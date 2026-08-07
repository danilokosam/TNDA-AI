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
        // onStatusUpdate is passed straight through (not re-wrapped with a
        // fresh per-item closure) — PolledUploadQueueItem curries item.id
        // itself, so this stays whatever reference the caller gave us.
        <PolledUploadQueueItem key={item.id} item={item} onStatusUpdate={onStatusUpdate} onRemove={() => onRemove(item.id)} />
      ))}
    </div>
  );
}
