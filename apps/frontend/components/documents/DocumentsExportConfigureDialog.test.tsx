import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentsExportConfigureDialog } from "@/components/documents/DocumentsExportConfigureDialog";
import type { ExportColumnOption } from "@/features/documents/export-columns";

const COLUMNS: ExportColumnOption[] = [
  { field: "jobId", defaultLabel: "Job ID" },
  { field: "VendorName", defaultLabel: "VendorName" },
  { field: "InvoiceTotal", defaultLabel: "InvoiceTotal" },
];

function renderDialog(onExport = vi.fn(), overrides: Partial<React.ComponentProps<typeof DocumentsExportConfigureDialog>> = {}) {
  const onOpenChange = vi.fn();
  render(
    <DocumentsExportConfigureDialog
      open
      onOpenChange={onOpenChange}
      availableColumns={COLUMNS}
      onExport={onExport}
      isPending={false}
      {...overrides}
    />,
  );
  return { onOpenChange, onExport };
}

describe("DocumentsExportConfigureDialog", () => {
  it("renders one row per available column, all included by default with their default labels", () => {
    renderDialog();

    for (const column of COLUMNS) {
      expect(screen.getByRole("checkbox", { name: new RegExp(column.defaultLabel, "i") })).toBeChecked();
      expect(screen.getByDisplayValue(column.defaultLabel)).toBeInTheDocument();
    }
  });

  it("exports every column, in default order with default labels, when nothing is changed", async () => {
    const user = userEvent.setup();
    const { onExport } = renderDialog();

    await user.click(screen.getByRole("button", { name: /^export$/i }));

    expect(onExport).toHaveBeenCalledWith({
      format: "csv",
      fieldSelection: [
        { field: "jobId", label: "Job ID" },
        { field: "VendorName", label: "VendorName" },
        { field: "InvoiceTotal", label: "InvoiceTotal" },
      ],
    });
  });

  it("excludes a column from the export when its checkbox is unchecked", async () => {
    const user = userEvent.setup();
    const { onExport } = renderDialog();

    await user.click(screen.getByRole("checkbox", { name: /vendorname/i }));
    await user.click(screen.getByRole("button", { name: /^export$/i }));

    expect(onExport).toHaveBeenCalledWith({
      format: "csv",
      fieldSelection: [
        { field: "jobId", label: "Job ID" },
        { field: "InvoiceTotal", label: "InvoiceTotal" },
      ],
    });
  });

  it("renames a column's output label when its text input is edited", async () => {
    const user = userEvent.setup();
    const { onExport } = renderDialog();

    const labelInput = screen.getByDisplayValue("VendorName");
    await user.clear(labelInput);
    await user.type(labelInput, "Supplier");
    await user.click(screen.getByRole("button", { name: /^export$/i }));

    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldSelection: expect.arrayContaining([{ field: "VendorName", label: "Supplier" }]),
      }),
    );
  });

  it("moves a column earlier in export order when its 'move up' control is used", async () => {
    const user = userEvent.setup();
    const { onExport } = renderDialog();

    await user.click(screen.getByRole("button", { name: /move invoicetotal up/i }));
    await user.click(screen.getByRole("button", { name: /^export$/i }));

    const [call] = onExport.mock.calls[0]!;
    expect(call.fieldSelection.map((spec: { field: string }) => spec.field)).toEqual([
      "jobId",
      "InvoiceTotal",
      "VendorName",
    ]);
  });

  it("uses the format selected in the dialog", async () => {
    const user = userEvent.setup();
    const { onExport } = renderDialog();

    await user.selectOptions(screen.getByRole("combobox", { name: /format/i }), "xlsx");
    await user.click(screen.getByRole("button", { name: /^export$/i }));

    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ format: "xlsx" }));
  });

  it("disables the Export button while a mutation is pending", () => {
    renderDialog(vi.fn(), { isPending: true });
    expect(screen.getByRole("button", { name: /exporting/i })).toBeDisabled();
  });
});
