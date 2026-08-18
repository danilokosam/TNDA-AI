import { describe, expect, it } from "vitest";
import { xmlSerializer } from "@/modules/documents/documents.export.serializer.xml";
import type { ResolvedExportTable } from "@/modules/documents/documents.export.configuration";

describe("xmlSerializer", () => {
  it("wraps an empty table in an empty <Documents> root", async () => {
    const xml = (await xmlSerializer.serialize({ columns: ["Job ID"], rows: [] })).toString();
    expect(xml).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<Documents></Documents>');
  });

  it("writes one <Document> element per row, with one child element per column", async () => {
    const table: ResolvedExportTable = {
      columns: ["Supplier", "Total"],
      rows: [{ jobId: "job_1", cells: ["Acme Corp", "199.99"] }],
    };

    const xml = (await xmlSerializer.serialize(table)).toString();

    expect(xml).toContain("<Documents>");
    expect(xml).toContain("<Document>");
    expect(xml).toContain("<Supplier>Acme Corp</Supplier>");
    expect(xml).toContain("<Total>199.99</Total>");
    expect(xml).toContain("</Document>");
    expect(xml).toContain("</Documents>");
  });

  it("writes one <Document> element per row for multiple rows", async () => {
    const table: ResolvedExportTable = {
      columns: ["Job ID"],
      rows: [
        { jobId: "job_1", cells: ["job_1"] },
        { jobId: "job_2", cells: ["job_2"] },
      ],
    };

    const xml = (await xmlSerializer.serialize(table)).toString();

    expect(xml.match(/<Document>/g)).toHaveLength(2);
    expect(xml).toContain("<JobID>job_1</JobID>");
    expect(xml).toContain("<JobID>job_2</JobID>");
  });

  it("escapes XML-reserved characters in cell values", async () => {
    const table: ResolvedExportTable = {
      columns: ["Notes"],
      rows: [{ jobId: "job_1", cells: ["Tom & Jerry <urgent> \"quoted\" 'single'"] }],
    };

    const xml = (await xmlSerializer.serialize(table)).toString();

    expect(xml).toContain("Tom &amp; Jerry &lt;urgent&gt; &quot;quoted&quot; &apos;single&apos;");
    expect(xml).not.toContain("<urgent>");
  });

  it("leaves an empty cell as an empty element, never a placeholder", async () => {
    const table: ResolvedExportTable = {
      columns: ["Average Confidence"],
      rows: [{ jobId: "job_1", cells: [""] }],
    };

    const xml = (await xmlSerializer.serialize(table)).toString();

    expect(xml).toContain("<AverageConfidence></AverageConfidence>");
  });

  it("sanitizes a column label into a valid XML element name", async () => {
    const table: ResolvedExportTable = {
      columns: ["Vendor Name", "2026 Total", "Vendor/Name"],
      rows: [{ jobId: "job_1", cells: ["Acme", "10", "Acme"] }],
    };

    const xml = (await xmlSerializer.serialize(table)).toString();

    expect(xml).toContain("<VendorName>Acme</VendorName>");
    expect(xml).toContain("<_2026Total>10</_2026Total>");
    expect(xml).toContain("<Vendor_Name>Acme</Vendor_Name>");
  });

  it("preserves unicode content", async () => {
    const table: ResolvedExportTable = {
      columns: ["VendorName"],
      rows: [{ jobId: "job_1", cells: ["Café Münchën 株式会社"] }],
    };

    const xml = (await xmlSerializer.serialize(table)).toString();

    expect(xml).toContain("Café Münchën 株式会社");
  });

  it("exposes xml metadata for the route to use as response headers", () => {
    expect(xmlSerializer.format).toBe("xml");
    expect(xmlSerializer.contentType).toBe("application/xml; charset=utf-8");
    expect(xmlSerializer.fileExtension).toBe("xml");
  });
});
