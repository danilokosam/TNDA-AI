"use client";

import { useCallback, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { DocumentTypeSelect } from "@/components/upload/DocumentTypeSelect";
import { Dropzone } from "@/components/upload/Dropzone";
import { UploadQueueList } from "@/components/upload/UploadQueueList";
import { useUploadController } from "@/features/upload/use-upload-controller";
import { isFinished } from "@/features/upload/queue";
import type { DocumentType, JobDto } from "@/types/api";

/**
 * The document-type selector applies to whatever gets dropped/selected
 * *next* — one type per upload action, not per queued item. A `.zip`
 * batch can only carry one type anyway (the backend applies it to the
 * whole archive); for multiple separate files, this keeps the UI simple
 * rather than building per-row type editing that wasn't asked for.
 */
export function UploadWorkspace() {
  const [documentType, setDocumentType] = useState<DocumentType>("invoice");
  const queue = useUploadController();
  const documentTypeId = useId();

  const hasFinishedItems = queue.items.some((item) => isFinished(item.status));

  // Stable across renders (depends only on queue.dispatch, itself stable —
  // useReducer's dispatch never changes identity) — so PolledUploadQueueItem's
  // effect only re-runs when polled data actually changes, not on every
  // unrelated render. Was a fresh closure every render before; see
  // PolledUploadQueueItem's doc comment for why that mattered. Deliberately
  // depends on `queue.dispatch`, not the whole `queue` object — `queue` is a
  // fresh reference every render (useUploadController/useUploadQueue return
  // a new object literal each call), so depending on it would recreate this
  // callback every render anyway, defeating the point.
  const handleStatusUpdate = useCallback(
    (id: string, job: JobDto) => queue.dispatch({ type: "job-status-updated", id, job }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue.dispatch],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <label htmlFor={documentTypeId} className="text-sm font-medium">
            Document type
          </label>
          <DocumentTypeSelect id={documentTypeId} value={documentType} onChange={setDocumentType} className="sm:w-56" />
        </div>
        {hasFinishedItems ? (
          <Button type="button" variant="outline" size="sm" onClick={queue.clearFinished}>
            Clear finished
          </Button>
        ) : null}
      </div>

      <Dropzone onFilesSelected={(files) => queue.addFiles(files.map((file) => ({ file, documentType })))} />

      <UploadQueueList items={queue.items} onStatusUpdate={handleStatusUpdate} onRemove={queue.removeItem} />
    </div>
  );
}
