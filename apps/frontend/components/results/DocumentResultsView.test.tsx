import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createQueryWrapper } from "../../test/query-client-wrapper";
import type { JobDto } from "@/types/api";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

const { apiFetch } = await import("@/lib/api/http");
const { DocumentResultsView } = await import("@/components/results/DocumentResultsView");

function jobFixture(overrides: Partial<JobDto> = {}): JobDto {
  return {
    jobId: "job_1",
    status: "completed",
    fileName: "invoice.pdf",
    fileSizeBytes: 2048,
    pageCount: 1,
    documentType: "invoice",
    averageConfidence: 0.92,
    resultJson: null,
    errorMessage: null,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("DocumentResultsView", () => {
  it("shows a loading state before the job data arrives", () => {
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows a processing message while the job is still processing", async () => {
    vi.mocked(apiFetch).mockResolvedValue(jobFixture({ status: "processing" }));

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText(/processing/i)).toBeInTheDocument();
  });

  it("shows a waiting message while the job is pending", async () => {
    vi.mocked(apiFetch).mockResolvedValue(jobFixture({ status: "pending" }));

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText(/waiting to process/i)).toBeInTheDocument();
  });

  it("shows the error message for a failed job", async () => {
    vi.mocked(apiFetch).mockResolvedValue(jobFixture({ status: "failed", errorMessage: "Azure timed out." }));

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText("Azure timed out.")).toBeInTheDocument();
  });

  it("shows a quota message for a rejected_quota job", async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      jobFixture({ status: "rejected_quota", errorMessage: "Monthly document limit reached." }),
    );

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText(/quota exceeded/i)).toBeInTheDocument();
    expect(screen.getByText("Monthly document limit reached.")).toBeInTheDocument();
  });

  it("renders extracted fields for a completed field-shaped document", async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      jobFixture({
        status: "completed",
        resultJson: { documents: [{ fields: { Total: { content: "$50.00", confidence: 0.9 } } }] },
      }),
    );

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText("Total")).toBeInTheDocument();
    expect(screen.getByText("$50.00")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
  });

  it("renders raw content for a completed generic document", async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      jobFixture({
        status: "completed",
        documentType: "generic",
        averageConfidence: null,
        resultJson: { content: "Extracted document text.", pages: [], tables: [] },
      }),
    );

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText("Extracted document text.")).toBeInTheDocument();
  });

  it("shows a fallback message when a completed job has no extractable data", async () => {
    vi.mocked(apiFetch).mockResolvedValue(jobFixture({ status: "completed", resultJson: null }));

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText(/no extracted data/i)).toBeInTheDocument();
  });

  it("shows an error state when the job fetch itself fails", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(404, "NOT_FOUND", "Job not found."));

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText(/couldn.t load this document/i)).toBeInTheDocument();
  });
});
