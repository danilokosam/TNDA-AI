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

const billingRepository = await import("@/modules/billing/billing.repository");
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
