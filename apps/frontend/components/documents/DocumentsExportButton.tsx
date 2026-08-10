"use client";

import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useExportDocuments } from "@/features/documents/hooks";
import { ApiError } from "@/lib/api/response";
import type { DocumentsFilters } from "@/features/documents/filters";

interface DocumentsExportButtonProps {
  filters: DocumentsFilters;
}

/** Same duplication call as DocumentRowActions.tsx's identical helper — small and proportionate, not worth sharing for three lines. */
function mutationErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Exports whatever the Documents list's current filters resolve to —
 * always completed documents only (see documents.service.ts#exportDocuments
 * on the backend); `status` is never forwarded (see buildDocumentsExportPath).
 */
export function DocumentsExportButton({ filters }: DocumentsExportButtonProps) {
  const exportDocuments = useExportDocuments();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={exportDocuments.isPending}
      onClick={() => {
        exportDocuments.mutate(filters, {
          onSuccess: ({ blob, fileName }) => {
            downloadBlob(blob, fileName);
            toast.success("Export ready");
          },
          onError: (error) => toast.error(mutationErrorMessage(error)),
        });
      }}
    >
      <Download />
      {exportDocuments.isPending ? "Exporting…" : "Export CSV"}
    </Button>
  );
}
