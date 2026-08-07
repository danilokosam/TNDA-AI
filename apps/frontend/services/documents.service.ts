import "server-only";
import { backendFetch } from "@/lib/api/backend-client";
import { getAccessToken } from "@/lib/supabase/server-client";
import {
  deleteDocumentResponseSchema,
  documentsListResponseSchema,
  fieldCorrectionsResponseSchema,
  jobDtoSchema,
  previewUrlResponseSchema,
  uploadResponseSchema,
  type DeleteDocumentResponse,
  type DocumentCorrectionsRequest,
  type DocumentsListResponse,
  type FieldCorrectionsResponse,
  type JobDto,
  type ListDocumentsParams,
  type PreviewUrlResponse,
  type UploadDocumentParams,
  type UploadResponse,
} from "@/types/api";

function buildQuery(params: ListDocumentsParams): string {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.documentType) search.set("documentType", params.documentType);
  if (params.search) search.set("search", params.search);
  if (params.dateFrom) search.set("dateFrom", params.dateFrom);
  if (params.dateTo) search.set("dateTo", params.dateTo);
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit !== undefined) search.set("limit", String(params.limit));

  const queryString = search.toString();
  return queryString ? `?${queryString}` : "";
}

/**
 * `params.cursor` is always passed through opaque, exactly as received from
 * a previous call's `pagination.nextCursor` — never constructed here. See
 * `ListDocumentsParams`'s doc comment for why this isn't a Zod-validated
 * request schema.
 */
export async function listDocuments(params: ListDocumentsParams = {}): Promise<DocumentsListResponse> {
  const accessToken = await getAccessToken();
  return backendFetch(`/api/v1/documents${buildQuery(params)}`, documentsListResponseSchema, {
    accessToken: accessToken ?? undefined,
  });
}

/**
 * `documentType` is omitted from the form data entirely when not provided —
 * the backend defaults to `"invoice"` itself (`uploadDocumentSchema`), so
 * this doesn't duplicate that default on the frontend side.
 */
export async function uploadDocument(params: UploadDocumentParams): Promise<UploadResponse> {
  const accessToken = await getAccessToken();
  const formData = new FormData();
  formData.set("file", params.file);
  if (params.documentType) formData.set("documentType", params.documentType);

  return backendFetch("/api/v1/documents", uploadResponseSchema, {
    method: "POST",
    body: formData,
    accessToken: accessToken ?? undefined,
  });
}

export async function getJobStatus(jobId: string): Promise<JobDto> {
  const accessToken = await getAccessToken();
  return backendFetch(`/api/v1/documents/jobs/${encodeURIComponent(jobId)}`, jobDtoSchema, {
    accessToken: accessToken ?? undefined,
  });
}

export async function getPreviewUrl(jobId: string): Promise<PreviewUrlResponse> {
  const accessToken = await getAccessToken();
  return backendFetch(`/api/v1/documents/jobs/${encodeURIComponent(jobId)}/preview-url`, previewUrlResponseSchema, {
    accessToken: accessToken ?? undefined,
  });
}

export async function getFieldCorrections(jobId: string): Promise<FieldCorrectionsResponse> {
  const accessToken = await getAccessToken();
  return backendFetch(
    `/api/v1/documents/jobs/${encodeURIComponent(jobId)}/corrections`,
    fieldCorrectionsResponseSchema,
    { accessToken: accessToken ?? undefined },
  );
}

/** Saves corrections without deciding confirm/reject — see documents.service.ts (backend) for the reset-to-unreviewed behavior this can trigger. */
export async function saveFieldCorrections(jobId: string, request: DocumentCorrectionsRequest): Promise<JobDto> {
  const accessToken = await getAccessToken();
  return backendFetch(`/api/v1/documents/jobs/${encodeURIComponent(jobId)}/corrections`, jobDtoSchema, {
    method: "PATCH",
    body: JSON.stringify(request),
    accessToken: accessToken ?? undefined,
  });
}

export async function confirmDocumentReview(jobId: string, request: DocumentCorrectionsRequest): Promise<JobDto> {
  const accessToken = await getAccessToken();
  return backendFetch(`/api/v1/documents/jobs/${encodeURIComponent(jobId)}/confirm`, jobDtoSchema, {
    method: "POST",
    body: JSON.stringify(request),
    accessToken: accessToken ?? undefined,
  });
}

export async function rejectDocumentReview(jobId: string, request: DocumentCorrectionsRequest): Promise<JobDto> {
  const accessToken = await getAccessToken();
  return backendFetch(`/api/v1/documents/jobs/${encodeURIComponent(jobId)}/reject`, jobDtoSchema, {
    method: "POST",
    body: JSON.stringify(request),
    accessToken: accessToken ?? undefined,
  });
}

/** Removes the original file only — the job stays fully visible, so this returns the updated job, not a confirmation-only shape. */
export async function removeDocumentFile(jobId: string): Promise<JobDto> {
  const accessToken = await getAccessToken();
  return backendFetch(`/api/v1/documents/jobs/${encodeURIComponent(jobId)}/file`, jobDtoSchema, {
    method: "DELETE",
    accessToken: accessToken ?? undefined,
  });
}

/** Soft-deletes the whole document. See `deleteDocumentResponseSchema`'s doc comment for why the response is just `{jobId}`, not a full `JobDto`. */
export async function deleteDocument(jobId: string): Promise<DeleteDocumentResponse> {
  const accessToken = await getAccessToken();
  return backendFetch(`/api/v1/documents/jobs/${encodeURIComponent(jobId)}`, deleteDocumentResponseSchema, {
    method: "DELETE",
    accessToken: accessToken ?? undefined,
  });
}
