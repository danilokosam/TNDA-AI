import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";

/**
 * The one place `@supabase/ssr`'s cookie-backed session lives — identity
 * plumbing only (session/cookie lifecycle: `setSession()` after the
 * backend's own signup/login, `getUser()` for refresh in `proxy.ts`,
 * `signOut()` on logout, `getAccessToken()` below for forwarding to the
 * backend). Never used for direct-to-Supabase application-data reads — the
 * backend is the single source of truth for those (see PROGRESS.md §4
 * decision 1); document history/stats go through real backend endpoints.
 *
 * `setAll`'s write can throw when called from a Server Component (which
 * can't set cookies) — safe to swallow, because `proxy.ts` already
 * refreshes the session on every request before any Server Component
 * runs, so a Server Component never actually needs to persist a refresh
 * itself. See PROGRESS.md's Auth section.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — see doc comment above.
        }
      },
    },
  });
}

/**
 * The current request's access token, for forwarding as a Bearer header to
 * the real backend. Deliberately uses `getSession()` (cheap, local, no
 * network call) rather than `getUser()` here — `proxy.ts` already called
 * `getUser()` (which *does* revalidate against the Auth server) earlier in
 * this same request, so re-validating a second time per service call would
 * just be redundant network round-trips for no added safety.
 */
export async function getAccessToken(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
