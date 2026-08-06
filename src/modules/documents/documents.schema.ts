import { z } from "zod";

export const uploadDocumentSchema = z.object({
  file: z.instanceof(File),
});
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

export const jobIdParamSchema = z.object({
  id: z.string().uuid("Job id must be a valid UUID."),
});
