import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "../../test/query-client-wrapper";
import type { DocumentsListResponse, JobDto, ListDocumentsParams } from "@/types/api";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

const { apiFetch } = await import("@/lib/api/http");
const { useDocumentsList, useRemoveDocumentFile, useDeleteDocument } = await import("@/features/documents/hooks");

const emptyResult: DocumentsListResponse = { data: [], pagination: { nextCursor: null, hasMore: false } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useDocumentsList", () => {
  it("fetches /api/documents with no query string for empty params", async () => {
    vi.mocked(apiFetch).mockResolvedValue(emptyResult);

    const { result } = renderHook(() => useDocumentsList({}), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.data).toEqual(emptyResult));
    expect(apiFetch).toHaveBeenCalledWith("/api/documents", expect.anything());
  });

  it("builds the fetch path from the given filters", async () => {
    vi.mocked(apiFetch).mockResolvedValue(emptyResult);

    renderHook(() => useDocumentsList({ status: "completed", search: "acme" }), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [path] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toContain("status=completed");
    expect(path).toContain("search=acme");
  });

  it("refetches with a new path when params change", async () => {
    vi.mocked(apiFetch).mockResolvedValue(emptyResult);

    const { rerender } = renderHook(({ params }) => useDocumentsList(params), {
      wrapper: createQueryWrapper(),
      initialProps: { params: { status: "completed" } as ListDocumentsParams },
    });

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));

    rerender({ params: { status: "failed" } as ListDocumentsParams });

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    const [secondPath] = vi.mocked(apiFetch).mock.calls[1]!;
    expect(secondPath).toContain("status=failed");
  });
});

const jobFixture: JobDto = {
  jobId: "job_42",
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
};

describe("useRemoveDocumentFile", () => {
  it("DELETEs /api/documents/:jobId/file and returns the parsed job", async () => {
    vi.mocked(apiFetch).mockResolvedValue(jobFixture);

    const { result } = renderHook(() => useRemoveDocumentFile(), { wrapper: createQueryWrapper() });
    const response = await result.current.mutateAsync("job_42");

    expect(response).toEqual(jobFixture);
    const [path, , init] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toBe("/api/documents/job_42/file");
    expect(init?.method).toBe("DELETE");
  });

  it("invalidates this job's preview-url query on success", async () => {
    vi.mocked(apiFetch).mockResolvedValue(jobFixture);
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");

    const { result } = renderHook(() => useRemoveDocumentFile(), { wrapper: createQueryWrapper() });
    await result.current.mutateAsync("job_42");

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["document-preview-url", "job_42"] });
    invalidateSpy.mockRestore();
  });
});

describe("useDeleteDocument", () => {
  it("DELETEs /api/documents/:jobId and returns the parsed confirmation", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ jobId: "job_42" });

    const { result } = renderHook(() => useDeleteDocument(), { wrapper: createQueryWrapper() });
    const response = await result.current.mutateAsync("job_42");

    expect(response).toEqual({ jobId: "job_42" });
    const [path, , init] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toBe("/api/documents/job_42");
    expect(init?.method).toBe("DELETE");
  });

  it("invalidates this job's status and the documents list on success", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ jobId: "job_42" });
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");

    const { result } = renderHook(() => useDeleteDocument(), { wrapper: createQueryWrapper() });
    await result.current.mutateAsync("job_42");

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["job-status", "job_42"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["documents-list"] });
    invalidateSpy.mockRestore();
  });
});
