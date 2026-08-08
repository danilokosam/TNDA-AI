import { Card, CardHeader, CardTitle, CardContent, CardAction } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UsageMeter } from "@/components/dashboard/UsageMeter";
import { formatMonthlyPrice } from "@/lib/format";
import type { PlanRow, SubscriptionRow, UsageSummary } from "@/types/api";

export type SubscriptionStatus = SubscriptionRow["status"];

/** Reused by components/billing/CurrentSubscriptionCard.tsx — same status vocabulary, not redefined a third time. */
export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  canceled: "Canceled",
  incomplete: "Incomplete",
};

export const STATUS_VARIANTS: Record<SubscriptionStatus, "success" | "secondary" | "outline" | "destructive"> = {
  active: "success",
  trialing: "secondary",
  past_due: "outline",
  incomplete: "outline",
  canceled: "destructive",
};

interface CurrentPlanCardProps {
  plan: PlanRow;
  /** Real rows use the full `SubscriptionRow` union; the implicit free tier is always `"active"`. */
  status: SubscriptionStatus;
  usage: UsageSummary;
}

export function CurrentPlanCard({ plan, status, usage }: CurrentPlanCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Current plan</CardTitle>
        <CardAction>
          <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="text-2xl font-semibold">{plan.name}</p>
          <p className="text-sm text-muted-foreground">{formatMonthlyPrice(plan.price_monthly)}</p>
        </div>
        <div className="space-y-4">
          <UsageMeter label="Documents this period" used={usage.documentsUsed} limit={plan.max_documents_per_month} />
          <UsageMeter label="Pages this period" used={usage.pagesUsed} limit={plan.max_pages_per_month} />
        </div>
      </CardContent>
    </Card>
  );
}
