"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/http";
import {
  plansResponseSchema,
  subscriptionResponseSchema,
  urlResponseSchema,
  type CheckoutRequest,
  type UrlResponse,
} from "@/types/api";

export function usePlans() {
  return useQuery({
    queryKey: ["billing-plans"],
    queryFn: () => apiFetch("/api/billing/plans", plansResponseSchema),
  });
}

export interface UseSubscriptionOptions {
  /**
   * Passed straight through to TanStack Query's own `refetchInterval` —
   * not a bespoke polling mechanism. `false`/`undefined` (the default)
   * disables it entirely; the bounded post-checkout-return window that
   * enables this briefly lives in the component that reads
   * `?checkout=success`, not here (§6 of the Phase 3 plan).
   */
  refetchInterval?: number | false;
}

export function useSubscription(options: UseSubscriptionOptions = {}) {
  return useQuery({
    queryKey: ["billing-subscription"],
    queryFn: () => apiFetch("/api/billing/subscription", subscriptionResponseSchema),
    refetchInterval: options.refetchInterval,
  });
}

/**
 * Both mutations redirect to the Stripe-hosted URL the BFF returns via
 * `window.location.assign` — a real, full-page navigation off this app's
 * origin entirely, which `next/navigation`'s `router` (client-side,
 * same-origin only) cannot perform. Deliberately not `router.push()`.
 */
function redirectToExternalUrl(response: UrlResponse): void {
  window.location.assign(response.url);
}

export function useCreateCheckoutSession() {
  return useMutation({
    mutationFn: (input: { planId: CheckoutRequest["planId"] }) =>
      apiFetch("/api/billing/checkout", urlResponseSchema, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: redirectToExternalUrl,
  });
}

export function useCreatePortalSession() {
  return useMutation({
    mutationFn: () => apiFetch("/api/billing/portal", urlResponseSchema, { method: "POST" }),
    onSuccess: redirectToExternalUrl,
  });
}
