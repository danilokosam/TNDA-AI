import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { cacheFileForPreview } from "@/features/results/preview-cache";
import { useDocumentPreview } from "@/features/results/use-document-preview";

describe("useDocumentPreview", () => {
  let revokeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    revokeSpy = vi.spyOn(URL, "revokeObjectURL");
  });

  afterEach(() => {
    revokeSpy.mockRestore();
  });

  it("returns unavailable when no file is cached for this jobId", () => {
    const { result } = renderHook(() => useDocumentPreview("no-such-job"));
    expect(result.current).toEqual({ kind: "unavailable" });
  });

  it("returns a session-blob source when a file is cached", () => {
    const file = new File(["content"], "invoice.pdf", { type: "application/pdf" });
    cacheFileForPreview("job_preview_1", file);

    const { result } = renderHook(() => useDocumentPreview("job_preview_1"));

    expect(result.current.kind).toBe("session-blob");
    expect(result.current.kind === "session-blob" && result.current.url.startsWith("blob:")).toBe(true);
  });

  it("revokes the created blob URL on unmount", () => {
    const file = new File(["content"], "invoice.pdf", { type: "application/pdf" });
    cacheFileForPreview("job_preview_2", file);

    const { result, unmount } = renderHook(() => useDocumentPreview("job_preview_2"));
    const createdUrl = result.current.kind === "session-blob" ? result.current.url : null;
    expect(createdUrl).not.toBeNull();

    unmount();

    expect(revokeSpy).toHaveBeenCalledWith(createdUrl);
  });

  it("revokes the previous URL and creates a fresh one when jobId changes", () => {
    const fileA = new File(["a"], "a.pdf");
    const fileB = new File(["b"], "b.pdf");
    cacheFileForPreview("job_preview_a", fileA);
    cacheFileForPreview("job_preview_b", fileB);

    const { result, rerender } = renderHook(({ jobId }) => useDocumentPreview(jobId), {
      initialProps: { jobId: "job_preview_a" },
    });
    const firstUrl = result.current.kind === "session-blob" ? result.current.url : null;
    expect(firstUrl).not.toBeNull();

    rerender({ jobId: "job_preview_b" });

    expect(revokeSpy).toHaveBeenCalledWith(firstUrl);
    expect(result.current.kind).toBe("session-blob");
    expect(result.current.kind === "session-blob" && result.current.url).not.toBe(firstUrl);
  });
});
