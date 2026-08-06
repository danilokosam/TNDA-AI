import "server-only";
import { backendFetch } from "@/lib/api/backend-client";
import { getAccessToken } from "@/lib/supabase/server-client";
import {
  authResponseSchema,
  authenticatedUserSchema,
  type AuthResponse,
  type AuthenticatedUser,
  type LoginRequest,
  type SignUpRequest,
} from "@/types/api";

/**
 * Orchestrated by the backend itself (organization + profile creation,
 * with rollback on partial failure) — this just forwards the already-
 * validated request. The caller (the `/api/auth/signup` Route Handler) is
 * responsible for turning the returned session into cookies via
 * `@supabase/ssr`'s `setSession()`; this function only talks to the backend.
 */
export async function signUp(input: SignUpRequest): Promise<AuthResponse> {
  return backendFetch("/api/v1/auth/signup", authResponseSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function login(input: LoginRequest): Promise<AuthResponse> {
  return backendFetch("/api/v1/auth/login", authResponseSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Current user + org, using whatever session `proxy.ts` has already ensured is fresh. */
export async function getCurrentUser(): Promise<AuthenticatedUser> {
  const accessToken = await getAccessToken();
  return backendFetch("/api/v1/auth/me", authenticatedUserSchema, { accessToken: accessToken ?? undefined });
}
