import { supabaseAdmin } from "@/config/supabase";
import { AppError, NotFoundError } from "@/utils/errors";
import type { Database, DocumentJobStatus, DocumentType } from "@/config/database.types";

export type DocumentJobRow = Database["public"]["Tables"]["document_jobs"]["Row"];
export type DocumentJobInsert = Database["public"]["Tables"]["document_jobs"]["Insert"];
export type DocumentJobUpdate = Database["public"]["Tables"]["document_jobs"]["Update"];

/**
 * Encodes a `created_at` value into the opaque cursor callers pass back
 * in `GET /documents?cursor=...`. Base64url, not raw ISO text, so the
 * pagination strategy can change later (e.g. adding a tiebreaker) without
 * the wire format looking like something callers should parse themselves.
 */
function encodeCursor(createdAt: string): string {
  return Buffer.from(createdAt, "utf-8").toString("base64url");
}

/**
 * Returns `null` (rather than throwing) for anything that doesn't decode
 * to a valid timestamp - an invalid/tampered cursor is treated as "no
 * cursor" (first page), not a request error. Never interpolated into a
 * raw filter-expression string (see the `.lt()` call below) - `created_at`
 * only ever reaches Supabase as a parameterized filter *value*.
 */
function decodeCursor(cursor: string): string | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
    return Number.isNaN(Date.parse(decoded)) ? null : decoded;
  } catch {
    return null;
  }
}

export async function createDocumentJob(input: DocumentJobInsert): Promise<DocumentJobRow> {
  const { data, error } = await supabaseAdmin.from("document_jobs").insert(input).select("*").single();

  if (error || !data) {
    console.error("[documents.repository] createDocumentJob failed", { input, error });
    throw new AppError(500, "INTERNAL_ERROR", error?.message ?? "Failed to create document job.");
  }

  return data;
}

export async function updateDocumentJob(
  id: string,
  patch: DocumentJobUpdate,
): Promise<DocumentJobRow> {
  const { data, error } = await supabaseAdmin
    .from("document_jobs")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    console.error("[documents.repository] updateDocumentJob failed", { id, patch, error });
    throw new AppError(500, "INTERNAL_ERROR", error?.message ?? "Failed to update document job.");
  }

  return data;
}

export async function getDocumentJobForOrganization(
  id: string,
  organizationId: string,
): Promise<DocumentJobRow> {
  const { data, error } = await supabaseAdmin
    .from("document_jobs")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    throw new AppError(500, "INTERNAL_ERROR", error.message);
  }

  if (!data) {
    throw new NotFoundError("Document job not found.");
  }

  return data;
}

export interface ListDocumentJobsFilters {
  status?: DocumentJobStatus;
  documentType?: DocumentType;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  limit: number;
}

export interface ListDocumentJobsResult {
  jobs: DocumentJobRow[];
  nextCursor: string | null;
}

/**
 * Keyset pagination on `created_at` alone (no `id` tiebreaker), ordered
 * newest first. Deliberately simpler than a compound cursor: offset-based
 * pagination (`.range()`) drifts under concurrent inserts - a real case
 * here, since a batch upload can add rows while someone's paging through
 * their own history - and this avoids that without needing Supabase's
 * `.or()` raw-filter-string DSL (which would otherwise be the only way to
 * express a `(created_at, id) < (cursor_created_at, cursor_id)` compound
 * comparison, and would mean interpolating decoded cursor content into a
 * filter *expression* rather than a filter *value*). The accepted trade:
 * two jobs created in the exact same instant could theoretically land on
 * opposite sides of a page boundary - rare enough in practice (each job
 * row is written by a separate awaited round trip) not to be worth the
 * larger attack surface.
 */
export async function listDocumentJobsForOrganization(
  organizationId: string,
  filters: ListDocumentJobsFilters,
): Promise<ListDocumentJobsResult> {
  let query = supabaseAdmin
    .from("document_jobs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(filters.limit + 1);

  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.documentType) {
    query = query.eq("document_type", filters.documentType);
  }
  if (filters.search) {
    query = query.ilike("file_name", `%${filters.search}%`);
  }
  if (filters.dateFrom) {
    query = query.gte("created_at", filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte("created_at", filters.dateTo);
  }
  if (filters.cursor) {
    const decoded = decodeCursor(filters.cursor);
    if (decoded) {
      query = query.lt("created_at", decoded);
    }
  }

  const { data, error } = await query;

  if (error) {
    console.error("[documents.repository] listDocumentJobsForOrganization failed", { organizationId, filters, error });
    throw new AppError(500, "INTERNAL_ERROR", error.message);
  }

  const rows = data ?? [];
  const hasMore = rows.length > filters.limit;
  const jobs = hasMore ? rows.slice(0, filters.limit) : rows;
  const lastJob = jobs.at(-1);

  return {
    jobs,
    nextCursor: hasMore && lastJob ? encodeCursor(lastJob.created_at) : null,
  };
}
