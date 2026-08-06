import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";

const AUTH_PAGE_PATHS = new Set(["/login", "/signup"]);

function isPublicApiPath(pathname: string): boolean {
  // login/signup are how you get a session; logout is idempotent and
  // should work even against an already-expired session — none of the
  // three can require an existing session as a precondition.
  return pathname.startsWith("/api/auth/");
}

/**
 * Runs on every request (see matcher below). Two jobs, both centralized
 * here rather than scattered per-caller: (1) keep the session fresh —
 * `getUser()` transparently refreshes and re-cookies when needed, and
 * Server Components can't do this themselves since they can't write
 * cookies; (2) gate access — redirect unauthenticated page views to
 * `/login`, redirect authenticated users away from `/login`/`/signup`, and
 * 401 (not redirect — these are fetch() callers expecting JSON)
 * unauthenticated `/api/*` calls other than the auth endpoints themselves.
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthenticated = user !== null;
  const isApiPath = pathname.startsWith("/api/");

  if (pathname === "/") {
    return NextResponse.redirect(new URL(isAuthenticated ? "/dashboard" : "/login", request.url));
  }

  if (isApiPath) {
    if (!isAuthenticated && !isPublicApiPath(pathname)) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication is required to access this resource." } },
        { status: 401 },
      );
    }
    return response;
  }

  if (AUTH_PAGE_PATHS.has(pathname)) {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return response;
  }

  // Any other page path is a protected dashboard page.
  if (!isAuthenticated) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
