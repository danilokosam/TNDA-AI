import { Elysia } from "elysia";
import { authMiddleware } from "@/middlewares/auth.middleware";
import * as documentsService from "@/modules/documents/documents.service";
import type { DocumentJobRow, FieldCorrectionRow } from "@/modules/documents/documents.repository";
import {
  documentCorrectionsSchema,
  jobIdParamSchema,
  listDocumentsQuerySchema,
  uploadDocumentSchema,
} from "@/modules/documents/documents.schema";

function toJobDto(job: DocumentJobRow) {
  return {
    jobId: job.id,
    status: job.status,
    fileName: job.file_name,
    fileSizeBytes: job.file_size_bytes,
    pageCount: job.page_count,
    documentType: job.document_type,
    averageConfidence: job.average_confidence,
    resultJson: job.result_json,
    errorMessage: job.error_message,
    reviewStatus: job.review_status,
    reviewedBy: job.reviewed_by,
    reviewedAt: job.reviewed_at,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

function toFieldCorrectionDto(row: FieldCorrectionRow) {
  return {
    fieldName: row.field_name,
    previousValue: row.previous_value,
    newValue: row.new_value,
    editedBy: row.edited_by,
    editedAt: row.edited_at,
  };
}

export const documentsRoutes = new Elysia({ prefix: "/api/v1/documents" })
  .use(authMiddleware)
  .post(
    "/",
    async ({ auth, body, set }) => {
      const result = await documentsService.submitUpload(
        auth.organizationId,
        auth.userId,
        body.file,
        body.documentType,
      );
      set.status = 202;

      if (result.kind === "single") {
        return { kind: "single" as const, job: toJobDto(result.job) };
      }

      return { kind: "batch" as const, batch: result.batch };
    },
    { body: uploadDocumentSchema },
  )
  .get(
    "/",
    async ({ auth, query }) => {
      const result = await documentsService.listDocuments(auth.organizationId, query);
      return {
        data: result.jobs.map(toJobDto),
        pagination: {
          nextCursor: result.nextCursor,
          hasMore: result.nextCursor !== null,
        },
      };
    },
    { query: listDocumentsQuerySchema },
  )
  .get(
    "/jobs/:id",
    async ({ auth, params }) => {
      const job = await documentsService.getJobStatus(auth.organizationId, params.id);
      return toJobDto(job);
    },
    { params: jobIdParamSchema },
  )
  .get(
    "/jobs/:id/preview-url",
    async ({ auth, params }) => {
      const url = await documentsService.getDocumentPreviewUrl(auth.organizationId, params.id);
      return { url };
    },
    { params: jobIdParamSchema },
  )
  .get(
    "/jobs/:id/corrections",
    async ({ auth, params }) => {
      const { effective, history } = await documentsService.getFieldCorrections(auth.organizationId, params.id);
      return { effective, history: history.map(toFieldCorrectionDto) };
    },
    { params: jobIdParamSchema },
  )
  .patch(
    "/jobs/:id/corrections",
    async ({ auth, params, body }) => {
      const job = await documentsService.saveFieldCorrections(
        auth.organizationId,
        params.id,
        auth.userId,
        body.corrections,
      );
      return toJobDto(job);
    },
    { params: jobIdParamSchema, body: documentCorrectionsSchema },
  )
  .post(
    "/jobs/:id/confirm",
    async ({ auth, params, body }) => {
      const job = await documentsService.confirmDocumentReview(
        auth.organizationId,
        params.id,
        auth.userId,
        body.corrections,
      );
      return toJobDto(job);
    },
    { params: jobIdParamSchema, body: documentCorrectionsSchema },
  )
  .post(
    "/jobs/:id/reject",
    async ({ auth, params, body }) => {
      const job = await documentsService.rejectDocumentReview(
        auth.organizationId,
        params.id,
        auth.userId,
        body.corrections,
      );
      return toJobDto(job);
    },
    { params: jobIdParamSchema, body: documentCorrectionsSchema },
  );
