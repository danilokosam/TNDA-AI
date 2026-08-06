import {
  getActiveSubscription,
  getDocumentsSubmittedSince,
  getMonthlyPagesUsed,
  getOrganizationById,
  getPlanById,
  listPlans,
  type PlanRow,
  type SubscriptionRow,
} from "@/modules/organization/organization.repository";

export const DEFAULT_PLAN_ID = "free";

export interface EffectivePlan {
  plan: PlanRow;
  subscription: SubscriptionRow | null;
  periodStart: string;
}

function startOfCurrentMonthUtc(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Resolves the plan an organization is currently governed by. Orgs without
 * an active subscription row are treated as being on the free plan, billed
 * against the calendar month rather than a subscription period.
 */
export async function getEffectivePlan(organizationId: string): Promise<EffectivePlan> {
  const subscription = await getActiveSubscription(organizationId);
  const plan = await getPlanById(subscription?.plan_id ?? DEFAULT_PLAN_ID);

  return {
    plan,
    subscription,
    periodStart: subscription?.current_period_start ?? startOfCurrentMonthUtc(),
  };
}

export interface UsageSummary {
  plan: PlanRow;
  periodStart: string;
  pagesUsed: number;
  documentsUsed: number;
  pagesRemaining: number;
  documentsRemaining: number;
}

export async function getUsageSummary(organizationId: string): Promise<UsageSummary> {
  const { plan, periodStart } = await getEffectivePlan(organizationId);
  const [pagesUsed, documentsUsed] = await Promise.all([
    getMonthlyPagesUsed(organizationId),
    getDocumentsSubmittedSince(organizationId, periodStart),
  ]);

  return {
    plan,
    periodStart,
    pagesUsed,
    documentsUsed,
    pagesRemaining: Math.max(plan.max_pages_per_month - pagesUsed, 0),
    documentsRemaining: Math.max(plan.max_documents_per_month - documentsUsed, 0),
  };
}

export async function getOrganizationOverview(organizationId: string) {
  const [organization, usage] = await Promise.all([
    getOrganizationById(organizationId),
    getUsageSummary(organizationId),
  ]);

  return { organization, usage };
}

export async function getAllPlans(): Promise<PlanRow[]> {
  return listPlans();
}
