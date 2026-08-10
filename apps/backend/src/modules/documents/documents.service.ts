import { env } from "@/config/env";
import { inspectDocumentFile, type InspectedFile, type SupportedDocumentMimeType } from "@/utils/file-inspector";
import { extractZipEntries } from "@/utils/zip";
import { computeAverageConfidence } from "@/utils/confidence";
import { AppError, AzureServiceError, ConflictError, ForbiddenError, PayloadTooLargeError, QuotaExceededError, ValidationError } from "@/utils/errors";
import { getAnalysisOperationStatus } from "@/services/azure-document-intelligence.service";
import {
  buildStoragePath,
  createSignedPreviewUrl,
  deleteDocumentFile,
  downloadDocumentFile,
  uploadDocumentFile,
} from "@/services/storage.service";
import { getProcessingStrategy, type DocumentType } from "@/modules/documents/documents.strategy";
import { buildExportRecord, type ExportRecord } from "@/modules/documents/documents.export.mapper";
import { getExportSerializer } from "@/modules/documents/documents.export.serializer";
import type { ExportDocumentsQuery } from "@/modules/documents/documents.schema";
import { getEffectivePlan } from "@/modules/organization/organization.service";
import { getDocumentsSubmittedSince, getMonthlyPagesUsed, type PlanRow } from "@/modules/organization/organization.repository";
import type { DocumentJobEventType, ProfileRole } from "@/config/database.types";
import {
  createDocumentJob,
  getDocumentJobForOrganization,
  getDocumentJobForOrganizationIncludingDeleted,
  insertDocumentJobEvent,
  insertFieldCorrections,
  listDocumentJobsForOrganization,
  listFieldCorrections,
  updateDocumentJob,
  updateDocumentJobIfEpochMatches,
  type DocumentJobRow,
  type FieldCorrectionInsert,
  type FieldCorrectionRow,
  type ListDocumentJobsFilters,
  type ListDocumentJobsResult,
} from "@/modules/documents/documents.repository";

const ZIP_SIGNATURES: readonly number[][] = [
  [0x50, 0x4b, 0x03, 0x04], // standard
  [0x50, 0x4b, 0x05, 0x06], // empty archive
  [0x50, 0x4b, 0x07, 0x08], // spanned archive
];

function isZipFile(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURES.some((signature) => signature.every((byte, index) => bytes[index] === byte));
}

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}

/**
 * Records one row in the append-only lifecycle event log. Every call site
 * below only ever calls this *after* the corresponding state-transition
 * write has already succeeded — this function has no opinion on ordering,
 * it just persists a row. A failure here is caught and logged, never
 * allowed to fail the underlying user-facing operation or be mistaken for
 * the transition itself having failed: the same non-fatal tier as
 * persistOriginalFile's storage write. See
 * docs/adr/0011-lifecycle-event-log-and-retry-state.md for the full
 * consistency model and its accepted crash-window limitation.
 */
async function recordLifecycleEvent(
  jobId: string,
  eventType: DocumentJobEventType,
  actorUserId: string | null,
  fromStatus: string | null,
  toStatus: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await insertDocumentJobEvent({
      document_job_id: jobId,
      event_type: eventType,
      actor_user_id: actorUserId,
      from_status: fromStatus,
      to_status: toStatus,
      metadata,
    });
  } catch (error) {
    console.error("[documents.service] failed to record lifecycle event", { jobId, eventType, error });
  }
}

/**
 * Classifies a submission-time failure as retryable (transient — Azure
 * unreachable, timed out, returned a 5xx, or rate-limited us with a 429)
 * or not (Azure explicitly rejected the request with some other 4xx —
 * retrying the identical request would fail the same way). Local
 * validation failures (corrupt file, wrong format, quota) never reach
 * this point: inspectDocumentFile and assertFileMeetsPlanConstraints
 * already run, and are handled, before a job is ever submitted to Azure.
 *
 * 429 is deliberately carved out of the blanket 4xx-is-terminal rule
 * (Wave 3 Phase 2, revisiting the classification Wave 2 shipped with) —
 * by the time this is even reached, beginDocumentAnalysis's own
 * fetchWithRetry has already exhausted its intra-request 429 retries, so
 * a 429 that still surfaces here reflects sustained rate-limiting, the
 * textbook retryable case, not "Azure rejected this request." See
 * docs/adr/0013-wave-3-phase-2-processing-worker.md.
 */
function isRetryableSubmissionFailure(error: unknown): boolean {
  if (error instanceof AzureServiceError) {
    const status = error.details?.status;
    if (typeof status === "number") {
      if (status === 429) return true;
      if (status >= 400 && status < 500) return false;
    }
  }
  return true;
}

/**
 * Reads back the Retry-After value (in seconds) that beginDocumentAnalysis
 * captured on a 429, if any. `undefined` for every other failure shape —
 * callers fall back to the exponential+jitter formula in that case.
 */
function extractRetryAfterSeconds(error: unknown): number | undefined {
  if (error instanceof AzureServiceError) {
    const value = error.details?.retryAfterSeconds;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return undefined;
}

// Wave 3 Phase 2 approved defaults (docs/adr/0013). Policy constants, not
// deployment knobs — the same category of value as this module's sibling
// azure-document-intelligence.service.ts's own MAX_RETRIES/BASE_DELAY_MS,
// which are plain constants for the identical reason.
const RETRY_BASE_DELAY_MS = 30_000;
const RETRY_BACKOFF_MULTIPLIER = 2;
const RETRY_JITTER_MAX_MS = 10_000;
const RETRY_MAX_DELAY_MS = 600_000;

/**
 * How long until a retryable failure's next attempt becomes eligible
 * (feeds `document_jobs.next_attempt_at`). Azure's own `Retry-After`, when
 * available, is used verbatim instead of the exponential formula — Azure
 * knows its own rate-limit window better than a generic backoff guess
 * does. `retryCount` is the job's *current* value (before this failure is
 * persisted) — attempt 1's failure uses retryCount=0 (30s base), attempt
 * 2's uses retryCount=1 (60s), and so on, doubling per Wave 2's approved
 * multiplier. Both branches are capped at the same maximum.
 */
export function computeNextAttemptDelayMs(retryCount: number, retryAfterSeconds?: number): number {
  if (typeof retryAfterSeconds === "number") {
    return Math.min(retryAfterSeconds * 1000, RETRY_MAX_DELAY_MS);
  }

  const exponential = RETRY_BASE_DELAY_MS * RETRY_BACKOFF_MULTIPLIER ** retryCount;
  const jitter = Math.random() * RETRY_JITTER_MAX_MS;
  return Math.min(exponential + jitter, RETRY_MAX_DELAY_MS);
}

/**
 * Whether a job has used up its entire retry budget. Deliberately mirrors
 * the exact condition the claim RPC's own eligibility clause enforces
 * (`retry_count < p_max_retries`) — `retryCount` here must be the value
 * already on the claimed row (before this failure), never a value this
 * function increments itself; the RPC is the only place retry_count is
 * ever incremented, at the *next* claim, not at failure time. Getting
 * this out of sync with the RPC's own check would either let a job be
 * marked exhausted one attempt too early, or leave `is_retryable: true`
 * on a row the RPC will in fact never reclaim again.
 */
export function isRetryExhausted(retryCount: number, maxRetries: number): boolean {
  return retryCount >= maxRetries;
}

/** Hard, per-file constraints that never depend on how much of the plan's quota is already used. */
function assertFileMeetsPlanConstraints(fileName: string, inspected: InspectedFile, plan: PlanRow): void {
  const maxFileSizeBytes = plan.max_file_size_mb * 1024 * 1024;
  if (inspected.sizeBytes > maxFileSizeBytes) {
    throw new PayloadTooLargeError(
      `"${fileName}" is ${formatMb(inspected.sizeBytes)}MB, which exceeds the ${plan.max_file_size_mb}MB file size limit for the ${plan.name} plan.`,
      { fileName, maxFileSizeMb: plan.max_file_size_mb },
    );
  }

  if (inspected.pageCount > plan.max_pages_per_document) {
    throw new QuotaExceededError(
      `"${fileName}" has ${inspected.pageCount} pages, which exceeds the ${plan.max_pages_per_document}-page-per-document limit for the ${plan.name} plan.`,
      { fileName, maxPagesPerDocument: plan.max_pages_per_document },
    );
  }
}

interface QuotaState {
  pagesUsed: number;
  documentsUsed: number;
}

type QuotaCheckResult = { ok: true } | { ok: false; reason: string };

/** Rolling monthly quota check; `quota` is mutated by the caller as files within a batch get accepted. */
function checkMonthlyQuota(plan: PlanRow, quota: QuotaState, pageCount: number): QuotaCheckResult {
  if (quota.documentsUsed + 1 > plan.max_documents_per_month) {
    return {
      ok: false,
      reason: `Monthly document limit of ${plan.max_documents_per_month} reached for the ${plan.name} plan.`,
    };
  }

  if (quota.pagesUsed + pageCount > plan.max_pages_per_month) {
    return {
      ok: false,
      reason: `Processing this file would exceed the monthly page limit of ${plan.max_pages_per_month} pages for the ${plan.name} plan.`,
    };
  }

  return { ok: true };
}

/**
 * Persists the original file to Storage and records its path on the job.
 * Deliberately non-fatal: a storage hiccup shouldn't block the user from
 * getting their extracted data — `storage_path` just stays `null`, and the
 * preview UI already has an honest "unavailable" state for exactly that.
 * Never called for a `rejected_quota` job — nothing worth storing for a
 * submission that never proceeds.
 */
async function persistOriginalFile(
  jobId: string,
  organizationId: string,
  fileName: string,
  bytes: Uint8Array,
  mimeType: SupportedDocumentMimeType,
): Promise<void> {
  try {
    const storagePath = buildStoragePath(organizationId, jobId, fileName);
    await uploadDocumentFile(storagePath, bytes, mimeType);
    await updateDocumentJob(jobId, { storage_path: storagePath });
  } catch (error) {
    console.error("[documents.service] failed to persist original file to storage", { jobId, error });
  }
}

/**
 * Wave 3 Phase 2 — the worker's entry point for a freshly claimed (or
 * retry-reclaimed) `pending` job. Precondition, enforced by the caller,
 * not re-checked here: `job.status === "pending"`. Every write is
 * epoch-gated against `job.lease_epoch` — the value captured at claim
 * time — so a worker that has silently lost its lease to a reclaim
 * writes nothing and returns `null` instead of corrupting the new
 * holder's state (docs/adr/0013). A `null` return means exactly that:
 * the caller must stop touching this job entirely, not retry the write
 * or treat it as a normal failure.
 *
 * This is now the ONLY path that submits to Azure — Step 7 removed the
 * upload request's old synchronous submission call entirely, so this
 * function runs in a separate process from the original upload request
 * and has no in-memory bytes to work with — it re-downloads the original
 * file from Storage (Option 1 of the two considered; see the ADR for why
 * raw bytes were kept over switching to Azure's `urlSource` submission
 * style).
 */
export async function submitClaimedJobForProcessing(
  job: DocumentJobRow,
  workerId: string,
  maxRetries: number,
): Promise<DocumentJobRow | null> {
  if (job.retry_count > 0) {
    await recordLifecycleEvent(job.id, "processing_retried", null, "failed", "pending", {
      retryNumber: job.retry_count,
    });
  }

  // No storage_path means there is no bytes source this or any future
  // attempt could ever use — not because Storage upload is fatal at
  // upload time (it stays deliberately non-fatal there, unchanged), but
  // because nothing repopulates a file that was never persisted, or was
  // independently removed while this job sat in the claim queue. Always
  // terminal, never retryable: a later attempt would fail identically.
  if (!job.storage_path) {
    const message = "The original file was not persisted to storage and cannot be submitted for processing.";
    const updated = await updateDocumentJobIfEpochMatches(job.id, job.lease_epoch, {
      status: "failed",
      error_message: message,
      is_retryable: false,
      next_attempt_at: null,
      claimed_by: null,
      claimed_at: null,
      lease_expires_at: null,
    });
    if (!updated) return null;

    await recordLifecycleEvent(job.id, "processing_failed", null, "pending", "failed", {
      errorMessage: message,
      isRetryable: false,
      reason: "missing_storage_file",
    });
    return updated;
  }

  try {
    // A storage-download failure is not an AzureServiceError, so
    // isRetryableSubmissionFailure's default branch already treats it as
    // retryable below — a transient Storage hiccup is worth another
    // attempt later, unlike a permanently-missing file (handled above).
    const bytes = await downloadDocumentFile(job.storage_path);
    const inspected = await inspectDocumentFile(job.file_name, bytes);

    const strategy = getProcessingStrategy(job.document_type);
    const { operationReference } = await strategy.submit(bytes, inspected.mimeType);

    const updated = await updateDocumentJobIfEpochMatches(job.id, job.lease_epoch, {
      status: "processing",
      azure_operation_id: operationReference,
    });
    if (!updated) return null;

    await recordLifecycleEvent(job.id, "processing_started", null, "pending", "processing", {
      retryNumber: job.retry_count,
    });
    return updated;
  } catch (error) {
    console.error("[documents.service] submitClaimedJobForProcessing failed", { jobId: job.id, workerId, error });

    // Exhaustion is computed from the retry_count already on this claimed
    // row (before this failure — the RPC only increments it at the next
    // claim), never from a value this function derives itself. This must
    // stay exactly in sync with the claim RPC's own `retry_count <
    // p_max_retries` eligibility check, or a job could be marked
    // retryable here while the RPC would never actually reclaim it (or
    // vice versa) — see docs/adr/0013's consistency-review note.
    const exhausted = isRetryExhausted(job.retry_count, maxRetries);
    const isRetryable = exhausted ? false : isRetryableSubmissionFailure(error);
    const failureMessage = errorMessage(error, "Failed to submit document for analysis.");
    const nextAttemptAt = isRetryable
      ? new Date(Date.now() + computeNextAttemptDelayMs(job.retry_count, extractRetryAfterSeconds(error))).toISOString()
      : null;

    const updated = await updateDocumentJobIfEpochMatches(job.id, job.lease_epoch, {
      status: "failed",
      error_message: failureMessage,
      is_retryable: isRetryable,
      next_attempt_at: nextAttemptAt,
      claimed_by: null,
      claimed_at: null,
      lease_expires_at: null,
    });
    if (!updated) return null;

    await recordLifecycleEvent(job.id, "processing_failed", null, "pending", "failed", {
      errorMessage: failureMessage,
      isRetryable,
      ...(exhausted ? { exhausted: true } : {}),
    });
    return updated;
  }
}

/**
 * Wave 3 Phase 2 — one poll attempt against a claimed, already-submitted
 * (`processing`) job, called repeatedly by the worker's own loop while it
 * holds the claim. Deliberately mirrors `getJobStatus`'s existing
 * one-shot-check shape exactly (a non-terminal Azure status writes
 * nothing and returns the job unchanged) — the worker plays the role a
 * polling HTTP client used to play, not a new mechanism. Every write is
 * epoch-gated and releases the claim, for the same reasons documented on
 * `submitClaimedJobForProcessing` above; a `null` return means the same
 * thing here too.
 */
export async function checkClaimedJobProgress(job: DocumentJobRow): Promise<DocumentJobRow | null> {
  const azureStatus = await getAnalysisOperationStatus(job.azure_operation_id!);

  if (azureStatus.status === "succeeded") {
    const resultJson = azureStatus.analyzeResult ?? null;
    const updated = await updateDocumentJobIfEpochMatches(job.id, job.lease_epoch, {
      status: "completed",
      result_json: resultJson,
      average_confidence: computeAverageConfidence(resultJson),
      claimed_by: null,
      claimed_at: null,
      lease_expires_at: null,
    });
    if (!updated) return null;

    await recordLifecycleEvent(job.id, "processing_completed", null, "processing", "completed");
    return updated;
  }

  if (azureStatus.status === "failed") {
    const failureMessage = azureStatus.error?.message ?? "Azure Document Intelligence analysis failed.";
    // Azure fully processed this request and reported the failure itself
    // — a content-level failure, always terminal, exactly the same rule
    // getJobStatus already applies today.
    const updated = await updateDocumentJobIfEpochMatches(job.id, job.lease_epoch, {
      status: "failed",
      error_message: failureMessage,
      is_retryable: false,
      claimed_by: null,
      claimed_at: null,
      lease_expires_at: null,
    });
    if (!updated) return null;

    await recordLifecycleEvent(job.id, "processing_failed", null, "processing", "failed", {
      errorMessage: failureMessage,
      isRetryable: false,
    });
    return updated;
  }

  return job;
}

export async function processSingleDocument(
  organizationId: string,
  userId: string,
  fileName: string,
  bytes: Uint8Array,
  documentType: DocumentType,
): Promise<DocumentJobRow> {
  const inspected = await inspectDocumentFile(fileName, bytes);
  const { plan, periodStart } = await getEffectivePlan(organizationId);

  assertFileMeetsPlanConstraints(fileName, inspected, plan);

  const [pagesUsed, documentsUsed] = await Promise.all([
    getMonthlyPagesUsed(organizationId),
    getDocumentsSubmittedSince(organizationId, periodStart),
  ]);

  const quotaCheck = checkMonthlyQuota(plan, { pagesUsed, documentsUsed }, inspected.pageCount);

  if (!quotaCheck.ok) {
    const rejectedJob = await createDocumentJob({
      organization_id: organizationId,
      user_id: userId,
      file_name: fileName,
      file_size_bytes: inspected.sizeBytes,
      page_count: inspected.pageCount,
      status: "rejected_quota",
      document_type: documentType,
      error_message: quotaCheck.reason,
    });
    await recordLifecycleEvent(rejectedJob.id, "job_created", userId, null, "rejected_quota", {
      fileName,
      documentType,
    });
    throw new QuotaExceededError(quotaCheck.reason);
  }

  const job = await createDocumentJob({
    organization_id: organizationId,
    user_id: userId,
    file_name: fileName,
    file_size_bytes: inspected.sizeBytes,
    page_count: inspected.pageCount,
    status: "pending",
    document_type: documentType,
  });
  await recordLifecycleEvent(job.id, "job_created", userId, null, "pending", { fileName, documentType });

  await persistOriginalFile(job.id, organizationId, fileName, bytes, inspected.mimeType);

  // Wave 3 Phase 2, Step 7 — no synchronous Azure submission here anymore.
  // The job is returned as `pending`; the worker (src/worker/) claims and
  // submits it asynchronously. See docs/adr/0013.
  return job;
}

export interface BatchFileResult {
  fileName: string;
  status: "processing" | "rejected" | "rejected_quota" | "failed";
  jobId?: string;
  reason?: string;
}

export interface BatchResult {
  totalFiles: number;
  accepted: number;
  rejected: number;
  files: BatchFileResult[];
}

export async function processZipBatch(
  organizationId: string,
  userId: string,
  zipBytes: Uint8Array,
  documentType: DocumentType,
): Promise<BatchResult> {
  const entries = extractZipEntries(zipBytes);

  if (entries.length === 0) {
    throw new ValidationError("The archive does not contain any files.");
  }

  const { plan, periodStart } = await getEffectivePlan(organizationId);
  const [pagesUsed, documentsUsed] = await Promise.all([
    getMonthlyPagesUsed(organizationId),
    getDocumentsSubmittedSince(organizationId, periodStart),
  ]);

  // Mutated as files are accepted, so later files in the same archive are
  // checked against quota that already accounts for earlier ones in it.
  const quota: QuotaState = { pagesUsed, documentsUsed };
  const results: BatchFileResult[] = [];

  for (const entry of entries) {
    let inspected: InspectedFile;
    try {
      inspected = await inspectDocumentFile(entry.fileName, entry.bytes);
    } catch (error) {
      results.push({
        fileName: entry.fileName,
        status: "rejected",
        reason: errorMessage(error, "Unsupported or corrupt file."),
      });
      continue;
    }

    try {
      assertFileMeetsPlanConstraints(entry.fileName, inspected, plan);
    } catch (error) {
      results.push({
        fileName: entry.fileName,
        status: "rejected",
        reason: errorMessage(error, "File does not meet plan constraints."),
      });
      continue;
    }

    const quotaCheck = checkMonthlyQuota(plan, quota, inspected.pageCount);
    if (!quotaCheck.ok) {
      const job = await createDocumentJob({
        organization_id: organizationId,
        user_id: userId,
        file_name: entry.fileName,
        file_size_bytes: inspected.sizeBytes,
        page_count: inspected.pageCount,
        status: "rejected_quota",
        document_type: documentType,
        error_message: quotaCheck.reason,
      });
      await recordLifecycleEvent(job.id, "job_created", userId, null, "rejected_quota", {
        fileName: entry.fileName,
        documentType,
      });
      results.push({
        fileName: entry.fileName,
        status: "rejected_quota",
        jobId: job.id,
        reason: quotaCheck.reason,
      });
      continue;
    }

    const job = await createDocumentJob({
      organization_id: organizationId,
      user_id: userId,
      file_name: entry.fileName,
      file_size_bytes: inspected.sizeBytes,
      page_count: inspected.pageCount,
      status: "pending",
      document_type: documentType,
    });
    await recordLifecycleEvent(job.id, "job_created", userId, null, "pending", {
      fileName: entry.fileName,
      documentType,
    });

    await persistOriginalFile(job.id, organizationId, entry.fileName, entry.bytes, inspected.mimeType);

    quota.pagesUsed += inspected.pageCount;
    quota.documentsUsed += 1;
    // "processing" here describes this file's outcome in the batch
    // response — accepted into the pipeline — not the job's literal DB
    // status, which stays `pending` until the worker picks it up (Wave 3
    // Phase 2, Step 7; locked decision #3). No response-schema change:
    // BatchFileResult's status values are unchanged.
    results.push({ fileName: entry.fileName, status: "processing", jobId: job.id });
  }

  const accepted = results.filter((result) => result.status === "processing").length;

  return { totalFiles: entries.length, accepted, rejected: entries.length - accepted, files: results };
}

export type UploadResult =
  | { kind: "single"; job: DocumentJobRow }
  | { kind: "batch"; batch: BatchResult };

export async function submitUpload(
  organizationId: string,
  userId: string,
  file: File,
  documentType: DocumentType,
): Promise<UploadResult> {
  const maxUploadBytes = env.MAX_UPLOAD_SIZE_MB * 1024 * 1024;
  if (file.size > maxUploadBytes) {
    throw new PayloadTooLargeError(
      `Upload exceeds the maximum allowed size of ${env.MAX_UPLOAD_SIZE_MB}MB.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (isZipFile(bytes)) {
    return { kind: "batch", batch: await processZipBatch(organizationId, userId, bytes, documentType) };
  }

  return {
    kind: "single",
    job: await processSingleDocument(organizationId, userId, file.name, bytes, documentType),
  };
}

/**
 * Wave 3 Phase 2, Step 7 — a pure database read. Live Azure polling and
 * all Azure-related writes moved to the worker's own
 * `checkClaimedJobProgress`, which is now the sole owner of processing and
 * polling (docs/adr/0013; locked decision #9). This function no longer has
 * any opinion on the job's status — pending, processing, or terminal, it
 * just returns whatever the database currently has.
 */
export async function getJobStatus(organizationId: string, jobId: string): Promise<DocumentJobRow> {
  return getDocumentJobForOrganization(jobId, organizationId);
}

/**
 * `null` when the job has no persisted file (storage upload failed, or the
 * job predates persistence) — the caller (the route) turns that into
 * `{url: null}`, not a 404, since "no preview" is a legitimate, expected
 * state, not an error. A fresh signed URL is generated per call rather
 * than cached anywhere; see `storage.service.ts#createSignedPreviewUrl`
 * for the expiry.
 */
export async function getDocumentPreviewUrl(organizationId: string, jobId: string): Promise<string | null> {
  const job = await getDocumentJobForOrganization(jobId, organizationId);

  if (!job.storage_path) {
    return null;
  }

  return createSignedPreviewUrl(job.storage_path);
}

export async function listDocuments(
  organizationId: string,
  filters: ListDocumentJobsFilters,
): Promise<ListDocumentJobsResult> {
  return listDocumentJobsForOrganization(organizationId, filters);
}

// Policy constant, not a deployment knob — same category as this file's
// RETRY_* constants above. Keeps export synchronous and bounded: even the
// Pro plan's 1000-documents/month ceiling means this comfortably covers
// several years of a single org's completed-document history. If real
// usage ever proves this too small, that's the trigger to build an async
// export job — not a reason to raise this number indefinitely (see
// docs/adr/0014-document-csv-export.md).
const EXPORT_MAX_ROWS = 5000;

export interface ExportDocumentsResult {
  content: string;
  contentType: string;
  fileName: string;
}

/**
 * Filter-scoped export (Phase 1: CSV only). Always restricted to
 * `completed` jobs — an export represents validated, available data, never
 * a placeholder for something still processing or one that failed
 * (`ExportDocumentsQuery` has no `status` field at all, so there's no way
 * for a caller to override this). Reuses `reduceToEffectiveFields` — the
 * exact same effective-field reduction `getFieldCorrections` uses for the
 * review UI — so an export always reflects whatever a reviewer currently
 * sees, never Azure's raw, uncorrected output. Synchronous and bounded by
 * EXPORT_MAX_ROWS: throws PayloadTooLargeError rather than silently
 * truncating when a filter set resolves to more rows than that ceiling.
 */
export async function exportDocuments(
  organizationId: string,
  query: ExportDocumentsQuery,
): Promise<ExportDocumentsResult> {
  const serializer = getExportSerializer(query.format);

  const result = await listDocumentJobsForOrganization(organizationId, {
    status: "completed",
    documentType: query.documentType,
    search: query.search,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    limit: EXPORT_MAX_ROWS,
  });

  if (result.nextCursor !== null) {
    throw new PayloadTooLargeError(
      `This export matches more than ${EXPORT_MAX_ROWS} documents. Narrow your filters (date range, document type, or search) and try again.`,
      { maxRows: EXPORT_MAX_ROWS },
    );
  }

  const records: ExportRecord[] = await Promise.all(
    result.jobs.map(async (job) => {
      const history = await listFieldCorrections(job.id);
      const effective = reduceToEffectiveFields(history);
      return buildExportRecord(job, effective);
    }),
  );

  const content = serializer.serialize(records);
  const fileName = `documents-export-${new Date().toISOString().slice(0, 10)}.${serializer.fileExtension}`;

  return { content, contentType: serializer.contentType, fileName };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Azure's original value for one named field, read directly from
 * `result_json`. Mirrors the lookup half of the frontend's
 * `extract-fields.ts#extractDisplayValue` (kept in sync by hand — see that
 * file; duplicating this ~10-line lookup was judged cheaper than wiring up
 * the still-unpopulated `@tnda-ai/shared` package for one function), but
 * returns `null` rather than a "—" display placeholder where there's
 * nothing to show: this feeds `document_field_corrections.previous_value`,
 * an audit column, not UI text. Needed only to seed a field's *first-ever*
 * correction; every correction after that reads its prior value from
 * `document_field_corrections` itself (see `reduceToEffectiveFields`).
 * Like `extractDocumentFields`, assumes field names are unique enough to
 * key by — the first match across `documents[]` wins.
 */
function extractOriginalFieldValue(resultJson: Record<string, unknown> | null, fieldName: string): string | null {
  if (!resultJson) return null;
  const documents = resultJson.documents;
  if (!Array.isArray(documents)) return null;

  for (const doc of documents) {
    if (!isRecord(doc) || !isRecord(doc.fields)) continue;
    const field = doc.fields[fieldName];
    if (!isRecord(field)) continue;
    if (typeof field.content === "string" && field.content.length > 0) return field.content;
    if (typeof field.value === "string" || typeof field.value === "number") return String(field.value);
    return null;
  }

  return null;
}

/**
 * Reduces a job's full, chronologically-ordered correction history
 * (`listFieldCorrections` returns oldest-first) down to the latest value
 * per field — the "effective" value a reviewer currently sees, as opposed
 * to the full audit trail of how it got there.
 */
function reduceToEffectiveFields(history: FieldCorrectionRow[]): Record<string, string> {
  const effective: Record<string, string> = {};
  for (const correction of history) {
    effective[correction.field_name] = correction.new_value;
  }
  return effective;
}

function assertJobIsCompleted(job: DocumentJobRow): void {
  if (job.status !== "completed") {
    throw new ConflictError("This document hasn't finished processing yet, so it can't be reviewed.");
  }
}

/**
 * Compares each submitted correction against the field's current effective
 * value (the latest prior correction, or Azure's original extraction) and
 * stages only the ones that actually change something — a field "corrected"
 * to the value it already effectively has produces no new audit-log row.
 */
async function stageFieldCorrections(
  job: DocumentJobRow,
  userId: string,
  corrections: Record<string, string>,
): Promise<FieldCorrectionInsert[]> {
  const history = await listFieldCorrections(job.id);
  const effective = reduceToEffectiveFields(history);

  const staged: FieldCorrectionInsert[] = [];
  for (const [fieldName, newValue] of Object.entries(corrections)) {
    const previousValue = effective[fieldName] ?? extractOriginalFieldValue(job.result_json, fieldName);
    if (newValue === previousValue) continue;

    staged.push({
      document_job_id: job.id,
      field_name: fieldName,
      previous_value: previousValue,
      new_value: newValue,
      edited_by: userId,
    });
  }

  return staged;
}

export async function getFieldCorrections(
  organizationId: string,
  jobId: string,
): Promise<{ effective: Record<string, string>; history: FieldCorrectionRow[] }> {
  const job = await getDocumentJobForOrganization(jobId, organizationId);
  const history = await listFieldCorrections(job.id);
  return { effective: reduceToEffectiveFields(history), history };
}

/**
 * Saves corrections without deciding confirm/reject. If the job was
 * previously confirmed/rejected, that decision is reset to `unreviewed`
 * first (and only then are the new corrections inserted) — so a partial
 * failure never leaves `review_status` claiming a decision the data no
 * longer backs. See ARCHITECTURE.md / the review-workflow plan for the
 * full reasoning; the short version is: the write that could make a false
 * claim always goes last.
 */
export async function saveFieldCorrections(
  organizationId: string,
  jobId: string,
  userId: string,
  corrections: Record<string, string>,
): Promise<DocumentJobRow> {
  const job = await getDocumentJobForOrganization(jobId, organizationId);
  assertJobIsCompleted(job);

  const staged = await stageFieldCorrections(job, userId, corrections);

  let resultJob = job;
  if (job.review_status !== "unreviewed") {
    resultJob = await updateDocumentJob(job.id, { review_status: "unreviewed", reviewed_by: null, reviewed_at: null });
    await recordLifecycleEvent(job.id, "review_reset", userId, job.review_status, "unreviewed");
  }

  if (staged.length > 0) {
    await insertFieldCorrections(staged);
  }

  return resultJob;
}

/**
 * Shared by `confirmDocumentReview`/`rejectDocumentReview`. Any
 * accompanying corrections are inserted *before* the final review_status
 * write, not after — so if only one step succeeds, it's the corrections
 * (a job left at its old, honest status), never a status that claims a
 * decision over data that didn't actually save.
 */
async function setDocumentReview(
  organizationId: string,
  jobId: string,
  userId: string,
  reviewStatus: "confirmed" | "rejected",
  corrections: Record<string, string> | undefined,
): Promise<DocumentJobRow> {
  const job = await getDocumentJobForOrganization(jobId, organizationId);
  assertJobIsCompleted(job);

  if (corrections && Object.keys(corrections).length > 0) {
    const staged = await stageFieldCorrections(job, userId, corrections);
    if (staged.length > 0) {
      await insertFieldCorrections(staged);
    }
  }

  const updated = await updateDocumentJob(job.id, {
    review_status: reviewStatus,
    reviewed_by: userId,
    reviewed_at: new Date().toISOString(),
  });

  await recordLifecycleEvent(
    job.id,
    reviewStatus === "confirmed" ? "review_confirmed" : "review_rejected",
    userId,
    job.review_status,
    reviewStatus,
  );

  return updated;
}

export function confirmDocumentReview(
  organizationId: string,
  jobId: string,
  userId: string,
  corrections?: Record<string, string>,
): Promise<DocumentJobRow> {
  return setDocumentReview(organizationId, jobId, userId, "confirmed", corrections);
}

export function rejectDocumentReview(
  organizationId: string,
  jobId: string,
  userId: string,
  corrections?: Record<string, string>,
): Promise<DocumentJobRow> {
  return setDocumentReview(organizationId, jobId, userId, "rejected", corrections);
}

/**
 * File/document deletion is restricted to the job's own uploader or an org
 * owner/admin — unlike review actions (edit/confirm/reject), which are
 * open to any org member (§4 of the review-workflow plan): these are
 * destructive, so they get the stricter gate.
 */
function assertCanManageFile(job: DocumentJobRow, userId: string, role: ProfileRole): void {
  const isUploader = job.user_id === userId;
  const isOwnerOrAdmin = role === "owner" || role === "admin";

  if (!isUploader && !isOwnerOrAdmin) {
    throw new ForbiddenError("Only the person who uploaded this document, or an organization owner/admin, can do this.");
  }
}

/**
 * Hard-deletes the original file from Storage, leaves everything else on
 * the job row untouched (result_json, correction history, review status).
 * Idempotent: a job with no `storage_path` is a no-op, not an error. Uses
 * the "including deleted" lookup so this also works, harmlessly, on a job
 * whose document was already deleted (its file is already gone by then
 * anyway — see `deleteDocument`).
 */
export async function removeDocumentFile(
  organizationId: string,
  jobId: string,
  userId: string,
  role: ProfileRole,
): Promise<DocumentJobRow> {
  const job = await getDocumentJobForOrganizationIncludingDeleted(jobId, organizationId);
  assertCanManageFile(job, userId, role);

  if (!job.storage_path) {
    return job;
  }

  await deleteDocumentFile(job.storage_path);
  const updated = await updateDocumentJob(job.id, { storage_path: null });
  await recordLifecycleEvent(job.id, "file_removed", userId, "present", "removed");
  return updated;
}

/**
 * Soft-deletes the job (`deleted_at`) and removes its original file at the
 * same time — leaving orphaned bytes in Storage once a job is hidden from
 * every view serves no purpose. The row and everything on it (result_json,
 * full correction history) is always preserved; "deleted" means hidden,
 * never actually gone. Idempotent: a no-op on a job that's already
 * deleted. Storage deletion is best-effort/non-fatal here (same tier of
 * caution as the upload-time write in `persistOriginalFile`) — a Storage
 * hiccup shouldn't block the primary, user-facing effect of the document
 * disappearing from view.
 */
export async function deleteDocument(
  organizationId: string,
  jobId: string,
  userId: string,
  role: ProfileRole,
): Promise<DocumentJobRow> {
  const job = await getDocumentJobForOrganizationIncludingDeleted(jobId, organizationId);
  assertCanManageFile(job, userId, role);

  if (job.deleted_at) {
    return job;
  }

  if (job.storage_path) {
    try {
      await deleteDocumentFile(job.storage_path);
    } catch (error) {
      console.error("[documents.service] failed to remove the file while deleting the document", {
        jobId: job.id,
        error,
      });
    }
  }

  const updated = await updateDocumentJob(job.id, { storage_path: null, deleted_at: new Date().toISOString() });
  await recordLifecycleEvent(job.id, "document_deleted", userId, "active", "deleted");
  return updated;
}
