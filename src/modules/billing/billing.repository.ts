import { supabaseAdmin } from "@/config/supabase";
import { AppError } from "@/utils/errors";
import type { Database, SubscriptionStatus } from "@/config/database.types";

export type SubscriptionRow = Database["public"]["Tables"]["subscriptions"]["Row"];

function assertNoQueryError(error: { message: string } | null): void {
  if (error) {
    throw new AppError(500, "INTERNAL_ERROR", error.message);
  }
}

/** Persists the Stripe Customer ID an organization was resolved/created against, for reuse on later checkouts and portal sessions. */
export async function setOrganizationStripeCustomerId(
  organizationId: string,
  stripeCustomerId: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("organizations")
    .update({ stripe_customer_id: stripeCustomerId })
    .eq("id", organizationId);

  assertNoQueryError(error);
}

export interface OrganizationStripeLink {
  organizationId: string;
  stripeCustomerId: string | null;
}

export async function getOrganizationStripeLink(organizationId: string): Promise<OrganizationStripeLink> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id, stripe_customer_id")
    .eq("id", organizationId)
    .single();

  if (error || !data) {
    throw new AppError(500, "INTERNAL_ERROR", error?.message ?? "Organization not found.");
  }

  return { organizationId: data.id, stripeCustomerId: data.stripe_customer_id };
}

/** Resolves the organization a Stripe webhook event's `customer` id belongs to. */
export async function findOrganizationIdByStripeCustomerId(stripeCustomerId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();

  assertNoQueryError(error);

  return data?.id ?? null;
}

export interface UpsertSubscriptionInput {
  organizationId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}

/**
 * Syncs a Stripe subscription's current state into `subscriptions`, keyed
 * by `stripe_subscription_id` so `created`/`updated`/`deleted` webhook
 * events all converge on the same row regardless of delivery order.
 */
export async function upsertSubscriptionFromStripe(input: UpsertSubscriptionInput): Promise<SubscriptionRow> {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .upsert(
      {
        organization_id: input.organizationId,
        plan_id: input.planId,
        status: input.status,
        current_period_start: input.currentPeriodStart,
        current_period_end: input.currentPeriodEnd,
        stripe_customer_id: input.stripeCustomerId,
        stripe_subscription_id: input.stripeSubscriptionId,
      },
      { onConflict: "stripe_subscription_id" },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new AppError(500, "INTERNAL_ERROR", error?.message ?? "Failed to sync subscription from Stripe.");
  }

  return data;
}
