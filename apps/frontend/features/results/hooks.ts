"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/http";
import {
  fieldCorrectionsResponseSchema,
  jobDtoSchema,
  type DocumentCorrectionsRequest,
  type FieldCorrectionsResponse,
  type JobDto,
} from "@/types/api";

/**
 * `enabled` defaults to `true` but is meant to be driven by the caller's
 * own `useJobStatus` result (`job?.status === "completed"`) — a job with
 * no result yet has nothing to correct, so there's nothing worth fetching.
 */
export function useFieldCorrections(jobId: string, enabled = true) {
  return useQuery({
    queryKey: ["field-corrections", jobId],
    queryFn: () => apiFetch<FieldCorrectionsResponse>(`/api/documents/${jobId}/corrections`, fieldCorrectionsResponseSchema),
    enabled,
  });
}

interface ReviewMutationInput {
  jobId: string;
  corrections: Record<string, string>;
}

/**
 * Shared by the three review-mutation hooks below — same endpoint shape
 * (`{corrections}` body, a `JobDto` response), same invalidation on
 * success: this job's status/fields (`useJobStatus`) and its correction
 * history (`useFieldCorrections`) are both stale the moment any of these
 * resolve, and `reviewStatus` is also what the Documents list will
 * eventually badge (see the review-workflow plan's phase 3) — invalidating
 * it now costs nothing and means that later addition needs no new
 * plumbing here.
 */
function useReviewMutation(path: (jobId: string) => string, method: "PATCH" | "POST") {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, corrections }: ReviewMutationInput) =>
      apiFetch<JobDto>(path(jobId), jobDtoSchema, {
        method,
        body: JSON.stringify({ corrections } satisfies DocumentCorrectionsRequest),
      }),
    onSuccess: (_job, { jobId }) => {
      queryClient.invalidateQueries({ queryKey: ["job-status", jobId] });
      queryClient.invalidateQueries({ queryKey: ["field-corrections", jobId] });
      queryClient.invalidateQueries({ queryKey: ["documents-list"] });
    },
  });
}

/** Saves corrections without deciding confirm/reject. */
export function useSaveCorrections() {
  return useReviewMutation((jobId) => `/api/documents/${jobId}/corrections`, "PATCH");
}

export function useConfirmReview() {
  return useReviewMutation((jobId) => `/api/documents/${jobId}/confirm`, "POST");
}

export function useRejectReview() {
  return useReviewMutation((jobId) => `/api/documents/${jobId}/reject`, "POST");
}
