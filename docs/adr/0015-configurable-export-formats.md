# Configurable Export Formats: XLSX/JSON/XML Serializers and Stateless Column Mapping

## Status

Accepted

## Context

ADR 0014 shipped CSV-only export and explicitly named two pieces of un-precluded future work: additional export formats ("evaluate the three most valuable formats beyond CSV" — PROGRESS.md), and user-configurable exports (letting a user adapt column selection/order/naming to whatever destination system expects, without ever mutating the underlying document data). This ADR covers both, built together because they share one new architectural piece.

Research into what a B2B document-processing SaaS's customers actually need beyond CSV (QuickBooks/Xero import requirements, common B2B integration formats, e-invoicing standards) pointed at three additions, deliberately not the first guess of "whatever's popular":

- **XLSX** — QuickBooks Online's native import accepts CSV and XLSX directly; this is the highest-overlap format with existing CSV users who want something that opens cleanly in Excel.
- **JSON** — the natural fit for developers integrating TNDA-AI into their own systems or automation platforms (Zapier/Make/custom scripts), and architecturally a better match for this app's genuinely dynamic, per-document field set than a flattened table.
- **Generic XML** — reaches legacy/on-prem ERP and EDI-adjacent systems that only ingest XML feeds. Explicitly *not* UBL, Factur-X, CII, or any other e-invoicing/ERP XML standard: those are OASIS/EN16931-conformant schemas with mandatory, validated fields, and this app has no fixed invoice schema to honestly claim conformance with (ADR 0014's "opaque display-string" decision already established that boundary). Claiming standards compatibility here would be false advertising against this codebase's own architecture.

PDF and vendor-specific formats (QuickBooks IIF/QBO, Xero's exact CSV column contract) were considered and rejected: this product's inputs are already frequently PDFs (weak differentiation for a PDF "export"), and vendor-specific formats assume a fixed accounting schema this product doesn't have — a customer's chart of accounts differing from a guessed template would silently produce a broken import.

## Decision

### A shared export-configuration stage, inserted between the mapper and every serializer

```
ExportRecord[]  (unchanged — documents.export.mapper.ts's output, still Azure-shape-free)
  → buildExportTable(records, config?)     documents.export.configuration.ts (NEW)
  → ResolvedExportTable { columns: string[]; rows: { jobId; cells: string[] }[] }
  → serializer.serialize(table)            csv / json / xml / xlsx — format-only concern
```

Before this change, `csvSerializer` alone computed the "union of dynamic field names across records, sorted alphabetically, empty-fill any document missing a field" logic. Adding three more formats the same way would have meant writing that logic four times. `buildExportTable` extracts it once: given no `ExportConfiguration`, it reproduces the exact pre-existing default (6 fixed metadata columns in their original order, then the alphabetically-sorted dynamic-field union) — byte-identical to the original CSV output, which is what makes this change backward-compatible by construction rather than by careful discipline. Every serializer got simpler as a result (`csvSerializer` no longer knows what a "field union" is; it just prints a table).

`ExportConfiguration` is a single, minimal shape:

```ts
interface ExportColumnSpec { field: string; label?: string }
interface ExportConfiguration { fieldSelection?: ExportColumnSpec[] }
```

One ordered array does selection *and* ordering — there's no separate "ordering" concept. `field` matches either one of the 6 fixed metadata keys (`jobId`, `fileName`, `documentType`, `reviewStatus`, `averageConfidence`, `createdAt`) or any dynamic Azure-extracted field name; both are selectable, reorderable, and renameable through the same mechanism. Metadata columns are included in the same namespace as extracted fields deliberately: a real ERP import template (e.g. Xero's exact required-column contract) needs to *drop* `Job ID`/`Review Status`/`Average Confidence` entirely, not just reorder around them. A selected field missing on a given document renders as a genuinely empty cell/element/string, never a placeholder — unchanged from ADR 0014's rule. `buildExportTable` rejects a `fieldSelection` with a duplicate `field` (a `ValidationError`, 400) since a duplicated column is inherently ambiguous. This stage never reads `result_json` and never mutates `records` — it's a pure post-mapping filter/reorder/rename, preserving the document-domain independence ADR 0014 established.

### Format-specific serializers, one file each (per ADR 0014's own predicted extension pattern)

- **`documents.export.serializer.ts`** — unchanged interface *shape* conceptually, widened to `serialize(table): Promise<string | Buffer>` (async and binary-capable, since XLSX generation is inherently asynchronous and binary — every format implements the same signature so the route layer never special-cases one). Still owns `EXPORT_FORMATS`/the registry/`csvSerializer`.
- **`documents.export.serializer.xlsx.ts`** — `exceljs`, not the more commonly-reached-for `xlsx` (SheetJS) package: SheetJS Community Edition's npm distribution has unpatched high-severity prototype-pollution/ReDoS advisories and is effectively unmaintained upstream, while `exceljs` is actively maintained. Single worksheet, bold header row, no styling beyond that, no typed number/date/currency conversion (same opaque-string commitment as ADR 0014) — deliberately simple per this phase's scope.
- **`documents.export.serializer.json.ts`** — one JSON object per document, keyed by the resolved column **labels** (so a renamed export is renamed in the JSON too), not a literal re-encoding of the table's row-of-cells shape. A flat array, no pagination/metadata envelope — this is a point-in-time snapshot export, not a paginated API response.
- **`documents.export.serializer.xml.ts`** — one `<Document>` per record under a `<Documents>` root, one child element per resolved column. Column labels are sanitized into valid XML element names (whitespace stripped, other disallowed characters replaced with `_`, a leading digit prefixed with `_`); standard entity-escaping (`&<>"'`) on all text content. Two distinct labels sanitizing to the same element name is a known, accepted limitation of a generic schema, not solved here.

### Row ceiling: kept as one shared constant, benchmarked rather than assumed

XLSX has real per-row overhead beyond CSV's (styles, shared strings, zip compression). Rather than assume the existing `EXPORT_MAX_ROWS = 5000` was automatically safe for XLSX too, it was benchmarked directly: 5,000 rows × 15 columns of realistic invoice data serializes via `exceljs` in ~300ms and produces a ~0.27MB buffer — well inside a synchronous request budget. JSON/XML's cost profile (string building) is comparable to or cheaper than CSV's. Conclusion: one shared ceiling remains correct; a per-format ceiling would have been premature differentiation against no evidence of a real problem. Exports stay fully synchronous — nothing here changes ADR 0014's volume assumptions (this system's real scale, the Pro plan's 1,000-documents/month ceiling).

### API: GET stays exactly as-is; POST is new, additive, for configured exports only

`GET /api/v1/documents/export` is unchanged in shape (`exportDocumentsQuerySchema`) — new formats just extend the `format` enum, which `EXPORT_FORMATS` already drives automatically. This is what the plain format-picker menu uses.

`POST /api/v1/documents/export` (`exportDocumentsBodySchema`: the same filters + `format` + optional `fieldSelection`) is new and additive. A GET query string is a poor fit for an ordered array of `{field, label}` objects; POST avoids URL-encoding gymnastics without touching the working GET contract. Both routes share the same auth middleware, org filtering, completed-only/soft-delete semantics, and row ceiling — `documents.service.ts#exportDocuments`'s signature widened from `ExportDocumentsQuery` to `ExportDocumentsBody` (a structural superset; the GET path simply never populates `fieldSelection`).

The frontend BFF (`app/api/documents/export/route.ts`) mirrors this exactly: `GET` unchanged in behavior (now also passing `format` through, defaulting to `csv`), `POST` added as a thin passthrough — the body isn't re-validated in the BFF, since the backend's Zod schema is the single source of truth and already returns a structured `{error:{...}}` envelope on a bad shape (ADR 0001). `backendFetchFile`/`apiFetchFile` gained an optional `{method, body}` passthrough (additive, not a new duplicate helper) to support this.

### Frontend: two-phase UX, matching the two-phase backend rollout

- **Phase A** — the "Export CSV" button became an "Export ▾" menu (CSV/XLSX/JSON/XML), each item requesting the same default, unconfigured export in that format. Minimal UI change.
- **Phase B** — a "Customize columns…" menu item opens a `Sheet` panel (`DocumentsExportConfigureDialog`): a format select plus a checkbox/label-input/reorder-buttons row per available column, defaulting to *every* column included, in default order, with default labels — so exporting without touching anything reproduces the plain export's content. The dialog's available-columns list is a **client-side approximation**: it's derived (`features/documents/export-columns.ts#deriveAvailableExportColumns`) from the dynamic fields found on whatever page of documents is currently loaded in the Documents list (via the same `extractDocumentFields` the Results page already uses on `JobDto.resultJson`), not a query against the full filtered set. A field that only exists on a document outside the currently-loaded page won't appear as a checkbox option — it's still included by the plain, non-customized export. A dedicated "list available fields" backend endpoint was considered and rejected for this MVP as more backend surface than the value justified; this is a documented, accepted limitation, not an oversight.

A real implementation bug was caught here during manual verification (not by the automated suite, which always passed a stable `availableColumns` prop from first render): `DocumentsExportConfigureDialog` derived its initial column list once via a `useState` lazy initializer, so a dialog that happened to mount before the Documents list finished its first fetch would freeze on an empty/metadata-only column list forever, never picking up the real dynamic fields once they arrived. Fixed by remounting the dialog (a bumped `key`) every time it's opened from the menu, so it always starts from whatever is currently loaded. A regression test (`DocumentsExportButton.test.tsx`) now covers this exact sequence — prop starts empty, updates after "load," dialog opens showing the updated columns.

### Configurable-export persistence: explicitly not built

Per an explicit product-priority check during design (this is proactive roadmap investment, no concrete customer/ERP integration currently blocked on it), templates/saved configurations, database persistence, migrations, and RLS are **not** part of this work. `ExportConfiguration` is fully expressible as a stateless request parameter today; a template later is purely "this same JSON, saved with a name" — no redesign required if/when real usage data justifies building it.

## Consequences

- Adding a fifth format is now a new file implementing `ExportSerializer` plus one registry entry in `documents.export.serializer.ts` — `buildExportTable`, the route, and the BFF are all untouched, exactly as ADR 0014 predicted for CSV → XLSX/JSON.
- Column selection/ordering/renaming works uniformly across every format today and every format added later, for free, because it's implemented once in `buildExportTable` rather than per-serializer.
- The "available columns" list in the customize-columns dialog is a known, accepted approximation (current page's loaded data only) — a real gap if a customer's dynamic fields vary heavily across a large filtered set and they want to select a field that isn't on the visible page. Revisit with a dedicated backend endpoint only if this proves to matter in practice.
- Saved/reusable export templates, per-org/per-user configuration ownership, and any related persistence are real, named future capabilities — none are precluded by anything decided here, and none are built now.
- The row ceiling stays a single shared tuning constant; splitting it per format (or moving to an async export pipeline) requires no change to the `buildExportTable`/serializer/route contract, only evidence that the shared value has become wrong for some format.
- Generic XML's element-name sanitization can collide two distinct column labels into the same tag name; this is accepted for a v1 generic schema, not solved.
- Two things were deliberately verified via automated tests/benchmark rather than live full-stack data, by explicit decision rather than oversight: mixed-document-type export (no available test organization has more than one document type, and generating one would cost a real, unnecessary Azure Document Intelligence call) and the 5,000-row ceiling at real scale (no test organization has anywhere near that many documents; the `413` path and the `xlsxSerializer` benchmark both exercise real, unmocked code, just not through a live HTTP request at that volume). Revisit with real data if either mechanism changes.
