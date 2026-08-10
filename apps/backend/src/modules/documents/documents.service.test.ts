import { beforeEach, describe, expect, it, vi } from "vitest";
import { zipSync } from "fflate";
import { AzureServiceError } from "@/utils/errors";

// documents.service.ts's upload path predates this project's test suite
// and had remained largely untested (quota math, zip batching) — this file
// said so explicitly, above, before this session. The `submitUpload` block
// below closes the specific gap most squarely inside "the upload-security
// boundary" (size-limit enforcement, before any bytes are even read; the
// single-vs-batch routing decision) without attempting a full backfill of
// quota math/zip-batch internals, which stay untested here deliberately,
// same as before.

vi.mock("@/utils/file-inspector", () => ({ inspectDocumentFile: vi.fn() }));
vi.mock("@/modules/organization/organization.service", () => ({ getEffectivePlan: vi.fn() }));
vi.mock("@/modules/organization/organization.repository", () => ({
  getMonthlyPagesUsed: vi.fn(),
  getDocumentsSubmittedSince: vi.fn(),
}));
vi.mock("@/modules/documents/documents.repository", () => ({
  createDocumentJob: vi.fn(),
  updateDocumentJob: vi.fn(),
  updateDocumentJobIfEpochMatches: vi.fn(),
  getDocumentJobForOrganization: vi.fn(),
  getDocumentJobForOrganizationIncludingDeleted: vi.fn(),
  listDocumentJobsForOrganization: vi.fn(),
  listFieldCorrections: vi.fn(),
  insertFieldCorrections: vi.fn(),
  insertDocumentJobEvent: vi.fn(),
  claimOrRenewDocumentJob: vi.fn(),
}));
vi.mock("@/modules/documents/documents.strategy", () => ({ getProcessingStrategy: vi.fn() }));
vi.mock("@/services/storage.service", () => ({
  buildStoragePath: vi.fn(),
  uploadDocumentFile: vi.fn(),
  createSignedPreviewUrl: vi.fn(),
  deleteDocumentFile: vi.fn(),
  downloadDocumentFile: vi.fn(),
}));
vi.mock("@/services/azure-document-intelligence.service", () => ({ getAnalysisOperationStatus: vi.fn() }));

const fileInspector = await import("@/utils/file-inspector");
const orgService = await import("@/modules/organization/organization.service");
const orgRepository = await import("@/modules/organization/organization.repository");
const documentsRepository = await import("@/modules/documents/documents.repository");
const documentsStrategy = await import("@/modules/documents/documents.strategy");
const storageService = await import("@/services/storage.service");
const azureService = await import("@/services/azure-document-intelligence.service");
const {
  submitUpload,
  processSingleDocument,
  processZipBatch,
  getJobStatus,
  getDocumentPreviewUrl,
  getFieldCorrections,
  saveFieldCorrections,
  confirmDocumentReview,
  rejectDocumentReview,
  removeDocumentFile,
  deleteDocument,
  computeNextAttemptDelayMs,
  isRetryExhausted,
  submitClaimedJobForProcessing,
  checkClaimedJobProgress,
  exportDocuments,
} = await import("@/modules/documents/documents.service");

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
    deleted_at: null,
    retry_count: 0,
    is_retryable: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event_1",
    document_job_id: "job_1",
    event_type: "job_created",
    actor_user_id: "user_1",
    from_status: null,
    to_status: "pending",
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
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
  vi.mocked(documentsRepository.insertDocumentJobEvent).mockResolvedValue(eventRow() as never);
  vi.mocked(documentsStrategy.getProcessingStrategy).mockReturnValue({
    documentType: "invoice",
    submit: vi.fn().mockResolvedValue({ operationReference: "https://azure.example/op/1" }),
  });
  vi.mocked(storageService.buildStoragePath).mockReturnValue("org_1/job_1/invoice.pdf");
  vi.mocked(storageService.uploadDocumentFile).mockResolvedValue(undefined);
  vi.mocked(storageService.deleteDocumentFile).mockResolvedValue(undefined);
});

describe("processSingleDocument — storage persistence", () => {
  it("uploads the file to storage and persists storage_path", async () => {
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

  it("still returns the created (pending) job even when storage upload fails (non-fatal)", async () => {
    vi.mocked(storageService.uploadDocumentFile).mockRejectedValue(new Error("bucket unreachable"));

    const job = await processSingleDocument("org_1", "user_1", "invoice.pdf", new Uint8Array([1]), "invoice");

    expect(job.status).toBe("pending");
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

/**
 * Wave 3 Phase 2, Step 7 — the upload path no longer submits to Azure
 * synchronously within the HTTP request; it persists the job as `pending`
 * and the worker (src/worker/) picks it up asynchronously. This is the
 * regression assertion locked decision #10 requires: proof the Azure
 * adapter is never touched during upload.
 */
describe("processSingleDocument / processZipBatch — no longer submit to Azure synchronously (Wave 3 Phase 2)", () => {
  it("returns the job as pending, without ever calling the Azure processing strategy", async () => {
    const job = await processSingleDocument("org_1", "user_1", "invoice.pdf", new Uint8Array([1]), "invoice");

    expect(job.status).toBe("pending");
    expect(documentsStrategy.getProcessingStrategy).not.toHaveBeenCalled();
  });

  it("accepts a batch file as pending, without ever calling the Azure processing strategy", async () => {
    const archive = zipSync({ "receipt.pdf": new Uint8Array([1, 2, 3]) });

    await processZipBatch("org_1", "user_1", archive, "invoice");

    expect(documentsStrategy.getProcessingStrategy).not.toHaveBeenCalled();
    expect(documentsRepository.createDocumentJob).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending" }),
    );
  });

  it("reports an accepted batch file as \"processing\" in the response summary — meaning accepted into the pipeline, not the job's literal DB status (still `pending`, per locked decision #3)", async () => {
    const archive = zipSync({ "receipt.pdf": new Uint8Array([1, 2, 3]) });

    const result = await processZipBatch("org_1", "user_1", archive, "invoice");

    expect(result.files[0]).toMatchObject({ status: "processing", fileName: "receipt.pdf" });
    expect(documentsRepository.createDocumentJob).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending" }),
    );
  });
});

describe("submitUpload — the upload-security boundary's entrypoint", () => {
  function fakeFile(sizeBytes: number, name = "invoice.pdf"): File {
    // A duck-typed stand-in, not a real `File` backed by `sizeBytes` of
    // actual memory — lets the over-limit case assert that no bytes are
    // ever read (`arrayBuffer` uncalled), and keeps the test fast at any
    // size, including realistic multi-MB thresholds.
    return {
      size: sizeBytes,
      name,
      arrayBuffer: vi.fn(),
    } as unknown as File;
  }

  it("rejects a file over the configured size limit with PayloadTooLargeError, before reading any of its bytes", async () => {
    const { env } = await import("@/config/env");
    const overLimitFile = fakeFile(env.MAX_UPLOAD_SIZE_MB * 1024 * 1024 + 1);

    await expect(submitUpload("org_1", "user_1", overLimitFile, "invoice")).rejects.toThrow(
      `Upload exceeds the maximum allowed size of ${env.MAX_UPLOAD_SIZE_MB}MB.`,
    );
    expect(overLimitFile.arrayBuffer).not.toHaveBeenCalled();
    expect(documentsRepository.createDocumentJob).not.toHaveBeenCalled();
  });

  it("accepts a file exactly at the size limit (boundary is inclusive, not off-by-one)", async () => {
    const { env } = await import("@/config/env");
    const exactLimitBytes = new Uint8Array(env.MAX_UPLOAD_SIZE_MB * 1024 * 1024);
    const exactLimitFile = new File([exactLimitBytes], "invoice.pdf");

    const result = await submitUpload("org_1", "user_1", exactLimitFile, "invoice");

    expect(result.kind).toBe("single");
  });

  it("routes a real .zip file to batch processing, based on its actual bytes, not its filename", async () => {
    vi.mocked(orgRepository.getDocumentsSubmittedSince).mockResolvedValue(0);
    const archive = zipSync({ "receipt.pdf": new Uint8Array([1, 2, 3]) });
    // Named with a misleading extension — routing must read the real
    // magic bytes (isZipFile), the same invariant file-inspector.ts
    // upholds one layer deeper for the files a batch then unpacks into.
    const zipFile = new File([archive], "not-a-zip.pdf");

    const result = await submitUpload("org_1", "user_1", zipFile, "invoice");

    expect(result.kind).toBe("batch");
    if (result.kind === "batch") {
      expect(result.batch.totalFiles).toBe(1);
    }
  });

  it("routes a non-.zip file to single-document processing", async () => {
    const singleFile = new File([new Uint8Array([1, 2, 3])], "invoice.pdf");

    const result = await submitUpload("org_1", "user_1", singleFile, "invoice");

    expect(result.kind).toBe("single");
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

describe("removeDocumentFile", () => {
  it("removes the file when called by the uploader", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobFixture({ user_id: "user_1", storage_path: "org_1/job_1/invoice.pdf" }) as never,
    );

    const result = await removeDocumentFile("org_1", "job_1", "user_1", "member");

    expect(storageService.deleteDocumentFile).toHaveBeenCalledWith("org_1/job_1/invoice.pdf");
    expect(documentsRepository.updateDocumentJob).toHaveBeenCalledWith("job_1", { storage_path: null });
    expect(result.storage_path).toBeNull();
  });

  it("removes the file when called by an org owner/admin who didn't upload it", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobFixture({ user_id: "user_1", storage_path: "org_1/job_1/invoice.pdf" }) as never,
    );

    await removeDocumentFile("org_1", "job_1", "user_2", "owner");

    expect(storageService.deleteDocumentFile).toHaveBeenCalled();
  });

  it("throws a forbidden error for a member who neither uploaded it nor is an owner/admin", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobFixture({ user_id: "user_1", storage_path: "org_1/job_1/invoice.pdf" }) as never,
    );

    await expect(removeDocumentFile("org_1", "job_1", "user_2", "member")).rejects.toThrow();
    expect(storageService.deleteDocumentFile).not.toHaveBeenCalled();
  });

  it("is idempotent — a no-op, not an error, when there's no file to remove", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobFixture({ user_id: "user_1", storage_path: null }) as never,
    );

    await removeDocumentFile("org_1", "job_1", "user_1", "member");

    expect(storageService.deleteDocumentFile).not.toHaveBeenCalled();
    expect(documentsRepository.updateDocumentJob).not.toHaveBeenCalled();
  });
});

describe("deleteDocument", () => {
  it("removes the file and soft-deletes the job when called by the uploader", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobFixture({ user_id: "user_1", storage_path: "org_1/job_1/invoice.pdf", deleted_at: null }) as never,
    );

    await deleteDocument("org_1", "job_1", "user_1", "member");

    expect(storageService.deleteDocumentFile).toHaveBeenCalledWith("org_1/job_1/invoice.pdf");
    expect(documentsRepository.updateDocumentJob).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({ storage_path: null, deleted_at: expect.any(String) }),
    );
  });

  it("soft-deletes when called by an org owner/admin who didn't upload it", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobFixture({ user_id: "user_1", storage_path: null, deleted_at: null }) as never,
    );

    await deleteDocument("org_1", "job_1", "user_2", "admin");

    expect(documentsRepository.updateDocumentJob).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({ deleted_at: expect.any(String) }),
    );
  });

  it("throws a forbidden error for a member who neither uploaded it nor is an owner/admin", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobFixture({ user_id: "user_1", deleted_at: null }) as never,
    );

    await expect(deleteDocument("org_1", "job_1", "user_2", "member")).rejects.toThrow();
    expect(documentsRepository.updateDocumentJob).not.toHaveBeenCalled();
  });

  it("is idempotent — a no-op when the job is already deleted", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobFixture({ user_id: "user_1", deleted_at: "2026-01-20T00:00:00.000Z" }) as never,
    );

    await deleteDocument("org_1", "job_1", "user_1", "member");

    expect(storageService.deleteDocumentFile).not.toHaveBeenCalled();
    expect(documentsRepository.updateDocumentJob).not.toHaveBeenCalled();
  });

  it("does not attempt a storage call when there's no file to remove", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobFixture({ user_id: "user_1", storage_path: null, deleted_at: null }) as never,
    );

    await deleteDocument("org_1", "job_1", "user_1", "member");

    expect(storageService.deleteDocumentFile).not.toHaveBeenCalled();
    expect(documentsRepository.updateDocumentJob).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({ deleted_at: expect.any(String) }),
    );
  });

  it("still soft-deletes the job even when the storage deletion call fails (non-fatal)", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobFixture({ user_id: "user_1", storage_path: "org_1/job_1/invoice.pdf", deleted_at: null }) as never,
    );
    vi.mocked(storageService.deleteDocumentFile).mockRejectedValue(new Error("bucket unreachable"));

    await deleteDocument("org_1", "job_1", "user_1", "member");

    expect(documentsRepository.updateDocumentJob).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({ deleted_at: expect.any(String) }),
    );
  });
});

// --- Wave 2: lifecycle event log ---------------------------------------
// Each describe block below locks down one part of the document_job_events
// invariant set: the right event fires for the right transition, with the
// right actor (null for system-caused Azure outcomes, the caller's userId
// for human-caused ones), and — just as important — no event fires for an
// operation that was a no-op or that never actually completed.

describe("lifecycle events — job submission", () => {
  // Wave 3 Phase 2, Step 7 — processSingleDocument no longer submits to
  // Azure synchronously, so it only ever records job_created now;
  // processing_started moves to the worker's submitClaimedJobForProcessing
  // (see that function's own describe block for its event-ordering tests).
  it("records only job_created on a successful upload", async () => {
    await processSingleDocument("org_1", "user_1", "invoice.pdf", new Uint8Array([1]), "invoice");

    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenCalledTimes(1);
    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenNthCalledWith(1, {
      document_job_id: "job_1",
      event_type: "job_created",
      actor_user_id: "user_1",
      from_status: null,
      to_status: "pending",
      metadata: { fileName: "invoice.pdf", documentType: "invoice" },
    });
  });

  it("records only job_created (to=rejected_quota) when the file is rejected by quota — never processing_started", async () => {
    vi.mocked(orgRepository.getMonthlyPagesUsed).mockResolvedValue(1000);
    vi.mocked(documentsRepository.createDocumentJob).mockResolvedValue(
      jobFixture({ status: "rejected_quota" }) as never,
    );

    await expect(
      processSingleDocument("org_1", "user_1", "invoice.pdf", new Uint8Array([1]), "invoice"),
    ).rejects.toThrow();

    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenCalledTimes(1);
    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "job_created", to_status: "rejected_quota", actor_user_id: "user_1" }),
    );
  });

  it("records job_created per accepted file in a zip batch, with that file's own name in metadata", async () => {
    vi.mocked(documentsRepository.createDocumentJob).mockResolvedValue(
      jobFixture({ id: "job_zip_1", file_name: "receipt.pdf" }) as never,
    );
    const archive = zipSync({ "receipt.pdf": new Uint8Array([1, 2, 3]) });

    await processZipBatch("org_1", "user_1", archive, "invoice");

    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        document_job_id: "job_zip_1",
        event_type: "job_created",
        metadata: { fileName: "receipt.pdf", documentType: "invoice" },
      }),
    );
  });
});

/**
 * Wave 3 Phase 2, Step 7 — getJobStatus is now a pure database read. Live
 * Azure polling and all Azure-related writes moved to the worker's own
 * `checkClaimedJobProgress` (see that function's own describe block below,
 * which already covers the succeeded/failed/still-running branches this
 * used to test here). GET /jobs/:id's only remaining job is returning
 * whatever the database already has, for any status, untouched.
 */
describe("getJobStatus — pure database read (Wave 3 Phase 2, Step 7)", () => {
  it("returns a pending job's row exactly as stored, without touching Azure", async () => {
    const job = jobFixture({ status: "pending" });
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(job as never);

    const result = await getJobStatus("org_1", "job_1");

    expect(result).toBe(job);
    expect(azureService.getAnalysisOperationStatus).not.toHaveBeenCalled();
    expect(documentsRepository.updateDocumentJob).not.toHaveBeenCalled();
    expect(documentsRepository.updateDocumentJobIfEpochMatches).not.toHaveBeenCalled();
    expect(documentsRepository.insertDocumentJobEvent).not.toHaveBeenCalled();
  });

  it("returns a processing job's row exactly as stored, without polling Azure — the worker owns polling now", async () => {
    const job = jobFixture({ status: "processing", azure_operation_id: "op_1" });
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(job as never);

    const result = await getJobStatus("org_1", "job_1");

    expect(result).toBe(job);
    expect(azureService.getAnalysisOperationStatus).not.toHaveBeenCalled();
    expect(documentsRepository.insertDocumentJobEvent).not.toHaveBeenCalled();
  });

  it("returns a terminal job's row exactly as stored", async () => {
    const job = jobFixture({ status: "completed" });
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(job as never);

    const result = await getJobStatus("org_1", "job_1");

    expect(result).toBe(job);
    expect(azureService.getAnalysisOperationStatus).not.toHaveBeenCalled();
    expect(documentsRepository.insertDocumentJobEvent).not.toHaveBeenCalled();
  });
});

describe("lifecycle events — review decisions", () => {
  it("records review_confirmed with the caller as actor", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(completedJobWithFields as never);

    await confirmDocumentReview("org_1", "job_1", "user_1");

    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenCalledWith({
      document_job_id: "job_1",
      event_type: "review_confirmed",
      actor_user_id: "user_1",
      from_status: "unreviewed",
      to_status: "confirmed",
      metadata: {},
    });
  });

  it("records review_rejected with the caller as actor", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(completedJobWithFields as never);

    await rejectDocumentReview("org_1", "job_1", "user_1");

    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenCalledWith({
      document_job_id: "job_1",
      event_type: "review_rejected",
      actor_user_id: "user_1",
      from_status: "unreviewed",
      to_status: "rejected",
      metadata: {},
    });
  });

  it("records review_reset when a correction lands on an already-confirmed job", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(
      { ...completedJobWithFields, review_status: "confirmed" } as never,
    );
    vi.mocked(documentsRepository.listFieldCorrections).mockResolvedValue([]);

    await saveFieldCorrections("org_1", "job_1", "user_1", { VendorName: "Acme Corporation" });

    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenCalledWith({
      document_job_id: "job_1",
      event_type: "review_reset",
      actor_user_id: "user_1",
      from_status: "confirmed",
      to_status: "unreviewed",
      metadata: {},
    });
  });

  it("records no review_reset event when the job was already unreviewed (nothing actually transitioned)", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(completedJobWithFields as never);
    vi.mocked(documentsRepository.listFieldCorrections).mockResolvedValue([]);

    await saveFieldCorrections("org_1", "job_1", "user_1", { VendorName: "Acme Corporation" });

    expect(documentsRepository.insertDocumentJobEvent).not.toHaveBeenCalled();
  });
});

describe("lifecycle events — file lifecycle", () => {
  it("records file_removed when a file is actually removed", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobFixture({ user_id: "user_1", storage_path: "org_1/job_1/invoice.pdf" }) as never,
    );

    await removeDocumentFile("org_1", "job_1", "user_1", "member");

    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenCalledWith({
      document_job_id: "job_1",
      event_type: "file_removed",
      actor_user_id: "user_1",
      from_status: "present",
      to_status: "removed",
      metadata: {},
    });
  });

  it("records no event for an idempotent no-op remove (no file present)", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobFixture({ user_id: "user_1", storage_path: null }) as never,
    );

    await removeDocumentFile("org_1", "job_1", "user_1", "member");

    expect(documentsRepository.insertDocumentJobEvent).not.toHaveBeenCalled();
  });

  it("records document_deleted when a document is soft-deleted", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobFixture({ user_id: "user_1", storage_path: null, deleted_at: null }) as never,
    );

    await deleteDocument("org_1", "job_1", "user_1", "member");

    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenCalledWith({
      document_job_id: "job_1",
      event_type: "document_deleted",
      actor_user_id: "user_1",
      from_status: "active",
      to_status: "deleted",
      metadata: {},
    });
  });

  it("records no event for an idempotent no-op delete (already deleted)", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobFixture({ user_id: "user_1", deleted_at: "2026-01-20T00:00:00.000Z" }) as never,
    );

    await deleteDocument("org_1", "job_1", "user_1", "member");

    expect(documentsRepository.insertDocumentJobEvent).not.toHaveBeenCalled();
  });
});

describe("lifecycle events — event-log failures never fail the underlying operation", () => {
  it("still returns the confirmed job even when recording the event itself fails", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(completedJobWithFields as never);
    vi.mocked(documentsRepository.insertDocumentJobEvent).mockRejectedValue(new Error("db unreachable"));

    const result = await confirmDocumentReview("org_1", "job_1", "user_1");

    expect(result.review_status).toBe("confirmed");
  });
});

/**
 * These cases used to run through processSingleDocument's own synchronous
 * submission call; since Wave 3 Phase 2 Step 7 removed that call, the
 * classifier (`isRetryableSubmissionFailure`) is only ever exercised via
 * the worker's own submission path now — see also the epoch-gated write
 * assertions already covered by submitClaimedJobForProcessing's own
 * describe block below (the 5xx-retryable, exhaustion, and epoch-loss
 * cases in particular).
 */
describe("retry-state classification (is_retryable) — via the worker's submission path (Wave 3 Phase 2)", () => {
  function pendingJobFixture(overrides: Record<string, unknown> = {}) {
    return jobFixture({ status: "pending", storage_path: "org_1/job_1/invoice.pdf", lease_epoch: 1, retry_count: 0, ...overrides });
  }

  it("classifies a submission-time 5xx Azure failure as retryable", async () => {
    vi.mocked(storageService.downloadDocumentFile).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(documentsStrategy.getProcessingStrategy).mockReturnValue({
      documentType: "invoice",
      submit: vi.fn().mockRejectedValue(new AzureServiceError("service unavailable", { status: 503 })),
    });
    vi.mocked(documentsRepository.updateDocumentJobIfEpochMatches).mockResolvedValue(jobFixture({ status: "failed" }) as never);

    await submitClaimedJobForProcessing(pendingJobFixture() as never, "worker-1", 3);

    expect(documentsRepository.updateDocumentJobIfEpochMatches).toHaveBeenCalledWith(
      "job_1",
      1,
      expect.objectContaining({ status: "failed", error_message: "service unavailable", is_retryable: true }),
    );
  });

  it("classifies a submission-time 429 as retryable (Wave 3 Phase 2 — not lumped in with other 4xx)", async () => {
    vi.mocked(storageService.downloadDocumentFile).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(documentsStrategy.getProcessingStrategy).mockReturnValue({
      documentType: "invoice",
      submit: vi.fn().mockRejectedValue(new AzureServiceError("too many requests", { status: 429, retryAfterSeconds: 12 })),
    });
    vi.mocked(documentsRepository.updateDocumentJobIfEpochMatches).mockResolvedValue(jobFixture({ status: "failed" }) as never);

    await submitClaimedJobForProcessing(pendingJobFixture() as never, "worker-1", 3);

    expect(documentsRepository.updateDocumentJobIfEpochMatches).toHaveBeenCalledWith(
      "job_1",
      1,
      expect.objectContaining({ status: "failed", error_message: "too many requests", is_retryable: true }),
    );
  });

  it("classifies a submission-time 4xx Azure rejection as non-retryable", async () => {
    vi.mocked(storageService.downloadDocumentFile).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(documentsStrategy.getProcessingStrategy).mockReturnValue({
      documentType: "invoice",
      submit: vi.fn().mockRejectedValue(new AzureServiceError("bad request", { status: 400 })),
    });
    vi.mocked(documentsRepository.updateDocumentJobIfEpochMatches).mockResolvedValue(jobFixture({ status: "failed" }) as never);

    await submitClaimedJobForProcessing(pendingJobFixture() as never, "worker-1", 3);

    expect(documentsRepository.updateDocumentJobIfEpochMatches).toHaveBeenCalledWith(
      "job_1",
      1,
      expect.objectContaining({ status: "failed", error_message: "bad request", is_retryable: false }),
    );
  });

  it("classifies a network-level failure with no HTTP status as retryable", async () => {
    vi.mocked(storageService.downloadDocumentFile).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(documentsStrategy.getProcessingStrategy).mockReturnValue({
      documentType: "invoice",
      submit: vi.fn().mockRejectedValue(new Error("fetch failed")),
    });
    vi.mocked(documentsRepository.updateDocumentJobIfEpochMatches).mockResolvedValue(jobFixture({ status: "failed" }) as never);

    await submitClaimedJobForProcessing(pendingJobFixture() as never, "worker-1", 3);

    expect(documentsRepository.updateDocumentJobIfEpochMatches).toHaveBeenCalledWith(
      "job_1",
      1,
      expect.objectContaining({ status: "failed", error_message: "Failed to submit document for analysis.", is_retryable: true }),
    );
  });
});

describe("computeNextAttemptDelayMs (Wave 3 Phase 2 — pure backoff formula)", () => {
  it("uses Retry-After verbatim (in ms) when Azure supplied one, ignoring the exponential formula entirely", () => {
    expect(computeNextAttemptDelayMs(0, 12)).toBe(12_000);
    expect(computeNextAttemptDelayMs(2, 5)).toBe(5_000);
  });

  it("caps a Retry-After value at the maximum delay", () => {
    expect(computeNextAttemptDelayMs(0, 3600)).toBe(600_000);
  });

  it("falls back to base*2^retryCount + jitter(0..10s) when no Retry-After is available", () => {
    // retryCount=0: base 30s, jitter in [0, 10s) => delay in [30_000, 40_000)
    for (let i = 0; i < 20; i++) {
      const delay = computeNextAttemptDelayMs(0);
      expect(delay).toBeGreaterThanOrEqual(30_000);
      expect(delay).toBeLessThan(40_000);
    }
  });

  it("doubles the exponential component per retry (2x multiplier)", () => {
    for (let i = 0; i < 20; i++) {
      const delay = computeNextAttemptDelayMs(1);
      expect(delay).toBeGreaterThanOrEqual(60_000);
      expect(delay).toBeLessThan(70_000);
    }
    for (let i = 0; i < 20; i++) {
      const delay = computeNextAttemptDelayMs(2);
      expect(delay).toBeGreaterThanOrEqual(120_000);
      expect(delay).toBeLessThan(130_000);
    }
  });

  it("caps the exponential+jitter formula at the maximum delay too", () => {
    // A large retryCount would otherwise blow well past 10 minutes.
    expect(computeNextAttemptDelayMs(10)).toBe(600_000);
  });
});

describe("isRetryExhausted (Wave 3 Phase 2)", () => {
  it("is not exhausted while retry_count is below maxRetries", () => {
    expect(isRetryExhausted(0, 3)).toBe(false);
    expect(isRetryExhausted(1, 3)).toBe(false);
    expect(isRetryExhausted(2, 3)).toBe(false);
  });

  it("is exhausted once retry_count reaches maxRetries — matching exactly what the claim RPC's own eligibility check enforces", () => {
    expect(isRetryExhausted(3, 3)).toBe(true);
    expect(isRetryExhausted(4, 3)).toBe(true);
  });
});

describe("submitClaimedJobForProcessing (Wave 3 Phase 2 — worker-driven submission)", () => {
  it("downloads bytes from Storage, re-inspects them, submits, and persists the operation id with an epoch-gated write", async () => {
    const job = jobFixture({ status: "pending", storage_path: "org_1/job_1/invoice.pdf", lease_epoch: 3, retry_count: 0 });
    vi.mocked(storageService.downloadDocumentFile).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(documentsRepository.updateDocumentJobIfEpochMatches).mockResolvedValue(
      jobFixture({ status: "processing", azure_operation_id: "https://azure.example/op/1" }) as never,
    );

    const result = await submitClaimedJobForProcessing(job as never, "worker-1", 3);

    expect(storageService.downloadDocumentFile).toHaveBeenCalledWith("org_1/job_1/invoice.pdf");
    expect(documentsRepository.updateDocumentJobIfEpochMatches).toHaveBeenCalledWith("job_1", 3, {
      status: "processing",
      azure_operation_id: "https://azure.example/op/1",
    });
    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "processing_started", metadata: { retryNumber: 0 } }),
    );
    expect(documentsRepository.insertDocumentJobEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "processing_retried" }),
    );
    expect(result?.status).toBe("processing");
  });

  it("records processing_retried before processing_started when retry_count > 0 (a retry-transitioned claim)", async () => {
    const job = jobFixture({ status: "pending", storage_path: "org_1/job_1/invoice.pdf", lease_epoch: 2, retry_count: 2 });
    vi.mocked(storageService.downloadDocumentFile).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(documentsRepository.updateDocumentJobIfEpochMatches).mockResolvedValue(jobFixture({ status: "processing" }) as never);

    await submitClaimedJobForProcessing(job as never, "worker-1", 3);

    const eventCalls = vi.mocked(documentsRepository.insertDocumentJobEvent).mock.calls.map((call) => call[0]);
    expect(eventCalls[0]).toMatchObject({ event_type: "processing_retried", metadata: { retryNumber: 2 } });
    expect(eventCalls[1]).toMatchObject({ event_type: "processing_started", metadata: { retryNumber: 2 } });
  });

  it("marks a job with no storage_path as terminal, non-retryable, without ever attempting to download or submit", async () => {
    const job = jobFixture({ status: "pending", storage_path: null, lease_epoch: 1, retry_count: 0 });
    vi.mocked(documentsRepository.updateDocumentJobIfEpochMatches).mockResolvedValue(jobFixture({ status: "failed" }) as never);

    await submitClaimedJobForProcessing(job as never, "worker-1", 3);

    expect(storageService.downloadDocumentFile).not.toHaveBeenCalled();
    expect(documentsStrategy.getProcessingStrategy).not.toHaveBeenCalled();
    expect(documentsRepository.updateDocumentJobIfEpochMatches).toHaveBeenCalledWith(
      "job_1",
      1,
      expect.objectContaining({
        status: "failed",
        is_retryable: false,
        claimed_by: null,
        claimed_at: null,
        lease_expires_at: null,
      }),
    );
    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "processing_failed", metadata: expect.objectContaining({ reason: "missing_storage_file" }) }),
    );
  });

  it("schedules a future next_attempt_at for a retryable, not-yet-exhausted submission failure", async () => {
    const job = jobFixture({ status: "pending", storage_path: "p", lease_epoch: 1, retry_count: 1 });
    vi.mocked(storageService.downloadDocumentFile).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(documentsStrategy.getProcessingStrategy).mockReturnValue({
      documentType: "invoice",
      submit: vi.fn().mockRejectedValue(new AzureServiceError("service unavailable", { status: 503 })),
    });
    vi.mocked(documentsRepository.updateDocumentJobIfEpochMatches).mockResolvedValue(jobFixture({ status: "failed" }) as never);

    const before = Date.now();
    await submitClaimedJobForProcessing(job as never, "worker-1", 3);

    const [, , patch] = vi.mocked(documentsRepository.updateDocumentJobIfEpochMatches).mock.calls[0]!;
    expect(patch).toMatchObject({ status: "failed", is_retryable: true, claimed_by: null });
    expect(typeof patch.next_attempt_at).toBe("string");
    expect(new Date(patch.next_attempt_at as string).getTime()).toBeGreaterThan(before);
    const eventCall = vi.mocked(documentsRepository.insertDocumentJobEvent).mock.calls.find(
      (c) => c[0].event_type === "processing_failed",
    )!;
    expect(eventCall[0].metadata).not.toHaveProperty("exhausted");
  });

  it("forces is_retryable=false and marks exhausted:true once retry_count has reached maxRetries, even for an otherwise-retryable failure type", async () => {
    const job = jobFixture({ status: "pending", storage_path: "p", lease_epoch: 1, retry_count: 3 });
    vi.mocked(storageService.downloadDocumentFile).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(documentsStrategy.getProcessingStrategy).mockReturnValue({
      documentType: "invoice",
      submit: vi.fn().mockRejectedValue(new AzureServiceError("service unavailable", { status: 503 })),
    });
    vi.mocked(documentsRepository.updateDocumentJobIfEpochMatches).mockResolvedValue(jobFixture({ status: "failed" }) as never);

    await submitClaimedJobForProcessing(job as never, "worker-1", 3);

    expect(documentsRepository.updateDocumentJobIfEpochMatches).toHaveBeenCalledWith(
      "job_1",
      1,
      expect.objectContaining({ is_retryable: false, next_attempt_at: null }),
    );
    const eventCall = vi.mocked(documentsRepository.insertDocumentJobEvent).mock.calls.find(
      (c) => c[0].event_type === "processing_failed",
    )!;
    expect(eventCall[0].metadata).toMatchObject({ exhausted: true });
  });

  it("returns null and records no event when the epoch-gated success write loses the race (lost ownership)", async () => {
    const job = jobFixture({ status: "pending", storage_path: "p", lease_epoch: 1, retry_count: 0 });
    vi.mocked(storageService.downloadDocumentFile).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(documentsRepository.updateDocumentJobIfEpochMatches).mockResolvedValue(null);

    const result = await submitClaimedJobForProcessing(job as never, "worker-1", 3);

    expect(result).toBeNull();
    expect(documentsRepository.insertDocumentJobEvent).not.toHaveBeenCalled();
  });

  it("returns null and records no event when the epoch-gated failure write loses the race", async () => {
    const job = jobFixture({ status: "pending", storage_path: "p", lease_epoch: 1, retry_count: 0 });
    vi.mocked(storageService.downloadDocumentFile).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(documentsStrategy.getProcessingStrategy).mockReturnValue({
      documentType: "invoice",
      submit: vi.fn().mockRejectedValue(new Error("boom")),
    });
    vi.mocked(documentsRepository.updateDocumentJobIfEpochMatches).mockResolvedValue(null);

    const result = await submitClaimedJobForProcessing(job as never, "worker-1", 3);

    expect(result).toBeNull();
    expect(documentsRepository.insertDocumentJobEvent).not.toHaveBeenCalled();
  });
});

describe("checkClaimedJobProgress (Wave 3 Phase 2 — worker-driven poll)", () => {
  it("persists a succeeded Azure result with an epoch-gated, claim-releasing write and records processing_completed", async () => {
    const job = jobFixture({ status: "processing", azure_operation_id: "op_1", lease_epoch: 4 });
    vi.mocked(azureService.getAnalysisOperationStatus).mockResolvedValue({
      status: "succeeded",
      analyzeResult: { documents: [] },
    } as never);
    vi.mocked(documentsRepository.updateDocumentJobIfEpochMatches).mockResolvedValue(jobFixture({ status: "completed" }) as never);

    const result = await checkClaimedJobProgress(job as never);

    expect(documentsRepository.updateDocumentJobIfEpochMatches).toHaveBeenCalledWith(
      "job_1",
      4,
      expect.objectContaining({ status: "completed", claimed_by: null, claimed_at: null, lease_expires_at: null }),
    );
    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "processing_completed" }),
    );
    expect(result?.status).toBe("completed");
  });

  it("persists an Azure-reported content failure as terminal (never retryable) with claim release", async () => {
    const job = jobFixture({ status: "processing", azure_operation_id: "op_1", lease_epoch: 4 });
    vi.mocked(azureService.getAnalysisOperationStatus).mockResolvedValue({
      status: "failed",
      error: { code: "InvalidContent", message: "unreadable document" },
    } as never);
    vi.mocked(documentsRepository.updateDocumentJobIfEpochMatches).mockResolvedValue(jobFixture({ status: "failed" }) as never);

    await checkClaimedJobProgress(job as never);

    expect(documentsRepository.updateDocumentJobIfEpochMatches).toHaveBeenCalledWith(
      "job_1",
      4,
      expect.objectContaining({ status: "failed", is_retryable: false, claimed_by: null }),
    );
  });

  it("returns the job unchanged, with no write and no event, while Azure is still running", async () => {
    const job = jobFixture({ status: "processing", azure_operation_id: "op_1", lease_epoch: 4 });
    vi.mocked(azureService.getAnalysisOperationStatus).mockResolvedValue({ status: "running" } as never);

    const result = await checkClaimedJobProgress(job as never);

    expect(documentsRepository.updateDocumentJobIfEpochMatches).not.toHaveBeenCalled();
    expect(documentsRepository.insertDocumentJobEvent).not.toHaveBeenCalled();
    expect(result).toBe(job);
  });

  it("returns null and records no event when the epoch-gated completion write loses the race", async () => {
    const job = jobFixture({ status: "processing", azure_operation_id: "op_1", lease_epoch: 4 });
    vi.mocked(azureService.getAnalysisOperationStatus).mockResolvedValue({ status: "succeeded", analyzeResult: {} } as never);
    vi.mocked(documentsRepository.updateDocumentJobIfEpochMatches).mockResolvedValue(null);

    const result = await checkClaimedJobProgress(job as never);

    expect(result).toBeNull();
    expect(documentsRepository.insertDocumentJobEvent).not.toHaveBeenCalled();
  });
});

describe("exportDocuments", () => {
  it("filters to completed jobs only and returns a CSV built from the matched jobs", async () => {
    vi.mocked(documentsRepository.listDocumentJobsForOrganization).mockResolvedValue({
      jobs: [
        jobFixture({
          id: "job_1",
          status: "completed",
          result_json: { documents: [{ fields: { VendorName: { content: "Acme" } } }] },
        }),
      ],
      nextCursor: null,
    } as never);
    vi.mocked(documentsRepository.listFieldCorrections).mockResolvedValue([]);

    const result = await exportDocuments("org_1", { format: "csv" } as never);

    expect(documentsRepository.listDocumentJobsForOrganization).toHaveBeenCalledWith("org_1", {
      status: "completed",
      documentType: undefined,
      search: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      limit: 5000,
    });
    expect(result.contentType).toBe("text/csv; charset=utf-8");
    expect(result.fileName).toMatch(/^documents-export-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(result.content).toContain("Acme");
  });

  it("applies effective (corrected) values from the field-correction history, not Azure's original", async () => {
    vi.mocked(documentsRepository.listDocumentJobsForOrganization).mockResolvedValue({
      jobs: [
        jobFixture({ id: "job_1", result_json: { documents: [{ fields: { VendorName: { content: "Acme" } } }] } }),
      ],
      nextCursor: null,
    } as never);
    vi.mocked(documentsRepository.listFieldCorrections).mockResolvedValue([
      {
        id: "c1",
        document_job_id: "job_1",
        field_name: "VendorName",
        previous_value: "Acme",
        new_value: "Acme Corporation",
        edited_by: "user_1",
        edited_at: "2026-01-16T00:00:00.000Z",
      },
    ] as never);

    const result = await exportDocuments("org_1", { format: "csv" } as never);

    expect(result.content).toContain("Acme Corporation");
    expect(result.content).not.toContain(",Acme,");
  });

  it("throws PayloadTooLargeError without generating a CSV when more documents match than the row ceiling", async () => {
    vi.mocked(documentsRepository.listDocumentJobsForOrganization).mockResolvedValue({
      jobs: [jobFixture()],
      nextCursor: "some-cursor",
    } as never);

    await expect(exportDocuments("org_1", { format: "csv" } as never)).rejects.toMatchObject({
      statusCode: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
    expect(documentsRepository.listFieldCorrections).not.toHaveBeenCalled();
  });

  it("forwards documentType/search/date filters to the repository, never a status override", async () => {
    vi.mocked(documentsRepository.listDocumentJobsForOrganization).mockResolvedValue({
      jobs: [],
      nextCursor: null,
    } as never);

    await exportDocuments("org_1", {
      format: "csv",
      documentType: "receipt",
      search: "acme",
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-01-31T00:00:00.000Z",
    } as never);

    expect(documentsRepository.listDocumentJobsForOrganization).toHaveBeenCalledWith("org_1", {
      status: "completed",
      documentType: "receipt",
      search: "acme",
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-01-31T00:00:00.000Z",
      limit: 5000,
    });
  });
});
