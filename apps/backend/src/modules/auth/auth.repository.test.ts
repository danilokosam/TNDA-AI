import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, UnauthorizedError } from "@/utils/errors";

vi.mock("@/config/supabase", () => ({
  supabaseAdmin: {
    auth: { admin: { createUser: vi.fn(), deleteUser: vi.fn() } },
    from: vi.fn(),
  },
  createAuthClient: vi.fn(),
}));

const { supabaseAdmin, createAuthClient } = await import("@/config/supabase");
const authRepository = await import("@/modules/auth/auth.repository");

/**
 * Thenable at every step, not just after `.single()` — `createOrganizationWithOwner`
 * awaits `.insert(...)` directly for the `profiles` write (no `.select()`/
 * `.single()` chained), but `.select("id, name").single()` for `organizations`.
 * Matches documents.repository.test.ts's `createQueryBuilderMock` convention.
 */
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAuthUser", () => {
  it("returns the new user's id and email on success", async () => {
    vi.mocked(supabaseAdmin.auth.admin.createUser).mockResolvedValue({
      data: { user: { id: "user_1", email: "new@example.com" } },
      error: null,
    } as any);

    const result = await authRepository.createAuthUser("new@example.com", "password123");

    expect(result).toEqual({ id: "user_1", email: "new@example.com" });
  });

  it("throws ConflictError with a specific message when the email is already registered", async () => {
    vi.mocked(supabaseAdmin.auth.admin.createUser).mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", message: "raw supabase message" },
    } as any);

    await expect(authRepository.createAuthUser("dup@example.com", "password123")).rejects.toThrow(
      "An account with this email already exists.",
    );
    await expect(authRepository.createAuthUser("dup@example.com", "password123")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("throws ConflictError for any other Supabase failure", async () => {
    vi.mocked(supabaseAdmin.auth.admin.createUser).mockResolvedValue({
      data: { user: null },
      error: { code: "unexpected_failure", message: "Something else went wrong." },
    } as any);

    await expect(authRepository.createAuthUser("x@example.com", "password123")).rejects.toThrow(
      "Something else went wrong.",
    );
  });
});

describe("deleteAuthUser", () => {
  it("calls Supabase's admin deleteUser with the given id", async () => {
    vi.mocked(supabaseAdmin.auth.admin.deleteUser).mockResolvedValue({ data: {}, error: null } as any);

    await authRepository.deleteAuthUser("user_1");

    expect(supabaseAdmin.auth.admin.deleteUser).toHaveBeenCalledWith("user_1");
  });
});

describe("createOrganizationWithOwner", () => {
  const owner = { id: "user_1", email: "owner@example.com" };

  it("creates the organization and an owner profile, returning role 'owner'", async () => {
    const orgChain = singleChain({ data: { id: "org_1", name: "Acme" }, error: null });
    const profileChain = singleChain({ data: {}, error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "organizations") return orgChain;
      if (table === "profiles") return profileChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await authRepository.createOrganizationWithOwner("Acme", owner);

    expect(result).toEqual({ organizationId: "org_1", organizationName: "Acme", role: "owner" });
    expect(profileChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: owner.id, organization_id: "org_1", role: "owner" }),
    );
  });

  it("throws ConflictError when the organization insert fails, before ever touching profiles", async () => {
    const orgChain = singleChain({ data: null, error: { message: "org insert failed" } });
    const profileChain = singleChain({ data: {}, error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => (table === "organizations" ? orgChain : profileChain));

    await expect(authRepository.createOrganizationWithOwner("Acme", owner)).rejects.toBeInstanceOf(ConflictError);
    expect(profileChain.insert).not.toHaveBeenCalled();
  });

  it("throws ConflictError when the profile insert fails after the organization was already created", async () => {
    const orgChain = singleChain({ data: { id: "org_1", name: "Acme" }, error: null });
    const profileChain = singleChain({ data: null, error: { message: "profile insert failed" } });
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => (table === "organizations" ? orgChain : profileChain));

    // This is exactly the partial-creation state auth.service.ts's rollback
    // exists to clean up: the organization now exists, but the caller
    // never gets a success — an orphaned auth user is the risk, not an
    // orphaned organization (nothing else references it without a profile).
    await expect(authRepository.createOrganizationWithOwner("Acme", owner)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("getProfileWithOrganization", () => {
  it("returns the full profile + organization on success", async () => {
    const profileChain = singleChain({
      data: { id: "user_1", email: "u@example.com", role: "member", organization_id: "org_1" },
      error: null,
    });
    const orgChain = singleChain({ data: { id: "org_1", name: "Acme" }, error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => (table === "profiles" ? profileChain : orgChain));

    const result = await authRepository.getProfileWithOrganization("user_1");

    expect(result).toEqual({
      userId: "user_1",
      email: "u@example.com",
      role: "member",
      organizationId: "org_1",
      organizationName: "Acme",
    });
  });

  it("throws UnauthorizedError (not NotFoundError) when no profile exists for the user id", async () => {
    const profileChain = singleChain({ data: null, error: { message: "no rows" } });
    vi.mocked(supabaseAdmin.from).mockReturnValue(profileChain);

    // Deliberately uniform: whether the id is malformed, deleted, or never
    // existed, the caller only ever learns "unauthorized" — never a
    // distinct "not found" that could help enumerate valid ids.
    await expect(authRepository.getProfileWithOrganization("missing")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws UnauthorizedError when the profile's organization is missing (data-integrity edge case)", async () => {
    const profileChain = singleChain({
      data: { id: "user_1", email: "u@example.com", role: "member", organization_id: "org_missing" },
      error: null,
    });
    const orgChain = singleChain({ data: null, error: { message: "no rows" } });
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => (table === "profiles" ? profileChain : orgChain));

    await expect(authRepository.getProfileWithOrganization("user_1")).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("signInWithPassword", () => {
  it("returns tokens on a successful sign-in, using a fresh client (not the shared admin singleton)", async () => {
    const signIn = vi.fn().mockResolvedValue({
      data: {
        user: { id: "user_1", email: "u@example.com" },
        session: { access_token: "at", refresh_token: "rt", expires_at: 12345 },
      },
      error: null,
    });
    vi.mocked(createAuthClient).mockReturnValue({ auth: { signInWithPassword: signIn } } as any);

    const result = await authRepository.signInWithPassword("u@example.com", "password123");

    expect(result).toEqual({
      userId: "user_1",
      email: "u@example.com",
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: 12345,
    });
    expect(createAuthClient).toHaveBeenCalled();
  });

  it.each([
    ["wrong password", { data: { session: null, user: null }, error: { message: "Invalid login credentials" } }],
    ["a nonexistent account", { data: { session: null, user: null }, error: { message: "Invalid login credentials" } }],
  ])("throws a generic UnauthorizedError for %s, never distinguishing why", async (_case, mockResult) => {
    const signIn = vi.fn().mockResolvedValue(mockResult);
    vi.mocked(createAuthClient).mockReturnValue({ auth: { signInWithPassword: signIn } } as any);

    const rejection = authRepository.signInWithPassword("someone@example.com", "wrong");
    await expect(rejection).rejects.toBeInstanceOf(UnauthorizedError);
    // The message must stay generic — this is the actual security
    // invariant: "wrong password" and "no such account" must be
    // indistinguishable to the caller, or the endpoint becomes a way to
    // enumerate registered emails.
    await expect(rejection).rejects.toThrow("Invalid email or password.");
  });
});
