import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/config/env";
import type { Database } from "@/config/database.types";

/**
 * Service-role client used by all backend repositories. It bypasses RLS, so
 * every query built on top of it MUST explicitly filter by
 * `organization_id` itself — RLS in the database is defense-in-depth for
 * direct client access, not a safety net for this client.
 */
export const supabaseAdmin: SupabaseClient<Database> = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

/**
 * Creates a fresh, one-off client for password sign-in — deliberately NOT
 * a singleton. supabase-js mutates a client's own internal session state
 * on any successful `signInWithPassword`/`signUp` call, and from then on
 * uses that session's user JWT (instead of the key the client was created
 * with) as the Authorization header for every subsequent `.from()`/
 * `.rpc()` call made on that SAME client instance. Calling this on the
 * shared `supabaseAdmin` singleton would silently downgrade it from
 * service_role to whichever user last signed in — for every request
 * server-wide, since it's a module-level singleton — breaking RLS-gated
 * writes (e.g. `document_jobs` updates, which intentionally have no
 * policy granting them to plain `authenticated` users). A new client per
 * sign-in call keeps this fully isolated from the service-role client.
 */
export function createAuthClient(): SupabaseClient<Database> {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
