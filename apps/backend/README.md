# TNDA-AI Backend API

## Overview

**TNDA-AI Backend** is a multi-tenant SaaS backend engine built with **Bun** and **ElysiaJS**, purpose-built for SMBs and retail stores to automate document processing — invoices, receipts, multi-page PDFs, and `.zip` archives of documents — using **Azure Document Intelligence**, with **Stripe**-backed subscription billing.

The service is organization-scoped from the ground up: every user belongs to an `organization`, every `organization` is on a `plan` (free / basic / pro) with hard limits on file size, pages per document, pages per month, and documents per month, and every document processing job is pre-validated against those limits **before** a single byte is sent to Azure — protecting both cost and quota. Organizations upgrade their plan through a real Stripe Checkout flow, and Stripe webhooks keep the org's plan in sync automatically as subscriptions are created, updated, or canceled.

This README documents the backend only. There is no frontend in this repository.

---

## Tech Stack & Key Libraries

| Concern | Choice | Why |
|---|---|---|
| **Runtime** | [Bun](https://bun.sh) | Native TypeScript execution (no separate build step for dev), fast startup, built-in `fetch`/`File`/test runner, native `tsconfig.json` path-alias resolution. |
| **Framework** | [ElysiaJS](https://elysiajs.com) | High-throughput router built for Bun, first-class TypeScript inference end-to-end, built-in Swagger/OpenAPI generation, Standard Schema support (so Zod schemas plug in directly as route validators — no parallel TypeBox schema layer). |
| **Validation** | [Zod](https://zod.dev) | Every request body/params object is a Zod schema, passed straight into Elysia's `body`/`params` validators via the Standard Schema protocol. Full type inference, **zero `as` type assertions** anywhere in the application code (enforced by ESLint — see Testing & Code Quality below). |
| **Database & Auth** | [Supabase](https://supabase.com) (PostgreSQL + Row Level Security) | Postgres with RLS policies scoped by `organization_id` as defense-in-depth; the backend itself talks to Postgres via the **service-role key** (bypasses RLS) and enforces tenant isolation explicitly in every repository query, since it's a trusted server context. |
| **Billing** | [Stripe](https://stripe.com) (Checkout, Billing Portal, Webhooks) | Hosted Checkout Sessions for plan upgrades, the Billing Portal for self-service payment/invoice management, and a webhook endpoint that syncs subscription state (`created`/`updated`/`deleted`) back into `subscriptions`, keyed by `stripe_subscription_id` so events converge on one row regardless of delivery order. |
| **External Integration** | Azure Document Intelligence — **REST API**, called directly via `fetch` | Implements the async `HTTP 202` submit/poll pattern by hand (see §Data Flow) rather than using the `@azure/ai-form-recognizer` SDK's poller, because this backend persists the operation location and resumes polling from a **separate, later HTTP request** — a shape the SDK's in-process poller isn't designed for. Includes exponential backoff + jitter on `429 Too Many Requests`. The adapter itself (`azure-document-intelligence.service.ts`) takes the Azure model ID as a parameter and has no opinion on which one to use — that decision belongs to the domain layer's strategy registry (`documents.strategy.ts`), not a global setting. |
| **File Utilities** | `pdf-lib`, `fflate`, `file-type` | `pdf-lib` reads a PDF's page tree to get an exact page count **without rendering any page**; `fflate` decompresses `.zip` archives fully in memory (no temp files on disk); `file-type` sniffs a file's real MIME type from its magic bytes, so the pre-flight check never trusts a client-supplied `Content-Type` header. |
| **Testing** | [Vitest](https://vitest.dev) (run via Bun) | Unit and in-process integration tests — real HTTP request/response cycles via Elysia's `.handle(request)`, no port ever bound. Dummy, non-secret env values live in `vitest.config.ts` itself, so the suite never needs real Supabase/Azure/Stripe credentials to run, locally or in CI. |
| **Linting** | [ESLint](https://eslint.org) (flat config, `typescript-eslint`) | Formalizes this project's zero-`as`/zero-`any` convention as an enforced rule, not just a habit — `@typescript-eslint/consistent-type-assertions` and `no-explicit-any` are both errors in application code. |
| **Containerization** | [Docker](https://www.docker.com) (multi-stage, `oven/bun` base) | A 5-stage build where `typecheck`/`lint`/`test` are a hard **build-time gate** — the image cannot be built at all if any of them fail. Final image runs as a non-root user on a minimal Alpine base. |

---

## System Architecture & Directory Structure

The codebase follows a clean, layered, domain-modular architecture. Every domain module is internally consistent: `*.routes.ts` (HTTP layer) → `*.service.ts` (business logic) → `*.repository.ts` (Supabase access) → `*.schema.ts` (Zod DTOs), with `*.test.ts` files colocated next to what they test. All first-party imports use the `@/*` path alias (mapped to `src/*` in `tsconfig.json`) instead of relative paths.

```
backend/
├── src/
│   ├── config/                       # Environment validation & client/SDK setup
│   │   ├── env.ts                    #   Zod-validated process.env — the app refuses to boot on missing/invalid config
│   │   ├── supabase.ts               #   Service-role Supabase client (supabaseAdmin) + createAuthClient() for password sign-in
│   │   ├── database.types.ts         #   Hand-written Database type mirroring supabase/migrations/
│   │   ├── azure.ts                  #   Azure Document Intelligence endpoint/key/api-version config — deliberately no model ID (see documents.strategy.ts)
│   │   └── stripe.ts                 #   Stripe client + plan-slug ↔ Price-ID mapping
│   │
│   ├── modules/                      # Domain modules — one folder per bounded context
│   │   ├── auth/                     #   Signup, login, "me" — Supabase Auth orchestration
│   │   │   ├── auth.routes.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.repository.ts
│   │   │   └── auth.schema.ts
│   │   ├── organization/             #   Org profile, effective plan resolution, usage/quota computation, analytics
│   │   │   ├── organization.routes.ts
│   │   │   ├── organization.service.ts
│   │   │   ├── organization.repository.ts
│   │   │   ├── organization.schema.ts        # query validation for /me/stats (bounded `since` window)
│   │   │   ├── organization.routes.test.ts
│   │   │   ├── organization.service.test.ts
│   │   │   └── organization.repository.test.ts
│   │   ├── billing/                  #   Plan catalog, current subscription, Stripe Checkout/Portal/webhook sync
│   │   │   ├── billing.routes.ts
│   │   │   ├── billing.service.ts
│   │   │   ├── billing.repository.ts
│   │   │   ├── billing.schema.ts
│   │   │   ├── billing.routes.test.ts
│   │   │   ├── billing.service.test.ts
│   │   │   └── billing.repository.test.ts
│   │   └── documents/                #   Upload, pre-flight validation, ZIP batch handling, job polling, listing
│   │       ├── documents.routes.ts
│   │       ├── documents.service.ts
│   │       ├── documents.repository.ts       # incl. keyset-cursor pagination for the list endpoint
│   │       ├── documents.schema.ts
│   │       ├── documents.strategy.ts         # Document-type → processing-strategy registry (owns model selection)
│   │       ├── documents.strategy.test.ts
│   │       ├── documents.routes.test.ts
│   │       └── documents.repository.test.ts
│   │
│   ├── services/                     # External API adapters (integrations outside our own DB)
│   │   └── azure-document-intelligence.service.ts   # Pure Azure REST adapter — submit + poll, 429 backoff, no model opinion
│   │
│   ├── middlewares/                  # Cross-cutting HTTP concerns, applied as Elysia plugins
│   │   ├── auth.middleware.ts        #   Verifies Supabase bearer token, injects { userId, organizationId, role }
│   │   ├── error.middleware.ts       #   Centralized onError → structured { error: { code, message, details? } } JSON
│   │   ├── error.middleware.test.ts
│   │   └── rate-limit.middleware.ts  #   In-memory fixed-window limiter, keyed by client IP
│   │
│   ├── utils/                        # Pure, dependency-light helpers shared across modules
│   │   ├── file-inspector.ts         #   Magic-byte MIME detection + PDF page counting
│   │   ├── zip.ts                    #   In-memory .zip extraction & junk-entry filtering
│   │   ├── confidence.ts             #   Averages Azure's per-field confidence scores; null when a model has none
│   │   ├── confidence.test.ts
│   │   ├── errors.ts                 #   AppError hierarchy (ValidationError, QuotaExceededError, ...)
│   │   └── errors.test.ts
│   │
│   └── index.ts                      # App composition root — plugins, middleware order, route mounting, .listen()
│
├── scripts/                          # Standalone dev/ops scripts (run directly via `bun run scripts/...`)
│   ├── db-migrate.ts                 #   Applies supabase/migrations/*.sql over a direct Postgres connection, idempotently
│   └── test-e2e-azure.ts             #   Live pipeline test: signup → upload → real Azure submit/poll → completed
│
├── supabase/
│   └── migrations/                   # Numbered SQL migrations (schema + RLS policies + seed data)
│
├── .github/
│   └── workflows/ci.yml              # typecheck → lint → test on every push/PR
│
├── Dockerfile                        # Multi-stage build; typecheck/lint/test gate the image build itself
├── .dockerignore
├── vitest.config.ts                  # Path alias + dummy test env vars
├── eslint.config.js                  # Flat config, typescript-eslint
├── .env.example                      # Template for required environment variables
├── tsconfig.json                     # Strict TS config + "@/*" → "src/*" path alias
└── package.json
```

---

## API Endpoints

| Module | Endpoint | Auth | Purpose |
|---|---|---|---|
| health | `GET /health` | none | Liveness check |
| auth | `POST /api/v1/auth/signup` | none | Creates a Supabase auth user + organization + owner profile |
| auth | `POST /api/v1/auth/login` | none | Password sign-in, returns a session |
| auth | `GET /api/v1/auth/me` | Bearer | Current user + organization |
| organization | `GET /api/v1/organizations/me` | Bearer | Org record + usage summary |
| organization | `GET /api/v1/organizations/me/usage` | Bearer | Pages/documents used vs. plan limits for the current billing period |
| organization | `GET /api/v1/organizations/me/stats` | Bearer | Success rate, avg. processing time, and a gap-filled daily job-count series (`?since=<ISO datetime>`, defaults to the last 30 days, capped at 400 days back) |
| billing | `GET /api/v1/billing/plans` | Bearer | Plan catalog (free/basic/pro) |
| billing | `GET /api/v1/billing/subscription` | Bearer | Org's effective plan + subscription row (or implicit free tier) |
| billing | `POST /api/v1/billing/checkout` | Bearer | Creates a Stripe Checkout Session (`{ planId: 'basic'\|'pro', redirectUrl? }` → `{ url }`) |
| billing | `POST /api/v1/billing/portal` | Bearer | Creates a Stripe Billing Portal session (`{ returnUrl? }` → `{ url }`) |
| billing | `POST /api/v1/billing/webhook` | **public** — Stripe signature, not bearer | Receives `checkout.session.completed` / `customer.subscription.created`\|`updated`\|`deleted`, syncs `subscriptions` |
| documents | `POST /api/v1/documents` | Bearer | Multipart upload — single file **or** `.zip` batch, with an optional `documentType` field (`invoice`\|`receipt`\|`identity_document`\|`generic`, defaults to `invoice`) selecting the processing strategy |
| documents | `GET /api/v1/documents` | Bearer | Cursor-paginated job list — filter by `status`, `documentType`, `search` (matches `fileName`), `dateFrom`/`dateTo`; `limit` 1-100 (default 20) |
| documents | `GET /api/v1/documents/jobs/:id` | Bearer | Polls job status, pulling a fresh status from Azure if still in flight |

Swagger UI is mounted at `/docs`.

---

## Detailed Data & Execution Flow

### 1. Request Ingestion

```
HTTP Request
   │
   ▼
Rate Limit Middleware (src/middlewares/rate-limit.middleware.ts)
   │  in-memory fixed window per client IP; 429 with Retry-After-style detail if exceeded
   ▼
Auth Middleware (src/middlewares/auth.middleware.ts)   [protected routes only]
   │  extracts Bearer token → supabaseAdmin.auth.getUser(token) → loads `profiles` row
   │  injects `auth: { userId, email, organizationId, role }` into the route context
   ▼
Zod body/params/query validation (Elysia Standard Schema)   [per-route]
   │  400 with per-field issues on failure
   ▼
Route handler → Service layer → Repository layer (Supabase)
```

Every error thrown anywhere in this chain — ours (`AppError` subclasses) or Elysia's own (validation, parse, not-found) — is caught by the global `error.middleware.ts` and normalized to:

```json
{ "error": { "code": "QUOTA_EXCEEDED", "message": "...", "details": { "...": "..." } } }
```

### 2. Pre-Flight Inspection & Quota Check (`documents.service.ts`)

Before a single byte is sent to Azure, every uploaded file goes through:

1. **Size gate** — the raw upload is checked against `MAX_UPLOAD_SIZE_MB` (hard server cap) via `File.size`, before reading any bytes.
2. **Magic-byte MIME detection** — `file-type` inspects the file's binary header to determine its *true* type (`application/pdf`, `image/png`, `image/jpeg`, `image/tiff`, `image/bmp`); the client-supplied `Content-Type` is never trusted.
3. **Page count extraction** — for PDFs, `pdf-lib` parses only the document's page tree/cross-reference table to get an exact page count, without rendering or OCR-ing a single page.
4. **Per-file plan constraints** — the organization's *effective plan* (its active subscription, or the implicit `free` tier if it has none) is resolved, and the file is checked against:
   - `max_file_size_mb` — file too large → `413 Payload Too Large`
   - `max_pages_per_document` — e.g. the free plan caps a single document at **1 page** → `422 Quota Exceeded`
5. **Monthly quota check** — the organization's current-period usage is computed (`SUM(page_count)` over `document_jobs` via the `get_organization_monthly_usage` Postgres function, plus a document count), and:
   ```
   if current_monthly_pages + new_file_pages > plan.max_pages_per_month:
       reject with HTTP 422 (QUOTA_EXCEEDED)
       persist a document_jobs row with status = 'rejected_quota'  (audit trail)
   ```
   Only once every check passes does the file get submitted to Azure.

### 3. ZIP Archive Handling (`documents.service.ts → processZipBatch`)

- The archive is decompressed **fully in memory** via `fflate` — no temporary files are ever written to disk.
- Directory entries, `__MACOSX/`, `.DS_Store`, and empty entries are filtered out before any file reaches validation.
- The organization's usage baseline is fetched **once** per batch, then a running in-memory quota counter is incremented as each file is accepted — this is what stops many small files inside a single archive from cumulatively exceeding the monthly quota even though each one looks fine in isolation against the initial database snapshot.
- Each file in the archive independently ends up as one of: `processing`, `rejected` (bad type/corrupt/too large), `rejected_quota` (would exceed quota), or `failed` (Azure submission error) — one bad file never aborts the rest of the batch. The response returns granular per-file status.

### 4. Document Type → Processing Strategy, then the HTTP 202 Async Pattern

**Strategy resolution (`documents.strategy.ts`, domain layer):**

```
requested documentType ("invoice" | "receipt" | "identity_document" | "generic")
      │
      ▼
getProcessingStrategy(documentType)   — looks up a Record<DocumentType, DocumentProcessingStrategy>
      │
      ▼
strategy.submit(bytes, mimeType)
      │  today, every strategy is "call Azure with a specific prebuilt model" —
      │  invoice → prebuilt-invoice, receipt → prebuilt-receipt,
      │  identity_document → prebuilt-idDocument, generic → prebuilt-layout
      ▼
```

This is the layer that decides *which* model (or, in the future, provider) handles a document — not `azure-document-intelligence.service.ts`, and not a global config value. Adding a new document type, repointing one at a different Azure model, or swapping a strategy to a different provider entirely (or a multi-step Azure+LLM pipeline) only touches this one file; `documents.service.ts`, the routes, and the Azure REST adapter are unaffected either way. (Status polling and the `document_jobs.azure_operation_id` column still assume Azure's Operation-Location model specifically — that part hasn't been generalized, since every strategy today is still Azure-backed.)

**Then the actual submission (`azure-document-intelligence.service.ts` — a pure Azure REST adapter, takes the model ID as a parameter, has no opinion on which one to use):**

```
1. POST {endpoint}/documentModels/{modelId}:analyze   (raw file bytes, Ocp-Apim-Subscription-Key header)
      │
      ▼  202 Accepted
   Operation-Location header captured
      │
      ▼
2. INSERT document_jobs (status='pending') → UPDATE status='processing', azure_operation_id=<Operation-Location>
      │
      ▼
3. Respond to client immediately:  { jobId, status: "processing", fileName, pageCount }
```

`429 Too Many Requests` from Azure (on either submit or poll) is retried automatically with exponential backoff + jitter, honoring the `Retry-After` header when Azure provides one — this happens transparently inside `fetchWithRetry`, so callers never see a 429 propagate.

### 5. Client Polling (`GET /api/v1/documents/jobs/:id`)

```
Client → GET /api/v1/documents/jobs/:id
   │
   ▼
documents.service.ts → getJobStatus(organizationId, jobId)
   │
   ├─ job.status is terminal (completed/failed/rejected_quota)?
   │     └─ return straight from Supabase, no Azure call
   │
   └─ job.status is pending/processing?
         └─ GET job.azure_operation_id  (one live poll against Azure)
               ├─ succeeded → UPDATE document_jobs SET status='completed', result_json=<analyzeResult>
               ├─ failed    → UPDATE document_jobs SET status='failed', error_message=<...>
               └─ notStarted/running → return current status, no DB write
```

The client is expected to poll this endpoint (e.g. every 2–5 seconds) until `status` is `completed`, `failed`, or `rejected_quota`.

### 6. Stripe Billing Flow (`billing.service.ts`)

**Checkout (upgrade a plan):**

```
POST /api/v1/billing/checkout  { planId: "basic" | "pro", redirectUrl? }
   │
   ▼
resolveOrCreateStripeCustomer(organizationId, email)
   │  org already has organizations.stripe_customer_id? → reuse it
   │  otherwise → stripe.customers.create() → persist the new id
   ▼
stripe.checkout.sessions.create({ mode: "subscription", customer, line_items: [price], ... })
   │
   ▼
Respond immediately:  { url: "https://checkout.stripe.com/..." }   (client redirects the user there)
```

**Webhook (Stripe → us, keeps `subscriptions` in sync):**

```
POST /api/v1/billing/webhook   (public — registered before authMiddleware; Stripe never sends a bearer token)
   │  Elysia's `parse: "text"` hands back the raw, unparsed body — required because Stripe's HMAC
   │  signature check is byte-sensitive and breaks on a JSON-parsed-then-re-serialized body.
   ▼
verifyStripeWebhookEvent(rawBody, stripe-signature header)
   │  stripe.webhooks.constructEventAsync(...) → 400 VALIDATION_ERROR on a bad/missing signature
   ▼
handleStripeWebhookEvent(event)
   │
   ├─ checkout.session.completed → retrieve the full subscription, then sync it (below)
   │
   └─ customer.subscription.created / updated / deleted
         │
         ▼
      syncSubscriptionFromStripeObject(subscription)
         │  resolve org via organizations.stripe_customer_id
         │  read plan + billing period from subscription.items.data[0] (not the deprecated
         │  top-level current_period_start/end — Stripe moved those to the item level)
         │  map Stripe's status set down to our 5-value subscription_status enum
         ▼
      upsertSubscriptionFromStripe(...)   — UPSERT keyed by stripe_subscription_id, so
                                             created → updated → deleted all converge on one row
                                             regardless of delivery order
```

Unrecognized customers or price IDs are logged and skipped (still returns `200`) rather than thrown as errors — retrying a webhook delivery won't fix a data/config problem, so erroring would just cause Stripe to retry pointlessly for up to 3 days.

---

## Getting Started

### Prerequisites
- [Bun](https://bun.sh) ≥ 1.3 (developed and CI-tested against `1.3.14`)
- A Supabase project — you'll need both the REST API credentials (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`) and, only for running migrations, a direct Postgres connection string (`SUPABASE_DB_URL`)
- An Azure Document Intelligence resource (endpoint + API key)
- A Stripe account in test mode (secret key, webhook signing secret, and two recurring Price IDs for the `basic`/`pro` plans)

### Setup

```bash
# 1. Copy the environment template and fill in real values
cp .env.example .env

# 2. Install dependencies
bun install

# 3. Apply database migrations to your Supabase project
bun run db:migrate
#    Uses SUPABASE_DB_URL. If your project only exposes an IPv6 direct connection and
#    you're on a network without IPv6 egress, use Supabase's connection *pooler* string
#    instead (Dashboard -> Connect -> "Session pooler") — see PROGRESS.md §3/§7 for the
#    full story, and for the Supabase CLI (`bun run db:push`) as an alternative.

# 4. Run the dev server (hot reload)
bun run dev

# — or run it once without watching —
bun run start

# 5. In a SEPARATE terminal, run the background worker — required for any
#    uploaded document to actually get processed. `POST /documents` always
#    returns immediately with the job left `pending`; nothing advances it
#    past `pending` until this process claims and submits it to Azure. It
#    is NOT started by `bun run dev` and is not part of any other script —
#    without it, uploads will sit at "Waiting to process…" indefinitely
#    (this is expected, not a bug — see PROGRESS.md §23 for the full
#    investigation behind this note).
bun run worker:dev
```

### Available scripts

| Command | Description |
|---|---|
| `bun run dev` | Starts the server with `--watch` (auto-restarts on file change) |
| `bun run start` | Starts the server once, no watching (production-style run) |
| `bun run worker:dev` | Starts the background worker with `--watch` — run this **in a separate terminal**; it's not started by `bun run dev` (see above) |
| `bun run worker:start` | Starts the background worker once, no watching |
| `bun run typecheck` | Runs `tsc --noEmit` — strict mode, zero `as` casts enforced by convention |
| `bun run lint` | Runs ESLint over the whole project |
| `bun run test` | Runs the full Vitest suite once (`vitest run`) — no real credentials needed |
| `bun run test:watch` | Runs Vitest in watch mode |
| `bun run db:migrate` | Applies `supabase/migrations/*.sql` against `SUPABASE_DB_URL`, idempotently |
| `bun run db:push` | Applies migrations via the Supabase CLI instead (alternative to `db:migrate` — don't mix the two against the same database) |

Before pushing/opening a PR, `bun run typecheck && bun run lint && bun run test` is exactly what CI runs — see below.

### API Documentation

Once the server is running, interactive Swagger/OpenAPI docs are available at:

```
http://localhost:<PORT>/docs
```

(`PORT` defaults to `3000` — see `.env.example`.)

### Health Check

```
GET /health → { "status": "ok", "timestamp": "..." }
```

---

## Testing & Code Quality

- **`bun run test`** runs the Vitest suite (22 files, 239 tests) covering the `auth`, `billing`, `documents`, and `organization` modules end-to-end (service, repository, routes), the centralized error middleware, the rate limiter, the ZIP-extraction and file-inspection upload-security boundary, and the `AppError` hierarchy. None of it needs real Supabase/Azure/Stripe credentials: `vitest.config.ts` sets dummy, non-secret env values that satisfy `env.ts`'s eagerly-validated Zod schema.
- **Stripe webhook signature verification is tested for real, with zero network calls**: tests sign a plain JS payload locally with `stripe.webhooks.generateTestHeaderStringAsync()` (pure HMAC, same secret as the test env) and hand it to the real `verifyStripeWebhookEvent`/`handleStripeWebhookEvent` — exercising the actual verification code path a live Stripe delivery would hit.
- **Route-level tests run in-process** via Elysia's `app.handle(request)` — the real routes and the real error middleware, composed exactly as `src/index.ts` does, with no port ever bound. `documents.routes.test.ts`/`organization.routes.test.ts` are the first tests to exercise an *authenticated* route path end-to-end (rather than only asserting the no-token 401 case): they mock `supabaseAdmin.auth.getUser` and the `profiles` lookup that `auth.middleware.ts` itself makes, so a request carrying a bearer token reaches the real handler as a real authenticated user — the pattern to reuse for any future route test that needs auth to succeed.
- **Repository tests mock `supabaseAdmin`** with a minimal fake of Supabase's fluent query builder, verifying both the success path and the `AppError`-on-failure path for every exported function. `documents.repository.test.ts` extends the query-builder mock with the additional filter methods (`order`/`limit`/`ilike`/`gte`/`lte`/`lt`) the list endpoint's dynamic filtering needs; `organization.repository.test.ts` uses a plain `rpc` mock instead, since `getJobStatsAggregate`/`getDailyJobCounts` call Postgres functions rather than the fluent query builder.
- **`organization.service.test.ts` pins time with `vi.useFakeTimers()`** to test the daily-count gap-filling logic (`buildDailySeries`) deterministically — the service always computes its date range relative to `new Date()`, so the alternative would be asserting on relative day-offsets instead of exact dates, which is harder to read and easier to get subtly wrong.
- **ESLint** (`eslint.config.js`) enforces the project's zero-`as`/zero-`any` convention as a hard rule in application code (`@typescript-eslint/consistent-type-assertions: never`, `no-explicit-any: error`). Test files get a narrow, documented exception for mocking Supabase's deeply generic query-builder types — application code has no exceptions.

---

## Continuous Integration

`.github/workflows/ci.yml` runs on every push and pull request (to `master` — this repository's actual default branch):

```
bun install --frozen-lockfile → bun run typecheck → bun run lint → bun run test
```

No GitHub Secrets are required — the dummy test env values live in `vitest.config.ts`, and `typecheck`/`lint` don't execute any application code that reads environment variables at all.

---

## Docker

A production image is built with a 5-stage `Dockerfile` on `oven/bun:${BUN_VERSION}-alpine` (pinned to an exact Bun patch version, not the rolling `1-alpine` tag, to match what CI and local development actually run against):

```
base (workspace manifests + lockfile + packages/config's real content, pnpm installed via Bun)
  → install (this package's dependency chain, --filter=@tnda-ai/backend..., incl. dev)
    → test (copies source, runs typecheck/lint/test as a build-time gate — the image
             cannot build if any of them fail — then strips *.test.ts files)
  → install-prod (same filtered install, --prod, so devDependencies never enter it)
→ release (production-only node_modules + package.json/tsconfig.json/src, non-root `bun`
           user, HEALTHCHECK against the real /health endpoint)
```

Since this app lives in a pnpm workspace (see the root [`README.md`](../../README.md)), the **build context is the monorepo root**, not this directory — pnpm needs to see the root lockfile and every workspace member's `package.json` to resolve the dependency graph, even though `--filter` scopes the actual install down to just this package.

```bash
# Build (run from the monorepo root, not apps/backend/)
docker build -f apps/backend/Dockerfile -t tnda-ai-backend .

# Run (pass real config at runtime — never baked into the image)
docker run --rm -p 3000:3000 --env-file apps/backend/.env tnda-ai-backend
```

The `test` stage's `RUN bun run test` step is a genuine gate: because `.dockerignore` deliberately does **not** exclude `*.test.ts` files (excluding them would leave Vitest with nothing to run, silently defeating the gate), and because the `release` stage pulls `src/`/`package.json`/`tsconfig.json` specifically **from** the `test` stage, Docker is forced to actually build and pass it before the final image can exist at all.

---

## License & Legal Notice

**Notice:** Although this source code is hosted publicly for demonstration and open-source inspection, all rights are strictly reserved. Unauthorized copying, distribution, modification, commercial use, or creation of derivative works for monetary gain or competitive business purposes without explicit written authorization is strictly prohibited and subject to legal action.

© TNDA-AI. All rights reserved.
