"use client";

import { useEffect, useState } from "react";

/** Commits `value` only once it has stayed unchanged for `delayMs` — resets the timer on every change. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
