import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryWrapper } from "../../test/query-client-wrapper";
import type { DocumentsListResponse, JobDto } from "@/types/api";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

const { apiFetch } = await import("@/lib/api/http");
const { DocumentsWorkspace } = await import("@/components/documents/DocumentsWorkspace");

function jobFixture(overrides: Partial<JobDto> = {}): JobDto {
  return {
    jobId: "job_1",
    status: "completed",
    fileName: "invoice.pdf",
    fileSizeBytes: 2048,
    pageCount: 3,
    documentType: "invoice",
    averageConfidence: 0.92,
    resultJson: null,
    errorMessage: null,
    reviewStatus: "unreviewed",
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2026-08-08T14:30:00.000Z",
    updatedAt: "2026-08-08T14:30:00.000Z",
    ...overrides,
  };
}

function listResult(overrides: Partial<DocumentsListResponse> = {}): DocumentsListResponse {
  return { data: [], pagination: { nextCursor: null, hasMore: false }, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DocumentsWorkspace", () => {
  it("shows a loading state before data arrives", () => {
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));

    render(<DocumentsWorkspace canExport />, { wrapper: createQueryWrapper() });

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows an error state when the query fails", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom"));

    render(<DocumentsWorkspace canExport />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText(/couldn.t load/i)).toBeInTheDocument();
  });

  it("renders the table and pagination once documents load", async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      listResult({ data: [jobFixture()], pagination: { nextCursor: "cursor2", hasMore: true } }),
    );

    render(<DocumentsWorkspace canExport />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText("invoice.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
  });

  it("shows a 'no documents yet' empty state with an upload CTA when there are no results and no filters", async () => {
    vi.mocked(apiFetch).mockResolvedValue(listResult());

    render(<DocumentsWorkspace canExport />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText(/no documents yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /upload a document/i })).toHaveAttribute("href", "/upload");
  });

  it("shows a 'no results for these filters' empty state, not the upload CTA, once a filter is active", async () => {
    const user = userEvent.setup();
    vi.mocked(apiFetch).mockResolvedValue(listResult());
    render(<DocumentsWorkspace canExport />, { wrapper: createQueryWrapper() });
    await screen.findByText(/no documents yet/i);

    await user.selectOptions(screen.getByLabelText("Status"), "completed");

    expect(await screen.findByText(/no documents match/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /upload a document/i })).not.toBeInTheDocument();
  });

  it("clicking Next dispatches next-page and refetches with the returned cursor", async () => {
    const user = userEvent.setup();
    vi.mocked(apiFetch).mockResolvedValueOnce(
      listResult({ data: [jobFixture()], pagination: { nextCursor: "cursor2", hasMore: true } }),
    );
    render(<DocumentsWorkspace canExport />, { wrapper: createQueryWrapper() });
    await screen.findByText("invoice.pdf");

    vi.mocked(apiFetch).mockResolvedValueOnce(
      listResult({ data: [jobFixture({ jobId: "job_2", fileName: "second.pdf" })] }),
    );
    await user.click(screen.getByRole("button", { name: /^next/i }));

    expect(await screen.findByText("second.pdf")).toBeInTheDocument();
    const lastCall = vi.mocked(apiFetch).mock.calls.at(-1)!;
    expect(lastCall[0]).toContain("cursor=cursor2");
  });

  it("clicking Clear filters resets an active filter and refetches without it", async () => {
    const user = userEvent.setup();
    vi.mocked(apiFetch).mockResolvedValue(listResult());
    render(<DocumentsWorkspace canExport />, { wrapper: createQueryWrapper() });
    await screen.findByText(/no documents yet/i);

    await user.selectOptions(screen.getByLabelText("Status"), "completed");
    await screen.findByText(/no documents match/i);

    await user.click(screen.getByRole("button", { name: /clear filters/i }));

    expect(await screen.findByText(/no documents yet/i)).toBeInTheDocument();
    const lastCall = vi.mocked(apiFetch).mock.calls.at(-1)!;
    expect(lastCall[0]).not.toContain("status=");
  });
});
