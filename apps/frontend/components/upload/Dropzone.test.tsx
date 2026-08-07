import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dropzone } from "@/components/upload/Dropzone";

function makeFile(name = "invoice.pdf") {
  return new File(["content"], name, { type: "application/pdf" });
}

describe("Dropzone", () => {
  it("calls onFilesSelected with the chosen file(s) via the file input", async () => {
    const user = userEvent.setup();
    const onFilesSelected = vi.fn();
    render(<Dropzone onFilesSelected={onFilesSelected} />);

    const file = makeFile();
    const input = screen.getByLabelText(/upload/i, { selector: "input" });
    await user.upload(input, file);

    expect(onFilesSelected).toHaveBeenCalledWith([file]);
  });

  it("calls onFilesSelected with every dropped file in one call", () => {
    const onFilesSelected = vi.fn();
    render(<Dropzone onFilesSelected={onFilesSelected} />);

    const files = [makeFile("a.pdf"), makeFile("b.pdf")];
    const dropzone = screen.getByTestId("dropzone");
    fireEvent.drop(dropzone, { dataTransfer: { files } });

    expect(onFilesSelected).toHaveBeenCalledWith(files);
  });

  it("does not call onFilesSelected on drop when disabled", () => {
    const onFilesSelected = vi.fn();
    render(<Dropzone onFilesSelected={onFilesSelected} disabled />);

    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [makeFile()] } });

    expect(onFilesSelected).not.toHaveBeenCalled();
  });

  it("disables the underlying file input when disabled", () => {
    render(<Dropzone onFilesSelected={vi.fn()} disabled />);
    expect(screen.getByLabelText(/upload/i, { selector: "input" })).toBeDisabled();
  });
});
