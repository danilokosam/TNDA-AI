import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentTypeSelect } from "@/components/upload/DocumentTypeSelect";

describe("DocumentTypeSelect", () => {
  it("renders all four document types as options", () => {
    render(<DocumentTypeSelect value="invoice" onChange={vi.fn()} />);

    expect(screen.getByRole("option", { name: "Invoice" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Receipt" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Identity document" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Generic document" })).toBeInTheDocument();
  });

  it("reflects the current value as selected", () => {
    render(<DocumentTypeSelect value="receipt" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveValue("receipt");
  });

  it("calls onChange with the newly selected document type", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DocumentTypeSelect value="invoice" onChange={onChange} />);

    await user.selectOptions(screen.getByRole("combobox"), "receipt");

    expect(onChange).toHaveBeenCalledWith("receipt");
  });

  it("is disabled when disabled is set", () => {
    render(<DocumentTypeSelect value="invoice" onChange={vi.fn()} disabled />);
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
