import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useUploadQueue } from "@/features/upload/queue";

function file(name = "invoice.pdf") {
  return new File(["content"], name, { type: "application/pdf" });
}

describe("useUploadQueue", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useUploadQueue());
    expect(result.current.items).toEqual([]);
  });

  it("addFiles adds one queued item per file, each with a generated id", () => {
    const { result } = renderHook(() => useUploadQueue());
    const f = file();

    act(() => {
      result.current.addFiles([{ file: f, documentType: "receipt" }]);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ file: f, documentType: "receipt", status: "queued" });
    expect(typeof result.current.items[0]?.id).toBe("string");
    expect(result.current.items[0]?.id.length).toBeGreaterThan(0);
  });

  it("addFiles defaults documentType to invoice and assigns distinct ids across multiple files", () => {
    const { result } = renderHook(() => useUploadQueue());

    act(() => {
      result.current.addFiles([{ file: file("a.pdf") }, { file: file("b.pdf") }]);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0]?.documentType).toBe("invoice");
    expect(result.current.items[0]?.id).not.toBe(result.current.items[1]?.id);
  });

  it("removeItem removes only the matching item", () => {
    const { result } = renderHook(() => useUploadQueue());
    act(() => {
      result.current.addFiles([{ file: file("a.pdf") }, { file: file("b.pdf") }]);
    });
    const idToRemove = result.current.items[0]!.id;

    act(() => {
      result.current.removeItem(idToRemove);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.file.name).toBe("b.pdf");
  });

  it("clearFinished drops finished items and keeps active ones", () => {
    const { result } = renderHook(() => useUploadQueue());
    act(() => {
      result.current.addFiles([{ file: file("a.pdf") }]);
    });
    const id = result.current.items[0]!.id;

    act(() => {
      result.current.dispatch({ type: "upload-failed", id, errorMessage: "Network error." });
    });
    expect(result.current.items[0]?.status).toBe("upload-failed");

    act(() => {
      result.current.clearFinished();
    });
    expect(result.current.items).toEqual([]);
  });

  it("exposes dispatch for the full action set (e.g. upload-started)", () => {
    const { result } = renderHook(() => useUploadQueue());
    act(() => {
      result.current.addFiles([{ file: file("a.pdf") }]);
    });
    const id = result.current.items[0]!.id;

    act(() => {
      result.current.dispatch({ type: "upload-started", id });
    });

    expect(result.current.items[0]?.status).toBe("uploading");
  });
});
