const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** `500` -> "500 B"; `1536` -> "1.5 KB"; `1048576` -> "1.0 MB". */
export function formatFileSize(bytes: number): string {
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < FILE_SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const formatted = unitIndex === 0 ? value.toString() : value.toFixed(1);
  return `${formatted} ${FILE_SIZE_UNITS[unitIndex]}`;
}

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

const dateFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" });

/**
 * `"2026-08-08T14:30:00.000Z"` -> "Aug 8, 2026". Unlike `formatShortDate`,
 * this takes a real timestamp (`document_jobs.created_at`, a moment that
 * actually happened) and deliberately renders in the viewer's local
 * timezone, not UTC — "uploaded at 2pm" should mean 2pm for the person
 * reading it, not 2pm UTC.
 */
export function formatDate(isoDateTime: string): string {
  return dateFormatter.format(new Date(isoDateTime));
}
