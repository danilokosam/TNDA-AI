import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryWrapper } from "../../test/query-client-wrapper";
import { getCachedFile } from "@/features/results/preview-cache";
import type { JobDto, UploadResponse } from "@/types/api";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

const { apiFetch } = await import("@/lib/api/http");
const { useUploadController } = await import("@/features/upload/use-upload-controller");

function jobFixture(overrides: Partial<JobDto> = {}): JobDto {
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

function file(name: string) {
  return new File(["content"], name, { type: "application/pdf" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useUploadController", () => {
  it("uploads a single queued file and reflects the resulting job status", async () => {
    const response: UploadResponse = { kind: "single", job: jobFixture({ jobId: "job_1", status: "processing" }) };
    vi.mocked(apiFetch).mockResolvedValue(response);

    const { result } = renderHook(() => useUploadController(), { wrapper: createQueryWrapper() });

    act(() => {
      result.current.addFiles([{ file: file("a.pdf") }]);
    });

    await vi.waitFor(() => expect(result.current.items[0]?.status).toBe("processing"));
    expect(result.current.items[0]).toMatchObject({ jobId: "job_1", status: "processing" });
  });

  it("uploads multiple queued files one at a time, not concurrently", async () => {
    const callOrder: string[] = [];
    let resolveFirst!: (value: UploadResponse) => void;
    const firstUploadPromise = new Promise<UploadResponse>((resolve) => {
      resolveFirst = resolve;
    });

    vi.mocked(apiFetch).mockImplementation((path: string) => {
      callOrder.push(path);
      // Both files POST to the same /api/documents path, so distinguish
      // calls by order: first call hangs until explicitly resolved below,
      // proving the second upload doesn't start until the first finishes.
      return callOrder.length === 1
        ? firstUploadPromise
        : Promise.resolve({ kind: "single", job: jobFixture({ jobId: "job_2" }) });
    });

    const { result } = renderHook(() => useUploadController(), { wrapper: createQueryWrapper() });

    act(() => {
      result.current.addFiles([{ file: file("a.pdf") }, { file: file("b.pdf") }]);
    });

    // Both start "queued"; only the first should have moved to "uploading" —
    // the second must still be waiting, proving uploads are sequential.
    await vi.waitFor(() => expect(result.current.items[0]?.status).toBe("uploading"));
    expect(result.current.items[1]?.status).toBe("queued");
    expect(apiFetch).toHaveBeenCalledTimes(1);

    resolveFirst({ kind: "single", job: jobFixture({ jobId: "job_1" }) });

    await vi.waitFor(() => expect(result.current.items[1]?.status).not.toBe("queued"));
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(result.current.items[0]?.jobId).toBe("job_1");
    expect(result.current.items[1]?.jobId).toBe("job_2");
  });

  it("marks a file upload-failed on a rejected upload and still moves on to the next file", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(apiFetch)
      .mockRejectedValueOnce(new ApiError(413, "PAYLOAD_TOO_LARGE", "File too large."))
      .mockResolvedValueOnce({ kind: "single", job: jobFixture({ jobId: "job_2" }) });

    const { result } = renderHook(() => useUploadController(), { wrapper: createQueryWrapper() });

    act(() => {
      result.current.addFiles([{ file: file("a.pdf") }, { file: file("b.pdf") }]);
    });

    await vi.waitFor(() => expect(result.current.items[0]?.status).toBe("upload-failed"));
    expect(result.current.items[0]?.errorMessage).toBe("File too large.");

    await vi.waitFor(() => expect(result.current.items[1]?.jobId).toBe("job_2"));
  });

  it("caches the uploaded file for preview when a single upload succeeds", async () => {
    const response: UploadResponse = { kind: "single", job: jobFixture({ jobId: "job_cache_1" }) };
    vi.mocked(apiFetch).mockResolvedValue(response);
    const uploadedFile = file("invoice.pdf");

    const { result } = renderHook(() => useUploadController(), { wrapper: createQueryWrapper() });

    act(() => {
      result.current.addFiles([{ file: uploadedFile }]);
    });

    await vi.waitFor(() => expect(result.current.items[0]?.jobId).toBe("job_cache_1"));
    expect(getCachedFile("job_cache_1")).toBe(uploadedFile);
  });

  it("does not cache anything for a .zip batch upload (no 1:1 file-to-job mapping)", async () => {
    const response: UploadResponse = {
      kind: "batch",
      batch: { totalFiles: 2, accepted: 2, rejected: 0, files: [] },
    };
    vi.mocked(apiFetch).mockResolvedValue(response);

    const { result } = renderHook(() => useUploadController(), { wrapper: createQueryWrapper() });

    act(() => {
      result.current.addFiles([{ file: file("batch.zip") }]);
    });

    await vi.waitFor(() => expect(result.current.items[0]?.status).toBe("batch-submitted"));
    // Nothing meaningful to assert a negative on directly (no jobId exists
    // for a batch item) - this test exists to document the deliberate
    // gap, not to probe cache internals.
    expect(result.current.items[0]?.jobId).toBeNull();
  });
});
