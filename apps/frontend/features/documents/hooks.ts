"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchFile } from "@/lib/api/http";
import { buildDocumentsExportPath, buildDocumentsListPath } from "@/features/documents/query";
import type { DocumentsFilters } from "@/features/documents/filters";
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

/**
 * Filter-scoped CSV export. Resolves to the downloaded Blob plus a file
 * name parsed from the response's Content-Disposition header (falling back
 * to a sensible default if that header is ever missing) — the caller
 * (DocumentsExportButton) triggers the actual browser download.
 */
export function useExportDocuments() {
  return useMutation({
    mutationFn: async (filters: DocumentsFilters): Promise<{ blob: Blob; fileName: string }> => {
      const response = await apiFetchFile(buildDocumentsExportPath(filters));
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      return { blob, fileName: match?.[1] ?? "documents-export.csv" };
    },
  });
}
