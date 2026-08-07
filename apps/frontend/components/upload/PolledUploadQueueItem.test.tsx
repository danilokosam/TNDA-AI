import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createQueryWrapper } from "../../test/query-client-wrapper";
import { createUploadQueueItem } from "@/features/upload/queue";
import type { JobDto } from "@/types/api";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

const { apiFetch } = await import("@/lib/api/http");
const { PolledUploadQueueItem } = await import("@/components/upload/PolledUploadQueueItem");

function jobFixture(overrides: Partial<JobDto> = {}): JobDto {
  return {
    jobId: "job_1",
    status: "processing",
    fileName: "invoice.pdf",
    fileSizeBytes: 2048,
    pageCount: null,
    documentType: "invoice",
    averageConfidence: null,
    resultJson: null,
    errorMessage: null,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PolledUploadQueueItem", () => {
  it("polls the job and reports updates when the item has a jobId and isn't finished", async () => {
    const job = jobFixture({ status: "completed" });
    vi.mocked(apiFetch).mockResolvedValue(job);
    const onStatusUpdate = vi.fn();
    const item = { ...createUploadQueueItem({ id: "a", file: new File(["x"], "a.pdf") }), status: "processing" as const, jobId: "job_1" };

    render(<PolledUploadQueueItem item={item} onStatusUpdate={onStatusUpdate} onRemove={vi.fn()} />, {
      wrapper: createQueryWrapper(),
    });

    await vi.waitFor(() => expect(onStatusUpdate).toHaveBeenCalledWith(job));
    expect(apiFetch).toHaveBeenCalledWith("/api/documents/job_1", expect.anything());
  });

  it("does not poll when the item has no jobId yet", () => {
    const item = createUploadQueueItem({ id: "a", file: new File(["x"], "a.pdf") });
    render(<PolledUploadQueueItem item={item} onStatusUpdate={vi.fn()} onRemove={vi.fn()} />, {
      wrapper: createQueryWrapper(),
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("does not poll once the item is already in a finished state", () => {
    const item = {
      ...createUploadQueueItem({ id: "a", file: new File(["x"], "a.pdf") }),
      status: "completed" as const,
      jobId: "job_1",
    };
    render(<PolledUploadQueueItem item={item} onStatusUpdate={vi.fn()} onRemove={vi.fn()} />, {
      wrapper: createQueryWrapper(),
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("renders the underlying row and forwards onRemove", () => {
    const item = createUploadQueueItem({ id: "a", file: new File(["x"], "a.pdf") });
    render(<PolledUploadQueueItem item={item} onStatusUpdate={vi.fn()} onRemove={vi.fn()} />, {
      wrapper: createQueryWrapper(),
    });
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
  });
});
