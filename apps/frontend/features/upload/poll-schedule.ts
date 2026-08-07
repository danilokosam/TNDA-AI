import type { DocumentJobStatus } from "@/types/api";

/**
 * Backoff schedule for job-status polling, in milliseconds — not just
 * gentler UX. The backend's rate limiter is IP-keyed and becomes a bucket
 * shared across *all* users once every call is proxied through one Next.js
 * server, so a fixed fast interval is a real production ceiling, not a
 * nice-to-have (see PROGRESS.md §7).
 */
const POLL_INTERVALS_MS = [2000, 3000, 5000, 8000, 10000];

/**
 * Terminal *for polling purposes* — no further update will ever arrive for
 * a job in one of these states. Deliberately includes `rejected_quota`
 * (rejected before processing ever started) even though the backend's own
 * stats aggregate treats only `completed`/`failed` as "terminal" for
 * success-rate purposes — those are two different meanings of the word for
 * two different consumers, not a contradiction.
 */
const TERMINAL_STATUSES: ReadonlySet<DocumentJobStatus> = new Set(["completed", "failed", "rejected_quota"]);

/**
 * `fetchCount` is React Query's `query.state.dataUpdateCount` — how many
 * *successful* fetches have completed so far (0 before the first one).
 * Returns `false` to stop polling entirely once a terminal status is seen.
 */
export function getNextPollInterval(status: DocumentJobStatus | undefined, fetchCount: number): number | false {
  if (status && TERMINAL_STATUSES.has(status)) return false;

  // Safe: clamped into [0, POLL_INTERVALS_MS.length - 1] on the line above.
  const index = Math.max(0, Math.min(fetchCount - 1, POLL_INTERVALS_MS.length - 1));
  return POLL_INTERVALS_MS[index]!;
}
