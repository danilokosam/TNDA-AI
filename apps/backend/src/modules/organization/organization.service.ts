import {
  getActiveSubscription,
  getDailyJobCounts,
  getDocumentsSubmittedSince,
  getJobStatsAggregate,
  getMonthlyPagesUsed,
  getOrganizationById,
  getPlanById,
  listPlans,
  type DailyJobCount,
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

const DEFAULT_STATS_WINDOW_DAYS = 30;

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * `get_organization_daily_job_counts` only returns rows for days that
 * actually had activity (a plain `GROUP BY`, no zero-fill in SQL) — a
 * day missing from that result is indistinguishable from "no data at
 * all" for a client that doesn't know the query's internals. Filling
 * every day in the requested window here, once, means every consumer of
 * this API gets a complete, chart-ready series without needing to know
 * that detail themselves.
 */
function buildDailySeries(since: Date, until: Date, rows: DailyJobCount[]): Array<{ date: string; count: number }> {
  const countsByDay = new Map(rows.map((row) => [row.day, row.jobCount]));
  const series: Array<{ date: string; count: number }> = [];

  const cursor = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  const end = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate()));

  while (cursor <= end) {
    const dateKey = toDateKey(cursor);
    series.push({ date: dateKey, count: countsByDay.get(dateKey) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return series;
}

export interface JobStats {
  completedJobs: number;
  failedJobs: number;
  totalJobs: number;
  /** `null`, not 0, when there's no terminal job in the window to compute a rate from. */
  successRate: number | null;
  avgProcessingSeconds: number | null;
  dailyCounts: Array<{ date: string; count: number }>;
}

export async function getJobStats(organizationId: string, since?: string): Promise<JobStats> {
  const sinceDate = since ? new Date(since) : new Date(Date.now() - DEFAULT_STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();

  const [aggregate, dailyCounts] = await Promise.all([
    getJobStatsAggregate(organizationId, sinceDate.toISOString()),
    getDailyJobCounts(organizationId, sinceDate.toISOString()),
  ]);

  const totalJobs = aggregate.completedJobs + aggregate.failedJobs;

  return {
    completedJobs: aggregate.completedJobs,
    failedJobs: aggregate.failedJobs,
    totalJobs,
    successRate: totalJobs > 0 ? aggregate.completedJobs / totalJobs : null,
    avgProcessingSeconds: aggregate.avgProcessingSeconds,
    dailyCounts: buildDailySeries(sinceDate, now, dailyCounts),
  };
}
