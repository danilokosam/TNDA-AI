import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { computeOutcomeShares, ProcessingOutcomesChart } from "@/components/dashboard/ProcessingOutcomesChart";

describe("computeOutcomeShares", () => {
  it("returns zero shares when there are no terminal jobs at all", () => {
    expect(computeOutcomeShares(0, 0)).toEqual({ total: 0, completedRatio: 0, failedRatio: 0 });
  });

  it("is 100% completed when there are no failures", () => {
    const { total, completedRatio, failedRatio } = computeOutcomeShares(5, 0);
    expect(total).toBe(5);
    expect(completedRatio).toBe(1);
    expect(failedRatio).toBe(0);
  });

  it("is 100% failed when there are no completions", () => {
    const { total, completedRatio, failedRatio } = computeOutcomeShares(0, 3);
    expect(total).toBe(3);
    expect(completedRatio).toBe(0);
    expect(failedRatio).toBe(1);
  });

  it("splits proportionally for a mix of both", () => {
    const { total, completedRatio, failedRatio } = computeOutcomeShares(3, 1);
    expect(total).toBe(4);
    expect(completedRatio).toBe(0.75);
    expect(failedRatio).toBe(0.25);
  });

  it("always sums the two ratios to 1 whenever total > 0 (never over/under 100%)", () => {
    for (const [completed, failed] of [[1, 0], [0, 1], [7, 3], [1, 1], [100, 1]]) {
      const { completedRatio, failedRatio } = computeOutcomeShares(completed as number, failed as number);
      expect(completedRatio + failedRatio).toBeCloseTo(1, 10);
    }
  });
});

describe("ProcessingOutcomesChart", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  function expectNoDuplicateKeyWarning() {
    const duplicateKeyWarning = consoleErrorSpy.mock.calls.find((call: unknown[]) => String(call[0]).includes("same key"));
    expect(duplicateKeyWarning).toBeUndefined();
  }

  it("renders an empty state when there are no completed or failed jobs", () => {
    render(<ProcessingOutcomesChart completedJobs={0} failedJobs={0} />);

    expect(screen.getByText(/no completed or failed documents yet/i)).toBeInTheDocument();
    expectNoDuplicateKeyWarning();
  });

  it("renders correctly when every job failed (the 100%/0% degenerate case)", () => {
    render(<ProcessingOutcomesChart completedJobs={0} failedJobs={4} />);

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("4 · 100%")).toBeInTheDocument();
    expect(screen.getByText("0 · 0%")).toBeInTheDocument();
    expectNoDuplicateKeyWarning();
  });

  it("renders correctly when every job completed (the other 100%/0% degenerate case)", () => {
    render(<ProcessingOutcomesChart completedJobs={6} failedJobs={0} />);

    expect(screen.getByText("6 · 100%")).toBeInTheDocument();
    expectNoDuplicateKeyWarning();
  });

  it("renders correctly for a single document", () => {
    render(<ProcessingOutcomesChart completedJobs={1} failedJobs={0} />);

    expect(screen.getByText("1", { selector: "text" })).toBeInTheDocument();
    expectNoDuplicateKeyWarning();
  });

  it("renders correctly for a realistic mixed outcome, with a legend for both categories", () => {
    render(<ProcessingOutcomesChart completedJobs={87} failedJobs={13} />);

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("87 · 87%")).toBeInTheDocument();
    expect(screen.getByText("13 · 13%")).toBeInTheDocument();
    expectNoDuplicateKeyWarning();
  });
});
