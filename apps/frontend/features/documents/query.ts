import type { ListDocumentsParams } from "@/types/api";
import type { DocumentsFilters } from "@/features/documents/filters";

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

/**
 * Client-side query builder for the CSV export BFF route
 * (`app/api/documents/export/route.ts`). Deliberately omits `status`: the
 * backend export endpoint always restricts to `completed` documents (see
 * documents.service.ts#exportDocuments), so forwarding whatever status the
 * list view happens to be filtered to would misrepresent what gets
 * exported.
 */
export function buildDocumentsExportPath(filters: DocumentsFilters): string {
  const search = new URLSearchParams();
  if (filters.documentType) search.set("documentType", filters.documentType);
  if (filters.search) search.set("search", filters.search);
  if (filters.dateFrom) search.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) search.set("dateTo", filters.dateTo);

  const queryString = search.toString();
  return `/api/documents/export${queryString ? `?${queryString}` : ""}`;
}
