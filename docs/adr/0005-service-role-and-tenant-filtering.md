# Service-Role Database Access with Explicit Application-Level Tenant Filtering

## Status

Accepted

## Context

This is a multi-tenant system: every user belongs to exactly one organization, and every organization must only ever see its own data. Supabase's Row Level Security is the natural first tool reached for here — policies scoped by `organization_id` can enforce this at the database layer, for any client that connects as a specific authenticated user.

The backend, though, is not "any client" — it is a trusted server process that itself performs authentication (verifying the caller's Supabase bearer token), then needs to run queries, filters, joins, and aggregations on the caller's behalf. Relying on RLS as the *only* isolation mechanism for this API would mean either connecting to Postgres as the specific end user for every single query (awkward and limiting for a backend that also needs to do things no single end user's row-level policy would permit, like running cross-cutting aggregation functions), or accepting that RLS alone has to be expressive enough for every query shape the API will ever need. Neither fits a backend that owns real business logic on top of raw table access.

## Decision

The backend connects to Postgres via Supabase's **service-role** client, which bypasses Row Level Security entirely. Every repository function is written to explicitly filter by `organization_id` (or the caller's own identity, for user-scoped data) in application code, as part of its own query — this filtering, not RLS, is what actually enforces tenant isolation for this API. `auth.middleware.ts` verifies the caller's token and resolves their `organization_id` once, per request, and every downstream repository call is passed that value explicitly rather than re-deriving it.

Row Level Security policies are still defined on every table, scoped the same way (`organization_id`-based `select`, restrictive `insert`/`update`/`delete`). They exist as an independent second layer — defense-in-depth for any future context where something connects to this database as a real end user rather than through this trusted backend (a future direct-from-client integration, a support/debugging tool, a different service) — not as the primary mechanism this API currently depends on to be correct.

## Consequences

- Every new repository function must explicitly filter by tenant identity; there is no RLS backstop silently protecting a query that forgot to. This is a real, ongoing discipline requirement, not a one-time setup cost — code review and tests are what actually catch a missing filter, not the database.
- The backend is free to write whatever query shapes its business logic needs (joins, aggregation functions, cross-table reads) without being constrained to what a row-level policy can express for an individual authenticated end user.
- If anything other than this backend ever connects to the same Supabase project as a real, RLS-subject end user, the existing policies already provide a correct, independent isolation guarantee for that path — nothing new has to be designed for it later.
- A bug that mutates the shared service-role client's own session state (rather than creating a fresh client for anything that authenticates as an end user, such as password sign-in) can silently make every subsequent request on that process use the wrong privilege level. This is a known, real risk category for this specific pattern, not a hypothetical one — a password-sign-in code path was fixed for exactly this after `supabase-js`'s shared-client session mutation caused it in practice.
