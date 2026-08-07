// @vitest-environment node
//
// Route Handlers are server-side Node code, not DOM code — and jsdom (the
// project default) ships its own File/FormData/Blob that fail undici's
// internal webidl brand check when handed to the real Request.formData()
// parser used here. Confirmed with a plain-Node repro outside Vitest:
// jsdom's File is the mismatch, not a real bug in the route.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobDto } from "@/types/api";

vi.mock("@/services/documents.service", () => ({
  uploadDocument: vi.fn(),
  listDocuments: vi.fn(),
}));

const documentsService = await import("@/services/documents.service");
const { POST } = await import("@/app/api/documents/route");

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
});

// GET on this route (Stage 2) isn't covered here — it predates this test
// suite and was verified via real curl requests against the live backend
// instead (see PROGRESS.md §3.7/§6). Only POST (Stage 3, new) is tested.
describe("POST /api/documents", () => {
  it("uploads the file from form data and returns the service's response with 202", async () => {
    const uploadResult = { kind: "single" as const, job: jobDtoFixture() };
    vi.mocked(documentsService.uploadDocument).mockResolvedValue(uploadResult);

    const formData = new FormData();
    formData.set("file", new File(["content"], "invoice.pdf", { type: "application/pdf" }));
    const request = new Request("http://localhost/api/documents", { method: "POST", body: formData });

    const response = await POST(request);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(uploadResult);

    const callArg = vi.mocked(documentsService.uploadDocument).mock.calls[0]![0];
    expect(callArg.file).toBeInstanceOf(File);
    expect(callArg.file.name).toBe("invoice.pdf");
    expect(callArg.documentType).toBeUndefined();
  });

  it("forwards documentType when present in the form data", async () => {
    vi.mocked(documentsService.uploadDocument).mockResolvedValue({ kind: "single" as const, job: jobDtoFixture() });

    const formData = new FormData();
    formData.set("file", new File(["x"], "receipt.jpg", { type: "image/jpeg" }));
    formData.set("documentType", "receipt");
    const request = new Request("http://localhost/api/documents", { method: "POST", body: formData });

    await POST(request);

    const callArg = vi.mocked(documentsService.uploadDocument).mock.calls[0]![0];
    expect(callArg.documentType).toBe("receipt");
  });

  it("returns 400 VALIDATION_ERROR when no file is present, without calling the service", async () => {
    const request = new Request("http://localhost/api/documents", { method: "POST", body: new FormData() });

    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(documentsService.uploadDocument).not.toHaveBeenCalled();
  });

  it("translates a thrown service error into the uniform error envelope", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(documentsService.uploadDocument).mockRejectedValue(
      new ApiError(413, "PAYLOAD_TOO_LARGE", "File too large."),
    );
    const formData = new FormData();
    formData.set("file", new File(["x"], "a.pdf"));
    const request = new Request("http://localhost/api/documents", { method: "POST", body: formData });

    const response = await POST(request);

    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
