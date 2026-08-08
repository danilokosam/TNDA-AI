import { beforeEach, describe, expect, it, vi } from "vitest";
import { plansResponseSchema, subscriptionResponseSchema, urlResponseSchema, type SubscriptionResponse } from "@/types/api";

vi.mock("@/lib/api/backend-client", () => ({
  backendFetch: vi.fn(),
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getAccessToken: vi.fn(),
}));

const { backendFetch } = await import("@/lib/api/backend-client");
const { getAccessToken } = await import("@/lib/supabase/server-client");
const { getSubscription, getPlans, createCheckoutSession, createPortalSession } = await import(
  "@/services/billing.service"
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAccessToken).mockResolvedValue("test-access-token");
});

describe("getSubscription", () => {
  it("GETs /api/v1/billing/subscription with the access token attached", async () => {
    const expected: SubscriptionResponse = {
      plan: {
        id: "free",
        name: "Free",
        price_monthly: 0,
        max_documents_per_month: 5,
        max_pages_per_document: 1,
        max_pages_per_month: 2,
        max_file_size_mb: 5,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      subscription: { status: "active", planId: "free", note: "No paid subscription on file." },
    };
    vi.mocked(backendFetch).mockResolvedValue(expected);

    const result = await getSubscription();

    expect(result).toEqual(expected);
    const [path, schema, options] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(path).toBe("/api/v1/billing/subscription");
    expect(schema).toBe(subscriptionResponseSchema);
    expect(options?.accessToken).toBe("test-access-token");
  });
});

describe("getPlans", () => {
  it("GETs /api/v1/billing/plans with the access token attached", async () => {
    const expected = [{ id: "free" }];
    vi.mocked(backendFetch).mockResolvedValue(expected);

    const result = await getPlans();

    expect(result).toEqual(expected);
    const [path, schema, options] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(path).toBe("/api/v1/billing/plans");
    expect(schema).toBe(plansResponseSchema);
    expect(options?.accessToken).toBe("test-access-token");
  });
});

describe("createCheckoutSession", () => {
  it("POSTs the given body to /api/v1/billing/checkout with the access token attached", async () => {
    vi.mocked(backendFetch).mockResolvedValue({ url: "https://checkout.stripe.com/session_1" });

    const result = await createCheckoutSession({ planId: "basic", redirectUrl: "https://app.example.com/billing" });

    expect(result).toEqual({ url: "https://checkout.stripe.com/session_1" });
    const [path, schema, options] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(path).toBe("/api/v1/billing/checkout");
    expect(schema).toBe(urlResponseSchema);
    expect(options?.method).toBe("POST");
    expect(options?.accessToken).toBe("test-access-token");
    expect(JSON.parse(options?.body as string)).toEqual({
      planId: "basic",
      redirectUrl: "https://app.example.com/billing",
    });
  });
});

describe("createPortalSession", () => {
  it("POSTs the given body to /api/v1/billing/portal with the access token attached", async () => {
    vi.mocked(backendFetch).mockResolvedValue({ url: "https://billing.stripe.com/session_1" });

    const result = await createPortalSession({ returnUrl: "https://app.example.com/billing" });

    expect(result).toEqual({ url: "https://billing.stripe.com/session_1" });
    const [path, schema, options] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(path).toBe("/api/v1/billing/portal");
    expect(schema).toBe(urlResponseSchema);
    expect(options?.method).toBe("POST");
    expect(options?.accessToken).toBe("test-access-token");
    expect(JSON.parse(options?.body as string)).toEqual({ returnUrl: "https://app.example.com/billing" });
  });
});
