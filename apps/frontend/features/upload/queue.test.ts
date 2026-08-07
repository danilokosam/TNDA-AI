import { describe, expect, it } from "vitest";
import { createUploadQueueItem, uploadQueueReducer, type UploadQueueItem } from "@/features/upload/queue";
import type { JobDto, UploadResponse } from "@/types/api";

function file(name = "invoice.pdf") {
  return new File(["content"], name, { type: "application/pdf" });
}

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
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("createUploadQueueItem", () => {
  it("creates a queued item with the given id/file/documentType and empty result fields", () => {
    const f = file();
    const item = createUploadQueueItem({ id: "item_1", file: f, documentType: "receipt" });

    expect(item).toEqual({
      id: "item_1",
      file: f,
      documentType: "receipt",
      status: "queued",
      jobId: null,
      batchResult: null,
      errorMessage: null,
    });
  });

  it("defaults documentType to invoice when not given, matching the backend's own default", () => {
    const item = createUploadQueueItem({ id: "item_1", file: file() });
    expect(item.documentType).toBe("invoice");
  });
});

describe("uploadQueueReducer", () => {
  const queued = createUploadQueueItem({ id: "a", file: file("a.pdf") });

  it("add: appends new items without mutating the previous state array", () => {
    const before: UploadQueueItem[] = [];
    const added = createUploadQueueItem({ id: "b", file: file("b.pdf") });

    const after = uploadQueueReducer(before, { type: "add", items: [added] });

    expect(after).toEqual([added]);
    expect(before).toEqual([]);
  });

  it("add: appends after existing items, preserving order", () => {
    const second = createUploadQueueItem({ id: "b", file: file("b.pdf") });
    const after = uploadQueueReducer([queued], { type: "add", items: [second] });
    expect(after.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("remove: drops only the matching item", () => {
    const other = createUploadQueueItem({ id: "b", file: file("b.pdf") });
    const after = uploadQueueReducer([queued, other], { type: "remove", id: "a" });
    expect(after).toEqual([other]);
  });

  it("remove: is a no-op for an id that isn't in the queue", () => {
    const after = uploadQueueReducer([queued], { type: "remove", id: "does-not-exist" });
    expect(after).toEqual([queued]);
  });

  it("upload-started: transitions the matching item to uploading, leaves others untouched", () => {
    const other = createUploadQueueItem({ id: "b", file: file("b.pdf") });
    const after = uploadQueueReducer([queued, other], { type: "upload-started", id: "a" });

    expect(after.find((i) => i.id === "a")?.status).toBe("uploading");
    expect(after.find((i) => i.id === "b")).toEqual(other);
  });

  it("upload-succeeded (single): adopts the returned job's status/jobId, clears errorMessage", () => {
    const uploading = { ...queued, status: "uploading" as const };
    const response: UploadResponse = { kind: "single", job: jobFixture({ jobId: "job_99", status: "pending" }) };

    const after = uploadQueueReducer([uploading], { type: "upload-succeeded", id: "a", response });

    expect(after[0]).toMatchObject({ id: "a", status: "pending", jobId: "job_99", errorMessage: null });
  });

  it("upload-succeeded (batch): sets status to batch-submitted and stores the batch result", () => {
    const uploading = { ...queued, status: "uploading" as const };
    const response: UploadResponse = {
      kind: "batch",
      batch: { totalFiles: 2, accepted: 1, rejected: 1, files: [] },
    };

    const after = uploadQueueReducer([uploading], { type: "upload-succeeded", id: "a", response });

    expect(after[0]).toMatchObject({
      id: "a",
      status: "batch-submitted",
      jobId: null,
      batchResult: { totalFiles: 2, accepted: 1, rejected: 1, files: [] },
    });
  });

  it("upload-failed: sets status to upload-failed with the given message", () => {
    const uploading = { ...queued, status: "uploading" as const };
    const after = uploadQueueReducer([uploading], {
      type: "upload-failed",
      id: "a",
      errorMessage: "Network error.",
    });

    expect(after[0]).toMatchObject({ status: "upload-failed", errorMessage: "Network error." });
  });

  it("job-status-updated: mirrors a polled job's status and errorMessage onto the matching item", () => {
    const processing = { ...queued, status: "processing" as const, jobId: "job_99" };
    const job = jobFixture({ jobId: "job_99", status: "failed", errorMessage: "Azure timed out." });

    const state = [processing];
    const after = uploadQueueReducer(state, { type: "job-status-updated", id: "a", job });

    expect(after[0]).toMatchObject({ status: "failed", errorMessage: "Azure timed out." });
    // A real change must produce a new array reference — useReducer only
    // bails out of re-rendering when the SAME reference comes back.
    expect(after).not.toBe(state);
  });

  /**
   * Regression for a real "Maximum update depth exceeded" crash (found via
   * manual browser verification): a job sitting at the same status across
   * many polls (the normal case — processing takes real time) was
   * dispatching `job-status-updated` on every poll regardless of whether
   * anything had changed, and this reducer unconditionally built a new
   * array either way — `useReducer` has no way to bail out of a
   * consequent re-render unless the *exact same* reference comes back.
   * Combined with unstable callback identities elsewhere in the tree
   * (features/upload/use-upload-controller.ts's fix), that unconditional
   * new-array construction is what turned ordinary redundant effect
   * re-runs into runaway re-rendering. This is the precise, deterministic
   * property that actually has to hold — see UploadWorkspace.test.tsx's
   * "polling regression" describe block for why an end-to-end repro of
   * the exact crash wasn't reliable to assert on directly.
   */
  describe("job-status-updated: no-op when nothing actually changed", () => {
    it("returns the exact same array reference when status and errorMessage are unchanged", () => {
      const processing = { ...queued, status: "processing" as const, jobId: "job_99", errorMessage: null };
      const state = [processing];
      const job = jobFixture({ jobId: "job_99", status: "processing", errorMessage: null });

      const after = uploadQueueReducer(state, { type: "job-status-updated", id: "a", job });

      expect(after).toBe(state);
    });

    it("still returns a new reference when only errorMessage changes (status unchanged)", () => {
      const failing = { ...queued, status: "failed" as const, jobId: "job_99", errorMessage: "First attempt." };
      const state = [failing];
      const job = jobFixture({ jobId: "job_99", status: "failed", errorMessage: "Different message now." });

      const after = uploadQueueReducer(state, { type: "job-status-updated", id: "a", job });

      expect(after).not.toBe(state);
      expect(after[0]?.errorMessage).toBe("Different message now.");
    });

    it("returns the exact same array reference for an unknown id, not just an equal-valued copy", () => {
      const state = [queued];
      const job = jobFixture({ jobId: "job_99", status: "processing" });

      const after = uploadQueueReducer(state, { type: "job-status-updated", id: "does-not-exist", job });

      expect(after).toBe(state);
    });
  });

  it("clear-finished: removes completed/failed/upload-failed/batch-submitted items, keeps active ones", () => {
    const items: UploadQueueItem[] = [
      { ...queued, id: "queued", status: "queued" },
      { ...queued, id: "uploading", status: "uploading" },
      { ...queued, id: "processing", status: "processing" },
      { ...queued, id: "completed", status: "completed" },
      { ...queued, id: "failed", status: "failed" },
      { ...queued, id: "rejected_quota", status: "rejected_quota" },
      { ...queued, id: "upload-failed", status: "upload-failed" },
      { ...queued, id: "batch-submitted", status: "batch-submitted" },
    ];

    const after = uploadQueueReducer(items, { type: "clear-finished" });

    expect(after.map((i) => i.id)).toEqual(["queued", "uploading", "processing"]);
  });

  it("id-targeted actions on an unknown id leave the queue unchanged", () => {
    const after = uploadQueueReducer([queued], { type: "upload-started", id: "does-not-exist" });
    expect(after).toEqual([queued]);
  });
});
