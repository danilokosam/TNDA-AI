"use client";

import { useCallback, useReducer } from "react";
import type { BatchResult, DocumentType, JobDto, UploadResponse } from "@/types/api";

/**
 * `"queued"`/`"uploading"`/`"upload-failed"` don't exist on the backend —
 * they describe the client-only period before a job exists at all.
 * `"batch-submitted"` is likewise client-only: once a `.zip` upload is
 * accepted, per-file outcomes live in `batchResult` (this queue item
 * doesn't poll each sub-job — see the doc comment on `batchResult`).
 * Everything else mirrors `DocumentJobStatus` exactly, including keeping
 * `rejected_quota` distinct from `failed` (the rest of the app already
 * treats those as meaningfully different — see PROGRESS.md §4 decision 6).
 */
export type UploadQueueItemStatus = "queued" | "uploading" | "upload-failed" | JobDto["status"] | "batch-submitted";

export interface UploadQueueItem {
  id: string;
  file: File;
  documentType: DocumentType;
  status: UploadQueueItemStatus;
  /** Set once a *single*-file upload succeeds — this is what gets polled. */
  jobId: string | null;
  /**
   * Set once a `.zip` upload succeeds. Per-file results as returned by the
   * upload response, as-is — this queue item doesn't live-poll each
   * accepted sub-job; that's Results/History's job (Stage 4/5), not the
   * upload page's.
   */
  batchResult: BatchResult | null;
  errorMessage: string | null;
}

/** Statuses nothing further will ever happen to — used by `clear-finished`. */
const FINISHED_STATUSES: ReadonlySet<UploadQueueItemStatus> = new Set([
  "completed",
  "failed",
  "rejected_quota",
  "upload-failed",
  "batch-submitted",
]);

export function isFinished(status: UploadQueueItemStatus): boolean {
  return FINISHED_STATUSES.has(status);
}

export type UploadQueueAction =
  | { type: "add"; items: UploadQueueItem[] }
  | { type: "remove"; id: string }
  | { type: "upload-started"; id: string }
  | { type: "upload-succeeded"; id: string; response: UploadResponse }
  | { type: "upload-failed"; id: string; errorMessage: string }
  | { type: "job-status-updated"; id: string; job: JobDto }
  | { type: "clear-finished" };

/**
 * `id` is caller-supplied (not generated here) so this stays a pure
 * function — no `crypto.randomUUID()` call buried inside something that
 * otherwise has no side effects, and no need to mock randomness in tests.
 */
export function createUploadQueueItem(params: { id: string; file: File; documentType?: DocumentType }): UploadQueueItem {
  return {
    id: params.id,
    file: params.file,
    documentType: params.documentType ?? "invoice",
    status: "queued",
    jobId: null,
    batchResult: null,
    errorMessage: null,
  };
}

function updateItem(items: UploadQueueItem[], id: string, update: (item: UploadQueueItem) => UploadQueueItem) {
  return items.map((item) => (item.id === id ? update(item) : item));
}

export function uploadQueueReducer(state: UploadQueueItem[], action: UploadQueueAction): UploadQueueItem[] {
  switch (action.type) {
    case "add":
      return [...state, ...action.items];

    case "remove":
      return state.filter((item) => item.id !== action.id);

    case "upload-started":
      return updateItem(state, action.id, (item) => ({ ...item, status: "uploading" }));

    case "upload-succeeded":
      return updateItem(state, action.id, (item) =>
        action.response.kind === "single"
          ? {
              ...item,
              status: action.response.job.status,
              jobId: action.response.job.jobId,
              errorMessage: action.response.job.errorMessage,
            }
          : { ...item, status: "batch-submitted", batchResult: action.response.batch },
      );

    case "upload-failed":
      return updateItem(state, action.id, (item) => ({
        ...item,
        status: "upload-failed",
        errorMessage: action.errorMessage,
      }));

    case "job-status-updated": {
      // Fired on every poll, including when nothing has changed (a job can
      // legitimately sit at the same status across many polls). Returning
      // the *same* state reference when it's genuinely a no-op is what lets
      // useReducer bail out of re-rendering — building a new array/item
      // unconditionally here (the previous behavior) meant a stable status
      // still produced a new reference every time, which — combined with
      // unstable callback identities elsewhere in the tree — turned
      // ordinary redundant effect re-runs into a real "Maximum update depth
      // exceeded" crash. See queue.test.ts's "no-op when nothing actually
      // changed" tests.
      const target = state.find((item) => item.id === action.id);
      const isUnchanged =
        !target || (target.status === action.job.status && target.errorMessage === action.job.errorMessage);
      if (isUnchanged) return state;

      return updateItem(state, action.id, (item) => ({
        ...item,
        status: action.job.status,
        errorMessage: action.job.errorMessage,
      }));
    }

    case "clear-finished":
      return state.filter((item) => !isFinished(item.status));

    default:
      return state;
  }
}

/**
 * Deliberately doesn't know about `useUploadDocument`/`useJobStatus` —
 * state management for the queue's shape stays decoupled from the hooks
 * that actually talk to the backend. `dispatch` is exposed so a caller can
 * drive `upload-started`/`upload-succeeded`/`upload-failed`/
 * `job-status-updated` directly when wiring those hooks up.
 */
export function useUploadQueue() {
  const [items, dispatch] = useReducer(uploadQueueReducer, [] as UploadQueueItem[]);

  const addFiles = useCallback((files: Array<{ file: File; documentType?: DocumentType }>) => {
    dispatch({
      type: "add",
      items: files.map((f) =>
        createUploadQueueItem({ id: crypto.randomUUID(), file: f.file, documentType: f.documentType }),
      ),
    });
  }, []);

  const removeItem = useCallback((id: string) => dispatch({ type: "remove", id }), []);
  const clearFinished = useCallback(() => dispatch({ type: "clear-finished" }), []);

  return { items, addFiles, removeItem, clearFinished, dispatch };
}
