import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryWrapper } from "../../test/query-client-wrapper";
import type { JobDto } from "@/types/api";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

const { apiFetch } = await import("@/lib/api/http");
const { DocumentRowActions } = await import("@/components/documents/DocumentRowActions");

function jobFixture(overrides: Partial<JobDto> = {}): JobDto {
  return {
    jobId: "job_1",
    status: "completed",
    fileName: "invoice.pdf",
    fileSizeBytes: 2048,
    pageCount: 1,
    documentType: "invoice",
    averageConfidence: 0.9,
    resultJson: null,
    errorMessage: null,
    reviewStatus: "unreviewed",
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DocumentRowActions", () => {
  it("shows View, Remove file, and Delete document in the dropdown", async () => {
    const user = userEvent.setup();
    render(<DocumentRowActions job={jobFixture()} />, { wrapper: createQueryWrapper() });

    await user.click(screen.getByRole("button", { name: /open actions menu/i }));

    expect(screen.getByRole("menuitem", { name: /view/i })).toHaveAttribute("href", "/documents/job_1");
    expect(screen.getByRole("menuitem", { name: /remove file/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /delete document/i })).toBeInTheDocument();
  });

  it("does not call anything until the Remove file confirmation is accepted", async () => {
    const user = userEvent.setup();
    render(<DocumentRowActions job={jobFixture()} />, { wrapper: createQueryWrapper() });

    await user.click(screen.getByRole("button", { name: /open actions menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /remove file/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("Remove file: DELETEs .../file once confirmed", async () => {
    vi.mocked(apiFetch).mockResolvedValue(jobFixture({ storagePath: null } as never));
    const user = userEvent.setup();
    render(<DocumentRowActions job={jobFixture()} />, { wrapper: createQueryWrapper() });

    await user.click(screen.getByRole("button", { name: /open actions menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /remove file/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /^remove file$/i }));

    await waitFor(() => {
      const [path, , init] = vi.mocked(apiFetch).mock.calls[0]!;
      expect(path).toBe("/api/documents/job_1/file");
      expect((init as RequestInit)?.method).toBe("DELETE");
    });
  });

  it("Delete document: DELETEs the job once confirmed", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ jobId: "job_1" });
    const user = userEvent.setup();
    render(<DocumentRowActions job={jobFixture()} />, { wrapper: createQueryWrapper() });

    await user.click(screen.getByRole("button", { name: /open actions menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /delete document/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete document$/i }));

    await waitFor(() => {
      const [path, , init] = vi.mocked(apiFetch).mock.calls[0]!;
      expect(path).toBe("/api/documents/job_1");
      expect((init as RequestInit)?.method).toBe("DELETE");
    });
  });

  it("surfaces a failed Remove file as a visible error, not silently", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(403, "FORBIDDEN", "Only the uploader or an owner/admin can do this."));
    const user = userEvent.setup();
    render(<DocumentRowActions job={jobFixture()} />, { wrapper: createQueryWrapper() });

    await user.click(screen.getByRole("button", { name: /open actions menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /remove file/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /^remove file$/i }));

    expect(await screen.findByText("Only the uploader or an owner/admin can do this.")).toBeInTheDocument();
  });

  it("surfaces a failed Delete document as a visible error, not silently", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(403, "FORBIDDEN", "Only the uploader or an owner/admin can do this."));
    const user = userEvent.setup();
    render(<DocumentRowActions job={jobFixture()} />, { wrapper: createQueryWrapper() });

    await user.click(screen.getByRole("button", { name: /open actions menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /delete document/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete document$/i }));

    expect(await screen.findByText("Only the uploader or an owner/admin can do this.")).toBeInTheDocument();
  });

  it("disables the confirm button and shows a pending label while Remove file is in flight, so a slow request can't be double-submitted", async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.mocked(apiFetch).mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const user = userEvent.setup();
    render(<DocumentRowActions job={jobFixture()} />, { wrapper: createQueryWrapper() });

    await user.click(screen.getByRole("button", { name: /open actions menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /remove file/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /^remove file$/i }));

    const pendingButton = await within(dialog).findByRole("button", { name: /removing/i });
    expect(pendingButton).toBeDisabled();

    resolveFetch(jobFixture());
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
  });
});
