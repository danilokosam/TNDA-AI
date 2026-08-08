import { beforeEach, describe, expect, it, vi } from "vitest";
import { Elysia } from "elysia";
import { z } from "zod";
import { env } from "@/config/env";
import { stripe } from "@/config/stripe";
import { errorMiddleware } from "@/middlewares/error.middleware";

vi.mock("@/modules/billing/billing.repository", () => ({
  findOrganizationIdByStripeCustomerId: vi.fn(),
  upsertSubscriptionFromStripe: vi.fn(),
  getOrganizationStripeLink: vi.fn(),
  setOrganizationStripeCustomerId: vi.fn(),
}));

// Only the four caller-facing entry points are mocked (plans/subscription/
// checkout/portal) — everything webhook-related (verifyStripeWebhookEvent,
// handleStripeWebhookEvent, syncSubscriptionFromStripeObject, ...) stays
// real, exactly as the existing webhook tests below already rely on, so
// this file keeps testing the real signature-verification code path
// rather than switching to a fully-mocked service.
vi.mock("@/modules/billing/billing.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/billing/billing.service")>();
  return {
    ...actual,
    listAvailablePlans: vi.fn(),
    getCurrentSubscription: vi.fn(),
    createCheckoutSession: vi.fn(),
    createPortalSession: vi.fn(),
  };
});

vi.mock("@/config/supabase", () => ({
  supabaseAdmin: { auth: { getUser: vi.fn() }, from: vi.fn() },
}));

const billingRepository = await import("@/modules/billing/billing.repository");
const billingService = await import("@/modules/billing/billing.service");
const { supabaseAdmin } = await import("@/config/supabase");
const { billingRoutes } = await import("@/modules/billing/billing.routes");

/** No `.listen()` anywhere — requests are dispatched in-process via `.handle()`. */
const app = new Elysia().use(errorMiddleware).use(billingRoutes);

async function signPayload(payload: unknown): Promise<{ rawBody: string; signature: string }> {
  const rawBody = JSON.stringify(payload);
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({
    payload: rawBody,
    secret: env.STRIPE_WEBHOOK_SECRET,
  });
  return { rawBody, signature };
}

const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const TEST_PROFILE = { id: "user_1", organization_id: "org_1", email: "owner@example.com", role: "owner" };
const AUTH_HEADERS = { Authorization: "Bearer valid-test-token" };

/** Mirrors organization.routes.test.ts's own established auth-mocking pattern. */
function mockAuthenticated(profile: typeof TEST_PROFILE = TEST_PROFILE) {
  vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValue({
    data: { user: { id: profile.id } },
    error: null,
  } as any);

  const profileChain: any = {
    select: vi.fn(() => profileChain),
    eq: vi.fn(() => profileChain),
    single: vi.fn(() => Promise.resolve({ data: profile, error: null })),
  };
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "profiles") return profileChain;
    throw new Error(`Unexpected supabaseAdmin.from("${table}") call — mock it explicitly in this test.`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/billing/webhook", () => {
  it("is reachable without an Authorization header (public, signature-authenticated)", async () => {
    const { rawBody, signature } = await signPayload({
      id: "evt_route_1",
      type: "customer.updated",
      data: { object: {} },
    });

    const response = await app.handle(
      new Request("http://localhost/api/v1/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": signature },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });

  it("rejects a missing stripe-signature header with 400 VALIDATION_ERROR, via the real error middleware", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/billing/webhook", {
        method: "POST",
        body: JSON.stringify({ id: "evt_no_sig", type: "customer.updated" }),
      }),
    );

    expect(response.status).toBe(400);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a forged signature with 400 VALIDATION_ERROR", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=forged" },
        body: JSON.stringify({ id: "evt_forged", type: "customer.updated" }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("a real customer.subscription.updated delivery syncs through to the repository layer", async () => {
    vi.mocked(billingRepository.findOrganizationIdByStripeCustomerId).mockResolvedValue("org_route_1");
    vi.mocked(billingRepository.upsertSubscriptionFromStripe).mockResolvedValue({
      id: "row_1",
      organization_id: "org_route_1",
      plan_id: "pro",
      status: "active",
      current_period_start: "2026-01-01T00:00:00.000Z",
      current_period_end: "2026-02-01T00:00:00.000Z",
      stripe_customer_id: "cus_route_1",
      stripe_subscription_id: "sub_route_1",
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const { rawBody, signature } = await signPayload({
      id: "evt_route_2",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_route_1",
          status: "active",
          customer: "cus_route_1",
          items: {
            data: [
              {
                price: { id: env.STRIPE_PRICE_ID_PRO },
                current_period_start: 1_700_000_000,
                current_period_end: 1_702_592_000,
              },
            ],
          },
        },
      },
    });

    const response = await app.handle(
      new Request("http://localhost/api/v1/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": signature },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(200);
    expect(billingRepository.upsertSubscriptionFromStripe).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_route_1", planId: "pro" }),
    );
  });
});

describe("protected billing routes without a bearer token", () => {
  it.each(["/api/v1/billing/plans", "/api/v1/billing/subscription"])("%s returns 401 UNAUTHORIZED", async (path) => {
    const response = await app.handle(new Request(`http://localhost${path}`));

    expect(response.status).toBe(401);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("POST /api/v1/billing/checkout returns 401 before even validating the body", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "not-a-real-plan" }),
      }),
    );

    expect(response.status).toBe(401);
  });
});

describe("GET /api/v1/billing/plans", () => {
  it("returns the service's plan catalog for an authenticated caller", async () => {
    mockAuthenticated();
    const plans = [{ id: "free", name: "Free" }];
    vi.mocked(billingService.listAvailablePlans).mockResolvedValue(plans as any);

    const response = await app.handle(
      new Request("http://localhost/api/v1/billing/plans", { headers: AUTH_HEADERS }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(plans);
  });
});

describe("GET /api/v1/billing/subscription", () => {
  it("returns the effective plan/subscription for the caller's own organization", async () => {
    mockAuthenticated();
    const payload = { plan: { id: "basic" }, subscription: { status: "active", planId: "basic", note: "..." } };
    vi.mocked(billingService.getCurrentSubscription).mockResolvedValue(payload as any);

    const response = await app.handle(
      new Request("http://localhost/api/v1/billing/subscription", { headers: AUTH_HEADERS }),
    );

    expect(response.status).toBe(200);
    expect(billingService.getCurrentSubscription).toHaveBeenCalledWith("org_1");
    expect(await response.json()).toEqual(payload);
  });
});

describe("POST /api/v1/billing/checkout (authenticated)", () => {
  it("passes the caller's organizationId/email/role and the request body through to the service, returning its url", async () => {
    mockAuthenticated();
    vi.mocked(billingService.createCheckoutSession).mockResolvedValue({ url: "https://checkout.stripe.com/session_1" });

    const response = await app.handle(
      new Request("http://localhost/api/v1/billing/checkout", {
        method: "POST",
        headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "basic" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(billingService.createCheckoutSession).toHaveBeenCalledWith({
      organizationId: "org_1",
      email: "owner@example.com",
      role: "owner",
      input: { planId: "basic" },
    });
    expect(await response.json()).toEqual({ url: "https://checkout.stripe.com/session_1" });
  });

  it("surfaces the service's ForbiddenError (plain member) as 403, reached through the real route", async () => {
    mockAuthenticated({ id: "user_2", organization_id: "org_1", email: "member@example.com", role: "member" });
    const { ForbiddenError } = await import("@/utils/errors");
    vi.mocked(billingService.createCheckoutSession).mockRejectedValue(
      new ForbiddenError("Only an organization owner or admin can manage billing."),
    );

    const response = await app.handle(
      new Request("http://localhost/api/v1/billing/checkout", {
        method: "POST",
        headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "basic" }),
      }),
    );

    expect(response.status).toBe(403);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe("FORBIDDEN");
    // The route still passed the caller's real role through — it's the
    // (here, mocked) service that made the authorization decision, not
    // the route silently rejecting on its own.
    expect(billingService.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ role: "member" }));
  });
});

describe("POST /api/v1/billing/portal (authenticated)", () => {
  it("passes the caller's organizationId/role and the request body through to the service, returning its url", async () => {
    mockAuthenticated();
    vi.mocked(billingService.createPortalSession).mockResolvedValue({ url: "https://billing.stripe.com/session_1" });

    const response = await app.handle(
      new Request("http://localhost/api/v1/billing/portal", {
        method: "POST",
        headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ returnUrl: "https://app.example.com/billing" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(billingService.createPortalSession).toHaveBeenCalledWith({
      organizationId: "org_1",
      role: "owner",
      input: { returnUrl: "https://app.example.com/billing" },
    });
    expect(await response.json()).toEqual({ url: "https://billing.stripe.com/session_1" });
  });

  it("surfaces the service's ValidationError (no billing history yet) as 400, reached through the real route", async () => {
    mockAuthenticated();
    const { ValidationError } = await import("@/utils/errors");
    vi.mocked(billingService.createPortalSession).mockRejectedValue(
      new ValidationError("This organization has no billing history yet. Start a checkout before opening the billing portal."),
    );

    const response = await app.handle(
      new Request("http://localhost/api/v1/billing/portal", {
        method: "POST",
        headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("surfaces the service's ForbiddenError (plain member) as 403, reached through the real route", async () => {
    mockAuthenticated({ id: "user_2", organization_id: "org_1", email: "member@example.com", role: "member" });
    const { ForbiddenError } = await import("@/utils/errors");
    vi.mocked(billingService.createPortalSession).mockRejectedValue(
      new ForbiddenError("Only an organization owner or admin can manage billing."),
    );

    const response = await app.handle(
      new Request("http://localhost/api/v1/billing/portal", {
        method: "POST",
        headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(403);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe("FORBIDDEN");
    expect(billingService.createPortalSession).toHaveBeenCalledWith(expect.objectContaining({ role: "member" }));
  });
});
