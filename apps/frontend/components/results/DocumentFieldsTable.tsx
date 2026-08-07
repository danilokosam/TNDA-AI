import { Input } from "@/components/ui/input";
import type { EffectiveField } from "@/features/results/extract-fields";
import { formatPercent } from "@/lib/format";

interface DocumentFieldsTableProps {
  fields: EffectiveField[];
  /** Sparse, unsaved edits keyed by field name — falls back to each field's `effectiveValue` when absent. */
  draft: Record<string, string>;
  onFieldChange: (name: string, value: string) => void;
}

/**
 * Only meaningful for the three field-shaped document types (invoice,
 * receipt, identity_document) — a `generic` result's `extractDocumentFields`
 * (and so `extractEffectiveFields`) always returns `[]`, which this
 * deliberately renders as nothing rather than an empty table; the caller
 * shows `DocumentRawContent` instead.
 *
 * Always editable, not a separate view/edit-mode toggle — a document
 * review workspace's whole point is correcting extracted values, so an
 * extra click to "enter edit mode" would be friction with no real
 * upside. The confidence column shows "Edited" instead of a stale Azure
 * percentage once a field's displayed value (draft or already-saved
 * correction) differs from what Azure originally extracted — a human
 * override has no confidence score of its own to report.
 */
export function DocumentFieldsTable({ fields, draft, onFieldChange }: DocumentFieldsTableProps) {
  if (fields.length === 0) return null;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="py-2 pr-4 font-medium">Field</th>
          <th className="py-2 pr-4 font-medium">Value</th>
          <th className="py-2 font-medium">Confidence</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => {
          const value = draft[field.name] ?? field.effectiveValue;
          const isEdited = value !== field.originalValue;

          return (
            <tr key={field.name} className="border-b last:border-0">
              <td className="py-2 pr-4 font-medium">{field.name}</td>
              <td className="py-2 pr-4">
                <Input value={value} onChange={(event) => onFieldChange(field.name, event.target.value)} />
              </td>
              <td className="py-2 text-muted-foreground">
                {isEdited ? "Edited" : field.confidence !== null ? formatPercent(field.confidence) : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
