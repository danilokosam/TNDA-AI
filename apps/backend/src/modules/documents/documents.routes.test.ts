import { beforeEach, describe, expect, it, vi } from "vitest";
import { Elysia } from "elysia";
import { z } from "zod";
import { errorMiddleware } from "@/middlewares/error.middleware";
import type { DocumentJobRow } from "@/modules/documents/documents.repository";

vi.mock("@/config/supabase", () => ({
  supabaseAdmin: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}));

vi.mock("@/modules/documents/documents.repository", () => ({
  createDocumentJob: vi.fn(),
  getDocumentJobForOrganization: vi.fn(),
  getDocumentJobForOrganizationIncludingDeleted: vi.fn(),
  updateDocumentJob: vi.fn(),
  listDocumentJobsForOrganization: vi.fn(),
  listFieldCorrections: vi.fn(),
  insertFieldCorrections: vi.fn(),
  insertDocumentJobEvent: vi.fn(),
}));

vi.mock("@/services/storage.service", () => ({
  createSignedPreviewUrl: vi.fn(),
  deleteDocumentFile: vi.fn(),
}));

const { supabaseAdmin } = await import("@/config/supabase");
const documentsRepository = await import("@/modules/documents/documents.repository");
const storageService = await import("@/services/storage.service");
const { documentsRoutes } = await import("@/modules/documents/documents.routes");

/** No `.listen()` anywhere - requests are dispatched in-process via `.handle()`. */
const app = new Elysia().use(errorMiddleware).use(documentsRoutes);

const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

/**
 * `Response.json()` types as `Promise<unknown>` under this project's
 * (Bun-native, non-DOM) lib config, not the looser `any` the DOM lib
 * would give it - parsing through a real schema (rather than reaching
 * into the unknown value's properties directly) is what satisfies that,
 * the same way `errorEnvelopeSchema` already does for the error case.
 */
const jobDtoSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  fileName: z.string(),
  fileSizeBytes: z.number(),
  pageCount: z.number().nullable(),
  documentType: z.string(),
  averageConfidence: z.number().nullable(),
  resultJson: z.record(z.string(), z.unknown()).nullable(),
  errorMessage: z.string().nullable(),
  reviewStatus: z.string(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const listResponseSchema = z.object({
  data: z.array(jobDtoSchema),
  pagination: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }),
});

const TEST_PROFILE = { id: "user_1", organization_id: "org_1", email: "owner@example.com", role: "owner" };
const AUTH_HEADERS = { Authorization: "Bearer valid-test-token" };

/**
 * documents.routes.ts has no prior test coverage at all, and no test file
 * in this codebase has previously needed to mock *through* authMiddleware
 * (existing route tests only cover the no-token 401 case, or a
 * signature-authenticated public route). authMiddleware calls
 * supabaseAdmin.auth.getUser(token) then supabaseAdmin.from("profiles")
 * .select(...).eq(...).single() - both mocked here so requests carrying
 * AUTH_HEADERS reach the route handler as a real authenticated user.
 */
function mockAuthenticated(profile: typeof TEST_PROFILE = TEST_PROFILE) {
  vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValue({
    data: { user: { id: profile.id } },
    error: null,
  } as any);

  const profileChain: any = {
    select: vi.fn(() => profileChain),
    eq: vi.fn(() => profileChain),
    single: vi.fn(() => Promise.resolve({ data: profile, error: null })),
  };
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "profiles") return profileChain;
    throw new Error(`Unexpected supabaseAdmin.from("${table}") call — mock it explicitly in this test.`);
  });
}

function jobRow(overrides: Partial<DocumentJobRow> = {}): DocumentJobRow {
  return {
    id: "job_1",
    organization_id: "org_1",
    user_id: "user_1",
    file_name: "invoice.pdf",
    file_size_bytes: 1024,
    page_count: 1,
    azure_operation_id: null,
    status: "completed",
    document_type: "invoice",
    average_confidence: 0.9,
    result_json: null,
    storage_path: null,
    review_status: "unreviewed",
    reviewed_by: null,
    reviewed_at: null,
    deleted_at: null,
    retry_count: 0,
    is_retryable: null,
    error_message: null,
    created_at: "2026-01-15T00:00:00.000Z",
    updated_at: "2026-01-15T00:00:05.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/documents", () => {
  it("returns 401 without a bearer token, before any query validation runs", async () => {
    const response = await app.handle(new Request("http://localhost/api/v1/documents?limit=not-a-number"));

    expect(response.status).toBe(401);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns the {data, pagination} envelope, mapping rows through toJobDto", async () => {
    mockAuthenticated();
    vi.mocked(documentsRepository.listDocumentJobsForOrganization).mockResolvedValue({
      jobs: [jobRow()],
      nextCursor: null,
    });

    const response = await app.handle(new Request("http://localhost/api/v1/documents", { headers: AUTH_HEADERS }));

    expect(response.status).toBe(200);
    const body = listResponseSchema.parse(await response.json());
    expect(body.pagination).toEqual({ nextCursor: null, hasMore: false });
    expect(body.data).toEqual([
      {
        jobId: "job_1",
        status: "completed",
        fileName: "invoice.pdf",
        fileSizeBytes: 1024,
        pageCount: 1,
        documentType: "invoice",
        averageConfidence: 0.9,
        resultJson: null,
        errorMessage: null,
        reviewStatus: "unreviewed",
        reviewedBy: null,
        reviewedAt: null,
        createdAt: "2026-01-15T00:00:00.000Z",
        updatedAt: "2026-01-15T00:00:05.000Z",
      },
    ]);
  });

  it("sets hasMore=true whenever the repository returns a non-null nextCursor", async () => {
    mockAuthenticated();
    vi.mocked(documentsRepository.listDocumentJobsForOrganization).mockResolvedValue({
      jobs: [jobRow()],
      nextCursor: "some-opaque-cursor",
    });

    const response = await app.handle(new Request("http://localhost/api/v1/documents", { headers: AUTH_HEADERS }));
    const body = listResponseSchema.parse(await response.json());

    expect(body.pagination).toEqual({ nextCursor: "some-opaque-cursor", hasMore: true });
  });

  it("parses query params and forwards them to the service/repository as a typed filter object", async () => {
    mockAuthenticated();
    vi.mocked(documentsRepository.listDocumentJobsForOrganization).mockResolvedValue({ jobs: [], nextCursor: null });

    await app.handle(
      new Request(
        "http://localhost/api/v1/documents?status=failed&documentType=receipt&search=acme&limit=10&cursor=abc",
        { headers: AUTH_HEADERS },
      ),
    );

    expect(documentsRepository.listDocumentJobsForOrganization).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({
        status: "failed",
        documentType: "receipt",
        search: "acme",
        limit: 10,
        cursor: "abc",
      }),
    );
  });

  it("scopes the query to the authenticated caller's own organization, never a client-supplied one", async () => {
    mockAuthenticated();
    vi.mocked(documentsRepository.listDocumentJobsForOrganization).mockResolvedValue({ jobs: [], nextCursor: null });

    // organizationId isn't even an accepted query param - this just
    // confirms the route derives it from auth, not from the request.
    await app.handle(
      new Request("http://localhost/api/v1/documents?organizationId=someone-elses-org", { headers: AUTH_HEADERS }),
    );

    expect(documentsRepository.listDocumentJobsForOrganization).toHaveBeenCalledWith("org_1", expect.anything());
  });

  it("rejects limit > 100 with 400 VALIDATION_ERROR", async () => {
    mockAuthenticated();

    const response = await app.handle(
      new Request("http://localhost/api/v1/documents?limit=500", { headers: AUTH_HEADERS }),
    );

    expect(response.status).toBe(400);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an invalid status enum value with 400 VALIDATION_ERROR", async () => {
    mockAuthenticated();

    const response = await app.handle(
      new Request("http://localhost/api/v1/documents?status=not-a-real-status", { headers: AUTH_HEADERS }),
    );

    expect(response.status).toBe(400);
  });

  it("defaults documentType/averageConfidence-bearing fields through even when null", async () => {
    mockAuthenticated();
    vi.mocked(documentsRepository.listDocumentJobsForOrganization).mockResolvedValue({
      jobs: [jobRow({ status: "processing", average_confidence: null, result_json: null })],
      nextCursor: null,
    });

    const response = await app.handle(new Request("http://localhost/api/v1/documents", { headers: AUTH_HEADERS }));
    const body = listResponseSchema.parse(await response.json());

    expect(body.data[0]?.averageConfidence).toBeNull();
  });
});

describe("GET /api/v1/documents/jobs/:id/preview-url", () => {
  it("returns 401 without a bearer token", async () => {
    const response = await app.handle(new Request("http://localhost/api/v1/documents/jobs/11111111-1111-1111-1111-111111111111/preview-url"));
    expect(response.status).toBe(401);
  });

  it("returns a signed url when the job has a persisted file", async () => {
    mockAuthenticated();
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(
      jobRow({ storage_path: "org_1/job_1/invoice.pdf" }),
    );
    vi.mocked(storageService.createSignedPreviewUrl).mockResolvedValue("https://signed.example/x");

    const response = await app.handle(
      new Request("http://localhost/api/v1/documents/jobs/11111111-1111-1111-1111-111111111111/preview-url", { headers: AUTH_HEADERS }),
    );
    const body = z.object({ url: z.string().nullable() }).parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.url).toBe("https://signed.example/x");
  });

  it("returns { url: null } — not a 404 — when the job has no persisted file", async () => {
    mockAuthenticated();
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(
      jobRow({ storage_path: null }),
    );

    const response = await app.handle(
      new Request("http://localhost/api/v1/documents/jobs/11111111-1111-1111-1111-111111111111/preview-url", { headers: AUTH_HEADERS }),
    );
    const body = z.object({ url: z.string().nullable() }).parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.url).toBeNull();
  });

  it("scopes the lookup to the authenticated caller's own organization", async () => {
    mockAuthenticated();
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(jobRow());

    await app.handle(
      new Request("http://localhost/api/v1/documents/jobs/11111111-1111-1111-1111-111111111111/preview-url", { headers: AUTH_HEADERS }),
    );

    expect(documentsRepository.getDocumentJobForOrganization).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      "org_1",
    );
  });
});

const JOB_URL = "http://localhost/api/v1/documents/jobs/11111111-1111-1111-1111-111111111111";

function correctionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "correction_1",
    document_job_id: "11111111-1111-1111-1111-111111111111",
    field_name: "VendorName",
    previous_value: "Acme Corp",
    new_value: "Acme Corporation",
    edited_by: "user_1",
    edited_at: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("GET /api/v1/documents/jobs/:id/corrections", () => {
  it("returns 401 without a bearer token", async () => {
    const response = await app.handle(new Request(`${JOB_URL}/corrections`));
    expect(response.status).toBe(401);
  });

  it("returns the effective value per field plus the full history, camelCased", async () => {
    mockAuthenticated();
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(jobRow());
    vi.mocked(documentsRepository.listFieldCorrections).mockResolvedValue([correctionRow()]);

    const response = await app.handle(new Request(`${JOB_URL}/corrections`, { headers: AUTH_HEADERS }));

    expect(response.status).toBe(200);
    const body = z
      .object({
        effective: z.record(z.string(), z.string()),
        history: z.array(
          z.object({
            fieldName: z.string(),
            previousValue: z.string().nullable(),
            newValue: z.string(),
            editedBy: z.string().nullable(),
            editedAt: z.string(),
          }),
        ),
      })
      .parse(await response.json());

    expect(body.effective).toEqual({ VendorName: "Acme Corporation" });
    expect(body.history).toEqual([
      {
        fieldName: "VendorName",
        previousValue: "Acme Corp",
        newValue: "Acme Corporation",
        editedBy: "user_1",
        editedAt: "2026-01-15T00:00:00.000Z",
      },
    ]);
  });
});

describe("PATCH /api/v1/documents/jobs/:id/corrections", () => {
  it("returns 401 without a bearer token", async () => {
    const response = await app.handle(new Request(`${JOB_URL}/corrections`, { method: "PATCH" }));
    expect(response.status).toBe(401);
  });

  it("saves the corrections and returns the (unreviewed) job", async () => {
    mockAuthenticated();
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(
      jobRow({ result_json: { documents: [{ fields: { Total: { content: "$50.00" } } }] } }),
    );
    vi.mocked(documentsRepository.listFieldCorrections).mockResolvedValue([]);
    vi.mocked(documentsRepository.insertFieldCorrections).mockResolvedValue([correctionRow()]);

    const response = await app.handle(
      new Request(`${JOB_URL}/corrections`, {
        method: "PATCH",
        headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ corrections: { Total: "$55.00" } }),
      }),
    );

    expect(response.status).toBe(200);
    expect(documentsRepository.insertFieldCorrections).toHaveBeenCalledWith([
      {
        document_job_id: "job_1",
        field_name: "Total",
        previous_value: "$50.00",
        new_value: "$55.00",
        edited_by: "user_1",
      },
    ]);
    const body = jobDtoSchema.parse(await response.json());
    expect(body.reviewStatus).toBe("unreviewed");
  });

  it("returns 409 CONFLICT when the job hasn't finished processing", async () => {
    mockAuthenticated();
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(jobRow({ status: "processing" }));

    const response = await app.handle(
      new Request(`${JOB_URL}/corrections`, {
        method: "PATCH",
        headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ corrections: { Total: "$55.00" } }),
      }),
    );

    expect(response.status).toBe(409);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe("CONFLICT");
  });
});

describe("POST /api/v1/documents/jobs/:id/confirm", () => {
  it("returns 401 without a bearer token", async () => {
    const response = await app.handle(new Request(`${JOB_URL}/confirm`, { method: "POST" }));
    expect(response.status).toBe(401);
  });

  it("marks the job confirmed, attributed to the authenticated caller", async () => {
    mockAuthenticated();
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(jobRow());
    vi.mocked(documentsRepository.updateDocumentJob).mockResolvedValue(
      jobRow({ review_status: "confirmed", reviewed_by: "user_1", reviewed_at: "2026-01-16T00:00:00.000Z" }),
    );

    const response = await app.handle(
      new Request(`${JOB_URL}/confirm`, {
        method: "POST",
        headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ corrections: {} }),
      }),
    );

    expect(response.status).toBe(200);
    expect(documentsRepository.updateDocumentJob).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({ review_status: "confirmed", reviewed_by: "user_1" }),
    );
    const body = jobDtoSchema.parse(await response.json());
    expect(body.reviewStatus).toBe("confirmed");
  });
});

describe("POST /api/v1/documents/jobs/:id/reject", () => {
  it("returns 401 without a bearer token", async () => {
    const response = await app.handle(new Request(`${JOB_URL}/reject`, { method: "POST" }));
    expect(response.status).toBe(401);
  });

  it("marks the job rejected", async () => {
    mockAuthenticated();
    vi.mocked(documentsRepository.getDocumentJobForOrganization).mockResolvedValue(jobRow());
    vi.mocked(documentsRepository.updateDocumentJob).mockResolvedValue(jobRow({ review_status: "rejected" }));

    const response = await app.handle(
      new Request(`${JOB_URL}/reject`, {
        method: "POST",
        headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ corrections: {} }),
      }),
    );

    expect(response.status).toBe(200);
    const body = jobDtoSchema.parse(await response.json());
    expect(body.reviewStatus).toBe("rejected");
  });
});

describe("DELETE /api/v1/documents/jobs/:id/file", () => {
  it("returns 401 without a bearer token", async () => {
    const response = await app.handle(new Request(`${JOB_URL}/file`, { method: "DELETE" }));
    expect(response.status).toBe(401);
  });

  it("removes the file when called by the uploader", async () => {
    mockAuthenticated({ ...TEST_PROFILE, id: "user_1" });
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobRow({ user_id: "user_1", storage_path: "org_1/job_1/invoice.pdf" }),
    );
    vi.mocked(documentsRepository.updateDocumentJob).mockResolvedValue(jobRow({ storage_path: null }));

    const response = await app.handle(new Request(`${JOB_URL}/file`, { method: "DELETE", headers: AUTH_HEADERS }));

    expect(response.status).toBe(200);
    expect(storageService.deleteDocumentFile).toHaveBeenCalledWith("org_1/job_1/invoice.pdf");
    const body = jobDtoSchema.parse(await response.json());
    expect(body.jobId).toBe("job_1");
  });

  it("returns 403 for a member who neither uploaded it nor is an owner/admin", async () => {
    mockAuthenticated({ id: "user_2", organization_id: "org_1", email: "member@example.com", role: "member" });
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobRow({ user_id: "user_1", storage_path: "org_1/job_1/invoice.pdf" }),
    );

    const response = await app.handle(new Request(`${JOB_URL}/file`, { method: "DELETE", headers: AUTH_HEADERS }));

    expect(response.status).toBe(403);
    expect(storageService.deleteDocumentFile).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/documents/jobs/:id", () => {
  it("returns 401 without a bearer token", async () => {
    const response = await app.handle(new Request(JOB_URL, { method: "DELETE" }));
    expect(response.status).toBe(401);
  });

  it("soft-deletes the document when called by the uploader", async () => {
    mockAuthenticated({ ...TEST_PROFILE, id: "user_1" });
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobRow({ user_id: "user_1", storage_path: null }),
    );
    vi.mocked(documentsRepository.updateDocumentJob).mockResolvedValue(
      jobRow({ deleted_at: "2026-01-20T00:00:00.000Z" }),
    );

    const response = await app.handle(new Request(JOB_URL, { method: "DELETE", headers: AUTH_HEADERS }));

    expect(response.status).toBe(200);
    const body = z.object({ jobId: z.string() }).parse(await response.json());
    expect(body.jobId).toBe("job_1");
  });

  it("returns 403 for a member who neither uploaded it nor is an owner/admin", async () => {
    mockAuthenticated({ id: "user_2", organization_id: "org_1", email: "member@example.com", role: "member" });
    vi.mocked(documentsRepository.getDocumentJobForOrganizationIncludingDeleted).mockResolvedValue(
      jobRow({ user_id: "user_1" }),
    );

    const response = await app.handle(new Request(JOB_URL, { method: "DELETE", headers: AUTH_HEADERS }));

    expect(response.status).toBe(403);
    expect(documentsRepository.updateDocumentJob).not.toHaveBeenCalled();
  });
});
