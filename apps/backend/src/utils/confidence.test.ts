import { describe, expect, it } from "vitest";
import { computeAverageConfidence } from "@/utils/confidence";

describe("computeAverageConfidence", () => {
  it("returns null for a null result", () => {
    expect(computeAverageConfidence(null)).toBeNull();
  });

  it("averages field confidences from an invoice/receipt-shaped result", () => {
    const result = {
      documents: [
        {
          fields: {
            VendorName: { value: "Acme", confidence: 0.9 },
            Total: { value: 100, confidence: 0.7 },
          },
        },
      ],
    };

    expect(computeAverageConfidence(result)).toBeCloseTo(0.8);
  });

  it("averages across multiple documents (a batch-analyzed result)", () => {
    const result = {
      documents: [
        { fields: { A: { confidence: 1.0 } } },
        { fields: { B: { confidence: 0.5 } } },
      ],
    };

    expect(computeAverageConfidence(result)).toBeCloseTo(0.75);
  });

  it("returns null for a generic/prebuilt-layout result (no per-field confidence at all)", () => {
    const result = {
      pages: [{ pageNumber: 1, lines: [{ content: "hello" }] }],
      tables: [],
    };

    expect(computeAverageConfidence(result)).toBeNull();
  });

  it("skips fields with a missing or non-numeric confidence rather than treating them as 0", () => {
    const result = {
      documents: [
        {
          fields: {
            Known: { value: "x", confidence: 0.8 },
            Unscored: { value: "y" },
          },
        },
      ],
    };

    expect(computeAverageConfidence(result)).toBe(0.8);
  });

  it("returns null when documents is present but not an array", () => {
    expect(computeAverageConfidence({ documents: "not-an-array" })).toBeNull();
  });

  it("returns null for a malformed/unexpected shape rather than throwing", () => {
    expect(computeAverageConfidence({ documents: [null, 42, { fields: "not-an-object" }] })).toBeNull();
  });
});
