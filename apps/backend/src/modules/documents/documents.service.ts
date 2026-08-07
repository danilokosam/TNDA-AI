import { env } from "@/config/env";
import { inspectDocumentFile, type InspectedFile, type SupportedDocumentMimeType } from "@/utils/file-inspector";
import { extractZipEntries } from "@/utils/zip";
import { computeAverageConfidence } from "@/utils/confidence";
import { AppError, ConflictError, ForbiddenError, PayloadTooLargeError, QuotaExceededError, ValidationError } from "@/utils/errors";
import { getAnalysisOperationStatus } from "@/services/azure-document-intelligence.service";
import { buildStoragePath, createSignedPreviewUrl, deleteDocumentFile, uploadDocumentFile } from "@/services/storage.service";
import { getProcessingStrategy, type DocumentType } from "@/modules/documents/documents.strategy";
import { getEffectivePlan } from "@/modules/organization/organization.service";
import { getDocumentsSubmittedSince, getMonthlyPagesUsed, type PlanRow } from "@/modules/organization/organization.repository";
import type { ProfileRole } from "@/config/database.types";
import {
  createDocumentJob,
  getDocumentJobForOrganization,
  getDocumentJobForOrganizationIncludingDeleted,
  insertFieldCorrections,
  listDocumentJobsForOrganization,
  listFieldCorrections,
  updateDocumentJob,
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
 * Submits a persisted job's bytes for analysis via whichever processing
 * strategy the requested `documentType` resolves to, and advances its
 * status. On failure the job is marked `failed` (so it's visible via the
 * polling endpoint) and the error is re-thrown for the caller to react to.
 *
 * This function itself has no idea which model or provider actually
 * handles the document — that's entirely the resolved strategy's
 * decision (see `documents.strategy.ts`).
 */
async function submitForAnalysis(
  jobId: string,
  bytes: Uint8Array,
  mimeType: SupportedDocumentMimeType,
  documentType: DocumentType,
): Promise<DocumentJobRow> {
  try {
    const strategy = getProcessingStrategy(documentType);
    const { operationReference } = await strategy.submit(bytes, mimeType);
    return await updateDocumentJob(jobId, { status: "processing", azure_operation_id: operationReference });
  } catch (error) {
    console.error("[documents.service] submitForAnalysis failed", { jobId, documentType, error });
    await updateDocumentJob(jobId, {
      status: "failed",
      error_message: errorMessage(error, "Failed to submit document for analysis."),
    });
    throw error;
  }
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
    await createDocumentJob({
      organization_id: organizationId,
      user_id: userId,
      file_name: fileName,
      file_size_bytes: inspected.sizeBytes,
      page_count: inspected.pageCount,
      status: "rejected_quota",
      document_type: documentType,
      error_message: quotaCheck.reason,
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

  await persistOriginalFile(job.id, organizationId, fileName, bytes, inspected.mimeType);

  return submitForAnalysis(job.id, bytes, inspected.mimeType, documentType);
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

    await persistOriginalFile(job.id, organizationId, entry.fileName, entry.bytes, inspected.mimeType);

    try {
      await submitForAnalysis(job.id, entry.bytes, inspected.mimeType, documentType);
      quota.pagesUsed += inspected.pageCount;
      quota.documentsUsed += 1;
      results.push({ fileName: entry.fileName, status: "processing", jobId: job.id });
    } catch (error) {
      results.push({
        fileName: entry.fileName,
        status: "failed",
        jobId: job.id,
        reason: errorMessage(error, "Document submission failed."),
      });
    }
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
 * Fetches a job's latest known state, polling Azure once for a fresh
 * status if the job is still in flight. Terminal jobs (completed / failed
 * / rejected_quota) are returned straight from the database.
 */
export async function getJobStatus(organizationId: string, jobId: string): Promise<DocumentJobRow> {
  const job = await getDocumentJobForOrganization(jobId, organizationId);

  if (job.status !== "pending" && job.status !== "processing") {
    return job;
  }

  if (!job.azure_operation_id) {
    return job;
  }

  const azureStatus = await getAnalysisOperationStatus(job.azure_operation_id);

  if (azureStatus.status === "succeeded") {
    const resultJson = azureStatus.analyzeResult ?? null;
    return updateDocumentJob(job.id, {
      status: "completed",
      result_json: resultJson,
      average_confidence: computeAverageConfidence(resultJson),
    });
  }

  if (azureStatus.status === "failed") {
    return updateDocumentJob(job.id, {
      status: "failed",
      error_message: azureStatus.error?.message ?? "Azure Document Intelligence analysis failed.",
    });
  }

  return job;
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

  return updateDocumentJob(job.id, {
    review_status: reviewStatus,
    reviewed_by: userId,
    reviewed_at: new Date().toISOString(),
  });
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
  return updateDocumentJob(job.id, { storage_path: null });
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

  return updateDocumentJob(job.id, { storage_path: null, deleted_at: new Date().toISOString() });
}
