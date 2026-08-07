"use client";

import { useId, useState, type ChangeEvent, type DragEvent } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

interface DropzoneProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
  /** Soft UI hint only — the backend re-validates independently regardless. */
  accept?: string;
}

const DEFAULT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.zip";

export function Dropzone({ onFilesSelected, disabled, accept = DEFAULT_ACCEPT }: DropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputId = useId();

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragOver(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onFilesSelected(files);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) onFilesSelected(files);
    // Reset so selecting the same file again (e.g. after removing it from
    // the queue) still fires a change event next time.
    event.target.value = "";
  }

  return (
    <label
      htmlFor={inputId}
      data-testid="dropzone"
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center transition-colors",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-muted/50",
        isDragOver && !disabled ? "border-ring bg-muted/50" : "border-input",
      )}
    >
      <UploadCloud className="size-8 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">Drop files to upload, or click to browse</p>
        <p className="text-xs text-muted-foreground">PDF, JPG, PNG, or a .zip batch</p>
      </div>
      <input
        id={inputId}
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        onChange={handleInputChange}
        aria-label="Upload files"
        className="sr-only"
      />
    </label>
  );
}
