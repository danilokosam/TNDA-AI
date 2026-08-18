import type { ExportRecord } from "@/modules/documents/documents.export.mapper";
import { ValidationError } from "@/utils/errors";

/**
 * One requested output column: `field` names either one of the fixed
 * metadata keys below or a dynamic Azure-extracted field name (matched
 * against `ExportRecord.fields[].name`); `label` is the output header,
 * defaulting to the metadata field's display label or, for a dynamic
 * field, the field name itself.
 */
export interface ExportColumnSpec {
  field: string;
  label?: string;
}

/** Omitted `fieldSelection` reproduces the pre-configuration default export exactly (see `defaultFieldSelection`). */
export interface ExportConfiguration {
  fieldSelection?: ExportColumnSpec[];
}

export interface ResolvedExportRow {
  jobId: string;
  cells: string[];
}

export interface ResolvedExportTable {
  columns: string[];
  rows: ResolvedExportRow[];
}

const METADATA_COLUMNS: { field: string; label: string; extract: (record: ExportRecord) => string }[] = [
  { field: "jobId", label: "Job ID", extract: (record) => record.jobId },
  { field: "fileName", label: "File Name", extract: (record) => record.fileName },
  { field: "documentType", label: "Document Type", extract: (record) => record.documentType },
  { field: "reviewStatus", label: "Review Status", extract: (record) => record.reviewStatus },
  {
    field: "averageConfidence",
    label: "Average Confidence",
    extract: (record) => (record.averageConfidence === null ? "" : String(record.averageConfidence)),
  },
  { field: "createdAt", label: "Uploaded At", extract: (record) => record.createdAt },
];

/**
 * The table shape produced when no `ExportConfiguration` is given: the
 * fixed metadata columns (this app's original CSV column order), followed
 * by the alphabetically-sorted union of every dynamic field name present
 * across `records` — byte-for-byte what `csvSerializer` computed on its
 * own before this module existed.
 */
function defaultFieldSelection(records: ExportRecord[]): ExportColumnSpec[] {
  const dynamicFieldNames = Array.from(new Set(records.flatMap((record) => record.fields.map((field) => field.name)))).sort();
  return [...METADATA_COLUMNS.map((metadata) => ({ field: metadata.field })), ...dynamicFieldNames.map((name) => ({ field: name }))];
}

function resolveColumnLabel(spec: ExportColumnSpec): string {
  if (spec.label && spec.label.trim().length > 0) return spec.label;
  return METADATA_COLUMNS.find((metadata) => metadata.field === spec.field)?.label ?? spec.field;
}

function resolveCellValue(record: ExportRecord, field: string): string {
  const metadata = METADATA_COLUMNS.find((candidate) => candidate.field === field);
  if (metadata) return metadata.extract(record);
  return record.fields.find((candidate) => candidate.name === field)?.value ?? "";
}

function assertNoDuplicateFields(fieldSelection: ExportColumnSpec[]): void {
  const seen = new Set<string>();
  for (const spec of fieldSelection) {
    if (seen.has(spec.field)) {
      throw new ValidationError(`Field "${spec.field}" is selected more than once.`, { field: spec.field });
    }
    seen.add(spec.field);
  }
}

/**
 * Shapes `ExportRecord[]` into the flat, ordered table every format
 * serializer consumes — the export-configuration stage between the mapper
 * and the serializers (docs/adr/0015-configurable-export-formats.md).
 * Never touches `result_json` or mutates `records`; `config` is purely a
 * post-mapping filter/reorder/rename applied to the mapper's already
 * provider-agnostic output.
 */
export function buildExportTable(records: ExportRecord[], config?: ExportConfiguration): ResolvedExportTable {
  const fieldSelection = config?.fieldSelection ?? defaultFieldSelection(records);
  assertNoDuplicateFields(fieldSelection);

  const columns = fieldSelection.map(resolveColumnLabel);
  const rows = records.map((record) => ({
    jobId: record.jobId,
    cells: fieldSelection.map((spec) => resolveCellValue(record, spec.field)),
  }));

  return { columns, rows };
}
