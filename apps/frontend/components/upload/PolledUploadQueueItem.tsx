"use client";

import { useEffect } from "react";
import { UploadQueueItemRow } from "@/components/upload/UploadQueueItemRow";
import { useJobStatus } from "@/features/upload/hooks";
import { isFinished, type UploadQueueItem } from "@/features/upload/queue";
import type { JobDto } from "@/types/api";

interface PolledUploadQueueItemProps {
  item: UploadQueueItem;
  onStatusUpdate: (id: string, job: JobDto) => void;
  onRemove: () => void;
}

/**
 * One `useJobStatus` call per rendered instance — the standard React
 * pattern for "a hook per item in a dynamic list," since hooks can't be
 * called in a loop. `UploadQueueList` renders one of these per queue item.
 *
 * `onStatusUpdate` takes `(id, job)` rather than being pre-curried with
 * this item's id by the parent (`UploadQueueList` used to do
 * `(job) => onStatusUpdate(item.id, job)`, a fresh closure every render) —
 * currying it here instead, from a prop that's already stable-when-
 * unchanged (see UploadWorkspace's useCallback), keeps this effect's
 * dependency array from changing on every unrelated re-render. That
 * instability was a contributing cause of a real "Maximum update depth
 * exceeded" crash — see queue.ts's job-status-updated case for the other,
 * primary half of the fix.
 */
export function PolledUploadQueueItem({ item, onStatusUpdate, onRemove }: PolledUploadQueueItemProps) {
  const shouldPoll = item.jobId !== null && !isFinished(item.status);
  const { data } = useJobStatus(shouldPoll ? item.jobId : null);

  useEffect(() => {
    if (data) onStatusUpdate(item.id, data);
  }, [data, item.id, onStatusUpdate]);

  return <UploadQueueItemRow item={item} onRemove={onRemove} />;
}
