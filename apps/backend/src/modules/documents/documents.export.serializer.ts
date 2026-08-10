import type { ExportRecord } from "@/modules/documents/documents.export.mapper";

/**
 * Registered export formats. Extend this tuple (and `SERIALIZERS` below) to
 * add a new one — nothing outside this file needs to change, mirroring
 * documents.strategy.ts's DOCUMENT_TYPES/STRATEGIES pattern exactly.
 */
export const EXPORT_FORMATS = ["csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * Turns a provider-agnostic ExportRecord[] into one downloadable format.
 * Never receives or reads Azure's raw result_json — documents.export.mapper.ts
 * is the only place that happens (see docs/adr/0014-document-csv-export.md).
 */
export interface ExportSerializer {
  readonly format: ExportFormat;
  readonly contentType: string;
  readonly fileExtension: string;
  serialize(records: ExportRecord[]): string;
}

const METADATA_COLUMNS = [
  "Job ID",
  "File Name",
  "Document Type",
  "Review Status",
  "Average Confidence",
  "Uploaded At",
] as const;

/** RFC 4180: quote a cell containing a comma, a double quote, or a newline; double any internal double quotes. */
function csvEscapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsvRow(cells: string[]): string {
  return cells.map(csvEscapeCell).join(",");
}

function metadataCells(record: ExportRecord): string[] {
  return [
    record.jobId,
    record.fileName,
    record.documentType,
    record.reviewStatus,
    record.averageConfidence === null ? "" : String(record.averageConfidence),
    record.createdAt,
  ];
}

/**
 * One row per document (never decomposed into per-line-item rows), wide
 * format: fixed metadata columns first, then the union of every field name
 * present across `records`, sorted alphabetically for a deterministic
 * column order regardless of request-to-request object-key iteration
 * order. A document missing a given field gets a genuinely empty cell,
 * never "—"/"N/A" (those are UI-only placeholders — see
 * extract-fields.ts's own extractDisplayValue on the frontend, deliberately
 * not reused here). UTF-8 BOM-prefixed and CRLF-terminated per RFC 4180,
 * so Windows Excel opens it with correct encoding.
 */
function buildCsvContent(records: ExportRecord[]): string {
  const fieldNames = Array.from(new Set(records.flatMap((record) => record.fields.map((field) => field.name)))).sort();

  const header = toCsvRow([...METADATA_COLUMNS, ...fieldNames]);

  const rows = records.map((record) => {
    const valueByName = new Map(record.fields.map((field) => [field.name, field.value]));
    const fieldCells = fieldNames.map((name) => valueByName.get(name) ?? "");
    return toCsvRow([...metadataCells(record), ...fieldCells]);
  });

  return `\uFEFF${[header, ...rows].join("\r\n")}`;
}

export const csvSerializer: ExportSerializer = {
  format: "csv",
  contentType: "text/csv; charset=utf-8",
  fileExtension: "csv",
  serialize: buildCsvContent,
};

const SERIALIZERS: Record<ExportFormat, ExportSerializer> = {
  csv: csvSerializer,
};

export function getExportSerializer(format: ExportFormat): ExportSerializer {
  return SERIALIZERS[format];
}
