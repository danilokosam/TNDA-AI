import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createQueryWrapper } from "../../test/query-client-wrapper";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

const { apiFetch } = await import("@/lib/api/http");
const { cacheFileForPreview } = await import("@/features/results/preview-cache");
const { DocumentPreviewPanel } = await import("@/components/results/DocumentPreviewPanel");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DocumentPreviewPanel", () => {
  it("renders a loading state before the signed-url fetch resolves", () => {
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));

    render(<DocumentPreviewPanel jobId="job_panel_loading" />, { wrapper: createQueryWrapper() });

    expect(screen.queryByTitle("Document preview")).not.toBeInTheDocument();
    expect(screen.queryByText(/preview unavailable/i)).not.toBeInTheDocument();
  });

  it("renders an iframe pointing at the signed url once the backend confirms a persisted file", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ url: "https://signed.example/invoice.pdf" });

    render(<DocumentPreviewPanel jobId="job_panel_remote" />, { wrapper: createQueryWrapper() });

    const iframe = await screen.findByTitle("Document preview");
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe.getAttribute("src")).toBe("https://signed.example/invoice.pdf");
  });

  it("falls back to the session-cached file's blob URL while nothing is persisted yet", () => {
    const file = new File(["content"], "invoice.pdf", { type: "application/pdf" });
    cacheFileForPreview("job_panel_session", file);
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));

    render(<DocumentPreviewPanel jobId="job_panel_session" />, { wrapper: createQueryWrapper() });

    const iframe = screen.getByTitle("Document preview");
    expect(iframe.getAttribute("src")).toMatch(/^blob:/);
  });

  it("shows an unavailable message once the backend confirms no file is persisted and nothing is cached", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ url: null });

    render(<DocumentPreviewPanel jobId="job_panel_none" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText(/preview unavailable/i)).toBeInTheDocument();
    expect(screen.queryByTitle("Document preview")).not.toBeInTheDocument();
  });
});
