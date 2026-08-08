import { CircleAlert } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardAction, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatMonthlyPrice } from "@/lib/format";
import type { PlanRow } from "@/types/api";

interface PlanCardProps {
  plan: PlanRow;
  isCurrentPlan: boolean;
  /** The org already has some real (non-free) subscription, regardless of which plan — checkout is only ever offered when there is none; existing subscriptions are changed via the Stripe Portal instead. */
  hasActiveSubscription: boolean;
  canManageBilling: boolean;
  onSelect: () => void;
  isCheckoutPending: boolean;
  checkoutError?: string | null;
}

export function PlanCard({
  plan,
  isCurrentPlan,
  hasActiveSubscription,
  canManageBilling,
  onSelect,
  isCheckoutPending,
  checkoutError,
}: PlanCardProps) {
  const isPaidPlan = plan.price_monthly > 0;
  const showAction = isPaidPlan && !isCurrentPlan && !hasActiveSubscription;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{plan.name}</CardTitle>
        {isCurrentPlan ? (
          <CardAction>
            <Badge variant="default">Current plan</Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-2xl font-semibold">{formatMonthlyPrice(plan.price_monthly)}</p>
        {checkoutError ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{checkoutError}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      {showAction ? (
        <CardFooter className="flex-col items-start gap-2">
          <Button onClick={onSelect} disabled={!canManageBilling || isCheckoutPending}>
            {isCheckoutPending ? "Redirecting…" : "Select"}
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
