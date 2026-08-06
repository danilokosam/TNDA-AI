import { Elysia } from "elysia";
import { supabaseAdmin } from "@/config/supabase";
import { UnauthorizedError } from "@/utils/errors";
import type { ProfileRole } from "@/config/database.types";

export interface AuthContext {
  userId: string;
  email: string;
  organizationId: string;
  role: ProfileRole;
}

function extractBearerToken(header: string | undefined): string {
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    throw new UnauthorizedError("Missing or malformed Authorization header.");
  }

  const token = header.slice("bearer ".length).trim();
  if (!token) {
    throw new UnauthorizedError("Missing bearer token.");
  }

  return token;
}

/**
 * Verifies the caller's Supabase access token and loads their profile
 * (organization + role). Every protected route group applies this plugin
 * via `.use(authMiddleware)`, which injects a strongly-typed `auth` value
 * into the route context — no route ever has to re-derive tenant scoping
 * itself.
 */
export const authMiddleware = new Elysia({ name: "auth-middleware" }).derive(
  { as: "scoped" },
  async ({ headers }): Promise<{ auth: AuthContext }> => {
    const token = extractBearerToken(headers.authorization);

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedError("Your session is invalid or has expired.");
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, organization_id, email, role")
      .eq("id", data.user.id)
      .single();

    if (profileError || !profile) {
      throw new UnauthorizedError("No profile is associated with this account.");
    }

    return {
      auth: {
        userId: profile.id,
        email: profile.email,
        organizationId: profile.organization_id,
        role: profile.role,
      },
    };
  },
);
