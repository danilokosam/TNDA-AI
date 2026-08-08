import {
  createAuthUser,
  createOrganizationWithOwner,
  deleteAuthUser,
  getProfileWithOrganization,
  signInWithPassword,
} from "@/modules/auth/auth.repository";
import type { LoginInput, SignUpInput } from "@/modules/auth/auth.schema";

export interface AuthResult {
  user: {
    id: string;
    email: string;
    role: "owner" | "admin" | "member";
    organization: { id: string; name: string };
  };
  session: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number | null;
  };
}

export async function signUp(input: SignUpInput): Promise<AuthResult> {
  const authUser = await createAuthUser(input.email, input.password);

  try {
    const membership = await createOrganizationWithOwner(input.organizationName, authUser);
    const session = await signInWithPassword(input.email, input.password);

    return {
      user: {
        id: authUser.id,
        email: authUser.email,
        role: membership.role,
        organization: { id: membership.organizationId, name: membership.organizationName },
      },
      session: {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
      },
    };
  } catch (error) {
    // Auth user and org/profile creation aren't transactional across
    // Supabase's auth schema and our public schema, so on any failure
    // after the auth user was created, clean it up manually to avoid
    // orphaned accounts that can never sign up again (duplicate email).
    // The cleanup itself has its own try/catch, deliberately: if it fails
    // too, the *original* error is still what the caller needs to see —
    // losing it in favor of a confusing "failed to delete auth user"
    // message would erase the actual diagnostic trail while leaving the
    // real problem (a failed signup) equally unsolved.
    try {
      await deleteAuthUser(authUser.id);
    } catch (cleanupError) {
      console.error(`Failed to roll back auth user ${authUser.id} after a signup error:`, cleanupError);
    }
    throw error;
  }
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const session = await signInWithPassword(input.email, input.password);
  const membership = await getProfileWithOrganization(session.userId);

  return {
    user: {
      id: membership.userId,
      email: membership.email,
      role: membership.role,
      organization: { id: membership.organizationId, name: membership.organizationName },
    },
    session: {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    },
  };
}

export async function getCurrentUser(userId: string): Promise<AuthResult["user"]> {
  const membership = await getProfileWithOrganization(userId);

  return {
    id: membership.userId,
    email: membership.email,
    role: membership.role,
    organization: { id: membership.organizationId, name: membership.organizationName },
  };
}
