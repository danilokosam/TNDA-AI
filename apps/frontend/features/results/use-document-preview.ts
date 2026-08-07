"use client";

import { useEffect, useState } from "react";
import { getCachedFile } from "@/features/results/preview-cache";
import type { DocumentPreviewSource } from "@/features/results/preview";

/**
 * Only ever produces `session-blob` or `unavailable` — `remote-url` has no
 * producer yet (see `preview.ts`). Creates a blob URL from the cached
 * `File` (if any) and revokes it on cleanup/`jobId` change — blob URLs are
 * an easy-to-miss memory leak otherwise, since nothing revokes them
 * automatically.
 */
export function useDocumentPreview(jobId: string): DocumentPreviewSource {
  const [source, setSource] = useState<DocumentPreviewSource>({ kind: "unavailable" });

  useEffect(() => {
    const file = getCachedFile(jobId);

    if (!file) {
      // Resets a stale `session-blob` from a previous `jobId` when the new
      // one has no cached file — not computable during render (reading the
      // module-level cache and creating/revoking the object URL below are
      // both external-system side effects, and the two branches share one
      // cleanup-paired lifecycle), and not a case `useSyncExternalStore`
      // fits either: there's nothing to subscribe to, since `preview-cache`
      // is written once at upload time, never mutated after. Deliberately
      // still a plain effect+setState rather than `useMemo`/a lazy
      // `useState` initializer for the URL — both of those run during
      // render, where React Strict Mode's double-invoke has no paired
      // cleanup and would leak one blob URL per mount; an effect's
      // double-invoke is mount→cleanup→mount, which revokes the first one.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSource({ kind: "unavailable" });
      return;
    }

    const url = URL.createObjectURL(file);
    setSource({ kind: "session-blob", url });

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [jobId]);

  return source;
}
