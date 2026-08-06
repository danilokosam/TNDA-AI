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

Seven SQL files in `supabase/migrations/`, applied in order:

1. `0001_extensions.sql` — `pgcrypto` for `gen_random_uuid()`
2. `0002_organizations.sql` — `organizations` table + `current_organization_id()` helper (used by every other policy)
3. `0003_profiles.sql` — `profiles` table (`owner`/`admin`/`member` role enum), FK to `auth.users`
4. `0004_plans.sql` — `plans` catalog, seeded with `free` / `basic` / `pro` rows (idempotent `upsert`)
5. `0005_subscriptions.sql` — `subscriptions`, one active/trialing/past_due row per org enforced via partial unique index
6. `0006_document_jobs.sql` — `document_jobs` table + status enum (`pending/processing/completed/failed/rejected_quota`) + `updated_at` trigger
7. `0007_usage_functions.sql` — `get_organization_monthly_usage(org_id)` SQL function used by the pre-flight quota check

RLS is enabled on every table with `organization_id`-scoped `select` policies (and a same-org `insert` policy on `document_jobs`); writes beyond that are service-role only.

**These have not been applied to a live Supabase project** — no Supabase project was provided/linked in this session. To apply them:

```bash
# Option A: Supabase CLI (recommended)
supabase link --project-ref <your-project-ref>
supabase db push

# Option B: paste each file's contents, in numeric order, into the Supabase Dashboard's SQL Editor
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

## 7. Current State & Next Steps

**Verified so far:** `bun install`, `bun run typecheck` (clean, zero errors, zero `as` casts), and the server boots and responds correctly (`bun run dev` / `bun run start`) — manually smoke-tested `/health`, `/docs`, auth-guard rejection (401 with structured JSON), Zod validation errors (400 with per-field issues), 404 handling, and multipart auth-gating, all against a placeholder `.env` (no real Supabase/Azure credentials were available in this session).

**Not yet done / explicitly out of scope for this pass:**

- **No live Supabase project was linked** — migrations exist but were never run against a real database, and nothing here has been tested against real RLS enforcement or real Postgres constraints (only against the hand-written TypeScript types).
- **No real Azure Document Intelligence resource was available** — the REST integration (submit, poll, 429 backoff) is implemented and type-checked but has not made a real Azure call.
- **No automated tests** — nothing here has unit/integration test coverage yet; would recommend starting with `documents.service.ts`'s quota math (the in-memory running-quota logic in `processZipBatch` is the highest-value thing to pin down with tests) and the error-middleware status-code mapping.
- **No background job worker** — `GET /jobs/:id` polls Azure synchronously, on-demand, inside the request handler. That satisfies the stated requirement, but a production version processing high volume would likely want a background poller (or Azure webhook, if the API ever supports one) updating `document_jobs` independently of client polling, so jobs make progress even if no one is polling.
- **No billing/payment provider integration** — `subscriptions` are modeled and readable, but nothing creates/upgrades a subscription (no Stripe or similar webhook handler yet). Signing up currently leaves an org with no `subscriptions` row, i.e. on the implicit free tier by design.
- **Team management is not implemented** — `profiles.role` (`owner/admin/member`) exists in the schema and RLS, but there's no invite-teammate / change-role endpoint yet.
- **Rate limiting is single-instance/in-memory** — fine for one server process; needs a shared store (Redis) before horizontal scaling.

**To resume work**, the next most valuable steps in order would be: (1) link a real Supabase project and run the migrations, (2) plug in real Azure Document Intelligence credentials and do an end-to-end upload → poll → completed test, (3) add the Stripe (or similar) webhook to actually create/update `subscriptions` rows, (4) add tests around the quota logic before touching it further.
