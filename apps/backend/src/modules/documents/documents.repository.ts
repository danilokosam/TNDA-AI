import { supabaseAdmin } from "@/config/supabase";
import { AppError, NotFoundError } from "@/utils/errors";
import type { Database, DocumentJobStatus, DocumentType } from "@/config/database.types";

export type DocumentJobRow = Database["public"]["Tables"]["document_jobs"]["Row"];
export type DocumentJobInsert = Database["public"]["Tables"]["document_jobs"]["Insert"];
export type DocumentJobUpdate = Database["public"]["Tables"]["document_jobs"]["Update"];

export type FieldCorrectionRow = Database["public"]["Tables"]["document_field_corrections"]["Row"];
export type FieldCorrectionInsert = Database["public"]["Tables"]["document_field_corrections"]["Insert"];

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

/** Excludes soft-deleted jobs — a deleted job is not viewable or actionable through this lookup. */
export async function getDocumentJobForOrganization(
  id: string,
  organizationId: string,
): Promise<DocumentJobRow> {
  const { data, error } = await supabaseAdmin
    .from("document_jobs")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new AppError(500, "INTERNAL_ERROR", error.message);
  }

  if (!data) {
    throw new NotFoundError("Document job not found.");
  }

  return data;
}

/**
 * Same lookup, but deliberately does NOT exclude soft-deleted jobs — used
 * only by the file-lifecycle service functions (`removeDocumentFile`,
 * `deleteDocument`), which need to find and act on a job regardless of
 * whether it's already been soft-deleted, so a repeated delete call stays
 * idempotent rather than 404ing on the second attempt.
 */
export async function getDocumentJobForOrganizationIncludingDeleted(
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
    .is("deleted_at", null)
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

/**
 * Full chronological history for one job, oldest first — not just the
 * latest value per field. `documents.service.ts` derives "current
 * effective value per field" from this by taking the last row per
 * `field_name`; the ordering here is what makes that reduction correct.
 */
export async function listFieldCorrections(jobId: string): Promise<FieldCorrectionRow[]> {
  const { data, error } = await supabaseAdmin
    .from("document_field_corrections")
    .select("*")
    .eq("document_job_id", jobId)
    .order("edited_at", { ascending: true });

  if (error) {
    console.error("[documents.repository] listFieldCorrections failed", { jobId, error });
    throw new AppError(500, "INTERNAL_ERROR", error.message);
  }

  return data ?? [];
}

/**
 * Bulk insert — a single save-corrections request can touch several fields
 * at once, and each is its own audit-log row. Trusts the caller to have
 * already filtered out no-op edits (a value "corrected" to what it already
 * was); this is a thin persistence layer, not where that decision belongs.
 */
export async function insertFieldCorrections(rows: FieldCorrectionInsert[]): Promise<FieldCorrectionRow[]> {
  const { data, error } = await supabaseAdmin.from("document_field_corrections").insert(rows).select("*");

  if (error || !data) {
    console.error("[documents.repository] insertFieldCorrections failed", { rows, error });
    throw new AppError(500, "INTERNAL_ERROR", error?.message ?? "Failed to save field corrections.");
  }

  return data;
}
