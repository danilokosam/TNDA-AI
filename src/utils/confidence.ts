function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Averages every field-level confidence score found in an Azure Document
 * Intelligence result (`documents[].fields{name: {confidence, ...}}` — the
 * field-extraction shape used by the invoice/receipt/identity_document
 * prebuilt models). Returns `null`, not 0, when there's nothing to
 * average — most notably `generic` (Azure's prebuilt-layout model), which
 * produces OCR text/tables and has no per-field confidence at all, so a
 * `null` average is the honest answer, not a fabricated one.
 */
export function computeAverageConfidence(resultJson: Record<string, unknown> | null): number | null {
  if (!resultJson) {
    return null;
  }

  const documents = resultJson.documents;
  if (!Array.isArray(documents)) {
    return null;
  }

  const confidences: number[] = [];

  for (const doc of documents) {
    if (!isRecord(doc) || !isRecord(doc.fields)) {
      continue;
    }

    for (const field of Object.values(doc.fields)) {
      if (isRecord(field) && typeof field.confidence === "number") {
        confidences.push(field.confidence);
      }
    }
  }

  if (confidences.length === 0) {
    return null;
  }

  return confidences.reduce((total, value) => total + value, 0) / confidences.length;
}
