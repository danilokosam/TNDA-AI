import type { ListDocumentsParams } from "@/types/api";

/**
 * Client-side counterpart to `documents.service.ts`'s own (server-only,
 * unreachable from here) query builder — same param-to-query-string logic,
 * duplicated rather than shared across the `server-only` boundary (see
 * ADR 0008), targeting this app's own `/api/documents` BFF route instead
 * of the real backend directly.
 */
export function buildDocumentsListPath(params: ListDocumentsParams): string {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.documentType) search.set("documentType", params.documentType);
  if (params.search) search.set("search", params.search);
  if (params.dateFrom) search.set("dateFrom", params.dateFrom);
  if (params.dateTo) search.set("dateTo", params.dateTo);
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit !== undefined) search.set("limit", String(params.limit));

  const queryString = search.toString();
  return `/api/documents${queryString ? `?${queryString}` : ""}`;
}
