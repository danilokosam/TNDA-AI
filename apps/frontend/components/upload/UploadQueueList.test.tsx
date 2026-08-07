import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryWrapper } from "../../test/query-client-wrapper";
import { createUploadQueueItem } from "@/features/upload/queue";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

const { UploadQueueList } = await import("@/components/upload/UploadQueueList");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("UploadQueueList", () => {
  it("renders nothing when there are no items", () => {
    const { container } = render(
      <UploadQueueList items={[]} onStatusUpdate={vi.fn()} onRemove={vi.fn()} />,
      { wrapper: createQueryWrapper() },
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one row per item", () => {
    const items = [
      createUploadQueueItem({ id: "a", file: new File(["x"], "a.pdf") }),
      createUploadQueueItem({ id: "b", file: new File(["x"], "b.pdf") }),
    ];
    render(<UploadQueueList items={items} onStatusUpdate={vi.fn()} onRemove={vi.fn()} />, {
      wrapper: createQueryWrapper(),
    });

    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    expect(screen.getByText("b.pdf")).toBeInTheDocument();
  });

  it("calls onRemove with the right item id", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const items = [createUploadQueueItem({ id: "a", file: new File(["x"], "a.pdf") })];
    render(<UploadQueueList items={items} onStatusUpdate={vi.fn()} onRemove={onRemove} />, {
      wrapper: createQueryWrapper(),
    });

    await user.click(screen.getByRole("button", { name: /remove/i }));

    expect(onRemove).toHaveBeenCalledWith("a");
  });
});
