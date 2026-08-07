import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadResponseSchema, jobDtoSchema, type JobDto } from "@/types/api";

vi.mock("@/lib/api/backend-client", () => ({
  backendFetch: vi.fn(),
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getAccessToken: vi.fn(),
}));

const { backendFetch } = await import("@/lib/api/backend-client");
const { getAccessToken } = await import("@/lib/supabase/server-client");
const { uploadDocument, getJobStatus } = await import("@/services/documents.service");

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
