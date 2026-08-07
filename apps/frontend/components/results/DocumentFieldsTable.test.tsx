import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentFieldsTable } from "@/components/results/DocumentFieldsTable";
import type { EffectiveField } from "@/features/results/extract-fields";

function field(overrides: Partial<EffectiveField> = {}): EffectiveField {
  return {
    name: "Total",
    originalValue: "$1,234.56",
    effectiveValue: "$1,234.56",
    isCorrected: false,
    confidence: 0.97,
    ...overrides,
  };
}

describe("DocumentFieldsTable", () => {
  it("renders a field's name, an editable input with its value, and formatted confidence", () => {
    render(<DocumentFieldsTable fields={[field()]} draft={{}} onFieldChange={vi.fn()} />);
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByDisplayValue("$1,234.56")).toBeInTheDocument();
    expect(screen.getByText("97%")).toBeInTheDocument();
  });

  it("shows an em dash instead of a fabricated percentage when confidence is null", () => {
    render(<DocumentFieldsTable fields={[field({ confidence: null })]} draft={{}} onFieldChange={vi.fn()} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders nothing when there are no fields", () => {
    const { container } = render(<DocumentFieldsTable fields={[]} draft={{}} onFieldChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every field in a multi-field result", () => {
    render(
      <DocumentFieldsTable
        fields={[
          field({ name: "Vendor", originalValue: "Acme Corp", effectiveValue: "Acme Corp", confidence: 0.88 }),
          field({ name: "Total", originalValue: "$50.00", effectiveValue: "$50.00", confidence: 0.6 }),
        ]}
        draft={{}}
        onFieldChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Vendor")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("88%")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByDisplayValue("$50.00")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  it("shows the draft value, not the effective value, once the field has been edited", () => {
    render(
      <DocumentFieldsTable
        fields={[field({ name: "Total", effectiveValue: "$50.00" })]}
        draft={{ Total: "$55.00" }}
        onFieldChange={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("$55.00")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("$50.00")).not.toBeInTheDocument();
  });

  it("calls onFieldChange with the field name and new value when edited", async () => {
    const onFieldChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DocumentFieldsTable fields={[field({ name: "Total", effectiveValue: "50" })]} draft={{}} onFieldChange={onFieldChange} />,
    );

    await user.type(screen.getByDisplayValue("50"), "5");

    expect(onFieldChange).toHaveBeenCalledWith("Total", "505");
  });

  it("shows an 'Edited' indicator instead of confidence once the displayed value differs from the original", () => {
    render(
      <DocumentFieldsTable
        fields={[field({ name: "Total", originalValue: "$50.00", effectiveValue: "$50.00", confidence: 0.9 })]}
        draft={{ Total: "$55.00" }}
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/edited/i)).toBeInTheDocument();
    expect(screen.queryByText("90%")).not.toBeInTheDocument();
  });

  it("does not show 'Edited' when the current value matches the original", () => {
    render(
      <DocumentFieldsTable
        fields={[field({ name: "Total", originalValue: "$50.00", effectiveValue: "$50.00", confidence: 0.9 })]}
        draft={{}}
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.queryByText(/edited/i)).not.toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
  });
});
