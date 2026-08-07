"use client";

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

  if (source.kind === "unavailable") {
    return (
      <div className="flex h-full min-h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        Preview unavailable
      </div>
    );
  }

  return <iframe title="Document preview" src={source.url} className="h-full min-h-96 w-full rounded-lg border" />;
}
