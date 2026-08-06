import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/utils/errors";

vi.mock("@/config/supabase", () => ({
  supabaseAdmin: { rpc: vi.fn() },
}));

const { supabaseAdmin } = await import("@/config/supabase");
const organizationRepository = await import("@/modules/organization/organization.repository");

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
