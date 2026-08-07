import { PolledUploadQueueItem } from "@/components/upload/PolledUploadQueueItem";
import type { UploadQueueItem } from "@/features/upload/queue";
import type { JobDto } from "@/types/api";

interface UploadQueueListProps {
  items: UploadQueueItem[];
  onStatusUpdate: (id: string, job: JobDto) => void;
  onRemove: (id: string) => void;
}

export function UploadQueueList({ items, onStatusUpdate, onRemove }: UploadQueueListProps) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <PolledUploadQueueItem
          key={item.id}
          item={item}
          onStatusUpdate={(job) => onStatusUpdate(item.id, job)}
          onRemove={() => onRemove(item.id)}
        />
      ))}
    </div>
  );
}
