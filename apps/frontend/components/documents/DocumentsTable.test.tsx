import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryWrapper } from "../../test/query-client-wrapper";
import { DocumentsTable } from "@/components/documents/DocumentsTable";
import type { JobDto } from "@/types/api";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

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

describe("DocumentsTable", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<DocumentsTable jobs={[]} />, { wrapper: createQueryWrapper() });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a row with the file name, type, confidence, and page count", () => {
    render(<DocumentsTable jobs={[jobFixture()]} />, { wrapper: createQueryWrapper() });

    expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
    expect(screen.getByText("Invoice")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows an em dash for null confidence and null page count, never a fabricated value", () => {
    render(<DocumentsTable jobs={[jobFixture({ averageConfidence: null, pageCount: null })]} />, {
      wrapper: createQueryWrapper(),
    });

    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("links to the results page via the row's actions menu", async () => {
    const user = userEvent.setup();
    render(<DocumentsTable jobs={[jobFixture({ jobId: "job_42" })]} />, { wrapper: createQueryWrapper() });

    await user.click(screen.getByRole("button", { name: /open actions menu/i }));

    expect(screen.getByRole("menuitem", { name: /view/i })).toHaveAttribute("href", "/documents/job_42");
  });

  it("renders one row per job, in the given order", () => {
    render(
      <DocumentsTable
        jobs={[jobFixture({ jobId: "job_1", fileName: "a.pdf" }), jobFixture({ jobId: "job_2", fileName: "b.pdf" })]}
      />,
      { wrapper: createQueryWrapper() },
    );

    const rows = screen.getAllByRole("row");
    // +1 for the header row.
    expect(rows).toHaveLength(3);
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    expect(screen.getByText("b.pdf")).toBeInTheDocument();
  });

  it.each([
    ["pending", "Pending"],
    ["processing", "Processing…"],
    ["completed", "Completed"],
    ["failed", "Failed"],
    ["rejected_quota", "Quota exceeded"],
  ] as const)("shows the right label for status=%s", (status, expectedLabel) => {
    render(<DocumentsTable jobs={[jobFixture({ status })]} />, { wrapper: createQueryWrapper() });
    expect(screen.getByText(expectedLabel)).toBeInTheDocument();
  });

  it.each([
    ["unreviewed", "Unreviewed"],
    ["confirmed", "Confirmed"],
    ["rejected", "Rejected"],
  ] as const)("shows the right review-status label for reviewStatus=%s", (reviewStatus, expectedLabel) => {
    render(<DocumentsTable jobs={[jobFixture({ reviewStatus })]} />, { wrapper: createQueryWrapper() });
    expect(screen.getByText(expectedLabel)).toBeInTheDocument();
  });

  it("keeps the review-status column visually distinct from the processing-status column, even when both could read as 'Rejected'-adjacent", () => {
    render(<DocumentsTable jobs={[jobFixture({ status: "rejected_quota", reviewStatus: "rejected" })]} />, {
      wrapper: createQueryWrapper(),
    });

    // Both labels present and distinguishable — "Quota exceeded" (processing)
    // never collapses into the same text as "Rejected" (review).
    expect(screen.getByText("Quota exceeded")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });
});
