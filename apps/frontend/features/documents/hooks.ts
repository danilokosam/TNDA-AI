"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/http";
import { buildDocumentsListPath } from "@/features/documents/query";
import { documentsListResponseSchema, type ListDocumentsParams } from "@/types/api";

/**
 * `params` (filters + the current page's cursor) is caller-assembled — see
 * `features/documents/filters.ts`'s reducer for how the History page
 * derives it. Included in the query key as-is, so TanStack Query treats
 * every distinct filter/cursor combination as its own cached entry.
 */
export function useDocumentsList(params: ListDocumentsParams) {
  return useQuery({
    queryKey: ["documents-list", params],
    queryFn: () => apiFetch(buildDocumentsListPath(params), documentsListResponseSchema),
  });
}
