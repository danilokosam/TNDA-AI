import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, NotFoundError } from "@/utils/errors";

vi.mock("@/config/supabase", () => ({
  supabaseAdmin: { rpc: vi.fn(), from: vi.fn() },
}));

const { supabaseAdmin } = await import("@/config/supabase");
const organizationRepository = await import("@/modules/organization/organization.repository");

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

/** Same per-file query-builder-chain mock convention as documents.repository.test.ts. */
function createQueryBuilderMock(result: QueryResult) {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
    then: (onfulfilled: (value: QueryResult) => unknown) => Promise.resolve(result).then(onfulfilled),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getJobStatsAggregate", () => {
  it("calls get_organization_job_stats with the org id and since date, and maps the row to camelCase", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: [{ completed_jobs: 12, failed_jobs: 3, avg_processing_seconds: 45.6 }],
      error: null,
    } as any);

    const result = await organizationRepository.getJobStatsAggregate("org_1", "2026-01-01T00:00:00.000Z");

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("get_organization_job_stats", {
      p_organization_id: "org_1",
      p_since: "2026-01-01T00:00:00.000Z",
    });
    expect(result).toEqual({ completedJobs: 12, failedJobs: 3, avgProcessingSeconds: 45.6 });
  });

  it("defaults to zero counts and a null average when the function returns no row", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: [], error: null } as any);

    const result = await organizationRepository.getJobStatsAggregate("org_1", "2026-01-01T00:00:00.000Z");

    expect(result).toEqual({ completedJobs: 0, failedJobs: 0, avgProcessingSeconds: null });
  });

  it("throws AppError when Supabase returns an error", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "function not found" } } as any);

    await expect(organizationRepository.getJobStatsAggregate("org_1", "2026-01-01T00:00:00.000Z")).rejects.toThrow(
      AppError,
    );
  });
});

describe("getDailyJobCounts", () => {
  it("calls get_organization_daily_job_counts and maps rows to camelCase", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: [
        { day: "2026-01-10", job_count: 3 },
        { day: "2026-01-11", job_count: 5 },
      ],
      error: null,
    } as any);

    const result = await organizationRepository.getDailyJobCounts("org_1", "2026-01-01T00:00:00.000Z");

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("get_organization_daily_job_counts", {
      p_organization_id: "org_1",
      p_since: "2026-01-01T00:00:00.000Z",
    });
    expect(result).toEqual([
      { day: "2026-01-10", jobCount: 3 },
      { day: "2026-01-11", jobCount: 5 },
    ]);
  });

  it("returns an empty array (not an error) when there's no activity in the window", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: [], error: null } as any);

    await expect(organizationRepository.getDailyJobCounts("org_1", "2026-01-01T00:00:00.000Z")).resolves.toEqual([]);
  });

  it("throws AppError when Supabase returns an error", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "db exploded" } } as any);

    await expect(organizationRepository.getDailyJobCounts("org_1", "2026-01-01T00:00:00.000Z")).rejects.toThrow(
      AppError,
    );
  });
});

describe("getActiveSubscription", () => {
  it("scopes to the organization, filters to trialing/active/past_due, and returns the newest match", async () => {
    const row = { id: "sub_1", organization_id: "org_1", plan_id: "basic", status: "active" };
    const chain = createQueryBuilderMock({ data: row, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    const result = await organizationRepository.getActiveSubscription("org_1");

    expect(supabaseAdmin.from).toHaveBeenCalledWith("subscriptions");
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org_1");
    expect(chain.in).toHaveBeenCalledWith("status", ["trialing", "active", "past_due"]);
    expect(chain.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(1);
    expect(result).toEqual(row);
  });

  it("returns null (not an error) when the organization has no active subscription — the implicit free tier", async () => {
    const chain = createQueryBuilderMock({ data: null, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    const result = await organizationRepository.getActiveSubscription("org_1");

    expect(result).toBeNull();
  });

  it("throws AppError when Supabase returns an error", async () => {
    const chain = createQueryBuilderMock({ data: null, error: { message: "db exploded" } });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(organizationRepository.getActiveSubscription("org_1")).rejects.toThrow(AppError);
  });
});

describe("getPlanById", () => {
  it("returns the plan row for a known plan id", async () => {
    const row = { id: "pro", name: "Pro" };
    const chain = createQueryBuilderMock({ data: row, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    const result = await organizationRepository.getPlanById("pro");

    expect(supabaseAdmin.from).toHaveBeenCalledWith("plans");
    expect(chain.eq).toHaveBeenCalledWith("id", "pro");
    expect(result).toEqual(row);
  });

  it("throws NotFoundError for an unknown plan id", async () => {
    const chain = createQueryBuilderMock({ data: null, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(organizationRepository.getPlanById("nonexistent")).rejects.toThrow(NotFoundError);
  });
});

describe("listPlans", () => {
  it("returns the full plan catalog ordered by price ascending", async () => {
    const rows = [{ id: "free", price_monthly: 0 }, { id: "basic", price_monthly: 29 }];
    const chain = createQueryBuilderMock({ data: rows, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    const result = await organizationRepository.listPlans();

    expect(supabaseAdmin.from).toHaveBeenCalledWith("plans");
    expect(chain.order).toHaveBeenCalledWith("price_monthly", { ascending: true });
    expect(result).toEqual(rows);
  });

  it("returns an empty array (not an error) when Supabase returns no data", async () => {
    const chain = createQueryBuilderMock({ data: null, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(organizationRepository.listPlans()).resolves.toEqual([]);
  });

  it("throws AppError when Supabase returns an error", async () => {
    const chain = createQueryBuilderMock({ data: null, error: { message: "db exploded" } });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(organizationRepository.listPlans()).rejects.toThrow(AppError);
  });
});
