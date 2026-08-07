"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, CircleX, Clock, LoaderCircle, type LucideIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DocumentFieldsTable } from "@/components/results/DocumentFieldsTable";
import { DocumentPreviewPanel } from "@/components/results/DocumentPreviewPanel";
import { DocumentRawContent } from "@/components/results/DocumentRawContent";
import { extractEffectiveFields, extractRawContent, isMarkdownContent } from "@/features/results/extract-fields";
import { useDeleteDocument, useRemoveDocumentFile } from "@/features/documents/hooks";
import { useConfirmReview, useFieldCorrections, useRejectReview, useSaveCorrections } from "@/features/results/hooks";
import { useJobStatus } from "@/features/upload/hooks";
import { ApiError } from "@/lib/api/response";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/format";
import type { DocumentReviewStatus } from "@/types/api";

interface DocumentResultsViewProps {
  jobId: string;
}

/** Exported for `DocumentsTable` (Stage 5's History table) to reuse for its own review-status column — same cross-file display-map convention as `DocumentTypeSelect.tsx#DOCUMENT_TYPE_LABELS`. */
export const REVIEW_STATUS_DISPLAY: Record<
  DocumentReviewStatus,
  { label: string; icon: LucideIcon; destructive?: boolean }
> = {
  unreviewed: { label: "Unreviewed", icon: Clock },
  confirmed: { label: "Confirmed", icon: CircleCheck },
  rejected: { label: "Rejected", icon: CircleX },
};

function mutationErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

/**
 * Live status via `useJobStatus` (backoff-polled, stops on a terminal
 * status — see `poll-schedule.ts`), not a one-shot server fetch: a job
 * reached right after upload is commonly still `pending`/`processing`.
 *
 * The review workflow (edit fields, save corrections, confirm/reject) is
 * the document review workspace this page is meant to be — see the
 * review-workflow plan. `draft` is local, unsaved edits only; the
 * server-confirmed effective value (Azure's original, or the latest saved
 * correction) always comes from `useFieldCorrections`. All hooks are
 * called unconditionally, before any of the early-return states below —
 * `useFieldCorrections`'s own `enabled` flag (not a conditional hook call)
 * is what skips fetching corrections for a job with nothing to correct yet.
 */
export function DocumentResultsView({ jobId }: DocumentResultsViewProps) {
  const router = useRouter();
  const { data: job, isLoading, isError } = useJobStatus(jobId);
  const { data: corrections } = useFieldCorrections(jobId, job?.status === "completed");
  const saveCorrections = useSaveCorrections();
  const confirmReview = useConfirmReview();
  const rejectReview = useRejectReview();
  const removeFile = useRemoveDocumentFile();
  const deleteDocument = useDeleteDocument();
  const [draft, setDraft] = useState<Record<string, string>>({});
  // Resets the draft when `jobId` changes — adjusted during render (React's
  // documented pattern for this), not an effect: there's no external system
  // to synchronize with here, just local state that needs to not leak
  // between two different jobs' review sessions.
  const [draftJobId, setDraftJobId] = useState(jobId);
  if (jobId !== draftJobId) {
    setDraftJobId(jobId);
    setDraft({});
  }

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

  const fields = extractEffectiveFields(job.resultJson, corrections?.effective ?? {});
  const rawContent = extractRawContent(job.resultJson);
  const hasExtractedData = fields.length > 0 || rawContent !== null;
  const rawContentView =
    rawContent !== null ? (
      <DocumentRawContent content={rawContent} format={isMarkdownContent(job.documentType) ? "markdown" : "text"} />
    ) : null;

  const reviewDisplay = REVIEW_STATUS_DISPLAY[job.reviewStatus];
  const ReviewIcon = reviewDisplay.icon;
  const isDirty = Object.keys(draft).length > 0;
  const isMutating =
    saveCorrections.isPending ||
    confirmReview.isPending ||
    rejectReview.isPending ||
    removeFile.isPending ||
    deleteDocument.isPending;
  const mutationError =
    saveCorrections.error ?? confirmReview.error ?? rejectReview.error ?? removeFile.error ?? deleteDocument.error;

  const handleFieldChange = (name: string, value: string) => {
    setDraft((previous) => ({ ...previous, [name]: value }));
  };

  const handleSave = () => {
    saveCorrections.mutate({ jobId, corrections: draft }, { onSuccess: () => setDraft({}) });
  };

  const handleConfirm = () => {
    confirmReview.mutate({ jobId, corrections: draft }, { onSuccess: () => setDraft({}) });
  };

  const handleReject = () => {
    rejectReview.mutate({ jobId, corrections: draft }, { onSuccess: () => setDraft({}) });
  };

  const handleRemoveFile = () => {
    removeFile.mutate(jobId);
  };

  const handleDeleteDocument = () => {
    deleteDocument.mutate(jobId, { onSuccess: () => router.push("/documents") });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
        <div
          className={cn(
            "flex items-center gap-1.5 text-sm",
            reviewDisplay.destructive ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <ReviewIcon className="size-3.5" />
          <span>{reviewDisplay.label}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {fields.length > 0 ? (
            <Button variant="outline" size="sm" disabled={!isDirty || isMutating} onClick={handleSave}>
              {saveCorrections.isPending ? "Saving…" : "Save corrections"}
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" disabled={isMutating} onClick={handleConfirm}>
            {confirmReview.isPending ? "Confirming…" : "Confirm"}
          </Button>
          <Button variant="destructive" size="sm" disabled={isMutating} onClick={handleReject}>
            {rejectReview.isPending ? "Rejecting…" : "Reject"}
          </Button>

          <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={isMutating}>
                Remove file
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove the original file?</AlertDialogTitle>
                <AlertDialogDescription>
                  Deletes the uploaded file from storage. Extracted fields, corrections, and the review status stay
                  exactly as they are — only the file preview stops being available.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleRemoveFile}>
                  Remove file
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={isMutating}>
                Delete document
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this document?</AlertDialogTitle>
                <AlertDialogDescription>
                  Hides it everywhere (History, Dashboard) and removes its original file. The extracted data is kept,
                  not erased — this isn&apos;t something you can undo from here, though.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleDeleteDocument}>
                  Delete document
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {mutationError ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{mutationErrorMessage(mutationError)}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {job.averageConfidence !== null ? (
            <p className="text-sm text-muted-foreground">Average confidence: {formatPercent(job.averageConfidence)}</p>
          ) : null}
          {hasExtractedData ? (
            <>
              <DocumentFieldsTable fields={fields} draft={draft} onFieldChange={handleFieldChange} />
              {fields.length > 0 && rawContentView ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Show raw extracted text</summary>
                  <div className="mt-2">{rawContentView}</div>
                </details>
              ) : (
                rawContentView
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No extracted data available.</p>
          )}
        </div>
        <DocumentPreviewPanel jobId={jobId} />
      </div>
    </div>
  );
}
