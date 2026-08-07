// @vitest-environment node
// Route Handlers are server-side Node code, not DOM code — see route.test.ts
// (the sibling POST test) for why this matters concretely, not just in theory.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobDto } from "@/types/api";

vi.mock("@/services/documents.service", () => ({
  getJobStatus: vi.fn(),
  deleteDocument: vi.fn(),
}));

const documentsService = await import("@/services/documents.service");
const { GET, DELETE } = await import("@/app/api/documents/[jobId]/route");

function jobDtoFixture(overrides: Partial<JobDto> = {}): JobDto {
  return {
    jobId: "job_1",
    status: "processing",
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
});

describe("GET /api/documents/:jobId", () => {
  it("returns the job status from the service", async () => {
    const job = jobDtoFixture({ jobId: "job_42", status: "completed" });
    vi.mocked(documentsService.getJobStatus).mockResolvedValue(job);

    const response = await GET(new Request("http://localhost/api/documents/job_42"), {
      params: Promise.resolve({ jobId: "job_42" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(job);
    expect(documentsService.getJobStatus).toHaveBeenCalledWith("job_42");
  });

  it("translates a thrown service error (e.g. not found) into the uniform error envelope", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(documentsService.getJobStatus).mockRejectedValue(new ApiError(404, "NOT_FOUND", "Job not found."));

    const response = await GET(new Request("http://localhost/api/documents/missing"), {
      params: Promise.resolve({ jobId: "missing" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("DELETE /api/documents/:jobId", () => {
  it("deletes the document and returns the confirmation", async () => {
    vi.mocked(documentsService.deleteDocument).mockResolvedValue({ jobId: "job_42" });

    const response = await DELETE(new Request("http://localhost/api/documents/job_42", { method: "DELETE" }), {
      params: Promise.resolve({ jobId: "job_42" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobId: "job_42" });
    expect(documentsService.deleteDocument).toHaveBeenCalledWith("job_42");
  });

  it("translates a thrown service error into the uniform error envelope", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(documentsService.deleteDocument).mockRejectedValue(new ApiError(403, "FORBIDDEN", "Not allowed."));

    const response = await DELETE(new Request("http://localhost/api/documents/job_42", { method: "DELETE" }), {
      params: Promise.resolve({ jobId: "job_42" }),
    });

    expect(response.status).toBe(403);
  });
});
