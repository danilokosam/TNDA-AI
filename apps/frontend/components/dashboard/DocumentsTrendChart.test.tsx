import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { computeYAxis, DocumentsTrendChart } from "@/components/dashboard/DocumentsTrendChart";
import type { OrganizationStats } from "@/types/api";

function dailyCounts(counts: number[]): OrganizationStats["dailyCounts"] {
  return counts.map((count, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, count }));
}

describe("computeYAxis", () => {
  it("never produces duplicate ticks for small max values (the reported regression: maxValue=2 produced [0,1,1,2,2])", () => {
    const { ticks } = computeYAxis(2);
    expect(ticks).toEqual([0, 1, 2]);
    expect(new Set(ticks).size).toBe(ticks.length);
  });

  it("never produces duplicate ticks for maxValue=1", () => {
    const { ticks } = computeYAxis(1);
    expect(new Set(ticks).size).toBe(ticks.length);
  });

  it("never produces duplicate ticks across every small integer max value (0-30) — the whole range where a sub-1 step could previously occur", () => {
    for (let maxValue = 0; maxValue <= 30; maxValue++) {
      const { ticks } = computeYAxis(maxValue);
      expect(new Set(ticks).size, `duplicates for maxValue=${maxValue}: ${JSON.stringify(ticks)}`).toBe(ticks.length);
    }
  });

  it("still produces clean round-number ticks for larger, normal-scale max values", () => {
    expect(computeYAxis(100).ticks).toEqual([0, 50, 100]);
    expect(computeYAxis(1000).ticks).toEqual([0, 500, 1000]);
  });

  it("always includes at least two ticks, even for maxValue=0", () => {
    const { ticks } = computeYAxis(0);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ticks).size).toBe(ticks.length);
  });
});

describe("DocumentsTrendChart", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  function expectNoDuplicateKeyWarning() {
    const duplicateKeyWarning = consoleErrorSpy.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes("same key"),
    );
    expect(duplicateKeyWarning).toBeUndefined();
  }

  it("renders an empty state for zero data, with no duplicate-key warning", () => {
    render(<DocumentsTrendChart dailyCounts={[]} />);

    expect(screen.getByText(/no activity in this window/i)).toBeInTheDocument();
    expectNoDuplicateKeyWarning();
  });

  it("renders correctly for a single document, with no duplicate-key warning", () => {
    render(<DocumentsTrendChart dailyCounts={dailyCounts([1])} />);

    expect(screen.getByText("Documents processed")).toBeInTheDocument();
    expectNoDuplicateKeyWarning();
  });

  it("renders correctly for the exact reported regression case (small values 1-2), with no duplicate-key warning", () => {
    render(<DocumentsTrendChart dailyCounts={dailyCounts([0, 1, 2, 1, 2])} />);

    expectNoDuplicateKeyWarning();
  });

  it("renders correctly for larger document counts, with no duplicate-key warning", () => {
    render(<DocumentsTrendChart dailyCounts={dailyCounts([120, 340, 210, 500, 480])} />);

    expectNoDuplicateKeyWarning();
  });

  it("renders correctly for normal dashboard-scale data spanning many days, with no duplicate-key warning", () => {
    render(<DocumentsTrendChart dailyCounts={dailyCounts(Array.from({ length: 31 }, (_, i) => (i * 3) % 17))} />);

    expectNoDuplicateKeyWarning();
  });
});
