"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useUploadDocument } from "@/features/upload/hooks";
import { useUploadQueue } from "@/features/upload/queue";
import { cacheFileForPreview } from "@/features/results/preview-cache";
import { ApiError } from "@/lib/api/response";
import type { UploadResponse } from "@/types/api";

/** `kind === "batch"` covers a whole `.zip` in one upload call — the toast reports what the backend actually accepted/rejected, not just "success". */
function describeUploadSuccess(response: UploadResponse): string {
  if (response.kind === "single") return `${response.job.fileName} uploaded`;
  const { accepted, rejected, totalFiles } = response.batch;
  return rejected > 0 ? `Uploaded ${accepted} of ${totalFiles} files (${rejected} rejected)` : `${accepted} files uploaded`;
}

/**
 * Drives the queue's "queued" items through `useUploadDocument` one at a
 * time — not concurrently. Deliberately decoupled from `useUploadQueue`
 * itself (§4 decision from PROGRESS.md: state management stays decoupled
 * from the hooks that talk to the backend); this is the composition point.
 */
export function useUploadController() {
  const queue = useUploadQueue();
  const uploadMutation = useUploadDocument();
  const isUploadingRef = useRef(false);

  useEffect(() => {
    if (isUploadingRef.current) return;
    const next = queue.items.find((item) => item.status === "queued");
    if (!next) return;

    isUploadingRef.current = true;
    queue.dispatch({ type: "upload-started", id: next.id });

    uploadMutation.mutate(
      { file: next.file, documentType: next.documentType },
      {
        onSuccess: (response) => {
          // Only a single-file upload maps 1:1 to one job — a .zip batch's
          // individual entries were never separately accessible client-side
          // to begin with, so there's no file to cache for any of them.
          if (response.kind === "single") {
            cacheFileForPreview(response.job.jobId, next.file);
          }
          toast.success(describeUploadSuccess(response));
          queue.dispatch({ type: "upload-succeeded", id: next.id, response });
        },
        onError: (error) => {
          const errorMessage = error instanceof ApiError ? error.message : "Upload failed. Please try again.";
          toast.error(errorMessage);
          queue.dispatch({ type: "upload-failed", id: next.id, errorMessage });
        },
        onSettled: () => {
          isUploadingRef.current = false;
        },
      },
    );
    // Deliberately not depending on the whole `queue`/`uploadMutation`
    // objects — both are fresh references every render (useUploadQueue
    // returns a new object literal; useMutation's return value isn't
    // referentially stable either), so depending on them would re-run this
    // effect on every render, not just when the queue's contents actually
    // change — undermining `isUploadingRef`'s whole purpose. `queue.items`,
    // `queue.dispatch` (useReducer's dispatch is stable), and
    // `uploadMutation.mutate` (memoized by TanStack Query) are the actual,
    // stable-when-unchanged dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.items, queue.dispatch, uploadMutation.mutate]);

  return queue;
}
