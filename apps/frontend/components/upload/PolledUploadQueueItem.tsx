"use client";

import { useEffect } from "react";
import { UploadQueueItemRow } from "@/components/upload/UploadQueueItemRow";
import { useJobStatus } from "@/features/upload/hooks";
import { isFinished, type UploadQueueItem } from "@/features/upload/queue";
import type { JobDto } from "@/types/api";

interface PolledUploadQueueItemProps {
  item: UploadQueueItem;
  onStatusUpdate: (job: JobDto) => void;
  onRemove: () => void;
}

/**
 * One `useJobStatus` call per rendered instance — the standard React
 * pattern for "a hook per item in a dynamic list," since hooks can't be
 * called in a loop. `UploadQueueList` renders one of these per queue item.
 */
export function PolledUploadQueueItem({ item, onStatusUpdate, onRemove }: PolledUploadQueueItemProps) {
  const shouldPoll = item.jobId !== null && !isFinished(item.status);
  const { data } = useJobStatus(shouldPoll ? item.jobId : null);

  useEffect(() => {
    if (data) onStatusUpdate(data);
  }, [data, onStatusUpdate]);

  return <UploadQueueItemRow item={item} onRemove={onRemove} />;
}
