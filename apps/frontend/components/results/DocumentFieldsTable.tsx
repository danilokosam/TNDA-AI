import type { ExtractedField } from "@/features/results/extract-fields";
import { formatPercent } from "@/lib/format";

interface DocumentFieldsTableProps {
  fields: ExtractedField[];
}

/**
 * Only meaningful for the three field-shaped document types (invoice,
 * receipt, identity_document) — a `generic` result's `extractDocumentFields`
 * always returns `[]`, which this deliberately renders as nothing rather
 * than an empty table; the caller shows `DocumentRawContent` instead.
 */
export function DocumentFieldsTable({ fields }: DocumentFieldsTableProps) {
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
        {fields.map((field, index) => (
          <tr key={index} className="border-b last:border-0">
            <td className="py-2 pr-4 font-medium">{field.name}</td>
            <td className="py-2 pr-4">{field.displayValue}</td>
            <td className="py-2 text-muted-foreground">
              {field.confidence !== null ? formatPercent(field.confidence) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
