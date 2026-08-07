/**
 * Locked in during Stage 3 planning (see PROGRESS.md §4 decision 2),
 * implemented here in Stage 4. The backend never persists uploaded files —
 * a persistent preview isn't achievable without new infrastructure — so
 * this is deliberately a swappable union, not just a boolean:
 *
 * - `session-blob`: the just-uploaded `File` is still cached in this tab
 *   (see `preview-cache.ts`) — real preview, only available for the
 *   immediate upload → results flow within the same browser session.
 * - `remote-url`: a persistent, backend-provided URL. Not produced by
 *   anything today — the type exists so this can slot in later (once the
 *   backend persists files) without touching any UI component that
 *   consumes `DocumentPreviewSource`.
 * - `unavailable`: no file to preview — opening a job from anywhere other
 *   than the immediate post-upload flow (a reloaded page, a future
 *   History link, a different tab).
 */
export type DocumentPreviewSource =
  | { kind: "session-blob"; url: string }
  | { kind: "remote-url"; url: string }
  | { kind: "unavailable" };
