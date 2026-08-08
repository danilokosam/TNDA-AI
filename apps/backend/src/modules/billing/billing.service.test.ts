import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/config/env";
import { stripe } from "@/config/stripe";
import { ForbiddenError, ValidationError } from "@/utils/errors";
import type { SubscriptionRow } from "@/modules/billing/billing.repository";

vi.mock("@/modules/billing/billing.repository", () => ({
  findOrganizationIdByStripeCustomerId: vi.fn(),
  upsertSubscriptionFromStripe: vi.fn(),
  getOrganizationStripeLink: vi.fn(),
  setOrganizationStripeCustomerId: vi.fn(),
}));

const billingRepository = await import("@/modules/billing/billing.repository");
const billingService = await import("@/modules/billing/billing.service");

/**
 * Signs a plain JS object exactly the way a real Stripe webhook delivery
 * would, using the SDK's own local (no-network) HMAC helper. The object
 * is never typed as `Stripe.Event` here — it's just JSON on the wire, the
 * same as a real payload — so `verifyStripeWebhookEvent`'s return type
 * (trusted from the SDK, same as with any external API response) is what
 * gives the parsed result its `Stripe.Event` typing, with zero casts.
 */
async function signWebhookPayload(payload: unknown): Promise<{ rawBody: string; signature: string }> {
  const rawBody = JSON.stringify(payload);
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({
    payload: rawBody,
    secret: env.STRIPE_WEBHOOK_SECRET,
  });
  return { rawBody, signature };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("appendQueryString", () => {
  it("appends with '?' when the URL has no existing query string", () => {
    expect(billingService.appendQueryString("https://app.example.com/billing", "a=1")).toBe(
      "https://app.example.com/billing?a=1",
    );
  });

  it("appends with '&' when the URL already has a query string", () => {
    expect(billingService.appendQueryString("https://app.example.com/billing?ref=email", "a=1")).toBe(
      "https://app.example.com/billing?ref=email&a=1",
    );
  });
});

describe("resolveCustomerId", () => {
  it("returns the id unchanged when given a plain string", () => {
    expect(billingService.resolveCustomerId("cus_123")).toBe("cus_123");
  });

  it("extracts .id when given an expanded Customer/DeletedCustomer object", () => {
    expect(billingService.resolveCustomerId({ id: "cus_456", object: "customer", deleted: true })).toBe("cus_456");
  });
});

describe("getPlanIdForPriceId", () => {
  it("maps configured price ids back to their plan slug", () => {
    expect(billingService.getPlanIdForPriceId(env.STRIPE_PRICE_ID_BASIC)).toBe("basic");
    expect(billingService.getPlanIdForPriceId(env.STRIPE_PRICE_ID_PRO)).toBe("pro");
  });

  it("returns null for an unrecognized price id", () => {
    expect(billingService.getPlanIdForPriceId("price_unknown")).toBeNull();
  });
});

describe("mapStripeStatusToInternal", () => {
  it("maps statuses that pass through unchanged", () => {
    expect(billingService.mapStripeStatusToInternal("trialing")).toBe("trialing");
    expect(billingService.mapStripeStatusToInternal("active")).toBe("active");
  });

  it("maps past_due and unpaid to past_due", () => {
    expect(billingService.mapStripeStatusToInternal("past_due")).toBe("past_due");
    expect(billingService.mapStripeStatusToInternal("unpaid")).toBe("past_due");
  });

  it("maps canceled, incomplete_expired, and paused to canceled", () => {
    expect(billingService.mapStripeStatusToInternal("canceled")).toBe("canceled");
    expect(billingService.mapStripeStatusToInternal("incomplete_expired")).toBe("canceled");
    expect(billingService.mapStripeStatusToInternal("paused")).toBe("canceled");
  });

  it("maps incomplete (and any unrecognized future status) to incomplete", () => {
    expect(billingService.mapStripeStatusToInternal("incomplete")).toBe("incomplete");
  });
});

describe("createCheckoutSession", () => {
  const baseParams = {
    organizationId: "org_1",
    email: "owner@example.com",
    role: "owner" as const,
    input: { planId: "basic" as const },
  };

  it("reuses an existing stripe_customer_id and never creates a new Stripe Customer", async () => {
    vi.mocked(billingRepository.getOrganizationStripeLink).mockResolvedValue({
      organizationId: "org_1",
      stripeCustomerId: "cus_existing",
    });
    const createCustomer = vi.spyOn(stripe.customers, "create");
    vi.spyOn(stripe.checkout.sessions, "create").mockResolvedValue({ url: "https://checkout.stripe.com/session_1" } as any);

    await billingService.createCheckoutSession(baseParams);

    expect(createCustomer).not.toHaveBeenCalled();
    expect(billingRepository.setOrganizationStripeCustomerId).not.toHaveBeenCalled();
  });

  it("creates and persists a new Stripe Customer when the org has none yet", async () => {
    vi.mocked(billingRepository.getOrganizationStripeLink).mockResolvedValue({
      organizationId: "org_1",
      stripeCustomerId: null,
    });
    vi.spyOn(stripe.customers, "create").mockResolvedValue({ id: "cus_new" } as any);
    vi.spyOn(stripe.checkout.sessions, "create").mockResolvedValue({ url: "https://checkout.stripe.com/session_1" } as any);

    await billingService.createCheckoutSession(baseParams);

    expect(stripe.customers.create).toHaveBeenCalledWith({
      email: "owner@example.com",
      metadata: { organization_id: "org_1" },
    });
    expect(billingRepository.setOrganizationStripeCustomerId).toHaveBeenCalledWith("org_1", "cus_new");
  });

  it("creates a subscription-mode session with the correct price, client_reference_id, and metadata", async () => {
    vi.mocked(billingRepository.getOrganizationStripeLink).mockResolvedValue({
      organizationId: "org_1",
      stripeCustomerId: "cus_existing",
    });
    const createSession = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue({ url: "https://checkout.stripe.com/session_1" } as any);

    await billingService.createCheckoutSession(baseParams);

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_existing",
        client_reference_id: "org_1",
        line_items: [{ price: env.STRIPE_PRICE_ID_BASIC, quantity: 1 }],
        subscription_data: { metadata: { organization_id: "org_1", plan_id: "basic" } },
        metadata: { organization_id: "org_1", plan_id: "basic" },
      }),
    );
  });

  it("builds success/cancel URLs from input.redirectUrl when provided", async () => {
    vi.mocked(billingRepository.getOrganizationStripeLink).mockResolvedValue({
      organizationId: "org_1",
      stripeCustomerId: "cus_existing",
    });
    const createSession = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue({ url: "https://checkout.stripe.com/session_1" } as any);

    await billingService.createCheckoutSession({
      ...baseParams,
      input: { planId: "basic", redirectUrl: "https://app.example.com/billing" },
    });

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: "https://app.example.com/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://app.example.com/billing?checkout=cancelled",
      }),
    );
  });

  it("falls back to env.APP_URL when no redirectUrl is given — never strands the user on the bare API", async () => {
    vi.mocked(billingRepository.getOrganizationStripeLink).mockResolvedValue({
      organizationId: "org_1",
      stripeCustomerId: "cus_existing",
    });
    const createSession = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue({ url: "https://checkout.stripe.com/session_1" } as any);

    await billingService.createCheckoutSession(baseParams);

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: `${env.APP_URL}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${env.APP_URL}?checkout=cancelled`,
      }),
    );
  });

  it("throws AppError when Stripe returns a session with no url", async () => {
    vi.mocked(billingRepository.getOrganizationStripeLink).mockResolvedValue({
      organizationId: "org_1",
      stripeCustomerId: "cus_existing",
    });
    vi.spyOn(stripe.checkout.sessions, "create").mockResolvedValue({ url: null } as any);

    await expect(billingService.createCheckoutSession(baseParams)).rejects.toThrow(
      "Stripe did not return a checkout URL.",
    );
  });

  it("throws ForbiddenError for a plain member, before ever touching the repository", async () => {
    await expect(billingService.createCheckoutSession({ ...baseParams, role: "member" })).rejects.toThrow(
      ForbiddenError,
    );
    expect(billingRepository.getOrganizationStripeLink).not.toHaveBeenCalled();
  });

  it("succeeds for an admin, same as an owner", async () => {
    vi.mocked(billingRepository.getOrganizationStripeLink).mockResolvedValue({
      organizationId: "org_1",
      stripeCustomerId: "cus_existing",
    });
    vi.spyOn(stripe.checkout.sessions, "create").mockResolvedValue({ url: "https://checkout.stripe.com/session_1" } as any);

    await expect(billingService.createCheckoutSession({ ...baseParams, role: "admin" })).resolves.toEqual({
      url: "https://checkout.stripe.com/session_1",
    });
  });
});

describe("createPortalSession", () => {
  it("throws ValidationError when the organization has no billing history yet", async () => {
    vi.mocked(billingRepository.getOrganizationStripeLink).mockResolvedValue({
      organizationId: "org_1",
      stripeCustomerId: null,
    });

    await expect(
      billingService.createPortalSession({ organizationId: "org_1", role: "owner", input: {} }),
    ).rejects.toThrow(ValidationError);
  });

  it("creates a portal session for the org's existing customer, using input.returnUrl when provided", async () => {
    vi.mocked(billingRepository.getOrganizationStripeLink).mockResolvedValue({
      organizationId: "org_1",
      stripeCustomerId: "cus_existing",
    });
    const createPortal = vi
      .spyOn(stripe.billingPortal.sessions, "create")
      .mockResolvedValue({ url: "https://billing.stripe.com/session_1" } as any);

    const result = await billingService.createPortalSession({
      organizationId: "org_1",
      role: "owner",
      input: { returnUrl: "https://app.example.com/billing" },
    });

    expect(createPortal).toHaveBeenCalledWith({ customer: "cus_existing", return_url: "https://app.example.com/billing" });
    expect(result).toEqual({ url: "https://billing.stripe.com/session_1" });
  });

  it("falls back to env.APP_URL as the return_url when none is given", async () => {
    vi.mocked(billingRepository.getOrganizationStripeLink).mockResolvedValue({
      organizationId: "org_1",
      stripeCustomerId: "cus_existing",
    });
    const createPortal = vi
      .spyOn(stripe.billingPortal.sessions, "create")
      .mockResolvedValue({ url: "https://billing.stripe.com/session_1" } as any);

    await billingService.createPortalSession({ organizationId: "org_1", role: "owner", input: {} });

    expect(createPortal).toHaveBeenCalledWith({ customer: "cus_existing", return_url: env.APP_URL });
  });

  it("throws ForbiddenError for a plain member, before ever touching Stripe or the repository", async () => {
    await expect(
      billingService.createPortalSession({ organizationId: "org_1", role: "member", input: {} }),
    ).rejects.toThrow(ForbiddenError);
    expect(billingRepository.getOrganizationStripeLink).not.toHaveBeenCalled();
  });

  it("succeeds for an admin, same as an owner", async () => {
    vi.mocked(billingRepository.getOrganizationStripeLink).mockResolvedValue({
      organizationId: "org_1",
      stripeCustomerId: "cus_existing",
    });
    vi.spyOn(stripe.billingPortal.sessions, "create").mockResolvedValue({ url: "https://billing.stripe.com/session_1" } as any);

    await expect(
      billingService.createPortalSession({ organizationId: "org_1", role: "admin", input: {} }),
    ).resolves.toEqual({ url: "https://billing.stripe.com/session_1" });
  });
});

describe("verifyStripeWebhookEvent", () => {
  it("rejects a request with no signature header", async () => {
    await expect(billingService.verifyStripeWebhookEvent("{}", undefined)).rejects.toThrow(ValidationError);
  });

  it("rejects a request with a signature that doesn't match the body", async () => {
    await expect(
      billingService.verifyStripeWebhookEvent("{}", "t=1,v1=not-a-real-signature"),
    ).rejects.toThrow(ValidationError);
  });

  it("accepts a correctly-signed payload and returns the parsed event", async () => {
    const { rawBody, signature } = await signWebhookPayload({
      id: "evt_test_1",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_test_1" } },
    });

    const event = await billingService.verifyStripeWebhookEvent(rawBody, signature);

    expect(event.id).toBe("evt_test_1");
    expect(event.type).toBe("customer.subscription.updated");
  });

  it("rejects a correctly-signed payload that has been tampered with afterward", async () => {
    const { signature } = await signWebhookPayload({ id: "evt_test_2", type: "customer.subscription.updated" });
    const tamperedBody = JSON.stringify({ id: "evt_test_2_evil", type: "customer.subscription.deleted" });

    await expect(billingService.verifyStripeWebhookEvent(tamperedBody, signature)).rejects.toThrow(ValidationError);
  });
});

const fakeSubscriptionRow: SubscriptionRow = {
  id: "row_1",
  organization_id: "org_1",
  plan_id: "basic",
  status: "active",
  current_period_start: "2026-01-01T00:00:00.000Z",
  current_period_end: "2026-02-01T00:00:00.000Z",
  stripe_customer_id: "cus_1",
  stripe_subscription_id: "sub_1",
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("syncSubscriptionFromStripeObject", () => {
  const baseItem = {
    price: { id: env.STRIPE_PRICE_ID_BASIC },
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
  };
  const baseSubscription = {
    id: "sub_1",
    status: "active" as const,
    customer: "cus_1",
    items: { data: [baseItem] },
  };

  it("upserts the mapped subscription when the customer and price are recognized", async () => {
    vi.mocked(billingRepository.findOrganizationIdByStripeCustomerId).mockResolvedValue("org_1");
    vi.mocked(billingRepository.upsertSubscriptionFromStripe).mockResolvedValue(fakeSubscriptionRow);

    await billingService.syncSubscriptionFromStripeObject(baseSubscription);

    expect(billingRepository.upsertSubscriptionFromStripe).toHaveBeenCalledWith({
      organizationId: "org_1",
      planId: "basic",
      status: "active",
      currentPeriodStart: new Date(1_700_000_000 * 1000).toISOString(),
      currentPeriodEnd: new Date(1_702_592_000 * 1000).toISOString(),
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
  });

  it("skips silently when the customer id is not linked to any organization", async () => {
    vi.mocked(billingRepository.findOrganizationIdByStripeCustomerId).mockResolvedValue(null);

    await billingService.syncSubscriptionFromStripeObject(baseSubscription);

    expect(billingRepository.upsertSubscriptionFromStripe).not.toHaveBeenCalled();
  });

  it("skips silently when the subscription has no line items", async () => {
    vi.mocked(billingRepository.findOrganizationIdByStripeCustomerId).mockResolvedValue("org_1");

    await billingService.syncSubscriptionFromStripeObject({ ...baseSubscription, items: { data: [] } });

    expect(billingRepository.upsertSubscriptionFromStripe).not.toHaveBeenCalled();
  });

  it("skips silently when the price id isn't one of our configured plans", async () => {
    vi.mocked(billingRepository.findOrganizationIdByStripeCustomerId).mockResolvedValue("org_1");

    await billingService.syncSubscriptionFromStripeObject({
      ...baseSubscription,
      items: { data: [{ ...baseItem, price: { id: "price_unrecognized" } }] },
    });

    expect(billingRepository.upsertSubscriptionFromStripe).not.toHaveBeenCalled();
  });
});

describe("handleCheckoutSessionCompleted", () => {
  it("is a no-op when the session has no (string) subscription id", async () => {
    await billingService.handleCheckoutSessionCompleted({ subscription: null });

    expect(billingRepository.findOrganizationIdByStripeCustomerId).not.toHaveBeenCalled();
    expect(billingRepository.upsertSubscriptionFromStripe).not.toHaveBeenCalled();
  });

  // The retrieve-then-sync branch (session.subscription is a string) calls
  // the real stripe.subscriptions.retrieve() SDK method, which returns the
  // full Stripe.Subscription type (30+ required fields) — faking that
  // return value would need either a huge fixture or a type assertion, so
  // that branch is intentionally left to live verification instead
  // (already exercised manually against the real Stripe API before this
  // was committed; see PROGRESS.md).
});

describe("handleStripeWebhookEvent", () => {
  it("routes customer.subscription.updated to the sync logic, end-to-end from a real signed payload", async () => {
    vi.mocked(billingRepository.findOrganizationIdByStripeCustomerId).mockResolvedValue("org_1");
    vi.mocked(billingRepository.upsertSubscriptionFromStripe).mockResolvedValue(fakeSubscriptionRow);

    const { rawBody, signature } = await signWebhookPayload({
      id: "evt_test_routing",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_routing_test",
          status: "trialing",
          customer: "cus_1",
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

    const event = await billingService.verifyStripeWebhookEvent(rawBody, signature);
    await billingService.handleStripeWebhookEvent(event);

    expect(billingRepository.upsertSubscriptionFromStripe).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", planId: "pro", status: "trialing" }),
    );
  });

  it("ignores event types it doesn't act on", async () => {
    const { rawBody, signature } = await signWebhookPayload({
      id: "evt_test_ignored",
      type: "customer.updated",
      data: { object: { id: "cus_1" } },
    });

    const event = await billingService.verifyStripeWebhookEvent(rawBody, signature);
    await expect(billingService.handleStripeWebhookEvent(event)).resolves.toBeUndefined();

    expect(billingRepository.upsertSubscriptionFromStripe).not.toHaveBeenCalled();
  });
});
