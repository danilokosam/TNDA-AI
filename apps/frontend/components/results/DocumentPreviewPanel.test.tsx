import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentPreviewPanel } from "@/components/results/DocumentPreviewPanel";
import { cacheFileForPreview } from "@/features/results/preview-cache";

describe("DocumentPreviewPanel", () => {
  it("renders an iframe pointing at the cached file's blob URL", () => {
    const file = new File(["content"], "invoice.pdf", { type: "application/pdf" });
    cacheFileForPreview("job_panel_1", file);

    render(<DocumentPreviewPanel jobId="job_panel_1" />);

    const iframe = screen.getByTitle("Document preview");
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe.getAttribute("src")).toMatch(/^blob:/);
  });

  it("shows an unavailable message when nothing is cached for this job", () => {
    render(<DocumentPreviewPanel jobId="job_panel_no_cache" />);
    expect(screen.getByText(/preview unavailable/i)).toBeInTheDocument();
    expect(screen.queryByTitle("Document preview")).not.toBeInTheDocument();
  });
});
