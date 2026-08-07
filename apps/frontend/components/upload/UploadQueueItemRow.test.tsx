import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UploadQueueItemRow } from "@/components/upload/UploadQueueItemRow";
import { createUploadQueueItem, type UploadQueueItem } from "@/features/upload/queue";

function itemFixture(overrides: Partial<UploadQueueItem> = {}): UploadQueueItem {
  return {
    ...createUploadQueueItem({ id: "item_1", file: new File(["x".repeat(2048)], "invoice.pdf") }),
    ...overrides,
  };
}

describe("UploadQueueItemRow", () => {
  it("renders the file name and formatted size", () => {
    render(<UploadQueueItemRow item={itemFixture()} onRemove={vi.fn()} />);
    expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it.each([
    ["queued", "Queued"],
    ["uploading", "Uploading…"],
    ["processing", "Processing…"],
    ["completed", "Completed"],
    ["rejected_quota", "Quota exceeded"],
  ] as const)("shows the right label for status=%s", (status, expectedLabel) => {
    render(<UploadQueueItemRow item={itemFixture({ status })} onRemove={vi.fn()} />);
    expect(screen.getByText(expectedLabel)).toBeInTheDocument();
  });

  it("shows the error message for a failed item", () => {
    render(
      <UploadQueueItemRow
        item={itemFixture({ status: "failed", errorMessage: "Azure timed out." })}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText("Azure timed out.")).toBeInTheDocument();
  });

  it("shows accepted/rejected counts for a batch-submitted item", () => {
    render(
      <UploadQueueItemRow
        item={itemFixture({
          status: "batch-submitted",
          batchResult: { totalFiles: 4, accepted: 3, rejected: 1, files: [] },
        })}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(/3 accepted/)).toBeInTheDocument();
    expect(screen.getByText(/1 rejected/)).toBeInTheDocument();
  });

  it("calls onRemove when the remove button is clicked", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<UploadQueueItemRow item={itemFixture()} onRemove={onRemove} />);

    await user.click(screen.getByRole("button", { name: /remove/i }));

    expect(onRemove).toHaveBeenCalledOnce();
  });
});
