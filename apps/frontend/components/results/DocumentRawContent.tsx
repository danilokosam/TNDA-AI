interface DocumentRawContentProps {
  content: string | null;
}

/**
 * The `generic` document type's (Azure's `prebuilt-layout` model) rendering
 * case — no per-field confidence exists for it at all (§4 decision 2 in
 * PROGRESS.md), so this shows the full extracted text instead of
 * `DocumentFieldsTable`. `content` is already extracted via
 * `extractRawContent`; `null` (nothing to show) renders nothing, same
 * "caller decides which view applies, this just handles its own empty
 * case" convention as `DocumentFieldsTable`.
 */
export function DocumentRawContent({ content }: DocumentRawContentProps) {
  if (content === null) return null;

  return (
    <div className="max-h-96 overflow-y-auto rounded-lg border p-4">
      <p className="whitespace-pre-wrap text-sm">{content}</p>
    </div>
  );
}
