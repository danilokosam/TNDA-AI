import { beforeEach, describe, expect, it, vi } from "vitest";
import { Elysia } from "elysia";
import { z } from "zod";
import { errorMiddleware } from "@/middlewares/error.middleware";

/** `Response.json()` types as `Promise<unknown>` here (Bun-native, non-DOM lib) — parsed through a real schema, matching documents.routes.test.ts's convention. */
const errorEnvelopeSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

vi.mock("@/config/supabase", () => ({
  supabaseAdmin: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}));

const { supabaseAdmin } = await import("@/config/supabase");
const { authMiddleware } = await import("@/middlewares/auth.middleware");

/**
 * A minimal route that only exists to expose whatever `auth` context the
 * middleware derived, so the tenant-scoping value every real protected
 * route depends on can be asserted directly, not inferred from a specific
 * feature route's behavior.
 */
const app = new Elysia().use(errorMiddleware).use(authMiddleware).get("/whoami", ({ auth }) => auth);

const TEST_PROFILE = { id: "user_1", organization_id: "org_1", email: "owner@example.com", role: "owner" };

function mockValidToken(userId = TEST_PROFILE.id) {
  vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  } as any);
}

function mockProfileLookup(result: { data: unknown; error: { message: string } | null }) {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
  };
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authMiddleware", () => {
  it("rejects with 401 when there is no Authorization header at all", async () => {
    const response = await app.handle(new Request("http://localhost/whoami"));

    expect(response.status).toBe(401);
    expect(supabaseAdmin.auth.getUser).not.toHaveBeenCalled();
  });

  it.each([
    ["missing the Bearer scheme entirely", "sometoken"],
    ["using a different scheme", "Basic sometoken"],
    ["Bearer with no token after it", "Bearer"],
    ["Bearer with only whitespace after it", "Bearer    "],
  ])("rejects with 401 for a malformed header: %s", async (_case, header) => {
    const response = await app.handle(new Request("http://localhost/whoami", { headers: { Authorization: header } }));

    expect(response.status).toBe(401);
    expect(supabaseAdmin.auth.getUser).not.toHaveBeenCalled();
  });

  it("rejects with 401 when Supabase reports the token invalid or expired", async () => {
    vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValue({
      data: { user: null },
      error: { message: "JWT expired" },
    } as any);

    const response = await app.handle(
      new Request("http://localhost/whoami", { headers: { Authorization: "Bearer expired-token" } }),
    );

    expect(response.status).toBe(401);
    const body = errorEnvelopeSchema.parse(await response.json());
    // The response never repeats Supabase's own internal reason (e.g.
    // "JWT expired") — a generic message regardless of why verification
    // failed, so nothing about *why* a token is invalid leaks to the caller.
    expect(body.error.message).not.toMatch(/jwt/i);
  });

  it("rejects with 401 (not a 500, and not silently succeeding) when the token is valid but no profile row exists for that user", async () => {
    // A real, if rare, integrity edge case: a Supabase Auth user exists
    // but its profile row was deleted or never created. Token
    // verification alone must never be treated as sufficient for access.
    mockValidToken();
    mockProfileLookup({ data: null, error: { message: "no rows" } });

    const response = await app.handle(
      new Request("http://localhost/whoami", { headers: { Authorization: "Bearer valid-token" } }),
    );

    expect(response.status).toBe(401);
  });

  it("injects the verified user's own organization_id and role — never anything client-supplied — on success", async () => {
    mockValidToken();
    mockProfileLookup({ data: TEST_PROFILE, error: null });

    const response = await app.handle(
      new Request("http://localhost/whoami", {
        headers: {
          Authorization: "Bearer valid-token",
          // A client-supplied organization id/role must have zero effect —
          // the middleware's whole job is deriving tenant scope itself,
          // from the verified token, not trusting anything the caller sends.
          "x-organization-id": "attacker-org",
          "x-role": "owner",
        },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      userId: "user_1",
      email: "owner@example.com",
      organizationId: "org_1",
      role: "owner",
    });
  });

  it("looks up the profile by the token's own verified user id, not any client-supplied id", async () => {
    mockValidToken("real-user-id");
    const chain = mockProfileLookup({ data: TEST_PROFILE, error: null });

    await app.handle(
      new Request("http://localhost/whoami", {
        headers: { Authorization: "Bearer valid-token", "x-user-id": "spoofed-user-id" },
      }),
    );

    expect(chain.eq).toHaveBeenCalledWith("id", "real-user-id");
  });
});
