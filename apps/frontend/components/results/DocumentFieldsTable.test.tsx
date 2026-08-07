import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentFieldsTable } from "@/components/results/DocumentFieldsTable";
import type { ExtractedField } from "@/features/results/extract-fields";

function field(overrides: Partial<ExtractedField> = {}): ExtractedField {
  return { name: "Total", displayValue: "$1,234.56", confidence: 0.97, ...overrides };
}

describe("DocumentFieldsTable", () => {
  it("renders a field's name, value, and formatted confidence", () => {
    render(<DocumentFieldsTable fields={[field()]} />);
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("$1,234.56")).toBeInTheDocument();
    expect(screen.getByText("97%")).toBeInTheDocument();
  });

  it("shows an em dash instead of a fabricated percentage when confidence is null", () => {
    render(<DocumentFieldsTable fields={[field({ confidence: null })]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders nothing when there are no fields", () => {
    const { container } = render(<DocumentFieldsTable fields={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every field in a multi-field result", () => {
    render(
      <DocumentFieldsTable
        fields={[
          field({ name: "Vendor", displayValue: "Acme Corp", confidence: 0.88 }),
          field({ name: "Total", displayValue: "$50.00", confidence: 0.6 }),
        ]}
      />,
    );
    expect(screen.getByText("Vendor")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("88%")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("$50.00")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
  });
});
