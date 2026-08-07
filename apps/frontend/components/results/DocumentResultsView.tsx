"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { DocumentFieldsTable } from "@/components/results/DocumentFieldsTable";
import { DocumentPreviewPanel } from "@/components/results/DocumentPreviewPanel";
import { DocumentRawContent } from "@/components/results/DocumentRawContent";
import { extractDocumentFields, extractRawContent } from "@/features/results/extract-fields";
import { useJobStatus } from "@/features/upload/hooks";
import { formatPercent } from "@/lib/format";

interface DocumentResultsViewProps {
  jobId: string;
}

/**
 * Live status via `useJobStatus` (backoff-polled, stops on a terminal
 * status — see `poll-schedule.ts`), not a one-shot server fetch: a job
 * reached right after upload is commonly still `pending`/`processing`.
 */
export function DocumentResultsView({ jobId }: DocumentResultsViewProps) {
  const { data: job, isLoading, isError } = useJobStatus(jobId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Loading…</p>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (isError || !job) {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>Couldn&apos;t load this document</AlertTitle>
        <AlertDescription>It may not exist, or you may not have access to it.</AlertDescription>
      </Alert>
    );
  }

  if (job.status === "pending" || job.status === "processing") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        <span>{job.status === "pending" ? "Waiting to process…" : "Processing…"}</span>
      </div>
    );
  }

  if (job.status === "failed" || job.status === "rejected_quota") {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>{job.status === "rejected_quota" ? "Quota exceeded" : "Processing failed"}</AlertTitle>
        {job.errorMessage ? <AlertDescription>{job.errorMessage}</AlertDescription> : null}
      </Alert>
    );
  }

  const fields = extractDocumentFields(job.resultJson);
  const rawContent = extractRawContent(job.resultJson);
  const hasExtractedData = fields.length > 0 || rawContent !== null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        {job.averageConfidence !== null ? (
          <p className="text-sm text-muted-foreground">Average confidence: {formatPercent(job.averageConfidence)}</p>
        ) : null}
        {hasExtractedData ? (
          <>
            <DocumentFieldsTable fields={fields} />
            <DocumentRawContent content={rawContent} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No extracted data available.</p>
        )}
      </div>
      <DocumentPreviewPanel jobId={jobId} />
    </div>
  );
}
