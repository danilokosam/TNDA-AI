import { describe, expect, it } from "vitest";
import { csvSerializer } from "@/modules/documents/documents.export.serializer";
import type { ResolvedExportTable } from "@/modules/documents/documents.export.configuration";

const BOM = "﻿";

function table(overrides: Partial<ResolvedExportTable> = {}): ResolvedExportTable {
  return {
    columns: ["Job ID", "File Name"],
    rows: [{ jobId: "job_1", cells: ["job_1", "invoice.pdf"] }],
    ...overrides,
  };
}

describe("csvSerializer", () => {
  it("returns just the header row for an empty table", async () => {
    const csv = await csvSerializer.serialize({ columns: ["Job ID"], rows: [] });
    expect(csv).toBe(`${BOM}Job ID`);
  });

  it("writes the header row and each row's cells, in the table's own column order", async () => {
    const csv = await csvSerializer.serialize(
      table({
        columns: ["Job ID", "File Name", "VendorName"],
        rows: [{ jobId: "job_1", cells: ["job_1", "invoice.pdf", "Acme Corp"] }],
      }),
    );
    const lines = csv.toString().replace(BOM, "").split("\r\n");

    expect(lines[0]).toBe("Job ID,File Name,VendorName");
    expect(lines[1]).toBe("job_1,invoice.pdf,Acme Corp");
  });

  it("writes one line per row", async () => {
    const csv = await csvSerializer.serialize(
      table({
        columns: ["Job ID"],
        rows: [
          { jobId: "job_1", cells: ["job_1"] },
          { jobId: "job_2", cells: ["job_2"] },
        ],
      }),
    );
    const lines = csv.toString().replace(BOM, "").split("\r\n");
    expect(lines).toEqual(["Job ID", "job_1", "job_2"]);
  });

  it("leaves an empty cell empty, never a placeholder", async () => {
    const csv = await csvSerializer.serialize(table({ columns: ["Average Confidence"], rows: [{ jobId: "job_1", cells: [""] }] }));
    const lines = csv.toString().replace(BOM, "").split("\r\n");
    expect(lines[1]).toBe("");
  });

  it("quotes a cell containing a comma", async () => {
    const csv = await csvSerializer.serialize(table({ columns: ["Address"], rows: [{ jobId: "job_1", cells: ["123 Main St, Suite 4"] }] }));
    expect(csv.toString()).toContain('"123 Main St, Suite 4"');
  });

  it("quotes and doubles internal quotes in a cell", async () => {
    const csv = await csvSerializer.serialize(table({ columns: ["Notes"], rows: [{ jobId: "job_1", cells: ['Says "urgent" on it'] }] }));
    expect(csv.toString()).toContain('"Says ""urgent"" on it"');
  });

  it("quotes a cell containing a newline", async () => {
    const csv = await csvSerializer.serialize(table({ columns: ["Notes"], rows: [{ jobId: "job_1", cells: ["Line one\nLine two"] }] }));
    expect(csv.toString()).toContain('"Line one\nLine two"');
  });

  it("preserves unicode content and prefixes the output with a UTF-8 BOM", async () => {
    const csv = await csvSerializer.serialize(table({ columns: ["VendorName"], rows: [{ jobId: "job_1", cells: ["Café Münchën 株式会社"] }] }));
    const text = csv.toString();
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("Café Münchën 株式会社");
  });

  it("exposes csv metadata for the route to use as response headers", () => {
    expect(csvSerializer.format).toBe("csv");
    expect(csvSerializer.contentType).toBe("text/csv; charset=utf-8");
    expect(csvSerializer.fileExtension).toBe("csv");
  });
});
