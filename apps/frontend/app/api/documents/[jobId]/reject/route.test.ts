// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/documents.service", () => ({
  rejectDocumentReview: vi.fn(),
}));

const documentsService = await import("@/services/documents.service");
const { POST } = await import("@/app/api/documents/[jobId]/reject/route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/documents/:jobId/reject", () => {
  it("forwards the JSON body to the service and returns the updated job", async () => {
    const job = { jobId: "job_42", reviewStatus: "rejected" };
    vi.mocked(documentsService.rejectDocumentReview).mockResolvedValue(job as never);

    const response = await POST(
      new Request("http://localhost/api/documents/job_42/reject", {
        method: "POST",
        body: JSON.stringify({ corrections: {} }),
      }),
      { params: Promise.resolve({ jobId: "job_42" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(job);
    expect(documentsService.rejectDocumentReview).toHaveBeenCalledWith("job_42", { corrections: {} });
  });

  it("translates a thrown service error into the uniform error envelope", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(documentsService.rejectDocumentReview).mockRejectedValue(new ApiError(409, "CONFLICT", "Not completed yet."));

    const response = await POST(
      new Request("http://localhost/api/documents/job_42/reject", {
        method: "POST",
        body: JSON.stringify({ corrections: {} }),
      }),
      { params: Promise.resolve({ jobId: "job_42" }) },
    );

    expect(response.status).toBe(409);
  });
});
