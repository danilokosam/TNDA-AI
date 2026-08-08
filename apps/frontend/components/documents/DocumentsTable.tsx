import { CircleCheck, CircleX, Clock, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import { DocumentRowActions } from "@/components/documents/DocumentRowActions";
import { REVIEW_STATUS_DISPLAY } from "@/components/results/DocumentResultsView";
import { DOCUMENT_TYPE_LABELS } from "@/components/upload/DocumentTypeSelect";
import { formatDate, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DocumentJobStatus, JobDto } from "@/types/api";

const STATUS_DISPLAY: Record<
  DocumentJobStatus,
  { label: string; icon: LucideIcon; spin?: boolean; destructive?: boolean; success?: boolean }
> = {
  pending: { label: "Pending", icon: Clock },
  processing: { label: "Processing…", icon: LoaderCircle, spin: true },
  completed: { label: "Completed", icon: CircleCheck, success: true },
  failed: { label: "Failed", icon: CircleX, destructive: true },
  rejected_quota: { label: "Quota exceeded", icon: TriangleAlert, destructive: true },
};

interface DocumentsTableProps {
  jobs: JobDto[];
}

/**
 * Presentational only, same "renders nothing for an empty list" convention
 * as `DocumentFieldsTable` — the caller (`DocumentsWorkspace`) decides
 * which of two different empty states applies (no documents at all vs. no
 * results for the current filters), which only it has enough context to know.
 */
export function DocumentsTable({ jobs }: DocumentsTableProps) {
  if (jobs.length === 0) return null;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="py-2 pr-4 font-medium">File</th>
          <th className="py-2 pr-4 font-medium">Type</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 pr-4 font-medium">Review</th>
          <th className="py-2 pr-4 font-medium">Confidence</th>
          <th className="py-2 pr-4 font-medium">Pages</th>
          <th className="py-2 pr-4 font-medium">Uploaded</th>
          <th className="py-2 font-medium">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => {
          const display = STATUS_DISPLAY[job.status];
          const StatusIcon = display.icon;
          const reviewDisplay = REVIEW_STATUS_DISPLAY[job.reviewStatus];
          const ReviewIcon = reviewDisplay.icon;

          return (
            <tr key={job.jobId} className="border-b last:border-0">
              <td className="max-w-64 truncate py-2 pr-4 font-medium">{job.fileName}</td>
              <td className="py-2 pr-4 text-muted-foreground">{DOCUMENT_TYPE_LABELS[job.documentType]}</td>
              <td className="py-2 pr-4">
                <div
                  className={cn(
                    "flex items-center gap-1.5",
                    display.destructive ? "text-destructive" : display.success ? "text-success" : "text-muted-foreground",
                  )}
                >
                  <StatusIcon className={cn("size-3.5", display.spin && "animate-spin")} />
                  <span>{display.label}</span>
                </div>
              </td>
              <td className="py-2 pr-4">
                <div
                  className={cn(
                    "flex items-center gap-1.5",
                    reviewDisplay.destructive
                      ? "text-destructive"
                      : reviewDisplay.success
                        ? "text-success"
                        : "text-muted-foreground",
                  )}
                >
                  <ReviewIcon className="size-3.5" />
                  <span>{reviewDisplay.label}</span>
                </div>
              </td>
              <td className="py-2 pr-4 text-muted-foreground">
                {job.averageConfidence !== null ? formatPercent(job.averageConfidence) : "—"}
              </td>
              <td className="py-2 pr-4 text-muted-foreground">{job.pageCount ?? "—"}</td>
              <td className="py-2 pr-4 text-muted-foreground">{formatDate(job.createdAt)}</td>
              <td className="py-2">
                <DocumentRowActions job={job} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
