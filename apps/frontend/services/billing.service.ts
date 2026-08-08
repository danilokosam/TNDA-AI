import "server-only";
import { backendFetch } from "@/lib/api/backend-client";
import { getAccessToken } from "@/lib/supabase/server-client";
import {
  plansResponseSchema,
  subscriptionResponseSchema,
  urlResponseSchema,
  type CheckoutRequest,
  type PortalRequest,
  type SubscriptionResponse,
  type UrlResponse,
} from "@/types/api";

export async function getSubscription(): Promise<SubscriptionResponse> {
  const accessToken = await getAccessToken();
  return backendFetch("/api/v1/billing/subscription", subscriptionResponseSchema, {
    accessToken: accessToken ?? undefined,
  });
}

export async function getPlans() {
  const accessToken = await getAccessToken();
  return backendFetch("/api/v1/billing/plans", plansResponseSchema, {
    accessToken: accessToken ?? undefined,
  });
}

/**
 * `input.redirectUrl` must already be the caller's own request origin — the
 * BFF route computes it server-side from the incoming request, never
 * trusting a client-supplied value; see app/api/billing/checkout/route.ts.
 */
export async function createCheckoutSession(input: CheckoutRequest): Promise<UrlResponse> {
  const accessToken = await getAccessToken();
  return backendFetch("/api/v1/billing/checkout", urlResponseSchema, {
    accessToken: accessToken ?? undefined,
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Same origin-derivation contract as createCheckoutSession — see app/api/billing/portal/route.ts. */
export async function createPortalSession(input: PortalRequest): Promise<UrlResponse> {
  const accessToken = await getAccessToken();
  return backendFetch("/api/v1/billing/portal", urlResponseSchema, {
    accessToken: accessToken ?? undefined,
    method: "POST",
    body: JSON.stringify(input),
  });
}
