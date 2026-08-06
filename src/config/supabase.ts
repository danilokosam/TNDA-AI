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
