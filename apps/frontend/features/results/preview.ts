/**
 * Locked in during Stage 3 planning (PROGRESS.md §4 decision 2), initially
 * implemented session-only in Stage 4, then migrated to backend-persisted
 * storage — see ARCHITECTURE.md and the Storage-migration plan. Stays a
 * swappable union (not a boolean) because the source genuinely still
 * varies per job:
 *
 * - `loading`: the signed-URL lookup (a real network request now) hasn't
 *   resolved yet, and nothing is session-cached to show in the meantime.
 *   Distinct from `unavailable` specifically so a reloaded/History-opened
 *   job doesn't flash "unavailable" before its real preview arrives.
 * - `remote-url`: a signed URL for the backend-persisted original file —
 *   the source of truth now, for any job that has one.
 * - `session-blob`: the just-uploaded `File`, still cached in this tab
 *   (`preview-cache.ts`). Only a fast-path/fallback now — an instant
 *   render while the signed-URL fetch above is in flight, or a last
 *   resort if the backend genuinely has nothing persisted for this job.
 * - `unavailable`: confirmed — no persisted file, and nothing session-cached
 *   either. A real, honest state (storage upload failed, or the job
 *   predates persistent storage), not a loading placeholder.
 */
export type DocumentPreviewSource =
  | { kind: "loading" }
  | { kind: "session-blob"; url: string }
  | { kind: "remote-url"; url: string }
  | { kind: "unavailable" };
