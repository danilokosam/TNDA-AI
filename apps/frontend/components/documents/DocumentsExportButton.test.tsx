import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryWrapper } from "../../test/query-client-wrapper";
import type { ExportColumnOption } from "@/features/documents/export-columns";

vi.mock("@/lib/api/http", () => ({
  apiFetchFile: vi.fn(),
}));

const { apiFetchFile } = await import("@/lib/api/http");
const { DocumentsExportButton } = await import("@/components/documents/DocumentsExportButton");

const AVAILABLE_COLUMNS: ExportColumnOption[] = [
  { field: "jobId", defaultLabel: "Job ID" },
  { field: "VendorName", defaultLabel: "VendorName" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:mock-url"),
    revokeObjectURL: vi.fn(),
  });
});

function fileResponse(fileName: string): Response {
  return new Response("content", {
    status: 200,
    headers: { "Content-Disposition": `attachment; filename="${fileName}"` },
  });
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /export/i }));
}

describe("DocumentsExportButton", () => {
  it("renders an Export trigger button", () => {
    render(<DocumentsExportButton filters={{}} availableColumns={AVAILABLE_COLUMNS} />, {
      wrapper: createQueryWrapper(),
    });
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });

  it("opens a menu offering CSV, XLSX, JSON, XML, and a customize-columns option", async () => {
    const user = userEvent.setup();
    render(<DocumentsExportButton filters={{}} availableColumns={AVAILABLE_COLUMNS} />, {
      wrapper: createQueryWrapper(),
    });

    await openMenu(user);

    expect(screen.getByRole("menuitem", { name: /csv/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /xlsx/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /json/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /xml/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /customize columns/i })).toBeInTheDocument();
  });

  it("requests a CSV export built from the current filters when the CSV item is clicked", async () => {
    vi.mocked(apiFetchFile).mockResolvedValue(fileResponse("documents-export-2026-08-10.csv"));
    const user = userEvent.setup();
    render(<DocumentsExportButton filters={{ documentType: "invoice" }} availableColumns={AVAILABLE_COLUMNS} />, {
      wrapper: createQueryWrapper(),
    });

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /csv/i }));

    await waitFor(() => {
      expect(apiFetchFile).toHaveBeenCalledWith("/api/documents/export?format=csv&documentType=invoice");
    });
  });

  it("requests an XLSX export when the XLSX item is clicked", async () => {
    vi.mocked(apiFetchFile).mockResolvedValue(fileResponse("documents-export-2026-08-10.xlsx"));
    const user = userEvent.setup();
    render(<DocumentsExportButton filters={{}} availableColumns={AVAILABLE_COLUMNS} />, {
      wrapper: createQueryWrapper(),
    });

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /xlsx/i }));

    await waitFor(() => {
      expect(apiFetchFile).toHaveBeenCalledWith("/api/documents/export?format=xlsx");
    });
  });

  it("shows an 'Exporting…' state on the trigger while the mutation is pending", async () => {
    let resolveFetch: (response: Response) => void = () => {};
    vi.mocked(apiFetchFile).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<DocumentsExportButton filters={{}} availableColumns={AVAILABLE_COLUMNS} />, {
      wrapper: createQueryWrapper(),
    });

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /csv/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /exporting/i })).toBeDisabled();
    });

    resolveFetch(fileResponse("documents-export-2026-08-10.csv"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^export$/i })).not.toBeDisabled();
    });
  });

  it("does not throw when the export fails, and re-enables the trigger", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(apiFetchFile).mockRejectedValue(new ApiError(413, "PAYLOAD_TOO_LARGE", "Too many documents."));
    const user = userEvent.setup();
    render(<DocumentsExportButton filters={{}} availableColumns={AVAILABLE_COLUMNS} />, {
      wrapper: createQueryWrapper(),
    });

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /csv/i }));

    await waitFor(() => {
      expect(apiFetchFile).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /export/i })).not.toBeDisabled();
    });
  });

  it("opens the customize-columns dialog when that menu item is clicked", async () => {
    const user = userEvent.setup();
    render(<DocumentsExportButton filters={{}} availableColumns={AVAILABLE_COLUMNS} />, {
      wrapper: createQueryWrapper(),
    });

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /customize columns/i }));

    expect(screen.getByText(/customize export/i)).toBeInTheDocument();
  });

  it("reflects the latest availableColumns when opened, even if it mounted before the documents list finished loading", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DocumentsExportButton filters={{}} availableColumns={[]} />, {
      wrapper: createQueryWrapper(),
    });

    // Simulate the Documents list finishing its fetch after the button (and
    // the dialog it renders) already mounted with an empty column list.
    rerender(<DocumentsExportButton filters={{}} availableColumns={AVAILABLE_COLUMNS} />);

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /customize columns/i }));

    expect(screen.getByRole("checkbox", { name: /vendorname/i })).toBeInTheDocument();
  });

  it("leaves the trigger button enabled when canExport defaults (no prop passed)", () => {
    render(<DocumentsExportButton filters={{}} availableColumns={AVAILABLE_COLUMNS} />, {
      wrapper: createQueryWrapper(),
    });
    expect(screen.getByRole("button", { name: /export/i })).not.toBeDisabled();
  });

  it("leaves the trigger button enabled when canExport={true}", () => {
    render(<DocumentsExportButton filters={{}} availableColumns={AVAILABLE_COLUMNS} canExport />, {
      wrapper: createQueryWrapper(),
    });
    expect(screen.getByRole("button", { name: /export/i })).not.toBeDisabled();
  });

  it("disables the trigger button, with an explanatory title, when canExport={false}", () => {
    render(<DocumentsExportButton filters={{}} availableColumns={AVAILABLE_COLUMNS} canExport={false} />, {
      wrapper: createQueryWrapper(),
    });
    const trigger = screen.getByRole("button", { name: /export/i });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("title", "Only admins and owners can export documents.");
  });

  it("requests a configured (POST) export reflecting the dialog's column selection", async () => {
    vi.mocked(apiFetchFile).mockResolvedValue(fileResponse("documents-export-2026-08-10.csv"));
    const user = userEvent.setup();
    render(<DocumentsExportButton filters={{ documentType: "invoice" }} availableColumns={AVAILABLE_COLUMNS} />, {
      wrapper: createQueryWrapper(),
    });

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /customize columns/i }));
    await user.click(screen.getByRole("checkbox", { name: /vendorname/i }));
    await user.click(screen.getByRole("button", { name: /^export$/i }));

    await waitFor(() => {
      expect(apiFetchFile).toHaveBeenCalledWith("/api/documents/export", {
        method: "POST",
        body: JSON.stringify({
          format: "csv",
          fieldSelection: [{ field: "jobId", label: "Job ID" }],
          documentType: "invoice",
        }),
      });
    });
  });
});
