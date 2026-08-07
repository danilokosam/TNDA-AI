import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface DocumentRawContentProps {
  content: string | null;
  format: "markdown" | "text";
}

/**
 * `content` is already extracted via `extractRawContent`; `null` (nothing to
 * show) renders nothing regardless of `format`, same "caller decides which
 * view applies, this just handles its own empty case" convention as
 * `DocumentFieldsTable`.
 *
 * `format` mirrors `extract-fields.ts#isMarkdownContent`, which mirrors the
 * backend's own per-document-type choice (`documents.strategy.ts`):
 * `generic` (Azure's prebuilt-layout model) requests Azure's Markdown output
 * — headers, GFM tables, reading-order paragraphs — and is rendered as such
 * via `react-markdown` + `remark-gfm` (raw HTML in the source is never
 * rendered as live elements — `react-markdown`'s safe default, no
 * `rehype-raw`). The other three (field-shaped) types keep Azure's default
 * flat reading-order text, rendered as literal preformatted text
 * (`whitespace-pre-wrap` + a monospace font): running plain OCR'd text
 * through a Markdown parser risks misinterpreting incidental characters (a
 * line starting with "- ", a stray `#`/`_` in an address or ID number) as
 * formatting instead of literal content.
 */
export function DocumentRawContent({ content, format }: DocumentRawContentProps) {
  if (content === null) return null;

  if (format === "markdown") {
    return (
      <div className="prose prose-sm dark:prose-invert max-h-96 max-w-none overflow-y-auto rounded-lg border p-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="max-h-96 overflow-y-auto rounded-lg border p-4">
      <p className="whitespace-pre-wrap font-mono text-sm">{content}</p>
    </div>
  );
}
