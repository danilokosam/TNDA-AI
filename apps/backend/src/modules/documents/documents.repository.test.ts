import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, NotFoundError } from "@/utils/errors";

vi.mock("@/config/supabase", () => ({
  supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
}));

const { supabaseAdmin } = await import("@/config/supabase");
const documentsRepository = await import("@/modules/documents/documents.repository");

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

/**
 * Extends the query-builder mock pattern from billing.repository.test.ts
 * with the additional filter methods listDocumentJobsForOrganization
 * chains (order/limit/ilike/gte/lte/lt), and records every call made to
 * each so tests can assert on filter arguments without caring about call
 * order between independent `if` branches.
 */
function createQueryBuilderMock(result: QueryResult) {
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
    then: (onfulfilled: (value: QueryResult) => unknown) => Promise.resolve(result).then(onfulfilled),
  };
  return chain;
}

function correctionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "correction_1",
    document_job_id: "job_1",
    field_name: "VendorName",
    previous_value: "Acme Corp",
    new_value: "Acme Corporation",
    edited_by: "user_1",
    edited_at: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

function jobRow(overrides: Partial<Record<string, unknown>> = {}) {
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
    storage_path: null,
    review_status: "unreviewed",
    reviewed_by: null,
    reviewed_at: null,
    deleted_at: null,
    retry_count: 0,
    is_retryable: null,
    claimed_by: null,
    claimed_at: null,
    lease_expires_at: null,
    lease_epoch: 0,
    next_attempt_at: null,
    created_at: "2026-01-15T00:00:00.000Z",
    updated_at: "2026-01-15T00:00:05.000Z",
    ...overrides,
  };
}

function eventRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "event_1",
    document_job_id: "job_1",
    event_type: "job_created",
    actor_user_id: "user_1",
    from_status: null,
    to_status: "pending",
    metadata: {},
    created_at: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listDocumentJobsForOrganization", () => {
  it("scopes to the organization and orders newest first with limit+1 (to detect a next page)", async () => {
    const chain = createQueryBuilderMock({ data: [jobRow()], error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await documentsRepository.listDocumentJobsForOrganization("org_1", { limit: 20 });

    expect(supabaseAdmin.from).toHaveBeenCalledWith("document_jobs");
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org_1");
    expect(chain.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(21);
  });

  it("returns hasMore=false (nextCursor=null) when there isn't an extra row beyond the limit", async () => {
    const chain = createQueryBuilderMock({ data: [jobRow({ id: "a" }), jobRow({ id: "b" })], error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    const result = await documentsRepository.listDocumentJobsForOrganization("org_1", { limit: 5 });

    expect(result.jobs).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it("trims the extra row and returns a decodable nextCursor when there IS a next page", async () => {
    const rows = [
      jobRow({ id: "a", created_at: "2026-01-15T00:00:00.000Z" }),
      jobRow({ id: "b", created_at: "2026-01-14T00:00:00.000Z" }),
      jobRow({ id: "c", created_at: "2026-01-13T00:00:00.000Z" }), // the "limit+1"th row
    ];
    const chain = createQueryBuilderMock({ data: rows, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    const result = await documentsRepository.listDocumentJobsForOrganization("org_1", { limit: 2 });

    expect(result.jobs.map((j) => j.id)).toEqual(["a", "b"]);
    expect(result.nextCursor).not.toBeNull();
    // The cursor is opaque on the wire, but decodes to the last *returned*
    // row's created_at - the property the pagination logic actually relies on.
    const decoded = Buffer.from(result.nextCursor ?? "", "base64url").toString("utf-8");
    expect(decoded).toBe("2026-01-14T00:00:00.000Z");
  });

  it("applies status, documentType, search, and date-range filters when provided", async () => {
    const chain = createQueryBuilderMock({ data: [], error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await documentsRepository.listDocumentJobsForOrganization("org_1", {
      limit: 20,
      status: "failed",
      documentType: "receipt",
      search: "acme",
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-01-31T00:00:00.000Z",
    });

    expect(chain.eq).toHaveBeenCalledWith("status", "failed");
    expect(chain.eq).toHaveBeenCalledWith("document_type", "receipt");
    expect(chain.ilike).toHaveBeenCalledWith("file_name", "%acme%");
    expect(chain.gte).toHaveBeenCalledWith("created_at", "2026-01-01T00:00:00.000Z");
    expect(chain.lte).toHaveBeenCalledWith("created_at", "2026-01-31T00:00:00.000Z");
  });

  it("omits filter clauses entirely when no filters are given", async () => {
    const chain = createQueryBuilderMock({ data: [], error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await documentsRepository.listDocumentJobsForOrganization("org_1", { limit: 20 });

    expect(chain.ilike).not.toHaveBeenCalled();
    expect(chain.gte).not.toHaveBeenCalled();
    expect(chain.lte).not.toHaveBeenCalled();
    expect(chain.lt).not.toHaveBeenCalled();
  });

  it("decodes a valid cursor into a created_at lower-bound filter", async () => {
    const chain = createQueryBuilderMock({ data: [], error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);
    const cursor = Buffer.from("2026-01-10T00:00:00.000Z", "utf-8").toString("base64url");

    await documentsRepository.listDocumentJobsForOrganization("org_1", { limit: 20, cursor });

    expect(chain.lt).toHaveBeenCalledWith("created_at", "2026-01-10T00:00:00.000Z");
  });

  it("silently ignores a malformed/tampered cursor rather than erroring (treated as first page)", async () => {
    const chain = createQueryBuilderMock({ data: [], error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await documentsRepository.listDocumentJobsForOrganization("org_1", {
      limit: 20,
      cursor: "not-valid-base64url-content-!!!",
    });

    expect(chain.lt).not.toHaveBeenCalled();
  });

  it("throws AppError when Supabase returns an error", async () => {
    const chain = createQueryBuilderMock({ data: null, error: { message: "db exploded" } });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(documentsRepository.listDocumentJobsForOrganization("org_1", { limit: 20 })).rejects.toThrow(
      AppError,
    );
  });

  it("excludes soft-deleted jobs", async () => {
    const chain = createQueryBuilderMock({ data: [], error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await documentsRepository.listDocumentJobsForOrganization("org_1", { limit: 20 });

    expect(chain.is).toHaveBeenCalledWith("deleted_at", null);
  });
});

describe("getDocumentJobForOrganization", () => {
  it("scopes to id + organization and excludes soft-deleted jobs", async () => {
    const chain = createQueryBuilderMock({ data: jobRow(), error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    const result = await documentsRepository.getDocumentJobForOrganization("job_1", "org_1");

    expect(supabaseAdmin.from).toHaveBeenCalledWith("document_jobs");
    expect(chain.eq).toHaveBeenCalledWith("id", "job_1");
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org_1");
    expect(chain.is).toHaveBeenCalledWith("deleted_at", null);
    expect(result).toEqual(jobRow());
  });

  it("throws NotFoundError when the job doesn't exist, isn't in this org, or is soft-deleted", async () => {
    const chain = createQueryBuilderMock({ data: null, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(documentsRepository.getDocumentJobForOrganization("job_1", "org_1")).rejects.toThrow(NotFoundError);
  });

  it("throws AppError when Supabase returns an error", async () => {
    const chain = createQueryBuilderMock({ data: null, error: { message: "db exploded" } });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(documentsRepository.getDocumentJobForOrganization("job_1", "org_1")).rejects.toThrow(AppError);
  });
});

describe("getDocumentJobForOrganizationIncludingDeleted", () => {
  it("scopes to id + organization but does NOT filter out soft-deleted jobs", async () => {
    const chain = createQueryBuilderMock({ data: jobRow({ deleted_at: "2026-01-20T00:00:00.000Z" }), error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    const result = await documentsRepository.getDocumentJobForOrganizationIncludingDeleted("job_1", "org_1");

    expect(chain.eq).toHaveBeenCalledWith("id", "job_1");
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org_1");
    expect(chain.is).not.toHaveBeenCalled();
    expect(result.deleted_at).toBe("2026-01-20T00:00:00.000Z");
  });

  it("throws NotFoundError when the job doesn't exist or isn't in this org", async () => {
    const chain = createQueryBuilderMock({ data: null, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(
      documentsRepository.getDocumentJobForOrganizationIncludingDeleted("job_1", "org_1"),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("listFieldCorrections", () => {
  it("scopes to the job and orders oldest first (full chronological history)", async () => {
    const chain = createQueryBuilderMock({ data: [correctionRow()], error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    const result = await documentsRepository.listFieldCorrections("job_1");

    expect(supabaseAdmin.from).toHaveBeenCalledWith("document_field_corrections");
    expect(chain.eq).toHaveBeenCalledWith("document_job_id", "job_1");
    expect(chain.order).toHaveBeenCalledWith("edited_at", { ascending: true });
    expect(result).toEqual([correctionRow()]);
  });

  it("throws AppError when Supabase returns an error", async () => {
    const chain = createQueryBuilderMock({ data: null, error: { message: "db exploded" } });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(documentsRepository.listFieldCorrections("job_1")).rejects.toThrow(AppError);
  });
});

describe("insertFieldCorrections", () => {
  it("inserts the given rows and returns them", async () => {
    const rows = [correctionRow({ id: "correction_1" }), correctionRow({ id: "correction_2", field_name: "Total" })];
    const chain = createQueryBuilderMock({ data: rows, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    const input = [
      { document_job_id: "job_1", field_name: "VendorName", previous_value: "Acme Corp", new_value: "Acme Corporation", edited_by: "user_1" },
    ];
    const result = await documentsRepository.insertFieldCorrections(input);

    expect(supabaseAdmin.from).toHaveBeenCalledWith("document_field_corrections");
    expect(chain.insert).toHaveBeenCalledWith(input);
    expect(result).toEqual(rows);
  });

  it("throws AppError when Supabase returns an error", async () => {
    const chain = createQueryBuilderMock({ data: null, error: { message: "db exploded" } });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(
      documentsRepository.insertFieldCorrections([
        { document_job_id: "job_1", field_name: "Total", previous_value: null, new_value: "$50.00", edited_by: "user_1" },
      ]),
    ).rejects.toThrow(AppError);
  });
});

describe("insertDocumentJobEvent", () => {
  it("inserts a single event row and returns it", async () => {
    const row = eventRow();
    const chain = createQueryBuilderMock({ data: row, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    const input = {
      document_job_id: "job_1",
      event_type: "job_created" as const,
      actor_user_id: "user_1",
      from_status: null,
      to_status: "pending",
      metadata: {},
    };
    const result = await documentsRepository.insertDocumentJobEvent(input);

    expect(supabaseAdmin.from).toHaveBeenCalledWith("document_job_events");
    expect(chain.insert).toHaveBeenCalledWith(input);
    expect(result).toEqual(row);
  });

  it("throws AppError when Supabase returns an error", async () => {
    const chain = createQueryBuilderMock({ data: null, error: { message: "db exploded" } });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(
      documentsRepository.insertDocumentJobEvent({
        document_job_id: "job_1",
        event_type: "job_created",
        actor_user_id: "user_1",
        from_status: null,
        to_status: "pending",
      }),
    ).rejects.toThrow(AppError);
  });
});

describe("listDocumentJobEvents", () => {
  it("scopes to the job and orders oldest first (full chronological history)", async () => {
    const chain = createQueryBuilderMock({ data: [eventRow()], error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    const result = await documentsRepository.listDocumentJobEvents("job_1");

    expect(supabaseAdmin.from).toHaveBeenCalledWith("document_job_events");
    expect(chain.eq).toHaveBeenCalledWith("document_job_id", "job_1");
    expect(chain.order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(result).toEqual([eventRow()]);
  });

  it("throws AppError when Supabase returns an error", async () => {
    const chain = createQueryBuilderMock({ data: null, error: { message: "db exploded" } });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(documentsRepository.listDocumentJobEvents("job_1")).rejects.toThrow(AppError);
  });
});

describe("claimOrRenewDocumentJob", () => {
  it("calls the claim_or_renew_document_job RPC with the given worker id, lease, and max-retries", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: jobRow({ claimed_by: "worker_1" }), error: null } as any);

    const result = await documentsRepository.claimOrRenewDocumentJob({
      workerId: "worker_1",
      leaseSeconds: 180,
      maxRetries: 3,
    });

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("claim_or_renew_document_job", {
      p_worker_id: "worker_1",
      p_lease_seconds: 180,
      p_max_retries: 3,
    });
    expect(result).toEqual(jobRow({ claimed_by: "worker_1" }));
  });

  it("returns null when nothing was available to claim (not an error)", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any);

    const result = await documentsRepository.claimOrRenewDocumentJob({
      workerId: "worker_1",
      leaseSeconds: 180,
      maxRetries: 3,
    });

    expect(result).toBeNull();
  });

  it("throws AppError when Supabase returns an error", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "function not found" } } as any);

    await expect(
      documentsRepository.claimOrRenewDocumentJob({ workerId: "worker_1", leaseSeconds: 180, maxRetries: 3 }),
    ).rejects.toThrow(AppError);
  });
});
