import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryWrapper } from "../../test/query-client-wrapper";
import type { JobDto } from "@/types/api";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
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
    reviewStatus: "unreviewed",
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockPush.mockClear();
});

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
    expect(screen.getByDisplayValue("$50.00")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
  });

  it("renders raw content for a completed generic document, not collapsed", async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      jobFixture({
        status: "completed",
        documentType: "generic",
        averageConfidence: null,
        resultJson: { content: "Extracted document text.", pages: [], tables: [] },
      }),
    );

    const { container } = render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText("Extracted document text.")).toBeInTheDocument();
    expect(container.querySelector("details")).toBeNull();
  });

  it("renders generic document content as real Markdown, not literal syntax characters", async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      jobFixture({
        status: "completed",
        documentType: "generic",
        averageConfidence: null,
        resultJson: { content: "# Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |", pages: [], tables: [] },
      }),
    );

    const { container } = render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByRole("heading", { level: 1, name: "Heading" })).toBeInTheDocument();
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("collapses raw content behind a details disclosure when extracted fields are also present", async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      jobFixture({
        status: "completed",
        resultJson: {
          documents: [{ fields: { Total: { content: "$50.00", confidence: 0.9 } } }],
          content: "Full OCR text of the invoice.",
        },
      }),
    );

    const { container } = render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    await screen.findByText("Total");
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText(/show raw extracted text/i)).toBeInTheDocument();
    expect(screen.getByText("Full OCR text of the invoice.")).toBeInTheDocument();
  });

  it("renders only the fields table, with no disclosure, when fields exist but there is no raw content", async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      jobFixture({
        status: "completed",
        resultJson: { documents: [{ fields: { Total: { content: "$50.00", confidence: 0.9 } } }] },
      }),
    );

    const { container } = render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    await screen.findByText("Total");
    expect(container.querySelector("details")).toBeNull();
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

describe("DocumentResultsView — review workflow", () => {
  function fieldShapedJob(overrides: Partial<JobDto> = {}): JobDto {
    return jobFixture({
      status: "completed",
      resultJson: { documents: [{ fields: { Total: { content: "$50.00", confidence: 0.9 } } }] },
      ...overrides,
    });
  }

  /** Dispatches by path suffix + HTTP method, since GET and PATCH .../corrections share a path. */
  function mockApiFetch(handlers: Array<[pathSuffix: string, method: string | undefined, response: unknown]>) {
    vi.mocked(apiFetch).mockImplementation(async (path: unknown, _schema: unknown, init?: RequestInit) => {
      const p = path as string;
      const method = init?.method;
      const handler = handlers.find(([suffix, m]) => p.endsWith(suffix) && m === method);
      if (!handler) throw new Error(`Unmocked apiFetch call: ${method ?? "GET"} ${p}`);
      return handler[2];
    });
  }

  it("shows a badge reflecting the job's current review status", async () => {
    mockApiFetch([
      ["/documents/job_1", undefined, fieldShapedJob({ reviewStatus: "confirmed" })],
      ["/corrections", undefined, { effective: {}, history: [] }],
      ["/preview-url", undefined, { url: null }],
    ]);

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText("Confirmed")).toBeInTheDocument();
  });

  it("shows Save/Confirm/Reject for a field-shaped document, with Save disabled until something is edited", async () => {
    mockApiFetch([
      ["/documents/job_1", undefined, fieldShapedJob()],
      ["/corrections", undefined, { effective: {}, history: [] }],
      ["/preview-url", undefined, { url: null }],
    ]);

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    await screen.findByText("Total");
    expect(screen.getByRole("button", { name: /save corrections/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^confirm$/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeEnabled();
  });

  it("does not show Save corrections for a generic document — there are no fields to correct", async () => {
    mockApiFetch([
      [
        "/documents/job_1",
        undefined,
        jobFixture({ status: "completed", documentType: "generic", averageConfidence: null, resultJson: { content: "hello" } }),
      ],
      ["/preview-url", undefined, { url: null }],
    ]);

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    await screen.findByText("hello");
    expect(screen.queryByRole("button", { name: /save corrections/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^confirm$/i })).toBeEnabled();
  });

  it("enables Save once a field is edited, and PATCHes the current draft", async () => {
    mockApiFetch([
      ["/documents/job_1", undefined, fieldShapedJob()],
      ["/corrections", undefined, { effective: {}, history: [] }],
      ["/preview-url", undefined, { url: null }],
      ["/corrections", "PATCH", fieldShapedJob()],
    ]);
    const user = userEvent.setup();

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    const input = await screen.findByDisplayValue("$50.00");
    await user.clear(input);
    await user.type(input, "$55.00");

    const saveButton = screen.getByRole("button", { name: /save corrections/i });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    await waitFor(() => {
      const patchCall = vi
        .mocked(apiFetch)
        .mock.calls.find(([, , init]) => (init as RequestInit | undefined)?.method === "PATCH");
      expect(patchCall).toBeDefined();
      expect(patchCall?.[2]?.body).toBe(JSON.stringify({ corrections: { Total: "$55.00" } }));
    });
  });

  it("Confirm sends the current draft (possibly empty) and marks the job confirmed", async () => {
    mockApiFetch([
      ["/documents/job_1", undefined, fieldShapedJob()],
      ["/corrections", undefined, { effective: {}, history: [] }],
      ["/preview-url", undefined, { url: null }],
      ["/confirm", "POST", fieldShapedJob({ reviewStatus: "confirmed" })],
    ]);
    const user = userEvent.setup();

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    await screen.findByText("Total");
    await user.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      const confirmCall = vi.mocked(apiFetch).mock.calls.find(([path]) => (path as string).endsWith("/confirm"));
      expect(confirmCall).toBeDefined();
      expect(confirmCall?.[2]?.body).toBe(JSON.stringify({ corrections: {} }));
    });
  });

  it("Reject POSTs to the reject endpoint", async () => {
    mockApiFetch([
      ["/documents/job_1", undefined, fieldShapedJob()],
      ["/corrections", undefined, { effective: {}, history: [] }],
      ["/preview-url", undefined, { url: null }],
      ["/reject", "POST", fieldShapedJob({ reviewStatus: "rejected" })],
    ]);
    const user = userEvent.setup();

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    await screen.findByText("Total");
    await user.click(screen.getByRole("button", { name: /^reject$/i }));

    await waitFor(() => {
      expect(vi.mocked(apiFetch).mock.calls.some(([path]) => (path as string).endsWith("/reject"))).toBe(true);
    });
  });

  it("shows an inline error message when a review action fails", async () => {
    const { ApiError } = await import("@/lib/api/response");
    mockApiFetch([
      ["/documents/job_1", undefined, fieldShapedJob()],
      ["/corrections", undefined, { effective: {}, history: [] }],
      ["/preview-url", undefined, { url: null }],
    ]);
    vi.mocked(apiFetch).mockImplementation(async (path: unknown, _schema: unknown, init?: RequestInit) => {
      const p = path as string;
      if (p.endsWith("/confirm") && init?.method === "POST") {
        throw new ApiError(409, "CONFLICT", "This document hasn't finished processing yet.");
      }
      if (p.endsWith("/documents/job_1")) return fieldShapedJob();
      if (p.endsWith("/corrections")) return { effective: {}, history: [] };
      if (p.endsWith("/preview-url")) return { url: null };
      throw new Error(`Unmocked apiFetch call: ${p}`);
    });
    const user = userEvent.setup();

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    await screen.findByText("Total");
    await user.click(screen.getByRole("button", { name: /^confirm$/i }));

    expect(await screen.findByText("This document hasn't finished processing yet.")).toBeInTheDocument();
  });
});

describe("DocumentResultsView — file lifecycle", () => {
  function fieldShapedJob(overrides: Partial<JobDto> = {}): JobDto {
    return jobFixture({
      status: "completed",
      resultJson: { documents: [{ fields: { Total: { content: "$50.00", confidence: 0.9 } } }] },
      ...overrides,
    });
  }

  function mockApiFetch(handlers: Array<[pathSuffix: string, method: string | undefined, response: unknown]>) {
    vi.mocked(apiFetch).mockImplementation(async (path: unknown, _schema: unknown, init?: RequestInit) => {
      const p = path as string;
      const method = init?.method;
      const handler = handlers.find(([suffix, m]) => p.endsWith(suffix) && m === method);
      if (!handler) throw new Error(`Unmocked apiFetch call: ${method ?? "GET"} ${p}`);
      return handler[2];
    });
  }

  it("shows Remove file and Delete document actions for a completed document", async () => {
    mockApiFetch([
      ["/documents/job_1", undefined, fieldShapedJob()],
      ["/corrections", undefined, { effective: {}, history: [] }],
      ["/preview-url", undefined, { url: null }],
    ]);

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    await screen.findByText("Total");
    expect(screen.getByRole("button", { name: /^remove file$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^delete document$/i })).toBeInTheDocument();
  });

  it("does nothing until the Remove file confirmation is accepted", async () => {
    mockApiFetch([
      ["/documents/job_1", undefined, fieldShapedJob()],
      ["/corrections", undefined, { effective: {}, history: [] }],
      ["/preview-url", undefined, { url: null }],
    ]);
    const user = userEvent.setup();

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    await screen.findByText("Total");
    await user.click(screen.getByRole("button", { name: /^remove file$/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(vi.mocked(apiFetch).mock.calls.some(([, , init]) => (init as RequestInit | undefined)?.method === "DELETE")).toBe(
      false,
    );
  });

  it("Remove file: DELETEs .../file once confirmed", async () => {
    mockApiFetch([
      ["/documents/job_1", undefined, fieldShapedJob()],
      ["/corrections", undefined, { effective: {}, history: [] }],
      ["/preview-url", undefined, { url: null }],
      ["/file", "DELETE", fieldShapedJob()],
    ]);
    const user = userEvent.setup();

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    await screen.findByText("Total");
    await user.click(screen.getByRole("button", { name: /^remove file$/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /^remove file$/i }));

    await waitFor(() => {
      expect(
        vi.mocked(apiFetch).mock.calls.some(
          ([path, , init]) => (path as string).endsWith("/file") && (init as RequestInit | undefined)?.method === "DELETE",
        ),
      ).toBe(true);
    });
  });

  it("Delete document: DELETEs the job and navigates to /documents once confirmed", async () => {
    mockApiFetch([
      ["/documents/job_1", undefined, fieldShapedJob()],
      ["/corrections", undefined, { effective: {}, history: [] }],
      ["/preview-url", undefined, { url: null }],
      ["job_1", "DELETE", { jobId: "job_1" }],
    ]);
    const user = userEvent.setup();

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    await screen.findByText("Total");
    await user.click(screen.getByRole("button", { name: /^delete document$/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete document$/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/documents"));
  });

  it("shows an inline error when a delete action fails", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(apiFetch).mockImplementation(async (path: unknown, _schema: unknown, init?: RequestInit) => {
      const p = path as string;
      const method = init?.method;
      if (p.endsWith("/file") && method === "DELETE") {
        throw new ApiError(403, "FORBIDDEN", "Only the uploader or an owner/admin can do this.");
      }
      if (p.endsWith("/documents/job_1")) return fieldShapedJob();
      if (p.endsWith("/corrections")) return { effective: {}, history: [] };
      if (p.endsWith("/preview-url")) return { url: null };
      throw new Error(`Unmocked apiFetch call: ${method ?? "GET"} ${p}`);
    });
    const user = userEvent.setup();

    render(<DocumentResultsView jobId="job_1" />, { wrapper: createQueryWrapper() });

    await screen.findByText("Total");
    await user.click(screen.getByRole("button", { name: /^remove file$/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /^remove file$/i }));

    expect(await screen.findByText("Only the uploader or an owner/admin can do this.")).toBeInTheDocument();
  });
});
