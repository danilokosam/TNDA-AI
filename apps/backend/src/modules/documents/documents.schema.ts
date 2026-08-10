import { z } from "zod";
import { DOCUMENT_TYPES } from "@/modules/documents/documents.strategy";
import { EXPORT_FORMATS } from "@/modules/documents/documents.export.serializer";
import type { DocumentJobStatus } from "@/config/database.types";

/**
 * Mirrors the `document_job_status` Postgres enum (0007_document_jobs.sql).
 * `satisfies` here catches a typo'd/invalid status value at compile time;
 * it doesn't catch a *missing* one (TypeScript can't check tuple-literal
 * completeness against a union), so keep this in sync with the migration
 * by hand.
 */
export const DOCUMENT_JOB_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "rejected_quota",
] as const satisfies readonly DocumentJobStatus[];

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

/**
 * Shared by all three review-mutation endpoints (save corrections,
 * confirm, reject) — the frontend always sends this exact shape, even
 * when there's nothing to correct (`corrections: {}`), so the route
 * handlers never have to treat a missing body as a distinct case from an
 * empty one.
 */
export const documentCorrectionsSchema = z.object({
  corrections: z.record(z.string(), z.string()),
});
export type DocumentCorrectionsInput = z.infer<typeof documentCorrectionsSchema>;

/**
 * Cursor is opaque to callers by design (an encoded `created_at` value) -
 * clients pass back exactly what they were given in `pagination.nextCursor`,
 * never construct one themselves. That's what lets the pagination strategy
 * change later without breaking any client's request shape.
 */
export const listDocumentsQuerySchema = z.object({
  status: z.enum(DOCUMENT_JOB_STATUSES).optional(),
  documentType: z.enum(DOCUMENT_TYPES).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

/**
 * `GET /documents/export` query params. Deliberately narrower than
 * `listDocumentsQuerySchema`: no `status` (export is always `completed`-only
 * — see documents.service.ts#exportDocuments), and no `cursor`/`limit` (the
 * export ceiling is an internal constant, not a client-controlled page
 * size). `format` is required and only ever `"csv"` today — the enum grows
 * when a future serializer is registered, nothing else about this schema
 * changes.
 */
export const exportDocumentsQuerySchema = z.object({
  format: z.enum(EXPORT_FORMATS),
  documentType: z.enum(DOCUMENT_TYPES).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});
export type ExportDocumentsQuery = z.infer<typeof exportDocumentsQuerySchema>;
