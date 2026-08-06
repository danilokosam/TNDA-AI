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
  updateDocumentJob: vi.fn(),
  listDocumentJobsForOrganization: vi.fn(),
}));

const { supabaseAdmin } = await import("@/config/supabase");
const documentsRepository = await import("@/modules/documents/documents.repository");
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
