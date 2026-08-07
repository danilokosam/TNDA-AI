import "server-only";
import { backendFetch } from "@/lib/api/backend-client";
import { getAccessToken } from "@/lib/supabase/server-client";
import {
  documentsListResponseSchema,
  jobDtoSchema,
  uploadResponseSchema,
  type DocumentsListResponse,
  type JobDto,
  type ListDocumentsParams,
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
