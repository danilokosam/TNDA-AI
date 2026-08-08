import { Elysia } from "elysia";
import { z } from "zod";
import { authMiddleware } from "@/middlewares/auth.middleware";
import * as billingService from "@/modules/billing/billing.service";
import { checkoutRequestSchema, portalRequestSchema } from "@/modules/billing/billing.schema";

export const billingRoutes = new Elysia({ prefix: "/api/v1/billing" })
  // Public: Stripe authenticates this endpoint via the `stripe-signature`
  // header, not our bearer auth, so it's registered before `authMiddleware`
  // is applied below. `parse: "text"` forces Elysia to hand back the exact
  // raw body string (never JSON-parsed/re-serialized), which Stripe's HMAC
  // signature verification requires byte-for-byte.
  .post(
    "/webhook",
    async ({ body, headers, set }) => {
      const event = await billingService.verifyStripeWebhookEvent(body, headers["stripe-signature"]);
      await billingService.handleStripeWebhookEvent(event);
      set.status = 200;
      return { received: true };
    },
    { body: z.string(), parse: "text" },
  )
  .use(authMiddleware)
  .get("/plans", async () => billingService.listAvailablePlans())
  .get("/subscription", async ({ auth }) => billingService.getCurrentSubscription(auth.organizationId))
  .post(
    "/checkout",
    async ({ auth, body }) =>
      billingService.createCheckoutSession({
        organizationId: auth.organizationId,
        email: auth.email,
        role: auth.role,
        input: body,
      }),
    { body: checkoutRequestSchema },
  )
  .post(
    "/portal",
    async ({ auth, body }) =>
      billingService.createPortalSession({
        organizationId: auth.organizationId,
        role: auth.role,
        input: body ?? {},
      }),
    { body: portalRequestSchema.optional() },
  );
