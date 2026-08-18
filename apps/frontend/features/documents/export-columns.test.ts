import { describe, expect, it } from "vitest";
import { deriveAvailableExportColumns } from "@/features/documents/export-columns";
import type { JobDto } from "@/types/api";

function jobDto(overrides: Partial<JobDto> = {}): JobDto {
  return {
    jobId: "job_1",
    status: "completed",
    fileName: "invoice.pdf",
    fileSizeBytes: 1024,
    pageCount: 1,
    documentType: "invoice",
    averageConfidence: 0.9,
    resultJson: null,
    errorMessage: null,
    reviewStatus: "unreviewed",
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:05.000Z",
    ...overrides,
  };
}

describe("deriveAvailableExportColumns", () => {
  it("always includes the fixed metadata columns, in a stable order", () => {
    const columns = deriveAvailableExportColumns([]);

    expect(columns).toEqual([
      { field: "jobId", defaultLabel: "Job ID" },
      { field: "fileName", defaultLabel: "File Name" },
      { field: "documentType", defaultLabel: "Document Type" },
      { field: "reviewStatus", defaultLabel: "Review Status" },
      { field: "averageConfidence", defaultLabel: "Average Confidence" },
      { field: "createdAt", defaultLabel: "Uploaded At" },
    ]);
  });

  it("appends the alphabetically-sorted union of dynamic fields found across the given jobs", () => {
    const columns = deriveAvailableExportColumns([
      jobDto({ resultJson: { documents: [{ fields: { VendorName: { content: "Acme" } } }] } }),
      jobDto({ resultJson: { documents: [{ fields: { DueDate: { content: "2026-02-01" } } }] } }),
    ]);

    expect(columns.slice(6)).toEqual([
      { field: "DueDate", defaultLabel: "DueDate" },
      { field: "VendorName", defaultLabel: "VendorName" },
    ]);
  });

  it("deduplicates a field name that appears on more than one job", () => {
    const columns = deriveAvailableExportColumns([
      jobDto({ jobId: "job_1", resultJson: { documents: [{ fields: { VendorName: { content: "Acme" } } }] } }),
      jobDto({ jobId: "job_2", resultJson: { documents: [{ fields: { VendorName: { content: "Beta" } } }] } }),
    ]);

    expect(columns.slice(6)).toEqual([{ field: "VendorName", defaultLabel: "VendorName" }]);
  });

  it("skips jobs with no resultJson without throwing", () => {
    const columns = deriveAvailableExportColumns([jobDto({ resultJson: null })]);
    expect(columns.slice(6)).toEqual([]);
  });
});
