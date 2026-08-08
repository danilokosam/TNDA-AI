import { supabaseAdmin } from "@/config/supabase";
import { AppError, NotFoundError } from "@/utils/errors";
import type { Database, DocumentJobStatus, DocumentType } from "@/config/database.types";

export type DocumentJobRow = Database["public"]["Tables"]["document_jobs"]["Row"];
export type DocumentJobInsert = Database["public"]["Tables"]["document_jobs"]["Insert"];
export type DocumentJobUpdate = Database["public"]["Tables"]["document_jobs"]["Update"];

export type FieldCorrectionRow = Database["public"]["Tables"]["document_field_corrections"]["Row"];
export type FieldCorrectionInsert = Database["public"]["Tables"]["document_field_corrections"]["Insert"];

export type DocumentJobEventRow = Database["public"]["Tables"]["document_job_events"]["Row"];
export type DocumentJobEventInsert = Database["public"]["Tables"]["document_job_events"]["Insert"];

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

/**
 * Appends one row to the lifecycle event log. Callers (documents.service.ts)
 * are responsible for only ever calling this after the corresponding state
 * transition has already been committed — this function itself has no
 * opinion on ordering or atomicity, it just persists a row. See
 * docs/adr/0011-lifecycle-event-log-and-retry-state.md for the consistency
 * model this is part of.
 */
export async function insertDocumentJobEvent(input: DocumentJobEventInsert): Promise<DocumentJobEventRow> {
  const { data, error } = await supabaseAdmin.from("document_job_events").insert(input).select("*").single();

  if (error || !data) {
    console.error("[documents.repository] insertDocumentJobEvent failed", { input, error });
    throw new AppError(500, "INTERNAL_ERROR", error?.message ?? "Failed to record document job event.");
  }

  return data;
}

/**
 * Full chronological history for one job, oldest first — mirrors
 * listFieldCorrections' ordering convention. Not exposed via any route in
 * Wave 2 (no product need yet); exists as an internal read primitive,
 * mainly so this table's ordering/scoping can actually be tested.
 */
export async function listDocumentJobEvents(jobId: string): Promise<DocumentJobEventRow[]> {
  const { data, error } = await supabaseAdmin
    .from("document_job_events")
    .select("*")
    .eq("document_job_id", jobId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[documents.repository] listDocumentJobEvents failed", { jobId, error });
    throw new AppError(500, "INTERNAL_ERROR", error.message);
  }

  return data ?? [];
}

export interface ClaimDocumentJobParams {
  /**
   * Identifies one claim SLOT, not a worker process — the RPC's
   * renew-vs-claim-new decision is purely "does a row already have
   * claimed_by = workerId." A worker holding more than one job at once
   * (WORKER_CONCURRENCY > 1) must call this with a distinct id per
   * concurrently-held job, never one shared id for the whole process —
   * see the migration's own column comment.
   */
  workerId: string;
  leaseSeconds: number;
  maxRetries: number;
}

/**
 * Wraps the `claim_or_renew_document_job` RPC (Wave 3 Phase 1) — atomically
 * claims the next available job, or renews the caller's existing claim if
 * it already holds one. Returns `null` when nothing is available to claim
 * right now, which is an entirely normal, expected outcome (an empty
 * queue), not an error. No document_job_id/organization scoping here by
 * design: a worker claims across every organization, the same way every
 * other cross-tenant operational concern in this backend (migrations,
 * aggregation functions) already does — the RPC itself is grant-restricted
 * to the service-role caller only, never exposed to `authenticated` (see
 * the migration's own comment and docs/adr/0012).
 */
export async function claimOrRenewDocumentJob(
  params: ClaimDocumentJobParams,
): Promise<DocumentJobRow | null> {
  const { data, error } = await supabaseAdmin.rpc("claim_or_renew_document_job", {
    p_worker_id: params.workerId,
    p_lease_seconds: params.leaseSeconds,
    p_max_retries: params.maxRetries,
  });

  if (error) {
    console.error("[documents.repository] claimOrRenewDocumentJob failed", { params, error });
    throw new AppError(500, "INTERNAL_ERROR", error.message);
  }

  return data ?? null;
}
