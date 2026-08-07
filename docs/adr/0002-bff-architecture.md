# A BFF Layer of Route Handlers, Not a Direct Browser-to-Backend Path

## Status

Accepted

## Context

The frontend needs to call the backend's REST API for essentially everything it renders. The most direct way to do that would be for the browser itself to call the backend's origin straight from Client Components — fewer moving parts, no extra hop.

That direct-call shape has real problems for this system specifically. The backend authenticates with a bearer access token; giving the browser that token directly means it has to live somewhere JavaScript-reachable (rather than an httpOnly cookie), which is a materially worse place for it to sit. It also means every Client Component that needs backend data has to independently know how to attach and refresh that token, and the backend's CORS configuration has to accept direct browser requests from the frontend's own origin as a first-class case, rather than only ever seeing same-process, trusted server-to-server calls.

An early draft of the alternative considered one generic, catch-all proxy route (`/api/backend/[...path]`) forwarding anything through to the backend. A deliberate self-review pass, done before writing it, found this "generic" proxy was never actually going to be generic in practice — file upload needs real multipart/stream handling, and billing redirects need request-origin-aware URL injection — so it would have ended up special-casing its own traffic anyway, while still being harder to reason about than a small set of purpose-built routes.

## Decision

Client Components never call the real backend and never hold a bearer token. They call this Next.js app's own Route Handlers, under `app/api/*` — small, purpose-built per operation, not one generic passthrough. Each Route Handler is a thin adapter: parse/validate the incoming request, call the same server-only `services/*.service.ts` function a Server Component would call directly, and return its result (or a normalized error) as JSON.

Server Components, which run entirely server-side already, skip this hop and call `services/*` directly, in-process — there is no reason to route a server-to-server call through an extra same-origin HTTP round trip. Both paths converge on the same `services/*` implementation and the same `backendFetch` helper that actually reaches the backend with a bearer token resolved server-side from the session.

## Consequences

- The browser never sees a backend bearer token, in any code path. Session state lives entirely in an httpOnly cookie, managed by `@supabase/ssr`.
- Every backend operation has exactly one implementation (`services/*.service.ts`), regardless of whether a Server Component or a Client Component (via its Route Handler) triggered it — no duplicated call logic between the two paths.
- Adding a new backend-backed feature to the frontend means adding both a `services/*` function and, if any Client Component needs it, a matching Route Handler — a small, explicit tax per feature, in exchange for never having a generic proxy's hidden special cases.
- The backend's CORS configuration only ever needs to trust this Next.js app's own server as a caller, not arbitrary browser origins.
