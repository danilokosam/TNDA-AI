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

    const after = uploadQueueReducer([processing], { type: "job-status-updated", id: "a", job });

    expect(after[0]).toMatchObject({ status: "failed", errorMessage: "Azure timed out." });
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
