import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "../../test/query-client-wrapper";
import type { DocumentsListResponse, ListDocumentsParams } from "@/types/api";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

const { apiFetch } = await import("@/lib/api/http");
const { useDocumentsList } = await import("@/features/documents/hooks");

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
