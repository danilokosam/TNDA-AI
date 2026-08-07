"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/http";
import { getCachedFile } from "@/features/results/preview-cache";
import { previewUrlResponseSchema } from "@/types/api";
import type { DocumentPreviewSource } from "@/features/results/preview";

/**
 * A backend-generated signed URL (the persisted file — see ARCHITECTURE.md's
 * Storage migration, ADR-equivalent decision) is the source of truth now.
 * The session cache (`preview-cache.ts`) is only ever a fast-path/fallback:
 * an instant render for the tab that just uploaded, shown while the
 * signed-URL fetch is still in flight, or a last resort if the backend
 * genuinely has nothing persisted (storage upload failed server-side, or
 * the job predates persistent storage). It never overrides a real signed
 * URL once one is known.
 */
export function useDocumentPreview(jobId: string): DocumentPreviewSource {
  const { data: remote, isPending } = useQuery({
    queryKey: ["document-preview-url", jobId],
    queryFn: () => apiFetch(`/api/documents/${jobId}/preview-url`, previewUrlResponseSchema),
  });

  const [sessionUrl, setSessionUrl] = useState<string | null>(null);

  useEffect(() => {
    const file = getCachedFile(jobId);

    if (!file) {
      // Resets a stale blob URL from a previous `jobId` when the new one
      // has nothing cached — see use-document-preview's Stage 4 history
      // for why this stays a plain effect+setState (not useSyncExternalStore
      // or a render-time useMemo/lazy-init): the cleanup pairing an effect
      // gives is what keeps this safe under React Strict Mode's
      // double-invoke, which a render-time resource allocation wouldn't get.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessionUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setSessionUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [jobId]);

  if (remote?.url) {
    return { kind: "remote-url", url: remote.url };
  }

  if (sessionUrl) {
    return { kind: "session-blob", url: sessionUrl };
  }

  if (isPending) {
    return { kind: "loading" };
  }

  return { kind: "unavailable" };
}
