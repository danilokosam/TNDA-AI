import { Elysia } from "elysia";
import { authMiddleware } from "@/middlewares/auth.middleware";
import * as documentsService from "@/modules/documents/documents.service";
import type { DocumentJobRow } from "@/modules/documents/documents.repository";
import {
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
    createdAt: job.created_at,
    updatedAt: job.updated_at,
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
  );
