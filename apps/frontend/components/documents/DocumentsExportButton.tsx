"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DocumentsExportConfigureDialog } from "@/components/documents/DocumentsExportConfigureDialog";
import { useExportDocuments } from "@/features/documents/hooks";
import { ApiError } from "@/lib/api/response";
import type { DocumentsFilters } from "@/features/documents/filters";
import type { ExportColumnOption } from "@/features/documents/export-columns";
import { EXPORT_FORMATS, type ExportColumnSpec, type ExportFormat } from "@/types/api";

interface DocumentsExportButtonProps {
  filters: DocumentsFilters;
  availableColumns: ExportColumnOption[];
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: "CSV",
  xlsx: "XLSX (Excel)",
  json: "JSON",
  xml: "XML",
};

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
 * The quick format menu items request the same default (unconfigured)
 * export; "Customize columns…" opens a dialog for column
 * selection/ordering/renaming instead
 * (docs/adr/0015-configurable-export-formats.md).
 */
export function DocumentsExportButton({ filters, availableColumns }: DocumentsExportButtonProps) {
  const [configureOpen, setConfigureOpen] = useState(false);
  // Bumped every time the dialog is opened, forced into its `key` below —
  // the dialog derives its initial column list once, on mount
  // (`useState`'s lazy initializer), so without this it can freeze on a
  // stale `availableColumns` from before the Documents list finished
  // loading and never pick up the real dynamic fields once they arrive.
  // Remounting on every open guarantees it always starts from whatever is
  // currently loaded.
  const [configureKey, setConfigureKey] = useState(0);
  const exportDocuments = useExportDocuments();

  const runExport = (format: ExportFormat, fieldSelection?: ExportColumnSpec[]) => {
    exportDocuments.mutate(
      { filters, format, fieldSelection },
      {
        onSuccess: ({ blob, fileName }) => {
          downloadBlob(blob, fileName);
          toast.success("Export ready");
          setConfigureOpen(false);
        },
        onError: (error) => toast.error(mutationErrorMessage(error)),
      },
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={exportDocuments.isPending}>
            <Download />
            {exportDocuments.isPending ? "Exporting…" : "Export"}
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {EXPORT_FORMATS.map((format) => (
            <DropdownMenuItem key={format} onSelect={() => runExport(format)}>
              {FORMAT_LABELS[format]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setConfigureKey((key) => key + 1);
              setConfigureOpen(true);
            }}
          >
            Customize columns…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DocumentsExportConfigureDialog
        key={configureKey}
        open={configureOpen}
        onOpenChange={setConfigureOpen}
        availableColumns={availableColumns}
        isPending={exportDocuments.isPending}
        onExport={({ format, fieldSelection }) => runExport(format, fieldSelection)}
      />
    </>
  );
}
