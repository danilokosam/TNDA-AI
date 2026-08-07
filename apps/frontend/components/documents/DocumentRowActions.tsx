"use client";

import { useState } from "react";
import Link from "next/link";
import { EllipsisVertical } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDeleteDocument, useRemoveDocumentFile } from "@/features/documents/hooks";
import type { JobDto } from "@/types/api";

interface DocumentRowActionsProps {
  job: JobDto;
}

type ConfirmingAction = "remove-file" | "delete" | null;

/**
 * One `useRemoveDocumentFile`/`useDeleteDocument` instance per rendered
 * row — same "a hook per item in a dynamic list" pattern already
 * established for `PolledUploadQueueItem` (Stage 3), which gives each
 * row's pending/error state independently, rather than N rows sharing one
 * mutation instance and fighting over its single `isPending`/`error`.
 *
 * The confirmation dialogs are controlled (`open`/`onOpenChange`), not the
 * simpler `AlertDialogTrigger`-wrapping-a-button pattern `DocumentResultsView`
 * uses — the trigger here is a `DropdownMenuItem`, and nesting an
 * `AlertDialogTrigger` inside one is a known-fragile Radix composition
 * (the menu's own closing/focus-return behavior can race the dialog trying
 * to open). `onSelect`'s `preventDefault()` stops the menu item's default
 * behavior from interfering; `confirmingAction` state, set from that
 * handler, is what actually opens the right dialog afterward.
 */
export function DocumentRowActions({ job }: DocumentRowActionsProps) {
  const [confirmingAction, setConfirmingAction] = useState<ConfirmingAction>(null);
  const removeFile = useRemoveDocumentFile();
  const deleteDocument = useDeleteDocument();

  const handleConfirmRemoveFile = () => {
    removeFile.mutate(job.jobId, { onSuccess: () => setConfirmingAction(null) });
  };

  const handleConfirmDelete = () => {
    deleteDocument.mutate(job.jobId, { onSuccess: () => setConfirmingAction(null) });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm">
            <EllipsisVertical />
            <span className="sr-only">Open actions menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/documents/${job.jobId}`}>View</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setConfirmingAction("remove-file");
            }}
          >
            Remove file
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              setConfirmingAction("delete");
            }}
          >
            Delete document
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirmingAction === "remove-file"}
        onOpenChange={(open) => !open && setConfirmingAction(null)}
      >
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
            <AlertDialogAction variant="destructive" onClick={handleConfirmRemoveFile}>
              Remove file
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmingAction === "delete"} onOpenChange={(open) => !open && setConfirmingAction(null)}>
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
            <AlertDialogAction variant="destructive" onClick={handleConfirmDelete}>
              Delete document
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
