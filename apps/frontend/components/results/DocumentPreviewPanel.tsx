"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentPreview } from "@/features/results/use-document-preview";

interface DocumentPreviewPanelProps {
  jobId: string;
}

/**
 * `<iframe>` uniformly for `session-blob`/`remote-url`, rather than
 * branching on file type (`<img>` vs. a PDF viewer) — browsers render both
 * images and PDFs inside a frame natively, and `DocumentPreviewSource`
 * deliberately carries no MIME type (see `preview.ts`), so branching would
 * mean threading file type through as a separate prop for no real gain.
 */
export function DocumentPreviewPanel({ jobId }: DocumentPreviewPanelProps) {
  const source = useDocumentPreview(jobId);

  if (source.kind === "loading") {
    return <Skeleton className="h-full min-h-96 w-full rounded-lg" />;
  }

  if (source.kind === "unavailable") {
    return (
      <div className="flex h-full min-h-48 flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
        <p>Preview unavailable</p>
        <p className="max-w-64 text-xs">No stored copy of this document could be found.</p>
      </div>
    );
  }

  return <iframe title="Document preview" src={source.url} className="h-full min-h-96 w-full rounded-lg border" />;
}
