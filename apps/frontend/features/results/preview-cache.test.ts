import { describe, expect, it } from "vitest";
import { cacheFileForPreview, getCachedFile } from "@/features/results/preview-cache";

// The cache is module-level by design (see its own doc comment) and
// persists across tests in this file — each test uses its own unique
// jobId so none of them depend on execution order or on each other.

describe("preview-cache", () => {
  it("returns null for a jobId that was never cached", () => {
    expect(getCachedFile("unknown-job")).toBeNull();
  });

  it("returns the cached file for a jobId that was cached", () => {
    const file = new File(["content"], "invoice.pdf", { type: "application/pdf" });
    cacheFileForPreview("job_get", file);
    expect(getCachedFile("job_get")).toBe(file);
  });

  it("caching a new file for the same jobId replaces the previous one", () => {
    const first = new File(["a"], "a.pdf");
    const second = new File(["b"], "b.pdf");
    cacheFileForPreview("job_replace", first);
    cacheFileForPreview("job_replace", second);
    expect(getCachedFile("job_replace")).toBe(second);
  });

  it("keeps entries for different jobIds independent", () => {
    const fileA = new File(["a"], "a.pdf");
    const fileB = new File(["b"], "b.pdf");
    cacheFileForPreview("job_indep_a", fileA);
    cacheFileForPreview("job_indep_b", fileB);
    expect(getCachedFile("job_indep_a")).toBe(fileA);
    expect(getCachedFile("job_indep_b")).toBe(fileB);
  });
});
