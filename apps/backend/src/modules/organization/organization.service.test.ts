import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/organization/organization.repository", () => ({
  getJobStatsAggregate: vi.fn(),
  getDailyJobCounts: vi.fn(),
}));

const organizationRepository = await import("@/modules/organization/organization.repository");
const { getJobStats } = await import("@/modules/organization/organization.service");

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
