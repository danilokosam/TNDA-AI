import type { DocumentJobRow } from "@/modules/documents/documents.repository";

export interface ExportField {
  name: string;
  value: string;
}

/**
 * Provider-agnostic representation of one document's exportable data. Never
 * carries Azure's raw {content, value, confidence} field shape — that's
 * exactly what `buildExportRecord` below exists to strip away. Any future
 * serializer (XLSX, JSON, an ERP connector) or export-layer code consumes
 * only this type, never `DocumentJobRow.result_json` directly.
 */
export interface ExportRecord {
  jobId: string;
  fileName: string;
  documentType: DocumentJobRow["document_type"];
  reviewStatus: DocumentJobRow["review_status"];
  averageConfidence: DocumentJobRow["average_confidence"];
  createdAt: string;
  fields: ExportField[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Enumerates every field Azure returned for a document — the export
 * equivalent of the frontend's `extract-fields.ts#extractDocumentFields`
 * and this module's own `documents.service.ts#extractOriginalFieldValue`,
 * hand-duplicated the same deliberate way those two already are (see
 * `extractOriginalFieldValue`'s own doc comment — `@tnda-ai/shared` stays
 * empty by design). This is the ONLY place export code reads Azure's raw
 * `result_json` shape; everything downstream only ever sees the
 * `ExportRecord` this file produces. Returns `[]` for `generic`-type
 * results (no `documents[].fields` at all) and for anything malformed,
 * never throws. A field with neither a usable `content` nor `value`
 * contributes nothing (not an empty-string field) — the same "return null"
 * outcome `extractOriginalFieldValue` has for the identical case.
 */
function extractFieldsForExport(resultJson: Record<string, unknown> | null): ExportField[] {
  if (!resultJson) return [];

  const documents = resultJson.documents;
  if (!Array.isArray(documents)) return [];

  const fields: ExportField[] = [];

  for (const doc of documents) {
    if (!isRecord(doc) || !isRecord(doc.fields)) continue;

    for (const [name, field] of Object.entries(doc.fields)) {
      if (!isRecord(field)) continue;

      if (typeof field.content === "string" && field.content.length > 0) {
        fields.push({ name, value: field.content });
      } else if (typeof field.value === "string" || typeof field.value === "number") {
        fields.push({ name, value: String(field.value) });
      }
    }
  }

  return fields;
}

/**
 * Builds one document's export record: Azure's originally-extracted fields
 * (via `extractFieldsForExport`), overlaid with `effectiveFields` — the
 * same latest-correction-per-field map `documents.service.ts#getFieldCorrections`
 * already computes via `reduceToEffectiveFields`, passed in by the caller
 * rather than recomputed here, so this stays a pure function with no
 * repository access of its own. A field name present only in
 * `effectiveFields` (a correction for a field Azure never extracted) is
 * still included — a reviewed value is real data regardless of where it
 * originated.
 */
export function buildExportRecord(job: DocumentJobRow, effectiveFields: Record<string, string>): ExportRecord {
  const original = extractFieldsForExport(job.result_json);
  const originalByName = new Map(original.map((field) => [field.name, field.value]));
  const names = new Set([...originalByName.keys(), ...Object.keys(effectiveFields)]);

  const fields: ExportField[] = Array.from(names, (name) => ({
    name,
    value: effectiveFields[name] ?? originalByName.get(name) ?? "",
  }));

  return {
    jobId: job.id,
    fileName: job.file_name,
    documentType: job.document_type,
    reviewStatus: job.review_status,
    averageConfidence: job.average_confidence,
    createdAt: job.created_at,
    fields,
  };
}
