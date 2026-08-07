import Link from "next/link";
import { CircleCheck, CircleX, Clock, FileText, LoaderCircle, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/format";
import type { UploadQueueItem, UploadQueueItemStatus } from "@/features/upload/queue";

const STATUS_DISPLAY: Record<UploadQueueItemStatus, { label: string; icon: LucideIcon; spin?: boolean; destructive?: boolean }> = {
  queued: { label: "Queued", icon: Clock },
  uploading: { label: "Uploading…", icon: LoaderCircle, spin: true },
  "upload-failed": { label: "Upload failed", icon: CircleX, destructive: true },
  pending: { label: "Waiting to process", icon: LoaderCircle, spin: true },
  processing: { label: "Processing…", icon: LoaderCircle, spin: true },
  completed: { label: "Completed", icon: CircleCheck },
  failed: { label: "Failed", icon: CircleX, destructive: true },
  rejected_quota: { label: "Quota exceeded", icon: TriangleAlert, destructive: true },
  "batch-submitted": { label: "Batch submitted", icon: FileText },
};

interface UploadQueueItemRowProps {
  item: UploadQueueItem;
  onRemove: () => void;
}

export function UploadQueueItemRow({ item, onRemove }: UploadQueueItemRowProps) {
  const display = STATUS_DISPLAY[item.status];
  const StatusIcon = display.icon;

  return (
    <div className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
      <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium">{item.file.name}</p>
          <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(item.file.size)}</span>
        </div>
        <div className={cn("flex items-center gap-1.5 text-xs", display.destructive ? "text-destructive" : "text-muted-foreground")}>
          <StatusIcon className={cn("size-3.5", display.spin && "animate-spin")} />
          <span>{display.label}</span>
          {item.status === "batch-submitted" && item.batchResult ? (
            <span>
              — {item.batchResult.accepted} accepted, {item.batchResult.rejected} rejected
            </span>
          ) : null}
        </div>
        {item.errorMessage ? <p className="text-xs text-destructive">{item.errorMessage}</p> : null}
        {item.status === "completed" && item.jobId ? (
          <Button asChild variant="link" size="xs" className="h-auto p-0">
            <Link href={`/documents/${item.jobId}`}>View results</Link>
          </Button>
        ) : null}
      </div>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${item.file.name}`}>
        <X />
      </Button>
    </div>
  );
}
