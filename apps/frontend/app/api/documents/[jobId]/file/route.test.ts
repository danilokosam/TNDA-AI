// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/documents.service", () => ({
  removeDocumentFile: vi.fn(),
}));

const documentsService = await import("@/services/documents.service");
const { DELETE } = await import("@/app/api/documents/[jobId]/file/route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/documents/:jobId/file", () => {
  it("removes the file and returns the updated job", async () => {
    const job = { jobId: "job_42", storagePath: null };
    vi.mocked(documentsService.removeDocumentFile).mockResolvedValue(job as never);

    const response = await DELETE(new Request("http://localhost/api/documents/job_42/file", { method: "DELETE" }), {
      params: Promise.resolve({ jobId: "job_42" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(job);
    expect(documentsService.removeDocumentFile).toHaveBeenCalledWith("job_42");
  });

  it("translates a thrown service error into the uniform error envelope", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(documentsService.removeDocumentFile).mockRejectedValue(new ApiError(403, "FORBIDDEN", "Not allowed."));

    const response = await DELETE(new Request("http://localhost/api/documents/job_42/file", { method: "DELETE" }), {
      params: Promise.resolve({ jobId: "job_42" }),
    });

    expect(response.status).toBe(403);
  });
});
