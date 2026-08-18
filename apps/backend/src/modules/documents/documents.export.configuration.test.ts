import { describe, expect, it } from "vitest";
import { buildExportTable } from "@/modules/documents/documents.export.configuration";
import { ValidationError } from "@/utils/errors";
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

describe("buildExportTable", () => {
  describe("default (no configuration)", () => {
    it("returns just the fixed metadata columns for an empty record set", () => {
      const table = buildExportTable([]);

      expect(table.columns).toEqual([
        "Job ID",
        "File Name",
        "Document Type",
        "Review Status",
        "Average Confidence",
        "Uploaded At",
      ]);
      expect(table.rows).toEqual([]);
    });

    it("appends the alphabetically-sorted union of dynamic fields after the fixed metadata columns", () => {
      const table = buildExportTable([
        record({
          fields: [
            { name: "VendorName", value: "Acme" },
            { name: "DueDate", value: "2026-02-01" },
            { name: "InvoiceTotal", value: "10.00" },
          ],
        }),
      ]);

      expect(table.columns).toEqual([
        "Job ID",
        "File Name",
        "Document Type",
        "Review Status",
        "Average Confidence",
        "Uploaded At",
        "DueDate",
        "InvoiceTotal",
        "VendorName",
      ]);
    });

    it("produces one row per record with cells aligned to the resolved columns", () => {
      const table = buildExportTable([record({ fields: [{ name: "VendorName", value: "Acme Corp" }] })]);

      expect(table.rows).toEqual([
        {
          jobId: "job_1",
          cells: ["job_1", "invoice.pdf", "invoice", "unreviewed", "0.92", "2026-01-15T00:00:00.000Z", "Acme Corp"],
        },
      ]);
    });

    it("renders a null average confidence as an empty cell, never a placeholder", () => {
      const table = buildExportTable([record({ averageConfidence: null })]);
      expect(table.rows[0]?.cells[4]).toBe("");
    });

    it("leaves a cell empty for a document missing a dynamic field present on another document", () => {
      const table = buildExportTable([
        record({ jobId: "job_1", fields: [{ name: "InvoiceTotal", value: "100.00" }] }),
        record({ jobId: "job_2", fields: [{ name: "MerchantName", value: "Corner Store" }] }),
      ]);

      expect(table.columns.slice(6)).toEqual(["InvoiceTotal", "MerchantName"]);
      expect(table.rows[0]?.cells.slice(6)).toEqual(["100.00", ""]);
      expect(table.rows[1]?.cells.slice(6)).toEqual(["", "Corner Store"]);
    });
  });

  describe("custom field selection", () => {
    it("selects only the requested fields, in the requested order", () => {
      const table = buildExportTable(
        [record({ fields: [{ name: "VendorName", value: "Acme" }, { name: "InvoiceTotal", value: "10.00" }] })],
        { fieldSelection: [{ field: "InvoiceTotal" }, { field: "jobId" }, { field: "VendorName" }] },
      );

      expect(table.columns).toEqual(["InvoiceTotal", "Job ID", "VendorName"]);
      expect(table.rows[0]?.cells).toEqual(["10.00", "job_1", "Acme"]);
    });

    it("uses a custom label when one is provided", () => {
      const table = buildExportTable([record({ fields: [{ name: "VendorName", value: "Acme" }] })], {
        fieldSelection: [{ field: "VendorName", label: "Supplier" }],
      });

      expect(table.columns).toEqual(["Supplier"]);
      expect(table.rows[0]?.cells).toEqual(["Acme"]);
    });

    it("falls back to the metadata field's default display label when no custom label is given", () => {
      const table = buildExportTable([record()], { fieldSelection: [{ field: "jobId" }] });
      expect(table.columns).toEqual(["Job ID"]);
    });

    it("falls back to the raw field name as the label for a dynamic field with no custom label", () => {
      const table = buildExportTable([record({ fields: [{ name: "VendorName", value: "Acme" }] })], {
        fieldSelection: [{ field: "VendorName" }],
      });
      expect(table.columns).toEqual(["VendorName"]);
    });

    it("leaves a cell empty when the selected field does not exist on that document", () => {
      const table = buildExportTable([record({ fields: [] })], {
        fieldSelection: [{ field: "VendorName" }],
      });
      expect(table.rows[0]?.cells).toEqual([""]);
    });

    it("throws a ValidationError when fieldSelection contains a duplicate field", () => {
      expect(() =>
        buildExportTable([record()], { fieldSelection: [{ field: "jobId" }, { field: "jobId", label: "ID" }] }),
      ).toThrow(ValidationError);
    });

    it("never mutates the input records", () => {
      const input = [record({ fields: [{ name: "VendorName", value: "Acme" }] })];
      const snapshot = JSON.parse(JSON.stringify(input));

      buildExportTable(input, { fieldSelection: [{ field: "VendorName", label: "Supplier" }] });

      expect(input).toEqual(snapshot);
    });
  });
});
