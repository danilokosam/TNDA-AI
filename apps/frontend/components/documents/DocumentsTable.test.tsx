import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentsTable } from "@/components/documents/DocumentsTable";
import type { JobDto } from "@/types/api";

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
    const { container } = render(<DocumentsTable jobs={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a row with the file name, type, confidence, and page count", () => {
    render(<DocumentsTable jobs={[jobFixture()]} />);

    expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
    expect(screen.getByText("Invoice")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows an em dash for null confidence and null page count, never a fabricated value", () => {
    render(<DocumentsTable jobs={[jobFixture({ averageConfidence: null, pageCount: null })]} />);

    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("links each row to its results page", () => {
    render(<DocumentsTable jobs={[jobFixture({ jobId: "job_42" })]} />);

    expect(screen.getByRole("link", { name: /view/i })).toHaveAttribute("href", "/documents/job_42");
  });

  it("renders one row per job, in the given order", () => {
    render(
      <DocumentsTable
        jobs={[jobFixture({ jobId: "job_1", fileName: "a.pdf" }), jobFixture({ jobId: "job_2", fileName: "b.pdf" })]}
      />,
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
    render(<DocumentsTable jobs={[jobFixture({ status })]} />);
    expect(screen.getByText(expectedLabel)).toBeInTheDocument();
  });
});
