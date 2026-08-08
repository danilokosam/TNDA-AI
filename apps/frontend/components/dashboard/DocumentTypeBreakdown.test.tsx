import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { countByType, DocumentTypeBreakdown } from "@/components/dashboard/DocumentTypeBreakdown";
import type { DocumentType } from "@/types/api";

function jobsOfType(...types: DocumentType[]): Array<{ documentType: DocumentType }> {
  return types.map((documentType) => ({ documentType }));
}

describe("countByType", () => {
  it("returns nothing for an empty list", () => {
    expect(countByType([])).toEqual([]);
  });

  it("counts a single document", () => {
    expect(countByType(jobsOfType("invoice"))).toEqual([{ type: "invoice", count: 1 }]);
  });

  it("drops types with zero occurrences rather than listing them at 0", () => {
    const result = countByType(jobsOfType("invoice", "invoice"));
    expect(result).toEqual([{ type: "invoice", count: 2 }]);
    expect(result.find((entry) => entry.type === "receipt")).toBeUndefined();
  });

  it("sorts by count descending, most common type first", () => {
    const result = countByType(jobsOfType("receipt", "invoice", "receipt", "generic", "receipt"));
    expect(result).toEqual([
      { type: "receipt", count: 3 },
      { type: "invoice", count: 1 },
      { type: "generic", count: 1 },
    ]);
  });

  it("counts all four document types correctly when every type is present", () => {
    const result = countByType(jobsOfType("invoice", "receipt", "identity_document", "generic"));
    expect(result).toHaveLength(4);
    expect(result.reduce((sum, entry) => sum + entry.count, 0)).toBe(4);
  });
});

describe("DocumentTypeBreakdown", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  function expectNoDuplicateKeyWarning() {
    const duplicateKeyWarning = consoleErrorSpy.mock.calls.find((call: unknown[]) => String(call[0]).includes("same key"));
    expect(duplicateKeyWarning).toBeUndefined();
  }

  it("renders an empty state for zero documents", () => {
    render(<DocumentTypeBreakdown jobs={[]} hasMore={false} />);

    expect(screen.getByText(/no documents yet/i)).toBeInTheDocument();
    expectNoDuplicateKeyWarning();
  });

  it("renders correctly for a single document", () => {
    render(<DocumentTypeBreakdown jobs={jobsOfType("invoice")} hasMore={false} />);

    expect(screen.getByText("Invoice")).toBeInTheDocument();
    expect(screen.getByText("1 · 100%")).toBeInTheDocument();
    expectNoDuplicateKeyWarning();
  });

  it("labels the card as a complete total when there's no further history", () => {
    render(<DocumentTypeBreakdown jobs={jobsOfType("invoice", "receipt")} hasMore={false} />);

    expect(screen.getByText("All documents")).toBeInTheDocument();
    expectNoDuplicateKeyWarning();
  });

  it("labels the card as a recent sample, not a total, when there's more history than what was fetched", () => {
    render(<DocumentTypeBreakdown jobs={jobsOfType("invoice", "receipt")} hasMore={true} />);

    expect(screen.getByText("Your 2 most recent documents")).toBeInTheDocument();
    expectNoDuplicateKeyWarning();
  });

  it("renders correctly for a realistic mix of all four document types", () => {
    render(
      <DocumentTypeBreakdown
        jobs={jobsOfType(
          "invoice",
          "invoice",
          "invoice",
          "receipt",
          "receipt",
          "identity_document",
          "generic",
        )}
        hasMore={true}
      />,
    );

    expect(screen.getByText("Invoice")).toBeInTheDocument();
    expect(screen.getByText("Receipt")).toBeInTheDocument();
    expect(screen.getByText("Identity document")).toBeInTheDocument();
    expect(screen.getByText("Generic document")).toBeInTheDocument();
    expectNoDuplicateKeyWarning();
  });
});
