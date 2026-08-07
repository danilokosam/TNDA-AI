/**
 * A module-level (not React-state) `jobId -> File` cache — deliberately,
 * not lifted into a Context/store. It exists for exactly one purpose:
 * letting the Results page (`/documents/[jobId]`, a separate route from
 * `/upload`) recover the just-uploaded `File` object for a session-blob
 * preview after a client-side navigation away from the upload queue's own
 * component tree, where that `File` otherwise only lives in local state.
 *
 * A plain module-level `Map` survives client-side route changes within the
 * same page load (the module isn't re-evaluated) but is gone after a real
 * page reload, matching the already-decided "session-only preview" scope —
 * the backend never persists uploaded files, so there is no cross-session
 * story here to begin with. See `DocumentPreviewSource` in `preview.ts`
 * for the type this cache backs.
 */
const cache = new Map<string, File>();

export function cacheFileForPreview(jobId: string, file: File): void {
  cache.set(jobId, file);
}

export function getCachedFile(jobId: string): File | null {
  return cache.get(jobId) ?? null;
}
