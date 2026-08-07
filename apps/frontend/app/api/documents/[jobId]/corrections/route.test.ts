// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/documents.service", () => ({
  getFieldCorrections: vi.fn(),
  saveFieldCorrections: vi.fn(),
}));

const documentsService = await import("@/services/documents.service");
const { GET, PATCH } = await import("@/app/api/documents/[jobId]/corrections/route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/documents/:jobId/corrections", () => {
  it("returns the corrections result from the service", async () => {
    const result = { effective: { VendorName: "Acme Corporation" }, history: [] };
    vi.mocked(documentsService.getFieldCorrections).mockResolvedValue(result);

    const response = await GET(new Request("http://localhost/api/documents/job_42/corrections"), {
      params: Promise.resolve({ jobId: "job_42" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(documentsService.getFieldCorrections).toHaveBeenCalledWith("job_42");
  });

  it("translates a thrown service error into the uniform error envelope", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(documentsService.getFieldCorrections).mockRejectedValue(new ApiError(404, "NOT_FOUND", "Job not found."));

    const response = await GET(new Request("http://localhost/api/documents/missing/corrections"), {
      params: Promise.resolve({ jobId: "missing" }),
    });

    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/documents/:jobId/corrections", () => {
  it("forwards the JSON body to the service and returns the updated job", async () => {
    const job = { jobId: "job_42", reviewStatus: "unreviewed" };
    vi.mocked(documentsService.saveFieldCorrections).mockResolvedValue(job as never);

    const response = await PATCH(
      new Request("http://localhost/api/documents/job_42/corrections", {
        method: "PATCH",
        body: JSON.stringify({ corrections: { Total: "$55.00" } }),
      }),
      { params: Promise.resolve({ jobId: "job_42" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(job);
    expect(documentsService.saveFieldCorrections).toHaveBeenCalledWith("job_42", { corrections: { Total: "$55.00" } });
  });

  it("translates a thrown service error into the uniform error envelope", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(documentsService.saveFieldCorrections).mockRejectedValue(new ApiError(409, "CONFLICT", "Not completed yet."));

    const response = await PATCH(
      new Request("http://localhost/api/documents/job_42/corrections", {
        method: "PATCH",
        body: JSON.stringify({ corrections: {} }),
      }),
      { params: Promise.resolve({ jobId: "job_42" }) },
    );

    expect(response.status).toBe(409);
  });
});
