import { env } from "@/config/env";
import { inspectDocumentFile, type InspectedFile, type SupportedDocumentMimeType } from "@/utils/file-inspector";
import { extractZipEntries } from "@/utils/zip";
import { computeAverageConfidence } from "@/utils/confidence";
import { AppError, PayloadTooLargeError, QuotaExceededError, ValidationError } from "@/utils/errors";
import { getAnalysisOperationStatus } from "@/services/azure-document-intelligence.service";
import { getProcessingStrategy, type DocumentType } from "@/modules/documents/documents.strategy";
import { getEffectivePlan } from "@/modules/organization/organization.service";
import { getDocumentsSubmittedSince, getMonthlyPagesUsed, type PlanRow } from "@/modules/organization/organization.repository";
import {
  createDocumentJob,
  getDocumentJobForOrganization,
  updateDocumentJob,
  type DocumentJobRow,
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
