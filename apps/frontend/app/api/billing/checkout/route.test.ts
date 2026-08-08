// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/billing.service", () => ({
  createCheckoutSession: vi.fn(),
}));

const billingService = await import("@/services/billing.service");
const { POST } = await import("@/app/api/billing/checkout/route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/billing/checkout", () => {
  it("calls createCheckoutSession with the body's planId and a redirectUrl computed from the request's own origin", async () => {
    vi.mocked(billingService.createCheckoutSession).mockResolvedValue({ url: "https://checkout.stripe.com/session_1" });

    const response = await POST(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ planId: "basic" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(billingService.createCheckoutSession).toHaveBeenCalledWith({
      planId: "basic",
      redirectUrl: "http://localhost/billing",
    });
    expect(await response.json()).toEqual({ url: "https://checkout.stripe.com/session_1" });
  });

  it("ignores any client-supplied redirectUrl and always uses the request's own origin instead", async () => {
    vi.mocked(billingService.createCheckoutSession).mockResolvedValue({ url: "https://checkout.stripe.com/session_1" });

    await POST(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ planId: "pro", redirectUrl: "https://evil.example.com/steal" }),
      }),
    );

    expect(billingService.createCheckoutSession).toHaveBeenCalledWith({
      planId: "pro",
      redirectUrl: "http://localhost/billing",
    });
  });

  it("derives redirectUrl from whatever origin the request actually came from", async () => {
    vi.mocked(billingService.createCheckoutSession).mockResolvedValue({ url: "https://checkout.stripe.com/session_1" });

    await POST(
      new Request("https://app.example.com/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ planId: "basic" }),
      }),
    );

    expect(billingService.createCheckoutSession).toHaveBeenCalledWith({
      planId: "basic",
      redirectUrl: "https://app.example.com/billing",
    });
  });

  it("returns 400 VALIDATION_ERROR for an invalid planId, without calling the service", async () => {
    const response = await POST(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ planId: "not-a-real-plan" }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(billingService.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("translates a thrown service error into the uniform error envelope", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(billingService.createCheckoutSession).mockRejectedValue(
      new ApiError(401, "UNAUTHORIZED", "No session."),
    );

    const response = await POST(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ planId: "basic" }),
      }),
    );

    expect(response.status).toBe(401);
  });
});
