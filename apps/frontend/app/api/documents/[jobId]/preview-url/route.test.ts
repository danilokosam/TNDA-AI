// @vitest-environment node
// Route Handlers are server-side Node code, not DOM code — see the sibling
// upload route's test for why this matters concretely, not just in theory.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/documents.service", () => ({
  getPreviewUrl: vi.fn(),
}));

const documentsService = await import("@/services/documents.service");
const { GET } = await import("@/app/api/documents/[jobId]/preview-url/route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/documents/:jobId/preview-url", () => {
  it("returns the preview url from the service", async () => {
    vi.mocked(documentsService.getPreviewUrl).mockResolvedValue({ url: "https://signed.example/x" });

    const response = await GET(new Request("http://localhost/api/documents/job_42/preview-url"), {
      params: Promise.resolve({ jobId: "job_42" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://signed.example/x" });
    expect(documentsService.getPreviewUrl).toHaveBeenCalledWith("job_42");
  });

  it("returns { url: null } as-is when the job has no persisted file", async () => {
    vi.mocked(documentsService.getPreviewUrl).mockResolvedValue({ url: null });

    const response = await GET(new Request("http://localhost/api/documents/job_42/preview-url"), {
      params: Promise.resolve({ jobId: "job_42" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: null });
  });

  it("translates a thrown service error into the uniform error envelope", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(documentsService.getPreviewUrl).mockRejectedValue(new ApiError(404, "NOT_FOUND", "Job not found."));

    const response = await GET(new Request("http://localhost/api/documents/missing/preview-url"), {
      params: Promise.resolve({ jobId: "missing" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
