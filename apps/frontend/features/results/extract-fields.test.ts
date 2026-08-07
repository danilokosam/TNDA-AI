import { describe, expect, it } from "vitest";
import { extractDocumentFields, extractEffectiveFields, extractRawContent } from "@/features/results/extract-fields";

describe("extractDocumentFields", () => {
  it("returns an empty array for a null result", () => {
    expect(extractDocumentFields(null)).toEqual([]);
  });

  it("returns an empty array when documents is missing or not an array", () => {
    expect(extractDocumentFields({})).toEqual([]);
    expect(extractDocumentFields({ documents: "not-an-array" })).toEqual([]);
  });

  it("extracts name/displayValue/confidence from an invoice/receipt-shaped result", () => {
    const result = {
      documents: [
        {
          fields: {
            VendorName: { content: "Acme Corp", confidence: 0.95 },
            Total: { content: "$100.00", confidence: 0.72 },
          },
        },
      ],
    };

    expect(extractDocumentFields(result)).toEqual([
      { name: "VendorName", displayValue: "Acme Corp", confidence: 0.95 },
      { name: "Total", displayValue: "$100.00", confidence: 0.72 },
    ]);
  });

  it("flattens fields across multiple documents in one result", () => {
    const result = {
      documents: [
        { fields: { A: { content: "a", confidence: 1.0 } } },
        { fields: { B: { content: "b", confidence: 0.5 } } },
      ],
    };

    expect(extractDocumentFields(result).map((f) => f.name)).toEqual(["A", "B"]);
  });

  it("prefers content over value when both are present", () => {
    const result = { documents: [{ fields: { X: { content: "from content", value: "from value" } } }] };
    expect(extractDocumentFields(result)[0]?.displayValue).toBe("from content");
  });

  it("falls back to a stringified value when content is missing", () => {
    const result = { documents: [{ fields: { Total: { value: 100 } } }] };
    expect(extractDocumentFields(result)[0]?.displayValue).toBe("100");
  });

  it("falls back to an em dash when neither content nor value is usable", () => {
    const result = { documents: [{ fields: { Empty: { confidence: 0.5 } } }] };
    expect(extractDocumentFields(result)[0]?.displayValue).toBe("—");
  });

  it("uses null (not 0) for a missing or non-numeric confidence", () => {
    const result = { documents: [{ fields: { X: { content: "x" } } }] };
    expect(extractDocumentFields(result)[0]?.confidence).toBeNull();
  });

  it("skips a malformed field rather than throwing", () => {
    const result = { documents: [{ fields: { Bad: "not-a-record", Good: { content: "ok", confidence: 1 } } }] };
    expect(extractDocumentFields(result)).toEqual([{ name: "Good", displayValue: "ok", confidence: 1 }]);
  });

  it("skips a malformed document rather than throwing", () => {
    const result = { documents: [null, 42, { fields: "not-an-object" }, { fields: { X: { content: "x" } } }] };
    expect(extractDocumentFields(result).map((f) => f.name)).toEqual(["X"]);
  });

  it("returns an empty array for a generic/prebuilt-layout result (no documents field at all)", () => {
    const result = { pages: [{ pageNumber: 1, lines: [{ content: "hello" }] }], tables: [] };
    expect(extractDocumentFields(result)).toEqual([]);
  });
});

describe("extractEffectiveFields", () => {
  const result = {
    documents: [
      {
        fields: {
          VendorName: { content: "Acme Corp", confidence: 0.95 },
          Total: { content: "$100.00", confidence: 0.72 },
        },
      },
    ],
  };

  it("returns Azure's original value as effectiveValue, uncorrected, when there are no corrections", () => {
    expect(extractEffectiveFields(result, {})).toEqual([
      { name: "VendorName", originalValue: "Acme Corp", effectiveValue: "Acme Corp", isCorrected: false, confidence: 0.95 },
      { name: "Total", originalValue: "$100.00", effectiveValue: "$100.00", isCorrected: false, confidence: 0.72 },
    ]);
  });

  it("uses the corrected value as effectiveValue and marks the field corrected", () => {
    const fields = extractEffectiveFields(result, { Total: "$105.00" });

    expect(fields).toContainEqual({
      name: "Total",
      originalValue: "$100.00",
      effectiveValue: "$105.00",
      isCorrected: true,
      confidence: 0.72,
    });
    // VendorName is untouched by the correction map.
    expect(fields).toContainEqual({
      name: "VendorName",
      originalValue: "Acme Corp",
      effectiveValue: "Acme Corp",
      isCorrected: false,
      confidence: 0.95,
    });
  });

  it("is not marked corrected when the effective value happens to equal the original (e.g. corrected then reverted)", () => {
    const fields = extractEffectiveFields(result, { Total: "$100.00" });
    expect(fields.find((f) => f.name === "Total")?.isCorrected).toBe(false);
  });

  it("keeps Azure's original confidence even for a corrected field — a human override has no confidence of its own", () => {
    const fields = extractEffectiveFields(result, { Total: "$105.00" });
    expect(fields.find((f) => f.name === "Total")?.confidence).toBe(0.72);
  });

  it("returns an empty array for a generic document (no fields at all)", () => {
    expect(extractEffectiveFields({ content: "markdown here" }, {})).toEqual([]);
  });

  it("returns an empty array for a null result", () => {
    expect(extractEffectiveFields(null, {})).toEqual([]);
  });
});

describe("extractRawContent", () => {
  it("returns null for a null result", () => {
    expect(extractRawContent(null)).toBeNull();
  });

  it("returns the top-level content string when present", () => {
    expect(extractRawContent({ content: "Full OCR text here." })).toBe("Full OCR text here.");
  });

  it("returns null when content is missing", () => {
    expect(extractRawContent({ pages: [] })).toBeNull();
  });

  it("returns null when content is an empty string", () => {
    expect(extractRawContent({ content: "" })).toBeNull();
  });

  it("returns null when content is present but not a string", () => {
    expect(extractRawContent({ content: 12345 })).toBeNull();
  });
});
