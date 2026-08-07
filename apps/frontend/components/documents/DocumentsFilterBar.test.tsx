import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentsFilterBar } from "@/components/documents/DocumentsFilterBar";

async function advanceBy(ms: number, stepMs = 25): Promise<void> {
  let elapsed = 0;
  while (elapsed < ms) {
    const step = Math.min(stepMs, ms - elapsed);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step);
    });
    elapsed += step;
  }
}

describe("DocumentsFilterBar", () => {
  it("calls onFilterChange with the selected status", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(<DocumentsFilterBar filters={{}} onFilterChange={onFilterChange} onReset={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText("Status"), "completed");

    expect(onFilterChange).toHaveBeenCalledWith("status", "completed");
  });

  it("calls onFilterChange with undefined when 'All statuses' is chosen", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(<DocumentsFilterBar filters={{ status: "completed" }} onFilterChange={onFilterChange} onReset={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText("Status"), "All statuses");

    expect(onFilterChange).toHaveBeenCalledWith("status", undefined);
  });

  it("calls onFilterChange with the selected document type", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(<DocumentsFilterBar filters={{}} onFilterChange={onFilterChange} onReset={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText("Type"), "Invoice");

    expect(onFilterChange).toHaveBeenCalledWith("documentType", "invoice");
  });

  it("calls onFilterChange when the date-from field changes", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(<DocumentsFilterBar filters={{}} onFilterChange={onFilterChange} onReset={vi.fn()} />);

    await user.type(screen.getByLabelText("From"), "2026-01-15");

    expect(onFilterChange).toHaveBeenCalledWith("dateFrom", "2026-01-15");
  });

  describe("search debouncing", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not call onFilterChange immediately on keystroke, only after the debounce settles", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const onFilterChange = vi.fn();
      render(<DocumentsFilterBar filters={{}} onFilterChange={onFilterChange} onReset={vi.fn()} />);

      await user.type(screen.getByLabelText("Search"), "acme");
      expect(onFilterChange).not.toHaveBeenCalled();

      await advanceBy(500);
      expect(onFilterChange).toHaveBeenCalledWith("search", "acme");
      expect(onFilterChange).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a Clear filters button only when a filter is active, and calls onReset when clicked", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const { rerender } = render(<DocumentsFilterBar filters={{}} onFilterChange={vi.fn()} onReset={onReset} />);

    expect(screen.queryByRole("button", { name: /clear filters/i })).not.toBeInTheDocument();

    rerender(<DocumentsFilterBar filters={{ status: "completed" }} onFilterChange={vi.fn()} onReset={onReset} />);
    const clearButton = screen.getByRole("button", { name: /clear filters/i });
    await user.click(clearButton);

    expect(onReset).toHaveBeenCalledOnce();
  });
});
