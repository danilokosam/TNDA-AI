import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryWrapper } from "../../test/query-client-wrapper";

vi.mock("@/lib/api/http", () => ({
  apiFetchFile: vi.fn(),
}));

const { apiFetchFile } = await import("@/lib/api/http");
const { DocumentsExportButton } = await import("@/components/documents/DocumentsExportButton");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:mock-url"),
    revokeObjectURL: vi.fn(),
  });
});

function csvResponse(): Response {
  return new Response("\uFEFFJob ID\r\njob_1", {
    status: 200,
    headers: { "Content-Disposition": 'attachment; filename="documents-export-2026-08-10.csv"' },
  });
}

describe("DocumentsExportButton", () => {
  it("renders an Export CSV button", () => {
    render(<DocumentsExportButton filters={{}} />, { wrapper: createQueryWrapper() });
    expect(screen.getByRole("button", { name: /export csv/i })).toBeInTheDocument();
  });

  it("requests the export path built from the current filters and triggers a download on success", async () => {
    vi.mocked(apiFetchFile).mockResolvedValue(csvResponse());
    const user = userEvent.setup();
    render(<DocumentsExportButton filters={{ documentType: "invoice" }} />, { wrapper: createQueryWrapper() });

    await user.click(screen.getByRole("button", { name: /export csv/i }));

    await waitFor(() => {
      expect(apiFetchFile).toHaveBeenCalledWith("/api/documents/export?documentType=invoice");
    });
    await waitFor(() => {
      expect(screen.getByText(/export csv/i)).toBeInTheDocument();
    });
  });

  it("does not throw when the export fails, and re-enables the button", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(apiFetchFile).mockRejectedValue(new ApiError(413, "PAYLOAD_TOO_LARGE", "Too many documents."));
    const user = userEvent.setup();
    render(<DocumentsExportButton filters={{}} />, { wrapper: createQueryWrapper() });

    await user.click(screen.getByRole("button", { name: /export csv/i }));

    await waitFor(() => {
      expect(apiFetchFile).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /export csv/i })).not.toBeDisabled();
    });
  });
});
