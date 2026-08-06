import { Elysia } from "elysia";
import { authMiddleware } from "@/middlewares/auth.middleware";
import * as documentsService from "@/modules/documents/documents.service";
import { jobIdParamSchema, uploadDocumentSchema } from "@/modules/documents/documents.schema";

function toJobDto(job: {
  id: string;
  status: string;
  file_name: string;
  file_size_bytes: number;
  page_count: number | null;
  result_json: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    jobId: job.id,
    status: job.status,
    fileName: job.file_name,
    fileSizeBytes: job.file_size_bytes,
    pageCount: job.page_count,
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
      const result = await documentsService.submitUpload(auth.organizationId, auth.userId, body.file);
      set.status = 202;

      if (result.kind === "single") {
        return { kind: "single" as const, job: toJobDto(result.job) };
      }

      return { kind: "batch" as const, batch: result.batch };
    },
    { body: uploadDocumentSchema },
  )
  .get(
    "/jobs/:id",
    async ({ auth, params }) => {
      const job = await documentsService.getJobStatus(auth.organizationId, params.id);
      return toJobDto(job);
    },
    { params: jobIdParamSchema },
  );
