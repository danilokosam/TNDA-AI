import { redirect } from "next/navigation";

/**
 * `proxy.ts` already redirects every `/` request before this ever renders
 * (to `/dashboard` if authenticated, `/login` otherwise) — this is a
 * defensive fallback only, in case that matcher ever changes. Redirecting
 * unconditionally to `/login` is safe either way: if the visitor actually
 * has a session, `/login`'s own reciprocal redirect (also in `proxy.ts`)
 * immediately bounces them to `/dashboard`.
 */
export default function RootPage() {
  redirect("/login");
}
