"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { DocumentTypeSelect } from "@/components/upload/DocumentTypeSelect";
import { Dropzone } from "@/components/upload/Dropzone";
import { UploadQueueList } from "@/components/upload/UploadQueueList";
import { useUploadController } from "@/features/upload/use-upload-controller";
import { isFinished } from "@/features/upload/queue";
import type { DocumentType } from "@/types/api";

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

      <UploadQueueList
        items={queue.items}
        onStatusUpdate={(id, job) => queue.dispatch({ type: "job-status-updated", id, job })}
        onRemove={queue.removeItem}
      />
    </div>
  );
}
