import type { ExportSerializer } from "@/modules/documents/documents.export.serializer";
import type { ResolvedExportTable } from "@/modules/documents/documents.export.configuration";

const XML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXmlText(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ENTITIES[char] ?? char);
}

/**
 * Turns a resolved column label into a valid XML element name: strips
 * whitespace, replaces any other character outside the XML Name-safe ASCII
 * subset this app's field names actually use with "_", and prefixes an
 * otherwise-numeric-leading result with "_" (XML names can't start with a
 * digit). Two distinct labels that happen to sanitize to the same element
 * name is a known, accepted limitation of a generic schema — not solved
 * here (see docs/adr/0015-configurable-export-formats.md).
 */
function sanitizeElementName(label: string): string {
  const withoutWhitespace = label.replace(/\s+/g, "");
  const safe = withoutWhitespace.replace(/[^A-Za-z0-9_.-]/g, "_");
  const named = safe.length > 0 ? safe : "Field";
  return /^[0-9]/.test(named) ? `_${named}` : named;
}

/**
 * Generic, TNDA-AI-specific export schema: one <Document> element per
 * document under a <Documents> root, one child element per resolved column.
 * This is NOT UBL, Factur-X, CII, or any other e-invoicing/ERP XML
 * standard — this app's fully dynamic, per-document field set (ADR 0014)
 * cannot honestly claim conformance to a standard with mandatory,
 * validated fields. See docs/adr/0015-configurable-export-formats.md.
 */
async function buildXmlContent(table: ResolvedExportTable): Promise<string> {
  const elementNames = table.columns.map(sanitizeElementName);

  const documents = table.rows
    .map((row) => {
      const fields = elementNames
        .map((name, index) => `<${name}>${escapeXmlText(row.cells[index] ?? "")}</${name}>`)
        .join("");
      return `<Document>${fields}</Document>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<Documents>${documents}</Documents>`;
}

export const xmlSerializer: ExportSerializer = {
  format: "xml",
  contentType: "application/xml; charset=utf-8",
  fileExtension: "xml",
  serialize: buildXmlContent,
};
