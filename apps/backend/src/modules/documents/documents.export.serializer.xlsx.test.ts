import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { xlsxSerializer } from "@/modules/documents/documents.export.serializer.xlsx";
import type { ResolvedExportTable } from "@/modules/documents/documents.export.configuration";

// exceljs's own type declarations shadow the global `Buffer` interface with
// a minimal `extends ArrayBuffer` redeclaration, which breaks assignability
// against Node's real (generic) `Buffer` wherever `.load()` is called — an
// upstream exceljs/TypeScript issue, not a real type mismatch (this is the
// exact Buffer `xlsxSerializer.serialize` just produced).
async function readBackWorkbook(buffer: string | Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return workbook;
}

describe("xlsxSerializer", () => {
  it("produces a single worksheet workbook", async () => {
    const buffer = await xlsxSerializer.serialize({ columns: ["Job ID"], rows: [] });
    const workbook = await readBackWorkbook(buffer);

    expect(workbook.worksheets).toHaveLength(1);
  });

  it("writes the resolved columns as the header row", async () => {
    const table: ResolvedExportTable = {
      columns: ["Supplier", "Total"],
      rows: [{ jobId: "job_1", cells: ["Acme Corp", "199.99"] }],
    };

    const workbook = await readBackWorkbook(await xlsxSerializer.serialize(table));
    const sheet = workbook.worksheets[0]!;

    expect(sheet.getRow(1).getCell(1).value).toBe("Supplier");
    expect(sheet.getRow(1).getCell(2).value).toBe("Total");
  });

  it("writes one worksheet row per document row, aligned to the columns", async () => {
    const table: ResolvedExportTable = {
      columns: ["Job ID"],
      rows: [
        { jobId: "job_1", cells: ["job_1"] },
        { jobId: "job_2", cells: ["job_2"] },
      ],
    };

    const workbook = await readBackWorkbook(await xlsxSerializer.serialize(table));
    const sheet = workbook.worksheets[0]!;

    expect(sheet.getRow(2).getCell(1).value).toBe("job_1");
    expect(sheet.getRow(3).getCell(1).value).toBe("job_2");
    expect(sheet.rowCount).toBe(3);
  });

  it("leaves an empty cell empty, never a placeholder", async () => {
    const table: ResolvedExportTable = {
      columns: ["Average Confidence"],
      rows: [{ jobId: "job_1", cells: [""] }],
    };

    const workbook = await readBackWorkbook(await xlsxSerializer.serialize(table));
    const sheet = workbook.worksheets[0]!;

    expect(sheet.getRow(2).getCell(1).value).toBeNull();
  });

  it("preserves unicode content", async () => {
    const table: ResolvedExportTable = {
      columns: ["VendorName"],
      rows: [{ jobId: "job_1", cells: ["Café Münchën 株式会社"] }],
    };

    const workbook = await readBackWorkbook(await xlsxSerializer.serialize(table));
    const sheet = workbook.worksheets[0]!;

    expect(sheet.getRow(2).getCell(1).value).toBe("Café Münchën 株式会社");
  });

  it("returns a binary Buffer, not text", async () => {
    const buffer = await xlsxSerializer.serialize({ columns: ["Job ID"], rows: [] });
    expect(Buffer.isBuffer(buffer)).toBe(true);
  });

  it("exposes xlsx metadata for the route to use as response headers", () => {
    expect(xlsxSerializer.format).toBe("xlsx");
    expect(xlsxSerializer.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(xlsxSerializer.fileExtension).toBe("xlsx");
  });
});
