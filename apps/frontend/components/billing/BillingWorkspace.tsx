"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { LoaderCircle } from "lucide-react";
import { can } from "@tnda-ai/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { CurrentSubscriptionCard } from "@/components/billing/CurrentSubscriptionCard";
import { PlanCard } from "@/components/billing/PlanCard";
import { useCreateCheckoutSession, useCreatePortalSession, usePlans, useSubscription } from "@/features/billing/hooks";
import type { CheckoutRequest, ProfileRole, SubscriptionResponse } from "@/types/api";

/**
 * Stripe's webhook delivery has no ordering guarantee relative to the
 * browser's redirect back to `/billing?checkout=success`, so the updated
 * subscription may not have landed yet. Rather than a bespoke polling
 * module, this just enables TanStack Query's own `refetchInterval` on
 * `useSubscription` for a bounded window — capped at whichever of
 * `CHECKOUT_POLL_MAX_ATTEMPTS` fetches or `CHECKOUT_POLL_TIMEOUT_MS` comes
 * first — and stops the instant the fetched subscription reflects a real
 * (Stripe-backed) row. If the webhook still hasn't landed once the window
 * closes, this falls back to the normal view using whatever was last
 * fetched; the query's own `refetchOnWindowFocus` and a manual reload
 * still pick up the real state later.
 */
const CHECKOUT_POLL_INTERVAL_MS = 2000;
const CHECKOUT_POLL_MAX_ATTEMPTS = 10;
const CHECKOUT_POLL_TIMEOUT_MS = 20_000;

/** A real Stripe-backed row always has an `id`; the synthetic implicit-free-tier response never does. */
function isRealSubscription(subscription: SubscriptionResponse["subscription"]): boolean {
  return "id" in subscription;
}

/** Only these plan ids are ever checkout-eligible (`billing.schema.ts#checkoutRequestSchema` on the backend) — matches `PlanCard`'s own `price_monthly > 0` gate for the seeded free/basic/pro plans. */
function isCheckoutablePlanId(id: string): id is CheckoutRequest["planId"] {
  return id === "basic" || id === "pro";
}

interface BillingWorkspaceProps {
  role: ProfileRole;
}

export function BillingWorkspace({ role }: BillingWorkspaceProps) {
  const canManageBilling = can(role, "billing.manage");

  const searchParams = useSearchParams();
  const router = useRouter();
  // Captured once on mount — a fresh checkout return always comes from a
  // full external redirect, never a client-side navigation, so this
  // doesn't need to react to later changes to the URL.
  const [checkoutStatus] = useState(() => searchParams.get("checkout"));
  const [checkoutPending, setCheckoutPending] = useState(checkoutStatus === "success");
  const pollAttemptsRef = useRef(0);

  useEffect(() => {
    if (checkoutStatus) {
      router.replace("/billing", { scroll: false });
    }
  }, [checkoutStatus, router]);

  const subscriptionQuery = useSubscription({
    refetchInterval: checkoutPending ? CHECKOUT_POLL_INTERVAL_MS : false,
  });
  const plansQuery = usePlans();
  const checkoutMutation = useCreateCheckoutSession();
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null);
  const portalMutation = useCreatePortalSession();

  // Stops the moment the fetched subscription reflects a real (Stripe-
  // backed) row, or after CHECKOUT_POLL_MAX_ATTEMPTS fetches — whichever
  // comes first.
  useEffect(() => {
    if (!checkoutPending || !subscriptionQuery.data) return;
    pollAttemptsRef.current += 1;
    const isConfirmed = isRealSubscription(subscriptionQuery.data.subscription);
    if (isConfirmed) toast.success("Subscription updated");
    if (isConfirmed || pollAttemptsRef.current >= CHECKOUT_POLL_MAX_ATTEMPTS) {
      setCheckoutPending(false);
    }
  }, [checkoutPending, subscriptionQuery.data]);

  // Hard ceiling independent of the above — covers a stalled or
  // repeatedly-erroring fetch, which the attempt-counting effect above
  // can't see (it only runs once real data arrives).
  useEffect(() => {
    if (!checkoutPending) return;
    const timeout = setTimeout(() => setCheckoutPending(false), CHECKOUT_POLL_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [checkoutPending]);

  function handleSelectPlan(planId: string) {
    if (!isCheckoutablePlanId(planId)) return;
    setCheckoutPlanId(planId);
    checkoutMutation.mutate(
      { planId },
      { onError: (error) => toast.error(error.message) },
    );
  }

  if (checkoutPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        <span>Finishing up your subscription update…</span>
      </div>
    );
  }

  const isLoading = subscriptionQuery.isLoading || plansQuery.isLoading;
  const isError = subscriptionQuery.isError || plansQuery.isError;

  if (isLoading) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Loading…</p>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError || !subscriptionQuery.data || !plansQuery.data) {
    return <p className="text-sm text-destructive">Couldn&apos;t load billing information. Please try again.</p>;
  }

  const { plan: currentPlan, subscription } = subscriptionQuery.data;
  const hasStripeSubscription = isRealSubscription(subscription);

  return (
    <div className="space-y-6">
      {checkoutStatus === "cancelled" ? (
        <Alert>
          <AlertDescription>Checkout was cancelled. No changes were made.</AlertDescription>
        </Alert>
      ) : null}

      <CurrentSubscriptionCard
        plan={currentPlan}
        status={subscription.status}
        hasStripeSubscription={hasStripeSubscription}
        canManageBilling={canManageBilling}
        onManagePortal={() => portalMutation.mutate(undefined, { onError: (error) => toast.error(error.message) })}
        isPortalPending={portalMutation.isPending}
        portalError={portalMutation.isError ? portalMutation.error.message : null}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {plansQuery.data.map((plan) => {
          const isThisPlanSelected = checkoutPlanId === plan.id;
          return (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrentPlan={plan.id === currentPlan.id}
              hasActiveSubscription={hasStripeSubscription}
              canManageBilling={canManageBilling}
              onSelect={() => handleSelectPlan(plan.id)}
              isCheckoutPending={isThisPlanSelected && checkoutMutation.isPending}
              checkoutError={
                isThisPlanSelected && checkoutMutation.isError ? checkoutMutation.error.message : null
              }
            />
          );
        })}
      </div>
    </div>
  );
}
