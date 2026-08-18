import { describe, expect, it } from "vitest";
import { jsonSerializer } from "@/modules/documents/documents.export.serializer.json";
import type { ResolvedExportTable } from "@/modules/documents/documents.export.configuration";

describe("jsonSerializer", () => {
  it("serializes an empty table as an empty JSON array", async () => {
    const json = await jsonSerializer.serialize({ columns: ["Job ID"], rows: [] });
    expect(JSON.parse(json.toString())).toEqual([]);
  });

  it("serializes one object per row, keyed by the resolved column labels", async () => {
    const table: ResolvedExportTable = {
      columns: ["Supplier", "Total"],
      rows: [{ jobId: "job_1", cells: ["Acme Corp", "199.99"] }],
    };

    const json = await jsonSerializer.serialize(table);

    expect(JSON.parse(json.toString())).toEqual([{ Supplier: "Acme Corp", Total: "199.99" }]);
  });

  it("serializes one object per row for multiple rows, in row order", async () => {
    const table: ResolvedExportTable = {
      columns: ["Job ID"],
      rows: [
        { jobId: "job_1", cells: ["job_1"] },
        { jobId: "job_2", cells: ["job_2"] },
      ],
    };

    const json = await jsonSerializer.serialize(table);

    expect(JSON.parse(json.toString())).toEqual([{ "Job ID": "job_1" }, { "Job ID": "job_2" }]);
  });

  it("keeps an empty cell as an empty string property, never omitting the key", async () => {
    const table: ResolvedExportTable = {
      columns: ["Average Confidence"],
      rows: [{ jobId: "job_1", cells: [""] }],
    };

    const json = await jsonSerializer.serialize(table);

    expect(JSON.parse(json.toString())).toEqual([{ "Average Confidence": "" }]);
  });

  it("produces valid, parseable JSON that preserves unicode content", async () => {
    const table: ResolvedExportTable = {
      columns: ["VendorName"],
      rows: [{ jobId: "job_1", cells: ["Café Münchën 株式会社"] }],
    };

    const json = (await jsonSerializer.serialize(table)).toString();

    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json)).toEqual([{ VendorName: "Café Münchën 株式会社" }]);
  });

  it("exposes json metadata for the route to use as response headers", () => {
    expect(jsonSerializer.format).toBe("json");
    expect(jsonSerializer.contentType).toBe("application/json; charset=utf-8");
    expect(jsonSerializer.fileExtension).toBe("json");
  });
});
