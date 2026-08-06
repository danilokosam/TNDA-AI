import type Stripe from "stripe";
import { env } from "@/config/env";
import { stripe, STRIPE_PRICE_ID_BY_PLAN, type PaidPlanId } from "@/config/stripe";
import { AppError, ValidationError } from "@/utils/errors";
import type { SubscriptionStatus } from "@/config/database.types";
import { getAllPlans, getEffectivePlan } from "@/modules/organization/organization.service";
import {
  findOrganizationIdByStripeCustomerId,
  getOrganizationStripeLink,
  setOrganizationStripeCustomerId,
  upsertSubscriptionFromStripe,
} from "@/modules/billing/billing.repository";
import type { CheckoutRequestInput, PortalRequestInput } from "@/modules/billing/billing.schema";

export function appendQueryString(url: string, queryString: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${queryString}`;
}

export async function listAvailablePlans() {
  return getAllPlans();
}

export async function getCurrentSubscription(organizationId: string) {
  const { plan, subscription } = await getEffectivePlan(organizationId);

  return {
    plan,
    subscription: subscription ?? {
      status: "active" as const,
      planId: plan.id,
      note: "No paid subscription on file; organization is on the free tier by default.",
    },
  };
}

/** Returns the organization's existing Stripe Customer, or creates and persists a new one. */
async function resolveOrCreateStripeCustomer(organizationId: string, email: string): Promise<string> {
  const link = await getOrganizationStripeLink(organizationId);
  if (link.stripeCustomerId) {
    return link.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email,
    metadata: { organization_id: organizationId },
  });

  await setOrganizationStripeCustomerId(organizationId, customer.id);
  return customer.id;
}

export interface CreateCheckoutSessionParams {
  organizationId: string;
  email: string;
  input: CheckoutRequestInput;
}

export async function createCheckoutSession({
  organizationId,
  email,
  input,
}: CreateCheckoutSessionParams): Promise<{ url: string }> {
  const customerId = await resolveOrCreateStripeCustomer(organizationId, email);
  const priceId = STRIPE_PRICE_ID_BY_PLAN[input.planId];
  const redirectBase = input.redirectUrl ?? env.APP_URL;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: organizationId,
    line_items: [{ price: priceId, quantity: 1 }],
    // Appended as raw query strings, not via the URL API: `{CHECKOUT_SESSION_ID}`
    // is a literal placeholder Stripe substitutes server-side, and
    // URLSearchParams would percent-encode its braces and break that.
    success_url: appendQueryString(redirectBase, "checkout=success&session_id={CHECKOUT_SESSION_ID}"),
    cancel_url: appendQueryString(redirectBase, "checkout=cancelled"),
    subscription_data: {
      metadata: { organization_id: organizationId, plan_id: input.planId },
    },
    metadata: { organization_id: organizationId, plan_id: input.planId },
  });

  if (!session.url) {
    throw new AppError(500, "INTERNAL_ERROR", "Stripe did not return a checkout URL.");
  }

  return { url: session.url };
}

export interface CreatePortalSessionParams {
  organizationId: string;
  input: PortalRequestInput;
}

export async function createPortalSession({
  organizationId,
  input,
}: CreatePortalSessionParams): Promise<{ url: string }> {
  const link = await getOrganizationStripeLink(organizationId);

  if (!link.stripeCustomerId) {
    throw new ValidationError(
      "This organization has no billing history yet. Start a checkout before opening the billing portal.",
    );
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: link.stripeCustomerId,
    return_url: input.returnUrl ?? env.APP_URL,
  });

  return { url: session.url };
}

/** Verifies the Stripe-Signature header and parses the raw webhook body into a typed event. */
export async function verifyStripeWebhookEvent(rawBody: string, signature: string | undefined): Promise<Stripe.Event> {
  if (!signature) {
    throw new ValidationError("Missing Stripe-Signature header.");
  }

  try {
    return await stripe.webhooks.constructEventAsync(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Stripe webhook signature.";
    throw new ValidationError(`Stripe webhook signature verification failed: ${message}`);
  }
}

const PLAN_ID_BY_STRIPE_PRICE_ID: Record<string, PaidPlanId> = {
  [STRIPE_PRICE_ID_BY_PLAN.basic]: "basic",
  [STRIPE_PRICE_ID_BY_PLAN.pro]: "pro",
};

export function getPlanIdForPriceId(priceId: string): PaidPlanId | null {
  return PLAN_ID_BY_STRIPE_PRICE_ID[priceId] ?? null;
}

export function mapStripeStatusToInternal(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return "canceled";
    case "incomplete":
    default:
      return "incomplete";
  }
}

export function resolveCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer): string {
  return typeof customer === "string" ? customer : customer.id;
}

/**
 * The subset of `Stripe.Subscription` this module actually reads. Narrowed
 * deliberately (rather than taking the full SDK type, which has 30+
 * required fields) so a realistic test fixture can be built without ever
 * needing a type assertion — any real `Stripe.Subscription` structurally
 * satisfies this already, so call sites need no cast either.
 */
export interface StripeSubscriptionSyncData {
  id: string;
  status: Stripe.Subscription.Status;
  customer: string | Stripe.Customer | Stripe.DeletedCustomer;
  items: {
    data: Array<{
      price: { id: string };
      current_period_start: number;
      current_period_end: number;
    }>;
  };
}

/**
 * Syncs a Stripe subscription's data into `subscriptions`. Used by
 * `customer.subscription.created`/`updated`/`deleted` directly, and by
 * `checkout.session.completed` (which retrieves the subscription itself
 * first) so the row is consistent immediately after checkout rather than
 * waiting on a second webhook delivery.
 */
export async function syncSubscriptionFromStripeObject(subscription: StripeSubscriptionSyncData): Promise<void> {
  const stripeCustomerId = resolveCustomerId(subscription.customer);
  const organizationId = await findOrganizationIdByStripeCustomerId(stripeCustomerId);

  if (!organizationId) {
    console.error("[billing.service] Stripe subscription event for an unrecognized customer", {
      stripeCustomerId,
      subscriptionId: subscription.id,
    });
    return;
  }

  const item = subscription.items.data[0];
  if (!item) {
    console.error("[billing.service] Stripe subscription has no line items", { subscriptionId: subscription.id });
    return;
  }

  const planId = getPlanIdForPriceId(item.price.id);
  if (!planId) {
    console.error("[billing.service] Stripe subscription uses an unrecognized price id", {
      priceId: item.price.id,
      subscriptionId: subscription.id,
    });
    return;
  }

  await upsertSubscriptionFromStripe({
    organizationId,
    planId,
    status: mapStripeStatusToInternal(subscription.status),
    currentPeriodStart: new Date(item.current_period_start * 1000).toISOString(),
    currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString(),
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
  });
}

export interface StripeCheckoutSessionSyncData {
  subscription: string | Stripe.Subscription | null;
}

export async function handleCheckoutSessionCompleted(session: StripeCheckoutSessionSyncData): Promise<void> {
  if (typeof session.subscription !== "string") {
    // Not a subscription-mode session (or Stripe already expanded it away) — nothing to sync.
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(session.subscription);
  await syncSubscriptionFromStripeObject(subscription);
}

export async function handleStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(event.data.object);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscriptionFromStripeObject(event.data.object);
      break;
    default:
      // Not an event type we act on; ignore.
      break;
  }
}
