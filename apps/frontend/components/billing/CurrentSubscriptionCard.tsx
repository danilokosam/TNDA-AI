import { CircleAlert } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardAction, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { STATUS_LABELS, STATUS_VARIANTS, type SubscriptionStatus } from "@/components/dashboard/CurrentPlanCard";
import { formatMonthlyPrice } from "@/lib/format";
import type { PlanRow } from "@/types/api";

interface CurrentSubscriptionCardProps {
  plan: PlanRow;
  status: SubscriptionStatus;
  /** Discriminates a real Stripe-backed `SubscriptionRow` from the synthetic implicit-free-tier response, which has no Stripe customer to open a Portal session for. */
  hasStripeSubscription: boolean;
  canManageBilling: boolean;
  onManagePortal: () => void;
  isPortalPending: boolean;
  portalError?: string | null;
}

export function CurrentSubscriptionCard({
  plan,
  status,
  hasStripeSubscription,
  canManageBilling,
  onManagePortal,
  isPortalPending,
  portalError,
}: CurrentSubscriptionCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Current plan</CardTitle>
        <CardAction>
          <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-2xl font-semibold">{plan.name}</p>
          <p className="text-sm text-muted-foreground">{formatMonthlyPrice(plan.price_monthly)}</p>
        </div>
        {status === "past_due" ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>Your payment needs attention. Update it to avoid interruption.</AlertDescription>
          </Alert>
        ) : null}
        {portalError ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{portalError}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      {hasStripeSubscription ? (
        <CardFooter className="flex-col items-start gap-2">
          <Button onClick={onManagePortal} disabled={!canManageBilling || isPortalPending}>
            {isPortalPending ? "Redirecting…" : "Manage billing"}
          </Button>
          {!canManageBilling ? (
            <p className="text-sm text-muted-foreground">
              Only organization owners and admins can manage billing.
            </p>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}
