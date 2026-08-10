import { describe, expect, it } from "vitest";
import { csvSerializer } from "@/modules/documents/documents.export.serializer";
import type { ExportRecord } from "@/modules/documents/documents.export.mapper";

function record(overrides: Partial<ExportRecord> = {}): ExportRecord {
  return {
    jobId: "job_1",
    fileName: "invoice.pdf",
    documentType: "invoice",
    reviewStatus: "unreviewed",
    averageConfidence: 0.92,
    createdAt: "2026-01-15T00:00:00.000Z",
    fields: [],
    ...overrides,
  };
}

describe("csvSerializer", () => {
  it("returns just the metadata header row for an empty record set", () => {
    const csv = csvSerializer.serialize([]);
    expect(csv).toBe("\uFEFFJob ID,File Name,Document Type,Review Status,Average Confidence,Uploaded At");
  });

  it("writes metadata columns and a document's fields", () => {
    const csv = csvSerializer.serialize([
      record({
        fields: [
          { name: "VendorName", value: "Acme Corp" },
          { name: "InvoiceTotal", value: "199.99" },
        ],
      }),
    ]);
    const lines = csv.replace("\uFEFF", "").split("\r\n");

    expect(lines[0]).toBe(
      "Job ID,File Name,Document Type,Review Status,Average Confidence,Uploaded At,InvoiceTotal,VendorName",
    );
    expect(lines[1]).toBe("job_1,invoice.pdf,invoice,unreviewed,0.92,2026-01-15T00:00:00.000Z,199.99,Acme Corp");
  });

  it("unions field names across mixed document types, leaving unrelated cells empty", () => {
    const csv = csvSerializer.serialize([
      record({ jobId: "job_1", documentType: "invoice", fields: [{ name: "InvoiceTotal", value: "100.00" }] }),
      record({ jobId: "job_2", documentType: "receipt", fields: [{ name: "MerchantName", value: "Corner Store" }] }),
    ]);
    const lines = csv.replace("\uFEFF", "").split("\r\n");

    expect(lines[0]).toBe(
      "Job ID,File Name,Document Type,Review Status,Average Confidence,Uploaded At,InvoiceTotal,MerchantName",
    );
    expect(lines[1]).toBe("job_1,invoice.pdf,invoice,unreviewed,0.92,2026-01-15T00:00:00.000Z,100.00,");
    expect(lines[2]).toBe("job_2,invoice.pdf,receipt,unreviewed,0.92,2026-01-15T00:00:00.000Z,,Corner Store");
  });

  it("renders a null average confidence as an empty cell, never a placeholder", () => {
    const csv = csvSerializer.serialize([record({ averageConfidence: null })]);
    const lines = csv.replace("\uFEFF", "").split("\r\n");
    expect(lines[1]).toBe("job_1,invoice.pdf,invoice,unreviewed,,2026-01-15T00:00:00.000Z");
  });

  it("quotes a field value containing a comma", () => {
    const csv = csvSerializer.serialize([record({ fields: [{ name: "Address", value: "123 Main St, Suite 4" }] })]);
    expect(csv).toContain('"123 Main St, Suite 4"');
  });

  it("quotes and doubles internal quotes in a field value", () => {
    const csv = csvSerializer.serialize([record({ fields: [{ name: "Notes", value: 'Says "urgent" on it' }] })]);
    expect(csv).toContain('"Says ""urgent"" on it"');
  });

  it("quotes a field value containing a newline", () => {
    const csv = csvSerializer.serialize([record({ fields: [{ name: "Notes", value: "Line one\nLine two" }] })]);
    expect(csv).toContain('"Line one\nLine two"');
  });

  it("preserves unicode content and prefixes the output with a UTF-8 BOM", () => {
    const csv = csvSerializer.serialize([record({ fields: [{ name: "VendorName", value: "Café Münchën 株式会社" }] })]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Café Münchën 株式会社");
  });

  it("sorts dynamic field columns alphabetically for deterministic ordering", () => {
    const csv = csvSerializer.serialize([
      record({
        fields: [
          { name: "VendorName", value: "Acme" },
          { name: "DueDate", value: "2026-02-01" },
          { name: "InvoiceTotal", value: "10.00" },
        ],
      }),
    ]);
    const header = csv.replace("\uFEFF", "").split("\r\n")[0];
    expect(header).toBe(
      "Job ID,File Name,Document Type,Review Status,Average Confidence,Uploaded At,DueDate,InvoiceTotal,VendorName",
    );
  });

  it("exposes csv metadata for the route to use as response headers", () => {
    expect(csvSerializer.format).toBe("csv");
    expect(csvSerializer.contentType).toBe("text/csv; charset=utf-8");
    expect(csvSerializer.fileExtension).toBe("csv");
  });
});
