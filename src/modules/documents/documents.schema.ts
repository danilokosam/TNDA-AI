import { z } from "zod";
import { DOCUMENT_TYPES } from "@/modules/documents/documents.strategy";

export const uploadDocumentSchema = z.object({
  file: z.instanceof(File),
  // Defaults to "invoice" to preserve pre-refactor behavior (the app
  // previously always used a single globally-configured Azure model,
  // which was "prebuilt-invoice"). For a .zip batch, the requested type
  // applies to every file in the archive — there's no per-file type yet.
  documentType: z.enum(DOCUMENT_TYPES).default("invoice"),
});
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

export const jobIdParamSchema = z.object({
  id: z.string().uuid("Job id must be a valid UUID."),
});
