import type { DocumentType } from "@/types/api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ExtractedField {
  name: string;
  displayValue: string;
  confidence: number | null;
}

function extractDisplayValue(field: Record<string, unknown>): string {
  if (typeof field.content === "string" && field.content.length > 0) return field.content;
  if (typeof field.value === "string" || typeof field.value === "number") return String(field.value);
  return "—";
}

/**
 * Pulls `{name, displayValue, confidence}` out of `documents[].fields` — the
 * key-value extraction shape Azure's invoice/receipt/identity_document
 * prebuilt models return (see the backend's `utils/confidence.ts`, the most
 * authoritative source in this codebase for the real shape — `resultJson`
 * itself is stored verbatim from Azure, untyped, on the backend). Multiple
 * documents in one result are flattened into one list; a duplicate field
 * name from a second document is kept as its own entry, not merged.
 *
 * Deliberately doesn't attempt to model Azure's full `DocumentField` union
 * (`valueString`/`valueNumber`/`valueDate`/`valueCurrency`/...) — `content`
 * is the one field Azure always populates with a human-readable string
 * regardless of type, and is what the backend's own field-shaped test
 * fixtures (`confidence.test.ts`) already treat as authoritative via a
 * plain `value` key, checked here as a fallback. Anything genuinely
 * malformed is skipped, never thrown on — matches
 * `computeAverageConfidence`'s own defensive style exactly.
 */
export function extractDocumentFields(resultJson: Record<string, unknown> | null): ExtractedField[] {
  if (!resultJson) return [];

  const documents = resultJson.documents;
  if (!Array.isArray(documents)) return [];

  const fields: ExtractedField[] = [];

  for (const doc of documents) {
    if (!isRecord(doc) || !isRecord(doc.fields)) continue;

    for (const [name, field] of Object.entries(doc.fields)) {
      if (!isRecord(field)) continue;

      fields.push({
        name,
        displayValue: extractDisplayValue(field),
        confidence: typeof field.confidence === "number" ? field.confidence : null,
      });
    }
  }

  return fields;
}

export interface EffectiveField {
  name: string;
  originalValue: string;
  effectiveValue: string;
  isCorrected: boolean;
  confidence: number | null;
}

/**
 * Merges Azure's originally-extracted fields with the effective (latest)
 * value per field from `GET .../corrections` — what the review UI actually
 * edits and displays. `isCorrected` compares the effective value against
 * the original, not "does a correction exist for this field name": a field
 * corrected and then reverted back to Azure's original value should read
 * as uncorrected again (the full edit history, if that matters, lives in
 * the same response's `history` array, not here). `confidence` always
 * stays Azure's original score, even when corrected — a human override has
 * no confidence of its own to report.
 */
export function extractEffectiveFields(
  resultJson: Record<string, unknown> | null,
  effective: Record<string, string>,
): EffectiveField[] {
  return extractDocumentFields(resultJson).map((field) => {
    const effectiveValue = effective[field.name] ?? field.displayValue;
    return {
      name: field.name,
      originalValue: field.displayValue,
      effectiveValue,
      isCorrected: effectiveValue !== field.displayValue,
      confidence: field.confidence,
    };
  });
}

/**
 * The top-level `content` field — Azure's full OCR'd text for the whole
 * document, present on every model's result regardless of type (including
 * `generic`/prebuilt-layout, which has no per-field confidence at all — see
 * `computeAverageConfidence`). The one thing safe to show for any document
 * type without knowing which model produced it.
 */
export function extractRawContent(resultJson: Record<string, unknown> | null): string | null {
  if (!resultJson) return null;
  return typeof resultJson.content === "string" && resultJson.content.length > 0 ? resultJson.content : null;
}

/**
 * Mirrors the backend's `documents.strategy.ts` `STRATEGIES` table: `generic`
 * (Azure's prebuilt-layout model) is the only type that requests
 * `outputContentFormat: "markdown"` — the other three keep Azure's default
 * flat reading-order text. Verified against real source as of 2026-08-07.
 * Content format is a property of *document type*, not something derivable
 * from `resultJson` itself, so this can't live next to `extractRawContent`'s
 * other checks — hand-mirrored here the same way `DOCUMENT_TYPES` itself
 * already is in `types/api.ts`.
 */
export function isMarkdownContent(documentType: DocumentType): boolean {
  return documentType === "generic";
}
