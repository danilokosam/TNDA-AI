import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentsPagination } from "@/components/documents/DocumentsPagination";

describe("DocumentsPagination", () => {
  it("disables Previous when canGoBack is false", () => {
    render(<DocumentsPagination canGoBack={false} hasMore={true} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
  });

  it("calls onPrev when Previous is enabled and clicked", async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    render(<DocumentsPagination canGoBack={true} hasMore={true} onPrev={onPrev} onNext={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /previous/i }));

    expect(onPrev).toHaveBeenCalledOnce();
  });

  it("disables Next when hasMore is false", () => {
    render(<DocumentsPagination canGoBack={true} hasMore={false} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^next/i })).toBeDisabled();
  });

  it("calls onNext when Next is enabled and clicked", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(<DocumentsPagination canGoBack={false} hasMore={true} onPrev={vi.fn()} onNext={onNext} />);

    await user.click(screen.getByRole("button", { name: /^next/i }));

    expect(onNext).toHaveBeenCalledOnce();
  });
});
