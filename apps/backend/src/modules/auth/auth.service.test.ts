import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/auth/auth.repository", () => ({
  createAuthUser: vi.fn(),
  deleteAuthUser: vi.fn(),
  createOrganizationWithOwner: vi.fn(),
  getProfileWithOrganization: vi.fn(),
  signInWithPassword: vi.fn(),
}));

const authRepository = await import("@/modules/auth/auth.repository");
const authService = await import("@/modules/auth/auth.service");

const AUTH_USER = { id: "user_1", email: "new@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("signUp", () => {
  it("creates the auth user, organization, and session, returning role 'owner'", async () => {
    vi.mocked(authRepository.createAuthUser).mockResolvedValue(AUTH_USER);
    vi.mocked(authRepository.createOrganizationWithOwner).mockResolvedValue({
      organizationId: "org_1",
      organizationName: "Acme",
      role: "owner",
    });
    vi.mocked(authRepository.signInWithPassword).mockResolvedValue({
      userId: "user_1",
      email: "new@example.com",
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: 12345,
    });

    const result = await authService.signUp({
      email: "new@example.com",
      password: "password123",
      organizationName: "Acme",
    });

    expect(result.user).toEqual({
      id: "user_1",
      email: "new@example.com",
      role: "owner",
      organization: { id: "org_1", name: "Acme" },
    });
    expect(result.session.accessToken).toBe("at");
    expect(authRepository.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("rolls back the auth user (and re-throws the original error) if organization creation fails after the auth user was created", async () => {
    vi.mocked(authRepository.createAuthUser).mockResolvedValue(AUTH_USER);
    const originalError = new Error("organization insert failed");
    vi.mocked(authRepository.createOrganizationWithOwner).mockRejectedValue(originalError);
    vi.mocked(authRepository.deleteAuthUser).mockResolvedValue(undefined);

    await expect(
      authService.signUp({ email: "new@example.com", password: "password123", organizationName: "Acme" }),
    ).rejects.toBe(originalError);

    expect(authRepository.deleteAuthUser).toHaveBeenCalledWith("user_1");
  });

  it("still re-throws the ORIGINAL signup error, not a confusing rollback error, when the cleanup delete itself fails", async () => {
    // The specific bug the companion audit named: auth.service.ts's
    // rollback had no try/catch of its own, so a failed cleanup replaced
    // the real, diagnostically useful error with an unrelated "failed to
    // delete auth user" one — losing the actual reason signup failed.
    vi.mocked(authRepository.createAuthUser).mockResolvedValue(AUTH_USER);
    const originalError = new Error("organization insert failed");
    vi.mocked(authRepository.createOrganizationWithOwner).mockRejectedValue(originalError);
    vi.mocked(authRepository.deleteAuthUser).mockRejectedValue(new Error("failed to delete auth user"));

    await expect(
      authService.signUp({ email: "new@example.com", password: "password123", organizationName: "Acme" }),
    ).rejects.toBe(originalError);
  });

  it("rolls back if session creation fails, even though the organization was already committed", async () => {
    vi.mocked(authRepository.createAuthUser).mockResolvedValue(AUTH_USER);
    vi.mocked(authRepository.createOrganizationWithOwner).mockResolvedValue({
      organizationId: "org_1",
      organizationName: "Acme",
      role: "owner",
    });
    const originalError = new Error("sign-in failed");
    vi.mocked(authRepository.signInWithPassword).mockRejectedValue(originalError);
    vi.mocked(authRepository.deleteAuthUser).mockResolvedValue(undefined);

    await expect(
      authService.signUp({ email: "new@example.com", password: "password123", organizationName: "Acme" }),
    ).rejects.toBe(originalError);
    expect(authRepository.deleteAuthUser).toHaveBeenCalledWith("user_1");
  });

  it("does not attempt any rollback if createAuthUser itself is what fails", async () => {
    const originalError = new Error("email already exists");
    vi.mocked(authRepository.createAuthUser).mockRejectedValue(originalError);

    await expect(
      authService.signUp({ email: "dup@example.com", password: "password123", organizationName: "Acme" }),
    ).rejects.toBe(originalError);
    expect(authRepository.deleteAuthUser).not.toHaveBeenCalled();
  });
});

describe("login", () => {
  it("returns the authenticated user's real role and organization, from the server-verified session", async () => {
    vi.mocked(authRepository.signInWithPassword).mockResolvedValue({
      userId: "user_1",
      email: "member@example.com",
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: 999,
    });
    vi.mocked(authRepository.getProfileWithOrganization).mockResolvedValue({
      userId: "user_1",
      email: "member@example.com",
      role: "member",
      organizationId: "org_1",
      organizationName: "Acme",
    });

    const result = await authService.login({ email: "member@example.com", password: "password123" });

    expect(result.user).toEqual({
      id: "user_1",
      email: "member@example.com",
      role: "member",
      organization: { id: "org_1", name: "Acme" },
    });
  });

  it("propagates the sign-in failure as-is, without ever calling the profile lookup", async () => {
    const authError = new Error("Invalid email or password.");
    vi.mocked(authRepository.signInWithPassword).mockRejectedValue(authError);

    await expect(authService.login({ email: "x@example.com", password: "wrong" })).rejects.toBe(authError);
    expect(authRepository.getProfileWithOrganization).not.toHaveBeenCalled();
  });
});

describe("getCurrentUser", () => {
  it("returns the profile for the given (server-verified) user id, with no session/token data", async () => {
    vi.mocked(authRepository.getProfileWithOrganization).mockResolvedValue({
      userId: "user_1",
      email: "u@example.com",
      role: "admin",
      organizationId: "org_1",
      organizationName: "Acme",
    });

    const result = await authService.getCurrentUser("user_1");

    expect(result).toEqual({
      id: "user_1",
      email: "u@example.com",
      role: "admin",
      organization: { id: "org_1", name: "Acme" },
    });
    expect(authRepository.getProfileWithOrganization).toHaveBeenCalledWith("user_1");
  });
});
