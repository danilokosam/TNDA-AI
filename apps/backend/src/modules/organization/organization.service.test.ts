import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanRow, SubscriptionRow } from "@/modules/organization/organization.repository";

vi.mock("@/modules/organization/organization.repository", () => ({
  getJobStatsAggregate: vi.fn(),
  getDailyJobCounts: vi.fn(),
  getActiveSubscription: vi.fn(),
  getPlanById: vi.fn(),
  listPlans: vi.fn(),
  getMonthlyPagesUsed: vi.fn(),
  getDocumentsSubmittedSince: vi.fn(),
}));

const organizationRepository = await import("@/modules/organization/organization.repository");
const { getJobStats, getEffectivePlan, getUsageSummary, getAllPlans } = await import(
  "@/modules/organization/organization.service"
);

function planFixture(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: "free",
    name: "Free",
    price_monthly: 0,
    max_documents_per_month: 5,
    max_pages_per_document: 1,
    max_pages_per_month: 2,
    max_file_size_mb: 5,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function subscriptionFixture(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "sub_1",
    organization_id: "org_1",
    plan_id: "basic",
    status: "active",
    current_period_start: "2026-01-05T00:00:00.000Z",
    current_period_end: "2026-02-05T00:00:00.000Z",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "stripe_sub_1",
    created_at: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-10T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getJobStats", () => {
  it("computes successRate as completed / (completed + failed)", async () => {
    vi.mocked(organizationRepository.getJobStatsAggregate).mockResolvedValue({
      completedJobs: 3,
      failedJobs: 1,
      avgProcessingSeconds: 12,
    });
    vi.mocked(organizationRepository.getDailyJobCounts).mockResolvedValue([]);

    const result = await getJobStats("org_1", "2026-01-08T00:00:00.000Z");

    expect(result.totalJobs).toBe(4);
    expect(result.successRate).toBe(0.75);
  });

  it("returns successRate: null (not 0) when there are no terminal jobs in the window", async () => {
    vi.mocked(organizationRepository.getJobStatsAggregate).mockResolvedValue({
      completedJobs: 0,
      failedJobs: 0,
      avgProcessingSeconds: null,
    });
    vi.mocked(organizationRepository.getDailyJobCounts).mockResolvedValue([]);

    const result = await getJobStats("org_1", "2026-01-08T00:00:00.000Z");

    expect(result.totalJobs).toBe(0);
    expect(result.successRate).toBeNull();
  });

  it("defaults `since` to 30 days back when not provided", async () => {
    vi.mocked(organizationRepository.getJobStatsAggregate).mockResolvedValue({
      completedJobs: 0,
      failedJobs: 0,
      avgProcessingSeconds: null,
    });
    vi.mocked(organizationRepository.getDailyJobCounts).mockResolvedValue([]);

    await getJobStats("org_1");

    // "now" is frozen at 2026-01-10T12:00:00.000Z above.
    expect(organizationRepository.getJobStatsAggregate).toHaveBeenCalledWith("org_1", "2025-12-11T12:00:00.000Z");
  });

  it("gap-fills days with no activity as count: 0, in a complete, contiguous date series", async () => {
    vi.mocked(organizationRepository.getJobStatsAggregate).mockResolvedValue({
      completedJobs: 2,
      failedJobs: 0,
      avgProcessingSeconds: 10,
    });
    // Sparse - only two of the four days in the window have activity.
    vi.mocked(organizationRepository.getDailyJobCounts).mockResolvedValue([
      { day: "2026-01-08", jobCount: 5 },
      { day: "2026-01-10", jobCount: 2 },
    ]);

    const result = await getJobStats("org_1", "2026-01-07T00:00:00.000Z");

    // "now" is frozen at 2026-01-10, so the window is Jan 7 - Jan 10 inclusive.
    expect(result.dailyCounts).toEqual([
      { date: "2026-01-07", count: 0 },
      { date: "2026-01-08", count: 5 },
      { date: "2026-01-09", count: 0 },
      { date: "2026-01-10", count: 2 },
    ]);
  });

  it("produces a single-entry series when since and now fall on the same day", async () => {
    vi.mocked(organizationRepository.getJobStatsAggregate).mockResolvedValue({
      completedJobs: 0,
      failedJobs: 0,
      avgProcessingSeconds: null,
    });
    vi.mocked(organizationRepository.getDailyJobCounts).mockResolvedValue([]);

    const result = await getJobStats("org_1", "2026-01-10T00:00:00.000Z");

    expect(result.dailyCounts).toEqual([{ date: "2026-01-10", count: 0 }]);
  });

  it("passes avgProcessingSeconds through untouched, including null", async () => {
    vi.mocked(organizationRepository.getJobStatsAggregate).mockResolvedValue({
      completedJobs: 0,
      failedJobs: 0,
      avgProcessingSeconds: null,
    });
    vi.mocked(organizationRepository.getDailyJobCounts).mockResolvedValue([]);

    const result = await getJobStats("org_1");

    expect(result.avgProcessingSeconds).toBeNull();
  });
});

describe("getEffectivePlan", () => {
  it("returns the active subscription's plan when one exists", async () => {
    const subscription = subscriptionFixture({ plan_id: "pro" });
    vi.mocked(organizationRepository.getActiveSubscription).mockResolvedValue(subscription);
    vi.mocked(organizationRepository.getPlanById).mockResolvedValue(planFixture({ id: "pro", name: "Pro" }));

    const result = await getEffectivePlan("org_1");

    expect(organizationRepository.getPlanById).toHaveBeenCalledWith("pro");
    expect(result.plan.id).toBe("pro");
    expect(result.subscription).toEqual(subscription);
    expect(result.periodStart).toBe(subscription.current_period_start);
  });

  it("falls back to the free plan (DEFAULT_PLAN_ID) when there's no active subscription", async () => {
    vi.mocked(organizationRepository.getActiveSubscription).mockResolvedValue(null);
    vi.mocked(organizationRepository.getPlanById).mockResolvedValue(planFixture({ id: "free" }));

    const result = await getEffectivePlan("org_1");

    expect(organizationRepository.getPlanById).toHaveBeenCalledWith("free");
    expect(result.subscription).toBeNull();
  });

  it("uses the start of the current calendar month as periodStart when there's no active subscription", async () => {
    vi.mocked(organizationRepository.getActiveSubscription).mockResolvedValue(null);
    vi.mocked(organizationRepository.getPlanById).mockResolvedValue(planFixture());

    const result = await getEffectivePlan("org_1");

    // "now" is frozen at 2026-01-10T12:00:00.000Z above.
    expect(result.periodStart).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("getUsageSummary", () => {
  it("computes pagesRemaining/documentsRemaining against the effective plan's limits", async () => {
    vi.mocked(organizationRepository.getActiveSubscription).mockResolvedValue(null);
    vi.mocked(organizationRepository.getPlanById).mockResolvedValue(
      planFixture({ max_pages_per_month: 100, max_documents_per_month: 10 }),
    );
    vi.mocked(organizationRepository.getMonthlyPagesUsed).mockResolvedValue(30);
    vi.mocked(organizationRepository.getDocumentsSubmittedSince).mockResolvedValue(4);

    const result = await getUsageSummary("org_1");

    expect(result.pagesUsed).toBe(30);
    expect(result.documentsUsed).toBe(4);
    expect(result.pagesRemaining).toBe(70);
    expect(result.documentsRemaining).toBe(6);
  });

  it("clamps pagesRemaining/documentsRemaining at 0 (never negative) when usage exceeds the plan's limits", async () => {
    vi.mocked(organizationRepository.getActiveSubscription).mockResolvedValue(null);
    vi.mocked(organizationRepository.getPlanById).mockResolvedValue(
      planFixture({ max_pages_per_month: 10, max_documents_per_month: 2 }),
    );
    vi.mocked(organizationRepository.getMonthlyPagesUsed).mockResolvedValue(50);
    vi.mocked(organizationRepository.getDocumentsSubmittedSince).mockResolvedValue(9);

    const result = await getUsageSummary("org_1");

    expect(result.pagesRemaining).toBe(0);
    expect(result.documentsRemaining).toBe(0);
  });

  it("passes the effective plan's periodStart through to getDocumentsSubmittedSince", async () => {
    const subscription = subscriptionFixture({ current_period_start: "2026-01-05T00:00:00.000Z" });
    vi.mocked(organizationRepository.getActiveSubscription).mockResolvedValue(subscription);
    vi.mocked(organizationRepository.getPlanById).mockResolvedValue(planFixture());
    vi.mocked(organizationRepository.getMonthlyPagesUsed).mockResolvedValue(0);
    vi.mocked(organizationRepository.getDocumentsSubmittedSince).mockResolvedValue(0);

    await getUsageSummary("org_1");

    expect(organizationRepository.getDocumentsSubmittedSince).toHaveBeenCalledWith("org_1", "2026-01-05T00:00:00.000Z");
  });
});

describe("getAllPlans", () => {
  it("delegates to the repository's plan list unchanged", async () => {
    const plans = [planFixture({ id: "free" }), planFixture({ id: "basic" })];
    vi.mocked(organizationRepository.listPlans).mockResolvedValue(plans);

    const result = await getAllPlans();

    expect(result).toEqual(plans);
  });
});
