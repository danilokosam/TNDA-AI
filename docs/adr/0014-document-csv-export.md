# Filter-Scoped, Synchronous CSV Export of Document Data

## Status

Accepted

## Context

Users need to get their processed document data out of TNDA-AI and into other business applications (accounting software, spreadsheets, an ERP staging import) — the product had no export capability of any kind before this. Investigation of the existing document domain surfaced several properties that shape what "export" can safely mean here:

- **The extracted schema is fully dynamic, not fixed.** `document_jobs.result_json` is Azure's raw, per-document response, stored as-is. For the three field-shaped document types (`invoice`, `receipt`, `identity_document`), the field set is whatever Azure's prebuilt model happened to return for that specific document — there is no static "invoice schema" anywhere in this codebase. `generic` (`prebuilt-layout`) results have no per-field structure at all.
- **Every field value this application already understands is an opaque display string.** `extractDisplayValue`/`extractOriginalFieldValue` (frontend and backend respectively) immediately stringify Azure's typed fields (`valueDate`, `valueCurrency`, `valueNumber`, ...) the moment they're read. Azure's type discriminators are not retained anywhere downstream.
- **Reviewed/corrected data lives as an audit-log overlay, not a rewrite.** `document_field_corrections` stores one row per edit; the "effective" value for a field is the latest correction, or Azure's original value if never corrected (`reduceToEffectiveFields`).
- **Repeated/nested Azure fields (e.g. an invoice's line items) are not part of this application's domain model today.** `extractDisplayValue` reads every field — array-typed ones included — as a single flattened string via Azure's `content` span; nothing in this codebase decomposes a line-item array into individual rows.
- **This is not a high-volume system.** The largest plan (Pro) caps at 1,000 documents/month; there is no realistic near-term scenario where a single organization's completed-document history reaches the point where synchronous CSV generation becomes a real latency problem.
- **The BFF architecture (ADR 0002) and tenant-isolation pattern (ADR 0005) already exist and are proven.** Every prior endpoint in this API returns JSON; export is the first to return a non-JSON body.

## Decision

### Mapper vs. serializer separation

Export is built as two small, single-purpose pieces, deliberately mirroring the existing `documents.strategy.ts` "small interface + registry" pattern used for Azure model selection:

- **`documents.export.mapper.ts`** — the only place export code reads Azure's raw `result_json` shape. `buildExportRecord(job, effectiveFields)` reads `result_json.documents[].fields`, overlays the caller-supplied effective-corrections map, and produces a `ExportRecord`: `{jobId, fileName, documentType, reviewStatus, averageConfidence, createdAt, fields: [{name, value}]}`. Nothing outside this file ever touches `result_json`.
- **`documents.export.serializer.ts`** — an `ExportSerializer` interface (`{format, contentType, fileExtension, serialize(records)}`) plus a format registry (`getExportSerializer`), with only `csvSerializer` implemented. It consumes `ExportRecord[]` exclusively; it has no knowledge of Azure, `document_jobs`, or corrections.

`documents.service.ts#exportDocuments` is the orchestration point: it queries `document_jobs` via the existing, unmodified `listDocumentJobsForOrganization`, reduces each job's correction history via the existing (unexported, same-file) `reduceToEffectiveFields`, calls the mapper once per job, and hands the resulting `ExportRecord[]` to the serializer. No new repository function was needed.

**Why this separation, and not one combined function:** the ADR-worthy property is what each side is *forbidden* from knowing. The serializer can be swapped (XLSX, JSON, a future ERP connector) without ever touching Azure-shape-parsing code, and the mapper can change how it reads a field without any format-specific code caring. This is the same reasoning ADR 0006 already applied to Azure model selection vs. the Azure REST adapter — decoupling "which provider/shape produced this" from "what do we do with it," generalized one layer further for the export boundary specifically.

### Phase 1 uses opaque display-string values, not typed/locale-aware formatting

`buildExportRecord` emits exactly the same string a human reviewer already sees in the Results page's field table — Azure's `content` span, or a correction's `new_value`, verbatim. No date reformatting, no decimal-separator normalization, no currency-symbol handling.

This was a real fork, not an oversight: Azure's typed field discriminators (`valueDate`, `valueCurrency`, ...) are never retained past the initial extraction anywhere in this codebase today. Honoring them for export would mean either (a) reading Azure's typed fields directly from the export layer — which breaks the mapper's one job, coupling export to Azure's raw shape for the sake of formatting — or (b) building a real typed-extraction layer in the domain model first, a materially larger change with no current product requirement forcing it. Opaque strings guarantee the exported value always matches what was reviewed and confirmed on screen, at zero new type-inference risk. Typed/locale-aware formatting is a legitimate future capability, gated on an actual typed-extraction layer existing — not attempted here.

### One CSV row represents one document

Nested/repeated Azure fields (an invoice's line items) are not decomposed into multiple rows. This preserves the current domain model exactly as-is: no code anywhere in this application reads a line-item array into individual records today, so doing it only for export would be new domain modeling smuggled into what should be a presentation-layer concern. Line-item detail is a named future capability, not attempted in Phase 1.

### Mixed document types are supported in a single export

A CSV's dynamic (non-metadata) columns are the union of every field name present across the exported set, sorted alphabetically for deterministic ordering. A document that doesn't have a given field gets a genuinely empty cell — never a UI placeholder like `"—"` or `"N/A"`, which a business-application CSV importer could otherwise misread as literal data. Restricting export to one document type per request, or splitting mixed-type exports into multiple files, was considered and rejected for Phase 1 as unnecessary complexity: a unioned, sparse CSV is still fully valid and importable, and the UI's filter bar already makes a same-type export the natural default without the export layer needing to enforce it.

### Export is synchronous, with a fixed row ceiling instead of an async job

`exportDocuments` runs entirely within the request/response cycle — no queue, no worker, no polling. This is a direct consequence of this system's real scale: even the Pro plan's 1,000-documents/month ceiling means an org's entire multi-year completed-document history is a fast, bounded, in-memory operation with zero external network calls in the critical path (unlike Wave 3's background worker, which exists specifically because Azure's poll latency is genuinely long and blocks a request — see ADR 0013). Building async export infrastructure now would be speculative complexity against a problem that doesn't exist yet.

A hard-coded `EXPORT_MAX_ROWS = 5000` ceiling (a policy constant in `documents.service.ts`, in the same category as that file's existing `RETRY_*` constants) is enforced by re-using the list repository's existing `limit`/`nextCursor` mechanics: the export query asks for `EXPORT_MAX_ROWS` rows, and a non-null `nextCursor` in the result means more rows matched than the ceiling allows. That case throws `PayloadTooLargeError` (413) with a message telling the user to narrow their filters — never a silent truncation. If real usage ever proves 5,000 too small, that's the trigger to build an async export-job pipeline (reusing the exact Postgres-claim pattern ADR 0012 already validated for Wave 3) — not a reason to raise the ceiling indefinitely.

### Filter-scoped only, no explicit row-selection UI

`GET /api/v1/documents/export` accepts the same filter shape as `GET /documents` (`documentType`, `search`, `dateFrom`, `dateTo`) minus `status` (export is unconditionally restricted to `completed` jobs — there is no way for a caller to request anything else) and minus `cursor`/`limit` (replaced by the internal ceiling). "Export what the current Documents-list filters resolve to" was chosen over building an explicit checkbox-based multi-select, because the Documents table has no row-selection capability today for *any* action (not even bulk delete) — adding one would be a materially larger UI change than this feature's scope justifies, and every stated business use case (bulk import into another system) is already served by filtering to the desired set and exporting all of it. Explicit per-row selection remains a legitimate fast-follow if/when checkbox selection is built for another reason (e.g. bulk delete).

### API and BFF shape

`GET /api/v1/documents/export?format=csv&documentType=&search=&dateFrom=&dateTo=`, behind the same `authMiddleware` every other `documents` route uses, with the same `organization_id`-filtered repository call (ADR 0005) — no new authorization mechanism. The route returns a raw `Response` (`text/csv; charset=utf-8`, `Content-Disposition: attachment`) rather than JSON — the first non-JSON response this API has ever returned. (Returning `set.headers` plus a plain string return value was tried first and rejected: Elysia appends its own default `Content-Type: text/plain` to a plain-string return regardless of `set.headers`, producing a combined, wrong header. A real `Response` object bypasses Elysia's own response construction entirely.)

Since every existing BFF helper (`backendFetch`/`apiFetch`) assumes a JSON body parsed through a Zod schema, two new sibling functions were added rather than overloading the existing ones: `backendFetchFile`/`apiFetchFile`, both delegating to a new `parseApiFileResponse` (which shares the same `{error:{...}}`-envelope-parsing logic as `parseApiResponse` on the failure path, but returns the raw `Response` on success instead of parsing a body). No existing JSON call path changed behavior.

## Consequences

- Adding a second export format (XLSX, JSON) is a new file implementing `ExportSerializer` plus one registry entry — the mapper, the route, and the BFF plumbing are all untouched.
- Line-item/nested-field export, typed/locale-aware value formatting, explicit row-selection export, and an async export pipeline are all real, named future capabilities — none are precluded by anything decided here, and none are built now.
- The 5,000-row ceiling is a tuning constant, not an architectural commitment; revisiting it (or building an async path instead) requires no change to the mapper/serializer/route contract.
- This is the first BFF route in the frontend that proxies a non-JSON body. Any future binary/file-returning endpoint should reuse `parseApiFileResponse`/`backendFetchFile`/`apiFetchFile` rather than re-deriving the pattern.
- Because export always forces `status: completed` server-side and ignores any client-supplied status, a user who exports while the Documents list is filtered to e.g. "Failed" gets a CSV containing only that org's `completed` documents matching the *other* active filters, not an empty file and not the failed ones — a deliberate product behavior worth remembering if support ever gets a "my export was empty" report.
