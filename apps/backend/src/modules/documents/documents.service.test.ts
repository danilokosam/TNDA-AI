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
  getDocumentJobForOrganization: vi.fn(),
  getDocumentJobForOrganizationIncludingDeleted: vi.fn(),
  listFieldCorrections: vi.fn(),
  insertFieldCorrections: vi.fn(),
  insertDocumentJobEvent: vi.fn(),
}));
vi.mock("@/modules/documents/documents.strategy", () => ({ getProcessingStrategy: vi.fn() }));
vi.mock("@/services/storage.service", () => ({
  buildStoragePath: vi.fn(),
  uploadDocumentFile: vi.fn(),
  createSignedPreviewUrl: vi.fn(),
  deleteDocumentFile: vi.fn(),
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
  it("records job_created then processing_started, in order, on a successful submission", async () => {
    await processSingleDocument("org_1", "user_1", "invoice.pdf", new Uint8Array([1]), "invoice");

    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenNthCalledWith(1, {
      document_job_id: "job_1",
      event_type: "job_created",
      actor_user_id: "user_1",
      from_status: null,
      to_status: "pending",
      metadata: { fileName: "invoice.pdf", documentType: "invoice" },
    });
    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenNthCalledWith(2, {
      document_job_id: "job_1",
      event_type: "processing_started",
      actor_user_id: null,
      from_status: "pending",
      to_status: "processing",
      metadata: {},
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

  it("records job_created then processing_failed when submission to Azure fails", async () => {
    vi.mocked(documentsStrategy.getProcessingStrategy).mockReturnValue({
      documentType: "invoice",
      submit: vi.fn().mockRejectedValue(new AzureServiceError("service unavailable", { status: 503 })),
    });

    await expect(
      processSingleDocument("org_1", "user_1", "invoice.pdf", new Uint8Array([1]), "invoice"),
    ).rejects.toThrow();

    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ event_type: "job_created", to_status: "pending" }),
    );
    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenNthCalledWith(2, {
      document_job_id: "job_1",
      event_type: "processing_failed",
      actor_user_id: null,
      from_status: "pending",
      to_status: "failed",
      metadata: { errorMessage: "service unavailable", isRetryable: true },
    });
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

describe("lifecycle events — polling outcomes", () => {
  it("records processing_completed, with a system (null) actor, when Azure reports success", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(
      jobFixture({ status: "processing", azure_operation_id: "op_1" }) as never,
    );
    vi.mocked(azureService.getAnalysisOperationStatus).mockResolvedValue({
      status: "succeeded",
      analyzeResult: { documents: [] },
    } as never);

    await getJobStatus("org_1", "job_1");

    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenCalledWith({
      document_job_id: "job_1",
      event_type: "processing_completed",
      actor_user_id: null,
      from_status: "processing",
      to_status: "completed",
      metadata: {},
    });
  });

  it("records processing_failed (terminal) when Azure itself reports the operation failed", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(
      jobFixture({ status: "processing", azure_operation_id: "op_1" }) as never,
    );
    vi.mocked(azureService.getAnalysisOperationStatus).mockResolvedValue({
      status: "failed",
      error: { code: "InvalidContent", message: "unreadable document" },
    } as never);

    await getJobStatus("org_1", "job_1");

    expect(documentsRepository.insertDocumentJobEvent).toHaveBeenCalledWith({
      document_job_id: "job_1",
      event_type: "processing_failed",
      actor_user_id: null,
      from_status: "processing",
      to_status: "failed",
      metadata: { errorMessage: "unreadable document", isRetryable: false },
    });
  });

  it("records nothing for a terminal job returned straight from the database (no Azure call)", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(
      jobFixture({ status: "completed" }) as never,
    );

    await getJobStatus("org_1", "job_1");

    expect(azureService.getAnalysisOperationStatus).not.toHaveBeenCalled();
    expect(documentsRepository.insertDocumentJobEvent).not.toHaveBeenCalled();
  });

  it("records nothing while Azure hasn't reached a terminal state yet", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(
      jobFixture({ status: "processing", azure_operation_id: "op_1" }) as never,
    );
    vi.mocked(azureService.getAnalysisOperationStatus).mockResolvedValue({ status: "running" } as never);

    await getJobStatus("org_1", "job_1");

    expect(documentsRepository.updateDocumentJob).not.toHaveBeenCalled();
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

describe("retry-state classification (is_retryable)", () => {
  it("classifies a submission-time 5xx Azure failure as retryable", async () => {
    vi.mocked(documentsStrategy.getProcessingStrategy).mockReturnValue({
      documentType: "invoice",
      submit: vi.fn().mockRejectedValue(new AzureServiceError("service unavailable", { status: 503 })),
    });

    await expect(
      processSingleDocument("org_1", "user_1", "invoice.pdf", new Uint8Array([1]), "invoice"),
    ).rejects.toThrow();

    expect(documentsRepository.updateDocumentJob).toHaveBeenCalledWith("job_1", {
      status: "failed",
      error_message: "service unavailable",
      is_retryable: true,
    });
  });

  it("classifies a submission-time 4xx Azure rejection as non-retryable", async () => {
    vi.mocked(documentsStrategy.getProcessingStrategy).mockReturnValue({
      documentType: "invoice",
      submit: vi.fn().mockRejectedValue(new AzureServiceError("bad request", { status: 400 })),
    });

    await expect(
      processSingleDocument("org_1", "user_1", "invoice.pdf", new Uint8Array([1]), "invoice"),
    ).rejects.toThrow();

    expect(documentsRepository.updateDocumentJob).toHaveBeenCalledWith("job_1", {
      status: "failed",
      error_message: "bad request",
      is_retryable: false,
    });
  });

  it("classifies a network-level failure with no HTTP status as retryable", async () => {
    vi.mocked(documentsStrategy.getProcessingStrategy).mockReturnValue({
      documentType: "invoice",
      submit: vi.fn().mockRejectedValue(new Error("fetch failed")),
    });

    await expect(
      processSingleDocument("org_1", "user_1", "invoice.pdf", new Uint8Array([1]), "invoice"),
    ).rejects.toThrow();

    expect(documentsRepository.updateDocumentJob).toHaveBeenCalledWith("job_1", {
      status: "failed",
      error_message: "Failed to submit document for analysis.",
      is_retryable: true,
    });
  });

  it("always classifies an Azure-reported operation failure as non-retryable, regardless of Azure's own error code", async () => {
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(
      jobFixture({ status: "processing", azure_operation_id: "op_1" }) as never,
    );
    vi.mocked(azureService.getAnalysisOperationStatus).mockResolvedValue({
      status: "failed",
      error: { code: "InvalidContent", message: "unreadable document" },
    } as never);

    await getJobStatus("org_1", "job_1");

    expect(documentsRepository.updateDocumentJob).toHaveBeenCalledWith("job_1", {
      status: "failed",
      error_message: "unreadable document",
      is_retryable: false,
    });
  });
});
