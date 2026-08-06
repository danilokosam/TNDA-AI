import { beforeEach, describe, expect, it, vi } from "vitest";
import { Elysia } from "elysia";
import { z } from "zod";
import { errorMiddleware } from "@/middlewares/error.middleware";

vi.mock("@/config/supabase", () => ({
  supabaseAdmin: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}));

vi.mock("@/modules/organization/organization.service", () => ({
  getOrganizationOverview: vi.fn(),
  getUsageSummary: vi.fn(),
  getJobStats: vi.fn(),
}));

const { supabaseAdmin } = await import("@/config/supabase");
const organizationService = await import("@/modules/organization/organization.service");
const { organizationRoutes } = await import("@/modules/organization/organization.routes");

const app = new Elysia().use(errorMiddleware).use(organizationRoutes);

const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const TEST_PROFILE = { id: "user_1", organization_id: "org_1", email: "owner@example.com", role: "owner" };
const AUTH_HEADERS = { Authorization: "Bearer valid-test-token" };

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/organizations/me/stats", () => {
  it("returns 401 without a bearer token", async () => {
    const response = await app.handle(new Request("http://localhost/api/v1/organizations/me/stats"));

    expect(response.status).toBe(401);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns the service's stats payload for the authenticated caller's organization", async () => {
    mockAuthenticated();
    const stats = {
      completedJobs: 5,
      failedJobs: 1,
      totalJobs: 6,
      successRate: 0.8333333333333334,
      avgProcessingSeconds: 42,
      dailyCounts: [{ date: "2026-01-10", count: 2 }],
    };
    vi.mocked(organizationService.getJobStats).mockResolvedValue(stats);

    const response = await app.handle(
      new Request("http://localhost/api/v1/organizations/me/stats", { headers: AUTH_HEADERS }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(stats);
    expect(organizationService.getJobStats).toHaveBeenCalledWith("org_1", undefined);
  });

  it("forwards a valid `since` query param to the service", async () => {
    mockAuthenticated();
    vi.mocked(organizationService.getJobStats).mockResolvedValue({
      completedJobs: 0,
      failedJobs: 0,
      totalJobs: 0,
      successRate: null,
      avgProcessingSeconds: null,
      dailyCounts: [],
    });

    await app.handle(
      new Request("http://localhost/api/v1/organizations/me/stats?since=2026-01-01T00:00:00.000Z", {
        headers: AUTH_HEADERS,
      }),
    );

    expect(organizationService.getJobStats).toHaveBeenCalledWith("org_1", "2026-01-01T00:00:00.000Z");
  });

  it("rejects a since value further back than the allowed window with 400 VALIDATION_ERROR", async () => {
    mockAuthenticated();

    const response = await app.handle(
      new Request("http://localhost/api/v1/organizations/me/stats?since=2000-01-01T00:00:00.000Z", {
        headers: AUTH_HEADERS,
      }),
    );

    expect(response.status).toBe(400);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a since value in the future with 400 VALIDATION_ERROR", async () => {
    mockAuthenticated();

    const response = await app.handle(
      new Request("http://localhost/api/v1/organizations/me/stats?since=2099-01-01T00:00:00.000Z", {
        headers: AUTH_HEADERS,
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects a non-ISO-datetime since value with 400 VALIDATION_ERROR", async () => {
    mockAuthenticated();

    const response = await app.handle(
      new Request("http://localhost/api/v1/organizations/me/stats?since=not-a-date", { headers: AUTH_HEADERS }),
    );

    expect(response.status).toBe(400);
  });
});
