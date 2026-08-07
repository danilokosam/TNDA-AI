import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

/**
 * A distinct fake-timer gotcha from `features/upload/hooks.test.tsx`'s
 * `advanceUntil` (that one's about `waitFor` specifically): here, a bare
 * `await vi.advanceTimersByTimeAsync(...)` fires the timer, but the
 * resulting `setDebounced(...)` never showed up on `result.current` —
 * confirmed by first ruling out a real implementation bug (same failure
 * with both one large advance and many small ones). `useJobStatus`'s own
 * polling test doesn't need this, because TanStack Query's internal
 * `refetchInterval` scheduling apparently flushes its own state updates in
 * a way `act()`-less fake-timer advancement already picks up; a plain
 * `useEffect` + `setTimeout` + `useState` doesn't get that for free.
 * Wrapping the advance in `act()` is what makes the update land.
 */
async function advanceBy(ms: number, stepMs = 25): Promise<void> {
  let elapsed = 0;
  while (elapsed < ms) {
    const step = Math.min(stepMs, ms - elapsed);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step);
    });
    elapsed += step;
  }
}

describe("useDebouncedValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("a", 300));
    expect(result.current).toBe("a");
  });

  it("does not commit a new value until the delay has fully elapsed", async () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: "a" },
    });

    rerender({ value: "b" });
    expect(result.current).toBe("a");

    await advanceBy(299);
    expect(result.current).toBe("a");

    await advanceBy(1);
    expect(result.current).toBe("b");
  });

  it("resets the timer on rapid successive changes, committing only the last value", async () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: "a" },
    });

    rerender({ value: "ab" });
    await advanceBy(200);
    rerender({ value: "abc" });
    await advanceBy(200);
    expect(result.current).toBe("a");

    await advanceBy(100);
    expect(result.current).toBe("abc");
  });
});
