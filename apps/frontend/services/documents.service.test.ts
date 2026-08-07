import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  uploadResponseSchema,
  jobDtoSchema,
  documentsListResponseSchema,
  previewUrlResponseSchema,
  fieldCorrectionsResponseSchema,
  type JobDto,
  type DocumentsListResponse,
  type PreviewUrlResponse,
  type FieldCorrectionsResponse,
} from "@/types/api";

vi.mock("@/lib/api/backend-client", () => ({
  backendFetch: vi.fn(),
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getAccessToken: vi.fn(),
}));

const { backendFetch } = await import("@/lib/api/backend-client");
const { getAccessToken } = await import("@/lib/supabase/server-client");
const {
  uploadDocument,
  getJobStatus,
  listDocuments,
  getPreviewUrl,
  getFieldCorrections,
  saveFieldCorrections,
  confirmDocumentReview,
  rejectDocumentReview,
} = await import("@/services/documents.service");

function jobDtoFixture(overrides: Partial<JobDto> = {}): JobDto {
  return {
    jobId: "job_1",
    status: "pending",
    fileName: "invoice.pdf",
    fileSizeBytes: 2048,
    pageCount: null,
    documentType: "invoice",
    averageConfidence: null,
    resultJson: null,
    errorMessage: null,
    reviewStatus: "unreviewed",
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAccessToken).mockResolvedValue("test-access-token");
});

describe("uploadDocument", () => {
  it("POSTs a FormData body to /api/v1/documents with the file and access token", async () => {
    const expected = { kind: "single" as const, job: jobDtoFixture() };
    vi.mocked(backendFetch).mockResolvedValue(expected);
    const file = new File(["content"], "invoice.pdf", { type: "application/pdf" });

    const result = await uploadDocument({ file });

    expect(result).toEqual(expected);
    expect(backendFetch).toHaveBeenCalledTimes(1);
    const [path, schema, options] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(path).toBe("/api/v1/documents");
    expect(schema).toBe(uploadResponseSchema);
    expect(options?.method).toBe("POST");
    expect(options?.accessToken).toBe("test-access-token");
    expect(options?.body).toBeInstanceOf(FormData);
    expect((options?.body as FormData).get("file")).toBe(file);
  });

  it("omits documentType from the form data when not provided, letting the backend default apply", async () => {
    vi.mocked(backendFetch).mockResolvedValue({ kind: "single" as const, job: jobDtoFixture() });
    const file = new File(["x"], "a.pdf");

    await uploadDocument({ file });

    const [, , options] = vi.mocked(backendFetch).mock.calls[0]!;
    expect((options?.body as FormData).has("documentType")).toBe(false);
  });

  it("includes documentType in the form data when provided", async () => {
    vi.mocked(backendFetch).mockResolvedValue({ kind: "single" as const, job: jobDtoFixture() });
    const file = new File(["x"], "receipt.jpg", { type: "image/jpeg" });

    await uploadDocument({ file, documentType: "receipt" });

    const [, , options] = vi.mocked(backendFetch).mock.calls[0]!;
    expect((options?.body as FormData).get("documentType")).toBe("receipt");
  });

  it("returns the batch shape as-is for a .zip upload", async () => {
    const expected = {
      kind: "batch" as const,
      batch: { totalFiles: 2, accepted: 2, rejected: 0, files: [] },
    };
    vi.mocked(backendFetch).mockResolvedValue(expected);

    const result = await uploadDocument({ file: new File(["zip"], "batch.zip") });

    expect(result).toEqual(expected);
  });

  it("forwards undefined (not null) as the access token when there is no session", async () => {
    vi.mocked(getAccessToken).mockResolvedValue(null);
    vi.mocked(backendFetch).mockResolvedValue({ kind: "single" as const, job: jobDtoFixture() });

    await uploadDocument({ file: new File(["x"], "a.pdf") });

    const [, , options] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(options?.accessToken).toBeUndefined();
  });
});

describe("listDocuments", () => {
  const emptyResult: DocumentsListResponse = { data: [], pagination: { nextCursor: null, hasMore: false } };

  it("GETs /api/v1/documents with no query string when called with no params", async () => {
    vi.mocked(backendFetch).mockResolvedValue(emptyResult);

    const result = await listDocuments();

    expect(result).toEqual(emptyResult);
    expect(backendFetch).toHaveBeenCalledTimes(1);
    const [path, schema, options] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(path).toBe("/api/v1/documents");
    expect(schema).toBe(documentsListResponseSchema);
    expect(options?.accessToken).toBe("test-access-token");
  });

  it("builds a query string from every provided filter", async () => {
    vi.mocked(backendFetch).mockResolvedValue(emptyResult);

    await listDocuments({
      status: "completed",
      documentType: "invoice",
      search: "acme",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      cursor: "abc123",
      limit: 10,
    });

    const [path] = vi.mocked(backendFetch).mock.calls[0]!;
    const [, queryString] = (path as string).split("?");
    const query = new URLSearchParams(queryString);
    expect(query.get("status")).toBe("completed");
    expect(query.get("documentType")).toBe("invoice");
    expect(query.get("search")).toBe("acme");
    expect(query.get("dateFrom")).toBe("2026-01-01");
    expect(query.get("dateTo")).toBe("2026-01-31");
    expect(query.get("cursor")).toBe("abc123");
    expect(query.get("limit")).toBe("10");
  });

  it("omits params that weren't provided, rather than sending empty values", async () => {
    vi.mocked(backendFetch).mockResolvedValue(emptyResult);

    await listDocuments({ status: "failed" });

    const [path] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(path).toBe("/api/v1/documents?status=failed");
  });

  it("forwards undefined (not null) as the access token when there is no session", async () => {
    vi.mocked(getAccessToken).mockResolvedValue(null);
    vi.mocked(backendFetch).mockResolvedValue(emptyResult);

    await listDocuments();

    const [, , options] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(options?.accessToken).toBeUndefined();
  });
});

describe("getJobStatus", () => {
  it("GETs /api/v1/documents/jobs/:id with the access token and returns the parsed job", async () => {
    const job = jobDtoFixture({ jobId: "job_42", status: "completed" });
    vi.mocked(backendFetch).mockResolvedValue(job);

    const result = await getJobStatus("job_42");

    expect(result).toEqual(job);
    expect(backendFetch).toHaveBeenCalledTimes(1);
    const [path, schema, options] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(path).toBe("/api/v1/documents/jobs/job_42");
    expect(schema).toBe(jobDtoSchema);
    expect(options?.accessToken).toBe("test-access-token");
  });

  it("URL-encodes the job id", async () => {
    vi.mocked(backendFetch).mockResolvedValue(jobDtoFixture());

    await getJobStatus("job with spaces");

    const [path] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(path).toBe("/api/v1/documents/jobs/job%20with%20spaces");
  });
});

describe("getPreviewUrl", () => {
  it("GETs /api/v1/documents/jobs/:id/preview-url with the access token and returns the parsed result", async () => {
    const result: PreviewUrlResponse = { url: "https://signed.example/x" };
    vi.mocked(backendFetch).mockResolvedValue(result);

    const returned = await getPreviewUrl("job_42");

    expect(returned).toEqual(result);
    expect(backendFetch).toHaveBeenCalledTimes(1);
    const [path, schema, options] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(path).toBe("/api/v1/documents/jobs/job_42/preview-url");
    expect(schema).toBe(previewUrlResponseSchema);
    expect(options?.accessToken).toBe("test-access-token");
  });

  it("URL-encodes the job id", async () => {
    vi.mocked(backendFetch).mockResolvedValue({ url: null });

    await getPreviewUrl("job with spaces");

    const [path] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(path).toBe("/api/v1/documents/jobs/job%20with%20spaces/preview-url");
  });
});

describe("getFieldCorrections", () => {
  it("GETs /api/v1/documents/jobs/:id/corrections with the access token and returns the parsed result", async () => {
    const result: FieldCorrectionsResponse = { effective: { VendorName: "Acme Corporation" }, history: [] };
    vi.mocked(backendFetch).mockResolvedValue(result);

    const returned = await getFieldCorrections("job_42");

    expect(returned).toEqual(result);
    const [path, schema, options] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(path).toBe("/api/v1/documents/jobs/job_42/corrections");
    expect(schema).toBe(fieldCorrectionsResponseSchema);
    expect(options?.accessToken).toBe("test-access-token");
  });
});

describe("saveFieldCorrections", () => {
  it("PATCHes /api/v1/documents/jobs/:id/corrections with a JSON body and returns the parsed job", async () => {
    const job = jobDtoFixture({ reviewStatus: "unreviewed" });
    vi.mocked(backendFetch).mockResolvedValue(job);

    const returned = await saveFieldCorrections("job_42", { corrections: { Total: "$55.00" } });

    expect(returned).toEqual(job);
    const [path, schema, options] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(path).toBe("/api/v1/documents/jobs/job_42/corrections");
    expect(schema).toBe(jobDtoSchema);
    expect(options?.method).toBe("PATCH");
    expect(options?.body).toBe(JSON.stringify({ corrections: { Total: "$55.00" } }));
    expect(options?.accessToken).toBe("test-access-token");
  });
});

describe("confirmDocumentReview", () => {
  it("POSTs /api/v1/documents/jobs/:id/confirm with a JSON body and returns the parsed job", async () => {
    const job = jobDtoFixture({ reviewStatus: "confirmed" });
    vi.mocked(backendFetch).mockResolvedValue(job);

    const returned = await confirmDocumentReview("job_42", { corrections: {} });

    expect(returned).toEqual(job);
    const [path, schema, options] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(path).toBe("/api/v1/documents/jobs/job_42/confirm");
    expect(schema).toBe(jobDtoSchema);
    expect(options?.method).toBe("POST");
    expect(options?.body).toBe(JSON.stringify({ corrections: {} }));
  });
});

describe("rejectDocumentReview", () => {
  it("POSTs /api/v1/documents/jobs/:id/reject with a JSON body and returns the parsed job", async () => {
    const job = jobDtoFixture({ reviewStatus: "rejected" });
    vi.mocked(backendFetch).mockResolvedValue(job);

    const returned = await rejectDocumentReview("job_42", { corrections: {} });

    expect(returned).toEqual(job);
    const [path, schema, options] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(path).toBe("/api/v1/documents/jobs/job_42/reject");
    expect(schema).toBe(jobDtoSchema);
    expect(options?.method).toBe("POST");
  });
});
