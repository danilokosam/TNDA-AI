import type { ResolvedExportTable } from "@/modules/documents/documents.export.configuration";
import { jsonSerializer } from "@/modules/documents/documents.export.serializer.json";
import { xmlSerializer } from "@/modules/documents/documents.export.serializer.xml";
import { xlsxSerializer } from "@/modules/documents/documents.export.serializer.xlsx";

/**
 * Registered export formats. Extend this tuple (and `SERIALIZERS` below) to
 * add a new one — nothing outside this file needs to change, mirroring
 * documents.strategy.ts's DOCUMENT_TYPES/STRATEGIES pattern exactly.
 */
export const EXPORT_FORMATS = ["csv", "json", "xml", "xlsx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * Turns a `ResolvedExportTable` (already field-selected, ordered, and
 * labeled by documents.export.configuration.ts#buildExportTable) into one
 * downloadable format. Never receives or reads Azure's raw result_json, nor
 * an `ExportRecord` — documents.export.mapper.ts is the only place that
 * happens (see docs/adr/0014-document-csv-export.md and
 * docs/adr/0015-configurable-export-formats.md). Async and `string | Buffer`
 * because the binary formats (XLSX) can only be produced asynchronously and
 * aren't text — every format implements the same signature so the route
 * layer never special-cases one format over another.
 */
export interface ExportSerializer {
  readonly format: ExportFormat;
  readonly contentType: string;
  readonly fileExtension: string;
  serialize(table: ResolvedExportTable): Promise<string | Buffer>;
}

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

/**
 * One row per document (never decomposed into per-line-item rows). Column
 * selection, ordering, and labeling are entirely `buildExportTable`'s
 * responsibility — this only turns an already-resolved table into RFC 4180
 * text: UTF-8 BOM-prefixed and CRLF-terminated so Windows Excel opens it
 * with correct encoding.
 */
async function buildCsvContent(table: ResolvedExportTable): Promise<string> {
  const header = toCsvRow(table.columns);
  const rows = table.rows.map((row) => toCsvRow(row.cells));

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
  json: jsonSerializer,
  xml: xmlSerializer,
  xlsx: xlsxSerializer,
};

export function getExportSerializer(format: ExportFormat): ExportSerializer {
  return SERIALIZERS[format];
}
