"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/http";
import { buildDocumentsListPath } from "@/features/documents/query";
import {
  deleteDocumentResponseSchema,
  documentsListResponseSchema,
  jobDtoSchema,
  type DeleteDocumentResponse,
  type JobDto,
  type ListDocumentsParams,
} from "@/types/api";

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

/**
 * Removes the original file only — the job stays fully visible everywhere
 * else, so the only cached data this invalidates is the preview itself
 * (`["document-preview-url", jobId]`, `use-document-preview.ts`'s query
 * key) — nothing on `JobDto` even reflects `storage_path`.
 */
export function useRemoveDocumentFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => apiFetch<JobDto>(`/api/documents/${jobId}/file`, jobDtoSchema, { method: "DELETE" }),
    onSuccess: (_job, jobId) => {
      queryClient.invalidateQueries({ queryKey: ["document-preview-url", jobId] });
    },
  });
}

/** Soft-deletes the whole document — invalidates both its own cached status and the Documents list, which must stop showing it. */
export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) =>
      apiFetch<DeleteDocumentResponse>(`/api/documents/${jobId}`, deleteDocumentResponseSchema, { method: "DELETE" }),
    onSuccess: (_result, jobId) => {
      queryClient.invalidateQueries({ queryKey: ["job-status", jobId] });
      queryClient.invalidateQueries({ queryKey: ["documents-list"] });
    },
  });
}
