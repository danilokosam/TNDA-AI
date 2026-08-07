import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "../../test/query-client-wrapper";
import type { JobDto, UploadResponse } from "@/types/api";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

const { apiFetch } = await import("@/lib/api/http");
const { useUploadDocument, useJobStatus } = await import("@/features/upload/hooks");

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useUploadDocument", () => {
  it("POSTs a FormData body to /api/documents and resolves with the parsed response", async () => {
    const expected: UploadResponse = { kind: "single", job: jobFixture() };
    vi.mocked(apiFetch).mockResolvedValue(expected);
    const file = new File(["content"], "invoice.pdf", { type: "application/pdf" });

    const { result } = renderHook(() => useUploadDocument(), { wrapper: createQueryWrapper() });
    const response = await result.current.mutateAsync({ file });

    expect(response).toEqual(expected);
    const [path, schema, init] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toBe("/api/documents");
    expect(schema).toBeDefined();
    expect(init?.method).toBe("POST");
    expect((init?.body as FormData).get("file")).toBe(file);
  });

  it("includes documentType in the form data when provided", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ kind: "single", job: jobFixture() });
    const { result } = renderHook(() => useUploadDocument(), { wrapper: createQueryWrapper() });

    await result.current.mutateAsync({ file: new File(["x"], "r.jpg"), documentType: "receipt" });

    const [, , init] = vi.mocked(apiFetch).mock.calls[0]!;
    expect((init?.body as FormData).get("documentType")).toBe("receipt");
  });
});

describe("useJobStatus", () => {
  it("does not fetch when jobId is null", () => {
    renderHook(() => useJobStatus(null), { wrapper: createQueryWrapper() });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("fetches /api/documents/:jobId and returns the parsed job", async () => {
    const job = jobFixture({ jobId: "job_7" });
    vi.mocked(apiFetch).mockResolvedValue(job);

    const { result } = renderHook(() => useJobStatus("job_7"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.data).toEqual(job));
    const [path] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toBe("/api/documents/job_7");
  });

  describe("polling backoff (fake timers)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * `@testing-library/react`'s own `waitFor` doesn't cooperate with
     * Vitest's fake timers (it polls on a real `setInterval`, which never
     * fires while fake time is frozen) — this is the fake-timer-compatible
     * equivalent: advance in small steps, flushing microtasks between each,
     * until `predicate` is true or `maxMs` is exhausted. Deliberately
     * asserts *ranges*, not an exact millisecond, since the precise number
     * of scheduling ticks React Query needs internally isn't this hook's
     * contract to pin down — only "not too soon" and "eventually" are.
     */
    async function advanceUntil(predicate: () => boolean, maxMs: number, stepMs = 50): Promise<number> {
      let elapsed = 0;
      while (!predicate() && elapsed < maxMs) {
        await vi.advanceTimersByTimeAsync(stepMs);
        elapsed += stepMs;
      }
      return elapsed;
    }

    it("polls again after the backoff interval, then stops once the job is terminal", async () => {
      const statuses: JobDto["status"][] = ["pending", "processing", "completed"];
      let callCount = 0;
      vi.mocked(apiFetch).mockImplementation(() => Promise.resolve(jobFixture({ status: statuses[callCount++] })));

      const { result } = renderHook(() => useJobStatus("job_1"), { wrapper: createQueryWrapper() });

      await advanceUntil(() => result.current.data?.status === "pending", 1000);
      expect(result.current.data?.status).toBe("pending");
      expect(apiFetch).toHaveBeenCalledTimes(1);

      // Must not refetch near-instantly — the whole point of a backoff
      // schedule is that it isn't a fixed fast interval (§7 of PROGRESS.md).
      await vi.advanceTimersByTimeAsync(500);
      expect(apiFetch, "should not have refetched within 500ms — that's not a backoff").toHaveBeenCalledTimes(1);

      // First backoff step (nominally 2000ms) eventually elapses.
      await advanceUntil(() => result.current.data?.status === "processing", 5000);
      expect(result.current.data?.status).toBe("processing");
      expect(apiFetch).toHaveBeenCalledTimes(2);

      // Second backoff step (nominally 3000ms) eventually elapses; job is now terminal.
      await advanceUntil(() => result.current.data?.status === "completed", 8000);
      expect(result.current.data?.status).toBe("completed");
      expect(apiFetch).toHaveBeenCalledTimes(3);

      // No further polling, no matter how much time passes.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(apiFetch).toHaveBeenCalledTimes(3);
    });
  });
});
