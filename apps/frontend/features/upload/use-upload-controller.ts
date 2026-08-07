"use client";

import { useEffect, useRef } from "react";
import { useUploadDocument } from "@/features/upload/hooks";
import { useUploadQueue } from "@/features/upload/queue";
import { ApiError } from "@/lib/api/response";

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
          queue.dispatch({ type: "upload-succeeded", id: next.id, response });
        },
        onError: (error) => {
          const errorMessage = error instanceof ApiError ? error.message : "Upload failed. Please try again.";
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
