import { beforeEach, describe, expect, it, vi } from "vitest";

// documents.service.ts's upload path predates this project's test suite
// and remains largely untested (quota math, zip batching) — see
// PROGRESS.md. This file is scoped narrowly to the new storage-persistence
// wiring, not a full backfill of the whole module.

vi.mock("@/utils/file-inspector", () => ({ inspectDocumentFile: vi.fn() }));
vi.mock("@/modules/organization/organization.service", () => ({ getEffectivePlan: vi.fn() }));
vi.mock("@/modules/organization/organization.repository", () => ({
  getMonthlyPagesUsed: vi.fn(),
  getDocumentsSubmittedSince: vi.fn(),
}));
vi.mock("@/modules/documents/documents.repository", () => ({
  createDocumentJob: vi.fn(),
  updateDocumentJob: vi.fn(),
  getDocumentJobForOrganization: vi.fn(),
  listFieldCorrections: vi.fn(),
  insertFieldCorrections: vi.fn(),
}));
vi.mock("@/modules/documents/documents.strategy", () => ({ getProcessingStrategy: vi.fn() }));
vi.mock("@/services/storage.service", () => ({
  buildStoragePath: vi.fn(),
  uploadDocumentFile: vi.fn(),
  createSignedPreviewUrl: vi.fn(),
}));

const fileInspector = await import("@/utils/file-inspector");
const orgService = await import("@/modules/organization/organization.service");
const orgRepository = await import("@/modules/organization/organization.repository");
const documentsRepository = await import("@/modules/documents/documents.repository");
const documentsStrategy = await import("@/modules/documents/documents.strategy");
const storageService = await import("@/services/storage.service");
const { processSingleDocument, getDocumentPreviewUrl, getFieldCorrections, saveFieldCorrections, confirmDocumentReview, rejectDocumentReview } =
  await import("@/modules/documents/documents.service");

function planFixture() {
  return {
    id: "plan_free",
    name: "free",
    price_monthly: 0,
    max_documents_per_month: 100,
    max_pages_per_document: 50,
    max_pages_per_month: 1000,
    max_file_size_mb: 10,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function jobFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "job_1",
    organization_id: "org_1",
    user_id: "user_1",
    file_name: "invoice.pdf",
    file_size_bytes: 1024,
    page_count: 1,
    azure_operation_id: null,
    status: "pending",
    document_type: "invoice",
    average_confidence: null,
    result_json: null,
    error_message: null,
    storage_path: null,
    review_status: "unreviewed",
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fileInspector.inspectDocumentFile).mockResolvedValue({
    fileName: "invoice.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    pageCount: 1,
  });
  vi.mocked(orgService.getEffectivePlan).mockResolvedValue({
    plan: planFixture() as never,
    subscription: null,
    periodStart: "2026-01-01T00:00:00.000Z",
  });
  vi.mocked(orgRepository.getMonthlyPagesUsed).mockResolvedValue(0);
  vi.mocked(orgRepository.getDocumentsSubmittedSince).mockResolvedValue(0);
  vi.mocked(documentsRepository.createDocumentJob).mockResolvedValue(jobFixture() as never);
  vi.mocked(documentsRepository.updateDocumentJob).mockImplementation(
    async (id, patch) => jobFixture({ id, ...patch }) as never,
  );
  vi.mocked(documentsStrategy.getProcessingStrategy).mockReturnValue({
    documentType: "invoice",
    submit: vi.fn().mockResolvedValue({ operationReference: "https://azure.example/op/1" }),
  });
  vi.mocked(storageService.buildStoragePath).mockReturnValue("org_1/job_1/invoice.pdf");
  vi.mocked(storageService.uploadDocumentFile).mockResolvedValue(undefined);
});

describe("processSingleDocument — storage persistence", () => {
  it("uploads the file to storage and persists storage_path before submitting for analysis", async () => {
    await processSingleDocument("org_1", "user_1", "invoice.pdf", new Uint8Array([1]), "invoice");

    expect(storageService.uploadDocumentFile).toHaveBeenCalledWith(
      "org_1/job_1/invoice.pdf",
      expect.any(Uint8Array),
      "application/pdf",
    );
    expect(documentsRepository.updateDocumentJob).toHaveBeenCalledWith("job_1", {
      storage_path: "org_1/job_1/invoice.pdf",
    });
  });

  it("still submits for analysis even when storage upload fails (non-fatal)", async () => {
    vi.mocked(storageService.uploadDocumentFile).mockRejectedValue(new Error("bucket unreachable"));

    await processSingleDocument("org_1", "user_1", "invoice.pdf", new Uint8Array([1]), "invoice");

    expect(documentsStrategy.getProcessingStrategy).toHaveBeenCalledWith("invoice");
    expect(documentsRepository.updateDocumentJob).not.toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({ storage_path: expect.anything() }),
    );
  });

  it("does not attempt storage upload for a job rejected by quota", async () => {
    vi.mocked(orgRepository.getMonthlyPagesUsed).mockResolvedValue(1000);

    await expect(
      processSingleDocument("org_1", "user_1", "invoice.pdf", new Uint8Array([1]), "invoice"),
    ).rejects.toThrow();

    expect(storageService.uploadDocumentFile).not.toHaveBeenCalled();
  });
});

describe("getDocumentPreviewUrl", () => {
  it("returns a signed URL when the job has a persisted file", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(
      jobFixture({ storage_path: "org_1/job_1/invoice.pdf" }) as never,
    );
    vi.mocked(storageService.createSignedPreviewUrl).mockResolvedValue("https://signed.example/x");

    const url = await getDocumentPreviewUrl("org_1", "job_1");

    expect(documentsRepository.getDocumentJobForOrganization).toHaveBeenCalledWith("job_1", "org_1");
    expect(storageService.createSignedPreviewUrl).toHaveBeenCalledWith("org_1/job_1/invoice.pdf");
    expect(url).toBe("https://signed.example/x");
  });

  it("returns null, without requesting a signed URL, when the job has no persisted file", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(
      jobFixture({ storage_path: null }) as never,
    );

    const url = await getDocumentPreviewUrl("org_1", "job_1");

    expect(url).toBeNull();
    expect(storageService.createSignedPreviewUrl).not.toHaveBeenCalled();
  });
});

function correctionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "correction_1",
    document_job_id: "job_1",
    field_name: "VendorName",
    previous_value: "Acme Corp",
    new_value: "Acme Corporation",
    edited_by: "user_1",
    edited_at: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

const completedJobWithFields = jobFixture({
  status: "completed",
  result_json: {
    documents: [{ fields: { VendorName: { content: "Acme Corp", confidence: 0.9 }, Total: { content: "$50.00", confidence: 0.8 } } }],
  },
});

describe("getFieldCorrections", () => {
  it("returns the full history plus the effective (latest-per-field) value", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(completedJobWithFields as never);
    vi.mocked(documentsRepository.listFieldCorrections).mockResolvedValue([
      correctionRow({ field_name: "VendorName", new_value: "Acme Corporation", edited_at: "2026-01-15T00:00:00.000Z" }),
      correctionRow({ field_name: "VendorName", new_value: "ACME Corporation", edited_at: "2026-01-16T00:00:00.000Z" }),
      correctionRow({ field_name: "Total", new_value: "$55.00", edited_at: "2026-01-15T00:00:00.000Z" }),
    ] as never);

    const result = await getFieldCorrections("org_1", "job_1");

    expect(documentsRepository.getDocumentJobForOrganization).toHaveBeenCalledWith("job_1", "org_1");
    expect(result.effective).toEqual({ VendorName: "ACME Corporation", Total: "$55.00" });
    expect(result.history).toHaveLength(3);
  });

  it("returns an empty effective map when nothing has ever been corrected", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(completedJobWithFields as never);
    vi.mocked(documentsRepository.listFieldCorrections).mockResolvedValue([]);

    const result = await getFieldCorrections("org_1", "job_1");

    expect(result.effective).toEqual({});
    expect(result.history).toEqual([]);
  });
});

describe("saveFieldCorrections", () => {
  it("throws a conflict error when the job hasn't finished processing", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(
      jobFixture({ status: "processing" }) as never,
    );

    await expect(saveFieldCorrections("org_1", "job_1", "user_1", { VendorName: "Acme Corporation" })).rejects.toThrow();
    expect(documentsRepository.insertFieldCorrections).not.toHaveBeenCalled();
  });

  it("computes previous_value from Azure's original result_json on a field's first-ever correction", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(completedJobWithFields as never);
    vi.mocked(documentsRepository.listFieldCorrections).mockResolvedValue([]);

    await saveFieldCorrections("org_1", "job_1", "user_1", { VendorName: "Acme Corporation" });

    expect(documentsRepository.insertFieldCorrections).toHaveBeenCalledWith([
      { document_job_id: "job_1", field_name: "VendorName", previous_value: "Acme Corp", new_value: "Acme Corporation", edited_by: "user_1" },
    ]);
  });

  it("computes previous_value from the prior correction, not Azure's original value, on a second edit", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(completedJobWithFields as never);
    vi.mocked(documentsRepository.listFieldCorrections).mockResolvedValue([
      correctionRow({ field_name: "VendorName", previous_value: "Acme Corp", new_value: "Acme Corporation" }),
    ] as never);

    await saveFieldCorrections("org_1", "job_1", "user_1", { VendorName: "ACME Corporation" });

    expect(documentsRepository.insertFieldCorrections).toHaveBeenCalledWith([
      { document_job_id: "job_1", field_name: "VendorName", previous_value: "Acme Corporation", new_value: "ACME Corporation", edited_by: "user_1" },
    ]);
  });

  it("skips a field 'corrected' to the value it already effectively has (no-op)", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(completedJobWithFields as never);
    vi.mocked(documentsRepository.listFieldCorrections).mockResolvedValue([]);

    await saveFieldCorrections("org_1", "job_1", "user_1", { VendorName: "Acme Corp" });

    expect(documentsRepository.insertFieldCorrections).not.toHaveBeenCalled();
  });

  it("resets review_status to unreviewed when correcting an already-confirmed job", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(
      { ...completedJobWithFields, review_status: "confirmed", reviewed_by: "user_2", reviewed_at: "2026-01-15T00:00:00.000Z" } as never,
    );
    vi.mocked(documentsRepository.listFieldCorrections).mockResolvedValue([]);

    await saveFieldCorrections("org_1", "job_1", "user_1", { VendorName: "Acme Corporation" });

    expect(documentsRepository.updateDocumentJob).toHaveBeenCalledWith("job_1", {
      review_status: "unreviewed",
      reviewed_by: null,
      reviewed_at: null,
    });
  });

  it("does not touch review_status when the job is already unreviewed", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(completedJobWithFields as never);
    vi.mocked(documentsRepository.listFieldCorrections).mockResolvedValue([]);

    await saveFieldCorrections("org_1", "job_1", "user_1", { VendorName: "Acme Corporation" });

    expect(documentsRepository.updateDocumentJob).not.toHaveBeenCalled();
  });
});

describe("confirmDocumentReview", () => {
  it("throws a conflict error when the job hasn't finished processing", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(
      jobFixture({ status: "pending" }) as never,
    );

    await expect(confirmDocumentReview("org_1", "job_1", "user_1")).rejects.toThrow();
  });

  it("sets review_status/reviewed_by/reviewed_at without touching corrections when none are given", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(completedJobWithFields as never);

    await confirmDocumentReview("org_1", "job_1", "user_1");

    expect(documentsRepository.insertFieldCorrections).not.toHaveBeenCalled();
    expect(documentsRepository.updateDocumentJob).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({ review_status: "confirmed", reviewed_by: "user_1" }),
    );
  });

  it("saves any accompanying corrections before setting the final confirmed status", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(completedJobWithFields as never);
    vi.mocked(documentsRepository.listFieldCorrections).mockResolvedValue([]);

    await confirmDocumentReview("org_1", "job_1", "user_1", { Total: "$55.00" });

    expect(documentsRepository.insertFieldCorrections).toHaveBeenCalledWith([
      { document_job_id: "job_1", field_name: "Total", previous_value: "$50.00", new_value: "$55.00", edited_by: "user_1" },
    ]);
    expect(documentsRepository.updateDocumentJob).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({ review_status: "confirmed" }),
    );
  });
});

describe("rejectDocumentReview", () => {
  it("sets review_status to rejected", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(completedJobWithFields as never);

    await rejectDocumentReview("org_1", "job_1", "user_1");

    expect(documentsRepository.updateDocumentJob).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({ review_status: "rejected", reviewed_by: "user_1" }),
    );
  });
});
