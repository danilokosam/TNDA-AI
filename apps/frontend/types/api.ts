/**
 * Wire types for the TNDA-AI backend API. Two sourcing strategies,
 * deliberately mixed:
 *
 * 1. Raw database row shapes and the error-code union are type-only
 *    imported directly from the backend's own source — no hand-duplication;
 *    a backend column rename becomes an immediate compile error here.
 *    (A full Eden-Treaty import of the backend's exported `App` type was
 *    tried first and doesn't work: `backend/src/index.ts` transitively
 *    imports everything via its own `@/*` alias, which resolves against
 *    *this* project's tsconfig once pulled into a cross-project import,
 *    not backend's — a hard collision, not fixable without editing
 *    backend's tsconfig. Files with zero internal imports, like
 *    `database.types.ts` and `utils/errors.ts`, don't hit this and import
 *    cleanly, which is what's used below.)
 * 2. Everything else — request bodies, and response shapes that are
 *    service-layer inventions rather than raw rows (auth, usage, billing,
 *    documents) — is hand-written as Zod schemas, verified against the
 *    real route/service source. `lib/api/backend-client.ts` parses every
 *    response through these at the call site, so drift is caught at
 *    runtime too, not just hoped not to happen. Where a schema mirrors a
 *    type-importable DB row, an `AssertExact` below makes drift a compile
 *    error as well.
 *
 * (An `openapi-typescript` codegen step against the backend's own mounted
 * Swagger was the other alternative considered — also doesn't work today:
 * `@elysiajs/swagger` serializes raw Zod-internal `_def` trees instead of
 * real JSON Schema for every request/response body, confirmed against the
 * live `/docs/json` output — every response schema comes back as `{}`.)
 *
 * See PROGRESS.md for the full story.
 */
import { z } from "zod";
import type { Database, ProfileRole } from "../../backend/src/config/database.types";
import type { AppErrorCode } from "../../backend/src/utils/errors";

export type { AppErrorCode, ProfileRole };

/**
 * Resolves to `never` unless `A` and `B` are structurally identical. Used
 * below as `export const _checkX: AssertExact<...> = true` — assigning the
 * literal `true` is what actually forces the check: if the type resolves to
 * `never`, `true` isn't assignable to it and the build fails right here.
 * (`export`, not a bare local, so `noUnusedLocals` doesn't flag these —
 * nothing is meant to ever import them.)
 */
type AssertExact<A, B> = A extends B ? (B extends A ? true : never) : never;

// ---------------------------------------------------------------------------
// Error envelope (middlewares/error.middleware.ts)
// ---------------------------------------------------------------------------

export const APP_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "QUOTA_EXCEEDED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_FILE_TYPE",
  "RATE_LIMITED",
  "AZURE_SERVICE_ERROR",
  "INTERNAL_ERROR",
] as const;
export const _checkAppErrorCodes: AssertExact<(typeof APP_ERROR_CODES)[number], AppErrorCode> = true;

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(APP_ERROR_CODES),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

// ---------------------------------------------------------------------------
// Auth (modules/auth/auth.schema.ts, auth.service.ts)
// ---------------------------------------------------------------------------

export const signUpRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters long."),
  organizationName: z.string().trim().min(1).max(200),
});
export type SignUpRequest = z.infer<typeof signUpRequestSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number().nullable(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const authenticatedUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(["owner", "admin", "member"]),
  organization: z.object({ id: z.string(), name: z.string() }),
});
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;
export const _checkAuthUserRole: AssertExact<AuthenticatedUser["role"], ProfileRole> = true;

export const authResponseSchema = z.object({
  user: authenticatedUserSchema,
  session: authSessionSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

// ---------------------------------------------------------------------------
// Organization (modules/organization/*)
// ---------------------------------------------------------------------------

export type OrganizationRow = Database["public"]["Tables"]["organizations"]["Row"];

export const organizationRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  stripe_customer_id: z.string().nullable(),
  created_at: z.string(),
});
export const _checkOrganizationRow: AssertExact<z.infer<typeof organizationRowSchema>, OrganizationRow> = true;

export type PlanRow = Database["public"]["Tables"]["plans"]["Row"];

export const planRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  price_monthly: z.number(),
  max_documents_per_month: z.number(),
  max_pages_per_document: z.number(),
  max_pages_per_month: z.number(),
  max_file_size_mb: z.number(),
  created_at: z.string(),
});
export const _checkPlanRow: AssertExact<z.infer<typeof planRowSchema>, PlanRow> = true;

export const usageSummarySchema = z.object({
  plan: planRowSchema,
  periodStart: z.string(),
  pagesUsed: z.number(),
  documentsUsed: z.number(),
  pagesRemaining: z.number(),
  documentsRemaining: z.number(),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;

export const organizationOverviewSchema = z.object({
  organization: organizationRowSchema,
  usage: usageSummarySchema,
});
export type OrganizationOverview = z.infer<typeof organizationOverviewSchema>;

// ---------------------------------------------------------------------------
// Billing (modules/billing/*)
// ---------------------------------------------------------------------------

export type SubscriptionRow = Database["public"]["Tables"]["subscriptions"]["Row"];

export const subscriptionRowSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  plan_id: z.string(),
  status: z.enum(["trialing", "active", "past_due", "canceled", "incomplete"]),
  current_period_start: z.string(),
  current_period_end: z.string(),
  stripe_customer_id: z.string().nullable(),
  stripe_subscription_id: z.string().nullable(),
  created_at: z.string(),
});
export const _checkSubscriptionRow: AssertExact<z.infer<typeof subscriptionRowSchema>, SubscriptionRow> = true;

/**
 * `billing.service.ts#getCurrentSubscription` returns this instead of a
 * real row when the organization has no paid subscription — the implicit
 * free tier is never actually persisted as a `subscriptions` row.
 */
export const implicitFreeSubscriptionSchema = z.object({
  status: z.literal("active"),
  planId: z.string(),
  note: z.string(),
});
export type ImplicitFreeSubscription = z.infer<typeof implicitFreeSubscriptionSchema>;

export const subscriptionResponseSchema = z.object({
  plan: planRowSchema,
  subscription: z.union([subscriptionRowSchema, implicitFreeSubscriptionSchema]),
});
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>;

export const plansResponseSchema = z.array(planRowSchema);

export const checkoutRequestSchema = z.object({
  planId: z.enum(["basic", "pro"]),
  redirectUrl: z.string().url().optional(),
});
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export const portalRequestSchema = z.object({
  returnUrl: z.string().url().optional(),
});
export type PortalRequest = z.infer<typeof portalRequestSchema>;

export const urlResponseSchema = z.object({ url: z.string() });
export type UrlResponse = z.infer<typeof urlResponseSchema>;

// ---------------------------------------------------------------------------
// Documents (modules/documents/*)
// ---------------------------------------------------------------------------

/**
 * Mirrors `documents.strategy.ts`'s `DOCUMENT_TYPES`. Not type-importable
 * (that file pulls in `@/services/...` via the backend's own alias, same
 * collision as `index.ts` — see file header) — hand-kept in sync, verified
 * against real source as of 2026-08-06.
 */
export const DOCUMENT_TYPES = ["invoice", "receipt", "identity_document", "generic"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type DocumentJobStatus = Database["public"]["Enums"]["document_job_status"];
export type DocumentReviewStatus = Database["public"]["Enums"]["document_review_status"];

/** camelCase wire shape from `documents.routes.ts#toJobDto` — not a raw DB row. */
export const jobDtoSchema = z.object({
  jobId: z.string(),
  status: z.enum(["pending", "processing", "completed", "failed", "rejected_quota"]),
  fileName: z.string(),
  fileSizeBytes: z.number(),
  pageCount: z.number().nullable(),
  documentType: z.enum(DOCUMENT_TYPES),
  averageConfidence: z.number().nullable(),
  resultJson: z.record(z.string(), z.unknown()).nullable(),
  errorMessage: z.string().nullable(),
  reviewStatus: z.enum(["unreviewed", "confirmed", "rejected"]),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JobDto = z.infer<typeof jobDtoSchema>;
export const _checkJobStatus: AssertExact<JobDto["status"], DocumentJobStatus> = true;
export const _checkReviewStatus: AssertExact<JobDto["reviewStatus"], DocumentReviewStatus> = true;

/**
 * `GET /documents` query params (`documents.schema.ts#listDocumentsQuerySchema`).
 * A plain interface, not a Zod schema — this is an outgoing request shape the
 * frontend itself constructs (from URL search params or Dashboard's fixed
 * window), not an untrusted payload that needs runtime validation here; the
 * backend re-validates it independently on receipt regardless.
 */
export interface ListDocumentsParams {
  status?: DocumentJobStatus;
  documentType?: DocumentType;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  limit?: number;
}

/** `GET /documents` response shape (`documents.routes.ts`'s `{data, pagination}`). */
export const documentsListResponseSchema = z.object({
  data: z.array(jobDtoSchema),
  pagination: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
});
export type DocumentsListResponse = z.infer<typeof documentsListResponseSchema>;

/**
 * `GET /documents/jobs/:id/preview-url` response shape. `url` is `null`,
 * never a 404, when the job has no persisted file (storage upload failed,
 * or the job predates persistent storage) — a real, expected state, not
 * an error (see `documents.service.ts#getDocumentPreviewUrl`).
 */
export const previewUrlResponseSchema = z.object({ url: z.string().nullable() });
export type PreviewUrlResponse = z.infer<typeof previewUrlResponseSchema>;

/**
 * `GET /documents/jobs/:id/corrections` response shape
 * (`documents.routes.ts#toFieldCorrectionDto`). `effective` is the latest
 * value per field — what the review UI edits and displays; `history` is
 * the full chronological audit trail behind it (every edit, by whom, from
 * what, to what).
 */
export const fieldCorrectionSchema = z.object({
  fieldName: z.string(),
  previousValue: z.string().nullable(),
  newValue: z.string(),
  editedBy: z.string().nullable(),
  editedAt: z.string(),
});
export type FieldCorrection = z.infer<typeof fieldCorrectionSchema>;

export const fieldCorrectionsResponseSchema = z.object({
  effective: z.record(z.string(), z.string()),
  history: z.array(fieldCorrectionSchema),
});
export type FieldCorrectionsResponse = z.infer<typeof fieldCorrectionsResponseSchema>;

/**
 * Request body shared by `PATCH .../corrections`, `POST .../confirm`, and
 * `POST .../reject` (`documents.schema.ts#documentCorrectionsSchema`) — an
 * outgoing shape the frontend constructs itself, same convention as
 * `ListDocumentsParams` above (not a Zod schema; the backend re-validates
 * independently on receipt regardless). `corrections` is always sent, even
 * when empty, so the backend never has to treat a missing body as a
 * distinct case from an empty one.
 */
export interface DocumentCorrectionsRequest {
  corrections: Record<string, string>;
}

/**
 * `DELETE /documents/jobs/:id` response shape. Deliberately not the full
 * `JobDto` — once deleted, the job is no longer viewable through any other
 * endpoint (`documents.repository.ts` filters `deleted_at` out of every
 * normal lookup), so there's nothing meaningful left to return beyond
 * confirming which job was deleted. `DELETE /jobs/:id/file` (remove the
 * original file only, job stays fully visible) returns the updated
 * `JobDto` instead — see `documents.service.ts#removeDocumentFile`.
 */
export const deleteDocumentResponseSchema = z.object({ jobId: z.string() });
export type DeleteDocumentResponse = z.infer<typeof deleteDocumentResponseSchema>;

// ---------------------------------------------------------------------------
// Organization stats (modules/organization/organization.service.ts#getJobStats)
// ---------------------------------------------------------------------------

/** `GET /organizations/me/stats` response shape — mirrors `JobStats` exactly. */
export const organizationStatsSchema = z.object({
  completedJobs: z.number(),
  failedJobs: z.number(),
  totalJobs: z.number(),
  /** `null`, never a fabricated 0, when there's no terminal job in the window. */
  successRate: z.number().nullable(),
  avgProcessingSeconds: z.number().nullable(),
  /** Gap-filled server-side — always one entry per day in the window, never sparse. */
  dailyCounts: z.array(z.object({ date: z.string(), count: z.number() })),
});
export type OrganizationStats = z.infer<typeof organizationStatsSchema>;

export const batchFileResultSchema = z.object({
  fileName: z.string(),
  status: z.enum(["processing", "rejected", "rejected_quota", "failed"]),
  jobId: z.string().optional(),
  reason: z.string().optional(),
});
export type BatchFileResult = z.infer<typeof batchFileResultSchema>;

export const batchResultSchema = z.object({
  totalFiles: z.number(),
  accepted: z.number(),
  rejected: z.number(),
  files: z.array(batchFileResultSchema),
});
export type BatchResult = z.infer<typeof batchResultSchema>;

export const uploadResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("single"), job: jobDtoSchema }),
  z.object({ kind: z.literal("batch"), batch: batchResultSchema }),
]);
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

/**
 * `POST /documents` request shape (`documents.schema.ts#uploadDocumentSchema`).
 * A plain interface, not a Zod schema, same reasoning as `ListDocumentsParams`:
 * this is an outgoing request the frontend itself constructs from a real
 * `File` object (not JSON), and the backend re-validates it independently
 * on receipt regardless. `documentType` defaults to `"invoice"` server-side
 * when omitted, matched here by not sending it rather than duplicating the
 * default on this side.
 */
export interface UploadDocumentParams {
  file: File;
  documentType?: DocumentType;
}
