import { beforeEach, describe, expect, it, vi } from "vitest";
import { Elysia } from "elysia";
import { z } from "zod";
import { errorMiddleware } from "@/middlewares/error.middleware";

/** `Response.json()` types as `Promise<unknown>` here (Bun-native, non-DOM lib) — parsed through a real schema, matching documents.routes.test.ts's convention. */
const errorEnvelopeSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const authResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    role: z.string(),
    organization: z.object({ id: z.string(), name: z.string() }),
  }),
  session: z.object({ accessToken: z.string(), refreshToken: z.string(), expiresAt: z.number().nullable() }),
});

vi.mock("@/config/supabase", () => ({
  supabaseAdmin: {
    auth: { getUser: vi.fn(), admin: { createUser: vi.fn(), deleteUser: vi.fn() } },
    from: vi.fn(),
  },
  createAuthClient: vi.fn(),
}));

const { supabaseAdmin, createAuthClient } = await import("@/config/supabase");
const { authRoutes } = await import("@/modules/auth/auth.routes");

/** No `.listen()` — requests dispatched in-process via `.handle()`, matching documents.routes.test.ts's convention. */
const app = new Elysia().use(errorMiddleware).use(authRoutes);

function singleChain(result: { data: unknown; error: { message: string; code?: string } | null }) {
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    then: (onfulfilled: (value: typeof result) => unknown) => Promise.resolve(result).then(onfulfilled),
  };
  return chain;
}

function postJson(path: string, body: unknown) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/auth/signup", () => {
  it("returns 201 and the new owner's account on a valid signup", async () => {
    vi.mocked(supabaseAdmin.auth.admin.createUser).mockResolvedValue({
      data: { user: { id: "user_1", email: "new@example.com" } },
      error: null,
    } as any);
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) =>
      table === "organizations"
        ? singleChain({ data: { id: "org_1", name: "Acme" }, error: null })
        : singleChain({ data: {}, error: null }),
    );
    vi.mocked(createAuthClient).mockReturnValue({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: {
            user: { id: "user_1", email: "new@example.com" },
            session: { access_token: "at", refresh_token: "rt", expires_at: 999 },
          },
          error: null,
        }),
      },
    } as any);

    const response = await postJson("/api/v1/auth/signup", {
      email: "new@example.com",
      password: "password123",
      organizationName: "Acme",
    });

    expect(response.status).toBe(201);
    const body = authResponseSchema.parse(await response.json());
    expect(body.user).toEqual({
      id: "user_1",
      email: "new@example.com",
      role: "owner",
      organization: { id: "org_1", name: "Acme" },
    });
    expect(body.session.accessToken).toBe("at");
  });

  it.each([
    ["an invalid email", { email: "not-an-email", password: "password123", organizationName: "Acme" }],
    ["a too-short password", { email: "a@example.com", password: "short", organizationName: "Acme" }],
    ["a blank organization name", { email: "a@example.com", password: "password123", organizationName: "" }],
    ["a missing field entirely", { email: "a@example.com", password: "password123" }],
  ])("returns 400 for %s, never reaching Supabase", async (_case, body) => {
    const response = await postJson("/api/v1/auth/signup", body);

    expect(response.status).toBe(400);
    expect(supabaseAdmin.auth.admin.createUser).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/auth/login", () => {
  it("returns 200 and the account on valid credentials", async () => {
    vi.mocked(createAuthClient).mockReturnValue({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: {
            user: { id: "user_1", email: "member@example.com" },
            session: { access_token: "at", refresh_token: "rt", expires_at: 999 },
          },
          error: null,
        }),
      },
    } as any);
    // getProfileWithOrganization makes two sequential `.from()` calls
    // (profiles, then organizations) — each needs its own chain/result.
    let call = 0;
    vi.mocked(supabaseAdmin.from).mockImplementation(() => {
      call += 1;
      return call === 1
        ? singleChain({
            data: { id: "user_1", email: "member@example.com", role: "member", organization_id: "org_1" },
            error: null,
          })
        : singleChain({ data: { id: "org_1", name: "Acme" }, error: null });
    });

    const response = await postJson("/api/v1/auth/login", { email: "member@example.com", password: "password123" });

    expect(response.status).toBe(200);
    const body = authResponseSchema.parse(await response.json());
    expect(body.user).toEqual({
      id: "user_1",
      email: "member@example.com",
      role: "member",
      organization: { id: "org_1", name: "Acme" },
    });
  });

  it("returns 401 for wrong credentials, with a generic message that doesn't confirm whether the email is registered", async () => {
    vi.mocked(createAuthClient).mockReturnValue({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: { message: "Invalid login credentials" },
        }),
      },
    } as any);

    const response = await postJson("/api/v1/auth/login", { email: "nobody@example.com", password: "wrong" });

    expect(response.status).toBe(401);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.message).toBe("Invalid email or password.");
  });

  it("returns 400 for a malformed request body, never reaching Supabase", async () => {
    const response = await postJson("/api/v1/auth/login", { email: "not-an-email", password: "" });

    expect(response.status).toBe(400);
    expect(createAuthClient).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/auth/me", () => {
  it("returns 401 with no Authorization header", async () => {
    const response = await app.handle(new Request("http://localhost/api/v1/auth/me"));

    expect(response.status).toBe(401);
  });

  it("returns the caller's own account, derived from their verified token, never from the request itself", async () => {
    vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValue({ data: { user: { id: "user_1" } }, error: null } as any);
    // Two profile lookups happen here, not one: authMiddleware's own (to
    // build `auth`), then getCurrentUser's (to build the response) — both
    // profile-shaped; only the third, final `.from()` call is organizations.
    let call = 0;
    vi.mocked(supabaseAdmin.from).mockImplementation(() => {
      call += 1;
      return call <= 2
        ? singleChain({
            data: { id: "user_1", email: "owner@example.com", role: "owner", organization_id: "org_1" },
            error: null,
          })
        : singleChain({ data: { id: "org_1", name: "Acme" }, error: null });
    });

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/me", { headers: { Authorization: "Bearer valid-token" } }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      id: "user_1",
      email: "owner@example.com",
      role: "owner",
      organization: { id: "org_1", name: "Acme" },
    });
  });
});
