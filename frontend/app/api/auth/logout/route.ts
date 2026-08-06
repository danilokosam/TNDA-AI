import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";

/**
 * Actually revokes the refresh token with Supabase (not just cookie
 * clearing) — the backend has no logout endpoint, but this app already
 * talks to Supabase directly for session management, so it can call
 * `signOut()` itself. Idempotent by design: works even if the session was
 * already expired or missing.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.json({ success: true });
}
