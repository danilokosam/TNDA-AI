import "server-only";
import { backendFetch } from "@/lib/api/backend-client";
import { getAccessToken } from "@/lib/supabase/server-client";
import { subscriptionResponseSchema, type SubscriptionResponse } from "@/types/api";

/**
 * Minimal for now — only what Stage 2's Dashboard "current plan" card needs.
 * `plans`/`checkout`/`portal` land with Stage 6 (Billing), which does the
 * full Checkout/Portal flow.
 */
export async function getSubscription(): Promise<SubscriptionResponse> {
  const accessToken = await getAccessToken();
  return backendFetch("/api/v1/billing/subscription", subscriptionResponseSchema, {
    accessToken: accessToken ?? undefined,
  });
}
