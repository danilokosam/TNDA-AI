import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { createQueryWrapper } from "../../test/query-client-wrapper";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

const { apiFetch } = await import("@/lib/api/http");
const { cacheFileForPreview } = await import("@/features/results/preview-cache");
const { useDocumentPreview } = await import("@/features/results/use-document-preview");

describe("useDocumentPreview", () => {
  let revokeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    revokeSpy = vi.spyOn(URL, "revokeObjectURL");
  });

  afterEach(() => {
    revokeSpy.mockRestore();
  });

  it("returns a remote-url source once the backend confirms a persisted file", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ url: "https://signed.example/x" });

    const { result } = renderHook(() => useDocumentPreview("job_remote_1"), { wrapper: createQueryWrapper() });

    await vi.waitFor(() => expect(result.current).toEqual({ kind: "remote-url", url: "https://signed.example/x" }));
  });

  it("falls back to the session cache while the signed-url fetch is still in flight", () => {
    const file = new File(["content"], "invoice.pdf", { type: "application/pdf" });
    cacheFileForPreview("job_fastpath_1", file);
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {})); // never resolves in this test

    const { result } = renderHook(() => useDocumentPreview("job_fastpath_1"), { wrapper: createQueryWrapper() });

    expect(result.current.kind).toBe("session-blob");
  });

  it("falls back to the session cache when the backend confirms no persisted file exists", async () => {
    const file = new File(["content"], "invoice.pdf", { type: "application/pdf" });
    cacheFileForPreview("job_fallback_1", file);
    vi.mocked(apiFetch).mockResolvedValue({ url: null });

    const { result } = renderHook(() => useDocumentPreview("job_fallback_1"), { wrapper: createQueryWrapper() });

    await vi.waitFor(() => expect(result.current.kind).toBe("session-blob"));
  });

  it("prefers the remote url over the session cache when both are available", async () => {
    const file = new File(["content"], "invoice.pdf", { type: "application/pdf" });
    cacheFileForPreview("job_both_1", file);
    vi.mocked(apiFetch).mockResolvedValue({ url: "https://signed.example/x" });

    const { result } = renderHook(() => useDocumentPreview("job_both_1"), { wrapper: createQueryWrapper() });

    await vi.waitFor(() => expect(result.current).toEqual({ kind: "remote-url", url: "https://signed.example/x" }));
  });

  it("returns unavailable when there is neither a remote file nor a session-cached one", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ url: null });

    const { result } = renderHook(() => useDocumentPreview("job_none_1"), { wrapper: createQueryWrapper() });

    await vi.waitFor(() => expect(result.current).toEqual({ kind: "unavailable" }));
  });

  it("returns loading — not unavailable — while the fetch is in flight and nothing is session-cached", () => {
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useDocumentPreview("job_loading_1"), { wrapper: createQueryWrapper() });

    expect(result.current).toEqual({ kind: "loading" });
  });

  it("revokes a session-cache blob url on unmount", async () => {
    const file = new File(["content"], "invoice.pdf", { type: "application/pdf" });
    cacheFileForPreview("job_revoke_1", file);
    vi.mocked(apiFetch).mockResolvedValue({ url: null });

    const { result, unmount } = renderHook(() => useDocumentPreview("job_revoke_1"), {
      wrapper: createQueryWrapper(),
    });
    await vi.waitFor(() => expect(result.current.kind).toBe("session-blob"));
    const createdUrl = result.current.kind === "session-blob" ? result.current.url : null;

    unmount();

    expect(revokeSpy).toHaveBeenCalledWith(createdUrl);
  });
});
