import type { ExportSerializer } from "@/modules/documents/documents.export.serializer";
import type { ResolvedExportTable } from "@/modules/documents/documents.export.configuration";

/**
 * One JSON object per document, keyed by the resolved column *labels* (so a
 * renamed export is renamed in JSON too) — a deliberate, developer-facing
 * shape, not a literal re-encoding of the CSV/table's row-of-cells layout.
 * A flat array (no pagination/metadata envelope): this is a point-in-time
 * snapshot export, not a paginated API response. See
 * docs/adr/0015-configurable-export-formats.md for the full contract.
 */
async function buildJsonContent(table: ResolvedExportTable): Promise<string> {
  const records = table.rows.map((row) => {
    const record: Record<string, string> = {};
    table.columns.forEach((column, index) => {
      record[column] = row.cells[index] ?? "";
    });
    return record;
  });

  return JSON.stringify(records, null, 2);
}

export const jsonSerializer: ExportSerializer = {
  format: "json",
  contentType: "application/json; charset=utf-8",
  fileExtension: "json",
  serialize: buildJsonContent,
};
