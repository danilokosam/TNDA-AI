import { DOCUMENT_TYPES, type DocumentType } from "@/types/api";
import { cn } from "@/lib/utils";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: "Invoice",
  receipt: "Receipt",
  identity_document: "Identity document",
  generic: "Generic document",
};

interface DocumentTypeSelectProps {
  value: DocumentType;
  onChange: (value: DocumentType) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function DocumentTypeSelect({ value, onChange, disabled, id, className }: DocumentTypeSelectProps) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as DocumentType)}
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80",
        className,
      )}
    >
      {DOCUMENT_TYPES.map((type) => (
        <option key={type} value={type}>
          {DOCUMENT_TYPE_LABELS[type]}
        </option>
      ))}
    </select>
  );
}
