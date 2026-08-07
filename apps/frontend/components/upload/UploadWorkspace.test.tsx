import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryWrapper } from "../../test/query-client-wrapper";

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
