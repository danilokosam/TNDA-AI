/** `82` -> "82%". Caller is responsible for the `null` ("no data") case. */
export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** `4.2` -> "4.2s"; `95` -> "1m 35s". Caller is responsible for the `null` case. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

/** `29` -> "$29/mo"; `29.5` -> "$29.50/mo". */
export function formatMonthlyPrice(amount: number): string {
  const formatted = Number.isInteger(amount)
    ? amount.toString()
    : amount.toFixed(2);
  return `$${formatted}/mo`;
}

const shortDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/**
 * `"2026-08-07"` -> "Aug 7". Parsed as UTC midnight — these are plain dates
 * (`toDateKey` on the backend), not datetimes, so parsing in the viewer's
 * local timezone could shift the day by one.
 */
export function formatShortDate(isoDate: string): string {
  return shortDateFormatter.format(new Date(`${isoDate}T00:00:00Z`));
}
