// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/billing.service", () => ({
  createPortalSession: vi.fn(),
}));

const billingService = await import("@/services/billing.service");
const { POST } = await import("@/app/api/billing/portal/route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/billing/portal", () => {
  it("calls createPortalSession with a returnUrl computed from the request's own origin, with no request body needed", async () => {
    vi.mocked(billingService.createPortalSession).mockResolvedValue({ url: "https://billing.stripe.com/session_1" });

    const response = await POST(new Request("http://localhost/api/billing/portal", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(billingService.createPortalSession).toHaveBeenCalledWith({ returnUrl: "http://localhost/billing" });
    expect(await response.json()).toEqual({ url: "https://billing.stripe.com/session_1" });
  });

  it("derives returnUrl from whatever origin the request actually came from", async () => {
    vi.mocked(billingService.createPortalSession).mockResolvedValue({ url: "https://billing.stripe.com/session_1" });

    await POST(new Request("https://app.example.com/api/billing/portal", { method: "POST" }));

    expect(billingService.createPortalSession).toHaveBeenCalledWith({ returnUrl: "https://app.example.com/billing" });
  });

  it("surfaces the backend's 'no billing history yet' ValidationError unchanged", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(billingService.createPortalSession).mockRejectedValue(
      new ApiError(400, "VALIDATION_ERROR", "This organization has no billing history yet."),
    );

    const response = await POST(new Request("http://localhost/api/billing/portal", { method: "POST" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
