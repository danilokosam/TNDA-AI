import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryWrapper } from "../../test/query-client-wrapper";
import type { JobDto, UploadResponse } from "@/types/api";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

const { apiFetch } = await import("@/lib/api/http");
const { UploadWorkspace } = await import("@/components/upload/UploadWorkspace");

beforeEach(() => {
  vi.clearAllMocks();
  // Never resolves in these tests — they only check that a file, once
  // selected, shows up in the queue and an upload was kicked off; the
  // upload/polling lifecycle itself is covered by use-upload-controller's
  // own tests.
  vi.mocked(apiFetch).mockImplementation(() => new Promise(() => {}));
});

describe("UploadWorkspace", () => {
  it("renders the document type selector and dropzone", () => {
    render(<UploadWorkspace />, { wrapper: createQueryWrapper() });
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByTestId("dropzone")).toBeInTheDocument();
  });

  it("adds a selected file to the queue and starts uploading it with the chosen document type", async () => {
    const user = userEvent.setup();
    render(<UploadWorkspace />, { wrapper: createQueryWrapper() });

    await user.selectOptions(screen.getByRole("combobox"), "receipt");

    const file = new File(["content"], "receipt.jpg", { type: "image/jpeg" });
    const input = screen.getByLabelText(/upload/i, { selector: "input" });
    await user.upload(input, file);

    expect(await screen.findByText("receipt.jpg")).toBeInTheDocument();
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [, , init] = vi.mocked(apiFetch).mock.calls[0]!;
    expect((init?.body as FormData).get("documentType")).toBe("receipt");
  });
});

describe("UploadWorkspace — polling regression", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * End-to-end sanity check for a real "Maximum update depth exceeded"
   * crash found via manual browser verification — not caught by any prior
   * test, since every prior test either mocked apiFetch to never resolve,
   * or never let a job sit at the same status across more than one poll.
   * A job legitimately sitting in "processing" across many polls (the
   * normal case — Azure processing takes real time) is the scenario that
   * crashed.
   *
   * Honest caveat: this specific integration test does not reliably
   * reproduce the crash on its own in this jsdom/Vitest environment (tried
   * with and without React.StrictMode, with identical vs. freshly-varying
   * poll responses, with one and with two simultaneously-polling items —
   * none crossed React's update-depth threshold here, though direct
   * instrumentation during diagnosis confirmed the redundant-dispatch
   * pattern is real and measurable regardless). The precise, deterministic
   * regression guard is the reducer-level test in queue.test.ts, which
   * tests the actual fixed property directly. This test stays as a
   * real-tree sanity check, not the primary proof.
   */
  it("does not throw when a poll repeatedly returns the same job status", async () => {
    vi.useFakeTimers();

    const stuckJob: JobDto = {
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
    };
    const uploadResponse: UploadResponse = { kind: "single", job: stuckJob };

    // Every poll returns a *freshly-constructed* object (varying updatedAt,
    // like the real backend would) with the same status — defeats React
    // Query's structural sharing, so `data` genuinely changes reference on
    // every poll even though nothing meaningful did.
    vi.mocked(apiFetch).mockImplementation((path: unknown) =>
      path === "/api/documents"
        ? Promise.resolve(uploadResponse)
        : Promise.resolve({ ...stuckJob, updatedAt: new Date().toISOString() }),
    );

    render(<UploadWorkspace />, { wrapper: createQueryWrapper() });

    const file = new File(["content"], "invoice.pdf", { type: "application/pdf" });
    const input = screen.getByLabelText(/upload/i, { selector: "input" });
    fireEvent.change(input, { target: { files: [file] } });

    await vi.advanceTimersByTimeAsync(0);
    for (let cycle = 0; cycle < 6; cycle++) {
      await vi.advanceTimersByTimeAsync(10_000);
    }

    expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
  });
});
