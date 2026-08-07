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
