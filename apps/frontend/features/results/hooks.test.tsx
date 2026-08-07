import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "../../test/query-client-wrapper";
import type { FieldCorrectionsResponse, JobDto } from "@/types/api";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

const { apiFetch } = await import("@/lib/api/http");
const { useFieldCorrections, useSaveCorrections, useConfirmReview, useRejectReview } = await import(
  "@/features/results/hooks"
);

function jobFixture(overrides: Partial<JobDto> = {}): JobDto {
  return {
    jobId: "job_1",
    status: "completed",
    fileName: "invoice.pdf",
    fileSizeBytes: 2048,
    pageCount: 1,
    documentType: "invoice",
    averageConfidence: 0.9,
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

describe("useFieldCorrections", () => {
  it("fetches /api/documents/:jobId/corrections and returns the parsed result", async () => {
    const result: FieldCorrectionsResponse = { effective: { VendorName: "Acme Corporation" }, history: [] };
    vi.mocked(apiFetch).mockResolvedValue(result);

    const { result: hookResult } = renderHook(() => useFieldCorrections("job_1"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(hookResult.current.data).toEqual(result));
    const [path] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toBe("/api/documents/job_1/corrections");
  });

  it("does not fetch when enabled=false — a job with nothing to correct yet", () => {
    renderHook(() => useFieldCorrections("job_1", false), { wrapper: createQueryWrapper() });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("useSaveCorrections", () => {
  it("PATCHes /api/documents/:jobId/corrections with a JSON body and returns the parsed job", async () => {
    const job = jobFixture();
    vi.mocked(apiFetch).mockResolvedValue(job);

    const { result } = renderHook(() => useSaveCorrections(), { wrapper: createQueryWrapper() });
    const response = await result.current.mutateAsync({ jobId: "job_1", corrections: { Total: "$55.00" } });

    expect(response).toEqual(job);
    const [path, , init] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toBe("/api/documents/job_1/corrections");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ corrections: { Total: "$55.00" } }));
  });

  it("invalidates this job's status and corrections queries, and the documents list, on success", async () => {
    vi.mocked(apiFetch).mockResolvedValue(jobFixture());
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");

    const { result } = renderHook(() => useSaveCorrections(), { wrapper: createQueryWrapper() });
    await result.current.mutateAsync({ jobId: "job_1", corrections: { Total: "$55.00" } });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["job-status", "job_1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["field-corrections", "job_1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["documents-list"] });

    invalidateSpy.mockRestore();
  });
});

describe("useConfirmReview", () => {
  it("POSTs /api/documents/:jobId/confirm with a JSON body and returns the parsed job", async () => {
    const job = jobFixture({ reviewStatus: "confirmed" });
    vi.mocked(apiFetch).mockResolvedValue(job);

    const { result } = renderHook(() => useConfirmReview(), { wrapper: createQueryWrapper() });
    const response = await result.current.mutateAsync({ jobId: "job_1", corrections: {} });

    expect(response).toEqual(job);
    const [path, , init] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toBe("/api/documents/job_1/confirm");
    expect(init?.method).toBe("POST");
  });
});

describe("useRejectReview", () => {
  it("POSTs /api/documents/:jobId/reject with a JSON body and returns the parsed job", async () => {
    const job = jobFixture({ reviewStatus: "rejected" });
    vi.mocked(apiFetch).mockResolvedValue(job);

    const { result } = renderHook(() => useRejectReview(), { wrapper: createQueryWrapper() });
    const response = await result.current.mutateAsync({ jobId: "job_1", corrections: {} });

    expect(response).toEqual(job);
    const [path, , init] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toBe("/api/documents/job_1/reject");
    expect(init?.method).toBe("POST");
  });
});
