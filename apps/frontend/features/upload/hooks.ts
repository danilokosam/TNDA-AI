"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/http";
import { getNextPollInterval } from "@/features/upload/poll-schedule";
import { jobDtoSchema, uploadResponseSchema, type JobDto, type UploadDocumentParams, type UploadResponse } from "@/types/api";

function buildUploadFormData(params: UploadDocumentParams): FormData {
  const formData = new FormData();
  formData.set("file", params.file);
  if (params.documentType) formData.set("documentType", params.documentType);
  return formData;
}

export function useUploadDocument() {
  return useMutation({
    mutationFn: (params: UploadDocumentParams) =>
      apiFetch<UploadResponse>("/api/documents", uploadResponseSchema, {
        method: "POST",
        body: buildUploadFormData(params),
      }),
  });
}

/**
 * `jobId: null` (rather than requiring conditional hook calls upstream) so
 * a queue of upload items — some with a job yet, some without — can all
 * call this hook unconditionally, one per item.
 */
export function useJobStatus(jobId: string | null) {
  return useQuery({
    queryKey: ["job-status", jobId],
    // Safe: React Query never calls queryFn while `enabled` is false.
    queryFn: () => apiFetch<JobDto>(`/api/documents/${encodeURIComponent(jobId!)}`, jobDtoSchema),
    enabled: jobId !== null,
    refetchInterval: (query) => getNextPollInterval(query.state.data?.status, query.state.dataUpdateCount),
  });
}
