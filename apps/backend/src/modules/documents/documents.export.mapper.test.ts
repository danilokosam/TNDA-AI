import { describe, expect, it } from "vitest";
import { buildExportRecord } from "@/modules/documents/documents.export.mapper";
import type { DocumentJobRow } from "@/modules/documents/documents.repository";

function jobRow(overrides: Partial<DocumentJobRow> = {}): DocumentJobRow {
  return {
    id: "job_1",
    organization_id: "org_1",
    user_id: "user_1",
    file_name: "invoice.pdf",
    file_size_bytes: 1024,
    page_count: 1,
    azure_operation_id: null,
    status: "completed",
    document_type: "invoice",
    average_confidence: 0.9,
    result_json: null,
    storage_path: null,
    review_status: "unreviewed",
    reviewed_by: null,
    reviewed_at: null,
    deleted_at: null,
    retry_count: 0,
    is_retryable: null,
    claimed_by: null,
    claimed_at: null,
    lease_expires_at: null,
    lease_epoch: 0,
    next_attempt_at: null,
    error_message: null,
    created_at: "2026-01-15T00:00:00.000Z",
    updated_at: "2026-01-15T00:00:05.000Z",
    ...overrides,
  };
}

describe("buildExportRecord", () => {
  it("carries job metadata straight onto the record", () => {
    const record = buildExportRecord(
      jobRow({
        id: "job_9",
        file_name: "receipt.jpg",
        document_type: "receipt",
        review_status: "confirmed",
        average_confidence: 0.75,
        created_at: "2026-02-01T00:00:00.000Z",
      }),
      {},
    );

    expect(record).toMatchObject({
      jobId: "job_9",
      fileName: "receipt.jpg",
      documentType: "receipt",
      reviewStatus: "confirmed",
      averageConfidence: 0.75,
      createdAt: "2026-02-01T00:00:00.000Z",
    });
  });

  it("reads Azure's raw field content as the original value", () => {
    const resultJson = { documents: [{ fields: { VendorName: { content: "Acme Corp", confidence: 0.95 } } }] };
    const record = buildExportRecord(jobRow({ result_json: resultJson }), {});

    expect(record.fields).toEqual([{ name: "VendorName", value: "Acme Corp" }]);
  });

  it("falls back to a numeric `value` when `content` is absent", () => {
    const resultJson = { documents: [{ fields: { InvoiceTotal: { value: 199.99 } } }] };
    const record = buildExportRecord(jobRow({ result_json: resultJson }), {});

    expect(record.fields).toEqual([{ name: "InvoiceTotal", value: "199.99" }]);
  });

  it("uses the effective (corrected) value in place of Azure's original", () => {
    const resultJson = { documents: [{ fields: { VendorName: { content: "Acme Corp" } } }] };
    const record = buildExportRecord(jobRow({ result_json: resultJson }), { VendorName: "Acme Corporation" });

    expect(record.fields).toEqual([{ name: "VendorName", value: "Acme Corporation" }]);
  });

  it("includes a corrected field even when Azure never extracted it originally", () => {
    const record = buildExportRecord(jobRow({ result_json: { documents: [{ fields: {} }] } }), {
      CustomField: "Added by reviewer",
    });

    expect(record.fields).toEqual([{ name: "CustomField", value: "Added by reviewer" }]);
  });

  it("returns no fields for a generic (prebuilt-layout) result with no documents[].fields shape", () => {
    const record = buildExportRecord(
      jobRow({ document_type: "generic", result_json: { content: "raw markdown", pages: [] } }),
      {},
    );

    expect(record.fields).toEqual([]);
  });

  it("returns no fields when result_json is null", () => {
    const record = buildExportRecord(jobRow({ result_json: null }), {});
    expect(record.fields).toEqual([]);
  });

  it("skips a malformed field entry (neither a usable content nor value) without throwing", () => {
    const resultJson = { documents: [{ fields: { Weird: { confidence: 0.5 } } }] };
    const record = buildExportRecord(jobRow({ result_json: resultJson }), {});

    expect(record.fields).toEqual([]);
  });
});
