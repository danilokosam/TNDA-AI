# TNDA-AI Backend — Progress

## 1. Summary of Work Completed

A working, type-checked (strict TypeScript, zero `as` casts) Bun + ElysiaJS backend was built from scratch. The server boots, responds on all routes, and every request/response is validated with Zod (used directly as Elysia's Standard-Schema validators — no duplicate TypeBox/Zod schema pairs).

### Modules & endpoints

| Module | Endpoint | Auth | Purpose |
|---|---|---|---|
| health | `GET /health` | none | liveness check |
| auth | `POST /api/v1/auth/signup` | none | creates a Supabase auth user + organization + owner profile in one flow, rolls back the auth user if org/profile creation fails |
| auth | `POST /api/v1/auth/login` | none | Supabase password sign-in, returns session + profile |
| auth | `GET /api/v1/auth/me` | required | current user + organization |
| organization | `GET /api/v1/organizations/me` | required | org record + usage summary |
| organization | `GET /api/v1/organizations/me/usage` | required | pages/documents used vs. plan limits for the current billing period |
| billing | `GET /api/v1/billing/plans` | required | plan catalog (free/basic/pro) |
| billing | `GET /api/v1/billing/subscription` | required | org's effective plan + subscription row (or implicit free tier) |
| documents | `POST /api/v1/documents` | required | multipart upload, single file **or** `.zip` batch — see §6 |
| documents | `GET /api/v1/documents/jobs/:id` | required | polls job status, pulling a fresh status from Azure if still in flight |

Swagger UI is mounted at `/docs`.

### Utilities & cross-cutting concerns

- **`src/utils/file-inspector.ts`** — detects true MIME type from magic bytes (`file-type`, never trusts client `Content-Type`), reads PDF page count via `pdf-lib` without rendering pages.
- **`src/utils/zip.ts`** — in-memory `.zip` extraction (`fflate`, no temp files), filters directories, `__MACOSX/`, `.DS_Store`, empty entries.
- **`src/utils/errors.ts`** — `AppError` hierarchy (`ValidationError`, `UnauthorizedError`, `QuotaExceededError`, `PayloadTooLargeError`, `UnsupportedFileTypeError`, `RateLimitedError`, `AzureServiceError`, …), each carrying an HTTP status + stable machine code.
- **`src/middlewares/error.middleware.ts`** — global `onError` normalizes every thrown error (ours and Elysia's own validation/parse/not-found errors) into `{ error: { code, message, details? } }`.
- **`src/middlewares/auth.middleware.ts`** — verifies the Supabase bearer token, loads the caller's `profiles` row, injects `auth: { userId, email, organizationId, role }` into context for every protected route.
- **`src/middlewares/rate-limit.middleware.ts`** — in-memory fixed-window limiter keyed by client IP (`RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS`); swap the `Map` for Redis if the app is ever scaled horizontally.
- **`src/services/azure-document-intelligence.service.ts`** — talks to Azure Document Intelligence over its **REST API directly** (not the `@azure/ai-form-recognizer` SDK — see note below), implements the 202/Operation-Location pattern by hand, and retries `429` responses with exponential backoff + jitter (honors `Retry-After`).

> **Design note on the Azure SDK vs. REST API:** the task allowed either. The SDK's `beginAnalyzeDocument` poller is designed to poll within one continuous process; this app instead persists the `Operation-Location` URL on `document_jobs` and resumes polling from a **separate, later HTTP request** to `GET /jobs/:id` (possibly hitting a different server instance). Driving the submit/poll REST calls by hand fits that architecture more directly and avoids fighting the SDK's poller-serialization model — so `@azure/ai-form-recognizer` was removed from `package.json` in favor of `fetch`.

## 2. Project Architecture Map

```
src/
  config/            env validation (Zod), Supabase client, Azure REST config, hand-written DB types
  modules/
    auth/            signup / login / me
    organization/     org profile, usage & quota computation (owns "effective plan" logic)
    billing/          plan catalog + current subscription (thin layer over organization module — no DB access of its own, so no repository.ts)
    documents/        upload (single + zip), pre-flight quota checks, job polling
      *.routes.ts      HTTP layer (Elysia routes, Zod validation)
      *.service.ts     business logic
      *.repository.ts  Supabase access (service-role client; every query filters by organization_id itself since RLS is bypassed)
      *.schema.ts      Zod DTOs
  services/          external integrations — azure-document-intelligence.service.ts
  middlewares/        auth, centralized error handling, rate limiting
  utils/             file inspection, zip extraction, AppError hierarchy
  index.ts           app wiring (cors, swagger, error/rate-limit middleware, route mounting)
supabase/migrations/  numbered SQL migrations (see §3)
```

**Backend-uses-service-role-key pattern:** all repositories query through `supabaseAdmin` (the service-role client), which bypasses RLS, and every query explicitly filters by `organization_id`/caller identity in application code. The RLS policies in the migrations are defense-in-depth for any future direct-from-client Supabase access, not the primary tenant-isolation mechanism for this API.

## 3. Database Migrations Status

**Applied and verified against the live Supabase project** (see §7). Eight SQL files in `supabase/migrations/`, applied in order:

1. `0001_extensions.sql` — `pgcrypto` for `gen_random_uuid()`
2. `0002_organizations.sql` — `organizations` table only (RLS/policies deliberately deferred — see `0004`)
3. `0003_profiles.sql` — `profiles` table (`owner`/`admin`/`member` role enum), FK to `auth.users` (RLS/policies deferred — see `0004`)
4. `0004_authorization.sql` — `current_organization_id()` helper + the RLS policies for `organizations` and `profiles` that call it. Split into its own migration, run after both tables exist, because `current_organization_id()` is a `LANGUAGE SQL` function whose body queries `profiles` — Postgres validates a SQL-language function's body against the catalog at `CREATE FUNCTION` time (unlike `plpgsql`, which defers to runtime), so defining it any earlier fails. See §7 for how this was discovered.
5. `0005_plans.sql` — `plans` catalog, seeded with `free` / `basic` / `pro` rows (idempotent `upsert`)
6. `0006_subscriptions.sql` — `subscriptions`, one active/trialing/past_due row per org enforced via partial unique index
7. `0007_document_jobs.sql` — `document_jobs` table + status enum (`pending/processing/completed/failed/rejected_quota`) + `updated_at` trigger
8. `0008_usage_functions.sql` — `get_organization_monthly_usage(org_id)` SQL function used by the pre-flight quota check

RLS is enabled on every table with `organization_id`-scoped `select` policies (and a same-org `insert` policy on `document_jobs`); writes beyond that are service-role only.

To (re-)apply against a Supabase project, two options are now available (see §7 for full detail — **do not mix the two on the same database**, they track applied migrations independently):

```bash
# Option A: this project's own migration runner (SUPABASE_DB_URL required in .env)
bun run db:migrate

# Option B: Supabase CLI
supabase link --project-ref <your-project-ref>
supabase db push
```

After applying, regenerate `src/config/database.types.ts` from the live schema if it ever drifts from the hand-written version:
```bash
supabase gen types typescript --project-id <your-project-ref> > src/config/database.types.ts
```
(the `Relationships` arrays this project's hand-written types use were shaped to match Supabase's own generator output, so a regenerated file should be a drop-in replacement.)

## 4. Path Alias Refactor (2026-08-06)

All imports under `src/` were refactored from relative paths (`./`, `../`, `../../`) to absolute `@/*` aliases mapped to `src/*`:

- `tsconfig.json` already declared `"baseUrl": "."` with `"paths": { "@/*": ["src/*"] }` (set up during initial scaffolding) — verified unchanged, no edits needed there.
- Every `import`/`import type` in every `.ts` file under `src/` (config, middlewares, all four modules, services, utils, and `index.ts` itself) now uses `@/...`, including same-directory imports (e.g. `./auth.schema` → `@/modules/auth/auth.schema`) rather than leaving those as relative.
- No `node_modules` package imports (`elysia`, `zod`, `@supabase/supabase-js`, etc.) were touched — only first-party relative imports were converted.
- Verified two ways: `bun run typecheck` (`tsc --noEmit`) is clean, and the server was actually booted with `bun run src/index.ts` against a placeholder `.env` to confirm Bun's runtime resolver (which honors `tsconfig.json` `paths` natively, no extra bundler config needed) resolves the aliases correctly, not just the type checker.
- No `as` casts were introduced — this was a pure import-path rewrite, no logic or types changed.

## 5. `.gitignore` & Backend `README.md` (2026-08-06)

- **`.gitignore`** was rewritten from a minimal 6-line file into a comprehensive, production-grade ignore list covering: environment/secrets (`.env`, `.env.*`, with `!.env.example` explicitly re-included), dependencies/caches (`node_modules/`, `.bun/`, `.bun/cache/`, `.npm/`, `.pnpm-store/`), build outputs and logs (`dist/`, `build/`, `out/`, `*.log`, `npm-debug.log*`, `yarn-debug.log*`, `bun-debug.log*`), OS/editor junk (`.DS_Store`, `Thumbs.db`, `.vscode/*` with `settings.json`/`extensions.json` re-included, `.idea/`, `*.swp`), test coverage output, and root-level temp test fixtures (loose `.pdf`/`.zip`/image files dropped at the repo root during manual testing — scoped to the root only, via `/*.pdf` etc., so it never hides intentionally committed fixtures nested in subfolders).
- **`README.md`** was added at the backend root: title/overview, tech stack rationale table, an ASCII directory-structure map of the layered architecture (`config/ → modules/ → services/ → middlewares/ → utils/`), a step-by-step walkthrough of the full request lifecycle (rate limit → auth → pre-flight quota check → ZIP batch handling → Azure's HTTP 202 submit/poll pattern → client polling), a Getting Started section (`.env` setup, `bun install`, `bun run dev/start/typecheck`, Swagger at `/docs`), and a proprietary/restricted-use license notice as specified.
- Both files describe the backend only — no frontend content was added, since there is none in this repository.

## 6. Pre-flight Validation & Zip Batch Logic (how the quota protection works)

`documents.service.ts`:

1. `submitUpload` checks `file.size` against `MAX_UPLOAD_SIZE_MB` (hard server cap) before reading any bytes, then sniffs the first bytes for a ZIP signature to decide single-file vs. batch.
2. **Single file** (`processSingleDocument`): `inspectDocumentFile` → real MIME type + PDF page count → `assertFileMeetsPlanConstraints` (file size vs. `max_file_size_mb`, page count vs. `max_pages_per_document`, both **hard** per-file caps, no DB row on failure) → monthly quota check (`pagesUsed + pageCount > max_pages_per_month` or `documentsUsed + 1 > max_documents_per_month`) → on quota failure, a `document_jobs` row is written with `status = 'rejected_quota'` for audit purposes and a `422` is returned → on success, a `pending` row is created, then submitted to Azure and flipped to `processing`.
3. **Zip batch** (`processZipBatch`): extracts all entries in memory, then loops with a **running in-memory quota counter** seeded from the DB — this is what stops many small files inside one archive from cumulatively blowing through the monthly quota even though each individually looked fine against the initial DB snapshot. Each file gets one of `processing / rejected / rejected_quota / failed` in the response; the archive is never rejected wholesale for one bad file inside it.
4. **Polling** (`getJobStatus`): terminal jobs (`completed/failed/rejected_quota`) are returned straight from the DB with no Azure call; in-flight jobs get one live `GET` against the stored `Operation-Location`, and the row is only written back to the DB when Azure reports a terminal state (`succeeded`/`failed`), to minimize writes.

## 7. Automated Supabase Migration Tooling (2026-08-06)

Added a real migration runner and validated it end-to-end against the live Supabase project (`.env` now has real Supabase credentials).

- **`scripts/db-migrate.ts`** reads every `.sql` file in `supabase/migrations/` (sorted ascending, numeric-aware), applies each one **inside its own transaction** against Postgres, and tracks what's already been applied in a `public._migrations(filename, applied_at)` table it creates on first run — so re-running the script is safe and idempotent; already-applied files are skipped.
- **Why it doesn't use `@supabase/supabase-js`** (as originally asked): `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` authenticate PostgREST, which only exposes specific tables/views/RPC functions — there is no generic "run arbitrary SQL" endpoint, by design. Nothing in our schema defines an `exec_sql`-style RPC either (and creating one would itself require running SQL first). So the script instead connects directly to Postgres over the wire protocol using the `postgres` package (added as a new dependency) and a new env var, **`SUPABASE_DB_URL`** (documented in `.env.example`, optional — only `db-migrate.ts` reads it via `Bun.env`, it was deliberately **not** added to `src/config/env.ts`'s Zod schema so the main app's boot-time validation and every other script/route stay unaffected by whether it's set).
- **`package.json`** gained two scripts: `db:migrate` (`bun run scripts/db-migrate.ts`) and `db:push` (`supabase db push`, the Supabase CLI's own equivalent, offered as an alternative). **These two are not interoperable** — `db:migrate` tracks state in `public._migrations`, the CLI tracks it in `supabase_migrations.schema_migrations`; mixing them against the same database means neither tool will know what the other already applied. Pick one per environment.
- **Connectivity gotcha hit and resolved during validation:** the direct Postgres hostname (`db.<ref>.supabase.co:5432`) resolves to an IPv6-only address on this Supabase project, and the sandbox this was run from has no IPv6 egress, so the first attempt failed with `ECONNREFUSED`. Fixed by switching `SUPABASE_DB_URL` to Supabase's **connection pooler** (Supavisor) endpoint instead — `aws-<n>-<region>.pooler.supabase.com:5432` with username `postgres.<project-ref>` — which is IPv4-compatible. Worth knowing if this is ever run from another IPv6-less environment (most CI runners, some sandboxes).
- **A real bug was caught and fixed by this first live run**, not by typechecking (which can't catch this — it's a Postgres catalog-validation-order issue, invisible to TypeScript): `0002_organizations.sql` originally defined `current_organization_id()` (a `LANGUAGE SQL` function whose body queries `public.profiles`) before `profiles` existed (`profiles` was created in `0003`). Postgres validates `LANGUAGE SQL` function bodies against the catalog at `CREATE FUNCTION` time — unlike `plpgsql`, which defers to first call — so this failed immediately on the real database with `relation "public.profiles" does not exist`. The transaction wrapper meant this rolled back cleanly with no partial state. **Fix:** split the migrations — `0002` and `0003` now contain only their tables (no RLS/policies), and a new `0004_authorization.sql` defines `current_organization_id()` plus the `organizations`/`profiles` RLS policies that depend on it, now correctly ordered after both tables exist. The old `0004_plans.sql` → `0007_usage_functions.sql` were renumbered up to `0005`–`0008` accordingly (renamed via `git mv` to preserve history — this happened before any commit had successfully applied them to production, so it was the right time to fix the ordering rather than patch around it).
- **Verified:** `bun run db:migrate` applied all 8 migrations successfully against the live project (`7 migration(s) applied, 1 already up to date` on the second run, after the fix); confirmed via a direct query that all six tables (`organizations`, `profiles`, `plans`, `subscriptions`, `document_jobs`, `_migrations`) exist and that the `plans` table seeded correctly (`free`: 1 page/document, 2 pages/month; `basic`; `pro`). `bun run typecheck` remains clean after all of this.

## 8. Azure Document Intelligence End-to-End Test (2026-08-06)

Added `scripts/test-e2e-azure.ts`, a self-contained live pipeline test: it spawns its own instance of the app (on a dedicated port, isolated from any `bun run dev` already running), signs up (or logs in, if the email already exists) a fresh test user via the real HTTP API, generates a mock invoice PDF **in memory with `pdf-lib`** (no fixture file on disk), uploads it through the real `POST /api/v1/documents` multipart endpoint, and polls `GET /api/v1/documents/jobs/:id` every 2 seconds until Azure reports a terminal state — printing the full extracted result payload at the end. Response shapes from the API are validated with Zod (`safeParse`/`parse`), consistent with the rest of the codebase — no `as` casts. Run it with `bun run scripts/test-e2e-azure.ts`.

**This surfaced and led to fixing a real, serious bug** — not something a fresh Azure resource alone would have caught; it required actually exercising the full request path with a real signup:

- **Symptom:** every document upload failed with `500 INTERNAL_ERROR: Cannot coerce the result to a single JSON object` — but only when going through the real running server, never when the same Supabase queries were replicated standalone.
- **Root cause:** `auth.repository.ts`'s `signInWithPassword` (called by both signup and login) was calling `.auth.signInWithPassword()` on the **shared `supabaseAdmin` singleton**. supabase-js mutates a client's own internal session on any successful sign-in, and from then on uses that session's user JWT — instead of the key the client was created with — as the Authorization header for every subsequent `.from()`/`.rpc()` call made on that *same client instance*. Since `supabaseAdmin` is a module-level singleton shared across the entire process, the **first** user to sign up or log in silently downgraded it from `service_role` to their own `authenticated` role for **every other request the server handles afterward**, until another sign-in overwrote it again.
- **Why it looked like a document-upload bug specifically:** the `document_jobs` RLS policies (0004_authorization.sql) grant `authenticated` users `select` and `insert` (scoped to their own org/user), by design, but deliberately **no `update`/`delete`** policy — those are meant to be service-role-only. So under a downgraded client, `INSERT` kept succeeding (matched the insert policy) while every subsequent `UPDATE` — marking a job `processing` or `failed` — silently matched 0 rows under RLS and threw. This is exactly why it reproduced 100% of the time through the real signup→upload flow but never in a standalone script that skipped sign-in.
- **Fix:** `src/config/supabase.ts` gained `createAuthClient()`, which constructs a **fresh, one-off** client (with the anon key) for password sign-in only, never reusing or mutating `supabaseAdmin`. `auth.repository.ts`'s `signInWithPassword` now calls `createAuthClient().auth.signInWithPassword(...)` instead of `supabaseAdmin.auth.signInWithPassword(...)`. `auth.admin.createUser()` and `auth.getUser(token)` (used by `auth.middleware.ts` on every request) were both verified empirically to **not** mutate client session state, so they were left on `supabaseAdmin`.
- **Incidentally, this also answers §7's "RLS is unverified" concern from the previous entry**: chasing this bug down *was* an end-to-end exercise of the RLS policies as a non-service-role client, and they behaved exactly as designed (insert allowed, update correctly denied) — which is what made the bug diagnosable in the first place.
- Also added lightweight `console.error` logging of the full Postgres/PostgREST error object (code, details, hint) in `documents.repository.ts`'s `createDocumentJob`/`updateDocumentJob` and in `documents.service.ts`'s `submitToAzure` catch block — previously these were fully swallowed into a bare `.message` string, which is what made this bug slow to diagnose. Kept permanently, not just for this session, since server-side visibility into DB failures is worth it and these never leak to the client response.

**Verified:** `bun run scripts/test-e2e-azure.ts` completes successfully end-to-end against the real Azure resource — job goes `processing` → `completed` after 4 polls (~8s), and the printed `resultJson` contains genuine Azure `prebuilt-invoice` extraction output (`docType: "invoice"`, confidence `1`, fields like `BillingAddressRecipient` correctly pulled from the mock PDF). `bun run typecheck` remains clean.

## 9. Current State & Next Steps

**Verified so far:** `bun install`, `bun run typecheck` (clean, zero errors, zero `as` casts), the server boots and responds correctly (`bun run dev` / `bun run start`) — manually smoke-tested `/health`, `/docs`, auth-guard rejection (401 with structured JSON), Zod validation errors (400 with per-field issues), 404 handling, and multipart auth-gating — **all 8 database migrations are applied and verified against the live Supabase project (§7)** — and **the full document pipeline (signup → upload → Azure submit → poll → completed, with real extracted fields) is verified working end-to-end against live Azure and Supabase resources (§8)**.

**Not yet done / explicitly out of scope for this pass:**

- **No automated tests** — nothing here has unit/integration test coverage yet; would recommend starting with `documents.service.ts`'s quota math (the in-memory running-quota logic in `processZipBatch` is the highest-value thing to pin down with tests) and the error-middleware status-code mapping. The §8 bug is also a good argument for a regression test around "does any code path call an auth-session-mutating method on `supabaseAdmin`" (e.g. a lint rule or a runtime assertion), since it's the kind of bug that's invisible until a second concurrent user hits the server.
- **No background job worker** — `GET /jobs/:id` polls Azure synchronously, on-demand, inside the request handler. That satisfies the stated requirement, but a production version processing high volume would likely want a background poller (or Azure webhook, if the API ever supports one) updating `document_jobs` independently of client polling, so jobs make progress even if no one is polling.
- **No billing/payment provider integration** — `subscriptions` are modeled and readable, but nothing creates/upgrades a subscription (no Stripe or similar webhook handler yet). Signing up currently leaves an org with no `subscriptions` row, i.e. on the implicit free tier by design.
- **Team management is not implemented** — `profiles.role` (`owner/admin/member`) exists in the schema and RLS, but there's no invite-teammate / change-role endpoint yet.
- **Rate limiting is single-instance/in-memory** — fine for one server process; needs a shared store (Redis) before horizontal scaling.
- **`scripts/test-e2e-azure.ts` leaves test data behind** — each run creates a new timestamped test user/org (no cleanup step), so the live Supabase project will accumulate `e2e-test-*` users/orgs and their document_jobs over repeated runs. Harmless for a dev/staging project (each run gets a fresh free-tier org, well under quota) but worth periodically clearing out, or extending the script with a teardown step, before this project has real customer data alongside it.

**To resume work**, the next most valuable steps in order would be: (1) add the Stripe (or similar) webhook to actually create/update `subscriptions` rows, (2) add tests around the quota logic and the auth-client-isolation bug from §8 before touching either further, (3) add a background poller so jobs progress without a client actively polling, (4) build the teardown/cleanup step for the E2E test script.
