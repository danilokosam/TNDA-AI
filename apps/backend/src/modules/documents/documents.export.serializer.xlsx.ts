import ExcelJS from "exceljs";
import type { ExportSerializer } from "@/modules/documents/documents.export.serializer";
import type { ResolvedExportTable } from "@/modules/documents/documents.export.configuration";

/**
 * Single-sheet workbook: a bold header row from `table.columns`, then one
 * worksheet row per document, in the table's own resolved order — the same
 * flat, one-row-per-document shape every other serializer uses. Cell values
 * stay the same opaque display strings ADR 0014 already commits to (no
 * typed number/date/currency parsing); an empty cell is left genuinely
 * empty. Deliberately a single worksheet, no styling beyond a bold header —
 * see docs/adr/0015-configurable-export-formats.md for why multiple sheets
 * and richer formatting are out of scope for this phase. Uses `exceljs`,
 * not the more popular `xlsx` (SheetJS) package: SheetJS Community
 * Edition's npm distribution has unpatched high-severity advisories and is
 * effectively unmaintained, while `exceljs` is actively maintained.
 */
async function buildXlsxContent(table: ResolvedExportTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Documents");

  const headerRow = sheet.addRow(table.columns);
  headerRow.font = { bold: true };

  for (const row of table.rows) {
    sheet.addRow(row.cells.map((cell) => (cell === "" ? null : cell)));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export const xlsxSerializer: ExportSerializer = {
  format: "xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  fileExtension: "xlsx",
  serialize: buildXlsxContent,
};
