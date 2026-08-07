import { describe, expect, it } from "vitest";
import { getNextPollInterval } from "@/features/upload/poll-schedule";

describe("getNextPollInterval", () => {
  it.each([
    [1, 2000],
    [2, 3000],
    [3, 5000],
    [4, 8000],
    [5, 10000],
  ])("returns the step-%i backoff interval of %ims for a non-terminal status", (fetchCount, expected) => {
    expect(getNextPollInterval("processing", fetchCount)).toBe(expected);
  });

  it("caps at the longest interval once the schedule is exhausted", () => {
    expect(getNextPollInterval("processing", 6)).toBe(10000);
    expect(getNextPollInterval("pending", 100)).toBe(10000);
  });

  it("never returns a negative or zero-indexed interval before the first fetch", () => {
    expect(getNextPollInterval(undefined, 0)).toBe(2000);
  });

  it.each(["completed", "failed", "rejected_quota"] as const)(
    "stops polling (returns false) once status is terminal: %s",
    (status) => {
      expect(getNextPollInterval(status, 1)).toBe(false);
      expect(getNextPollInterval(status, 5)).toBe(false);
    },
  );

  it.each(["pending", "processing"] as const)("keeps polling for a non-terminal status: %s", (status) => {
    expect(getNextPollInterval(status, 1)).not.toBe(false);
  });
});
