# TNDA-AI — Session Log & Progress

## How to use this document

This is the **authoritative, project-wide session log** — read this first, and it should be enough to resume work without re-reading source or asking what happened. `apps/backend/PROGRESS.md` and `apps/frontend/PROGRESS.md` still exist and hold more granular, file-level implementation history for their own app (exact test names, line-level reasoning) — this document consolidates the *decisions*, *current state*, and *what's next* at the project level, and points into those two only for detail beyond that.

---

## 1. Project Overview

TNDA-AI is a multi-tenant SaaS platform for automated document processing (invoices, receipts, identity documents, generic scans — single files or `.zip` batches) via Azure Document Intelligence, with Stripe-backed subscription billing. Two applications: a Bun + ElysiaJS REST API (`apps/backend`) and a Next.js dashboard (`apps/frontend`), in a pnpm + Turborepo monorepo. **The backend is the single source of truth** for business logic, querying, filtering, pagination, and analytics — the frontend never queries Supabase directly for application data (it does use Supabase directly for one thing only: session/cookie management via `@supabase/ssr`, which is identity plumbing, not application data — see §4, decision 1).

---

## 2. Current State (as of this session's close)

- **Backend**: feature-complete for everything asked of it so far. Auth, organizations, billing (Stripe Checkout/Portal/webhooks), and documents (upload, single + `.zip` batch, polling, **list/filter/paginate**, **analytics/stats**) all implemented, tested (94 tests, all passing), and live-verified against the real Supabase project and real Azure/Stripe APIs at various points this session. Nothing currently blocking backend work — see §8 for what's explicitly deferred.
- **Frontend**: Stage 0 (bootstrap) and Stage 1 (shell + auth) complete and verified end-to-end. Stages 2-7 (Dashboard, Upload/Processing, Results, History, Billing, Settings) **not started**. This is the next work.
- **Repo**: single git history at the `TNDA-AI/` root (migrated from a backend-only repo this session — see §3.5), `apps/backend` + `apps/frontend` + `packages/{config,types,shared}`. 15 commits on `master` (including the commit that lands this document), tracking `github.com/danilokosam/TNDA-AI`. **Nothing has been pushed** — this sandbox has no configured GitHub push credentials (confirmed twice, not a regression).
- **Uncommitted work**: none as of the commit made at the end of this session (see the final commit this session produced, described in §3.5).

---

## 3. Session Timeline

### 3.1 Frontend architecture planning

Before any frontend code was written: re-verified the backend's exact API surface from source (not memory), and current (Aug 2026) versions of the entire required stack from the npm registry (several — Next.js, Tailwind, TypeScript, Zod, Framer Motion→Motion — had had recent breaking changes stale knowledge would've gotten wrong). Identified 6 real gaps between the spec and the backend's actual capabilities at the time (no list endpoint, no refresh endpoint, no logout endpoint, no original-file persistence, no `document_type`/confidence columns, but RLS already scoped `document_jobs` reads by org). Dispatched an independent review of the proposed auth architecture, which found several concrete problems before any code existed (rate-limiter sharing once proxied, Server Components can't write cookies so refresh must centralize in `proxy.ts`, a Vercel body-size caveat for uploads, logout needing real token revocation) — see §4, decision 3, for the resolutions. A subsequent self-review (deliberately hunting for unnecessary complexity before writing code, not after) cut a planned generic catch-all proxy in favor of purpose-built routes, dropped an unneeded `/api/auth/refresh` route, and caught that Dashboard's stats and History's list were being conflated (an aggregate can't be correctly derived from one page of a paginated list).

### 3.2 Frontend Stage 0 — Bootstrap

`create-next-app` (Next 16.3.0, React 19.2.8, TypeScript 5.9.3, Tailwind v4.3.3, App Router, Turbopack, no `src/`, Bun), `tsconfig.json` tightened to match the backend's strictness, `shadcn init` (Radix primitives, Nova/Lucide preset), full dependency set installed at exact verified versions (see §9 for the full table), `.env`/`.env.example`, README/PROGRESS. Verified: typecheck/lint clean, dev server boots. Full detail: `apps/frontend/PROGRESS.md` §2.

### 3.3 Frontend Stage 1 — Shell + Auth

Built the full authenticated app shell: `proxy.ts` (centralized session refresh via `@supabase/ssr`'s `getUser()`, route protection, reciprocal `/login`↔`/dashboard` redirect, 401-not-redirect for unauthenticated `/api/*` calls), the `services/` → `/api/*` Route Handler → BFF architecture, sidebar/topbar shell, login/signup forms, 5 stub pages for the planned routes.

**The single biggest finding of this phase**: the plan's Eden Treaty approach (type-only importing the backend's exported `App` type for zero-hand-written DTOs) **does not work** — verified by testing, not assumed. `backend/src/index.ts` transitively imports every route module via the backend's own `@/*` alias; TypeScript resolves those imports using the *importing project's* `tsconfig.json` paths, not the imported file's own, so once pulled into a frontend file the alias resolves against the wrong root and fails outright. The fallback (`openapi-typescript` against the backend's mounted Swagger) also doesn't work — `@elysiajs/swagger` serializes raw Zod-internal `_def` trees instead of real JSON Schema, confirmed by fetching `/docs/json` directly and finding every response schema is a bare `{}`. Landed on a hybrid: files with zero internal imports (`database.types.ts`, `utils/errors.ts`) resolve fine as type-only cross-project imports and are used directly (zero duplication for those); everything else is hand-written Zod in `frontend/types/api.ts`, verified field-by-field against real backend source, parsed at every API call site (runtime safety, not just compile-time), with a compile-time `AssertExact<A,B>` check wherever a schema mirrors a type-importable DB row. **Caught a real bug in that safety net itself**: the first version used `declare const` for the assertion, which type-checks successfully regardless of what it resolves to (declaring a `never`-typed variable isn't itself an error) — a deliberate-break test (`price_monthly: z.number()` → `z.string()`) confirmed `tsc` still passed. Fixed by switching to a real assignment (`export const _checkX: AssertExact<...> = true`), which actually forces the check.

Verified end-to-end via `curl` against the real backend + Supabase project: signup → real org+profile created → single non-chunked `SameSite=lax` session cookie set → dashboard renders with real data → reciprocal redirect → `/api/organization` returns real parsed data → logout actually clears the session (not just the cookie) → subsequent access correctly denied → login → wrong password → invalid signup body, all behaving correctly. Full detail: `apps/frontend/PROGRESS.md` §3.

### 3.4 Backend REST contract extension

Mid-way into frontend Stage 2 (Dashboard), building its stats aggregate as a frontend-side direct-Supabase workaround (the plan's original resolution for backend gap #1) surfaced a real architectural tension, and this was **stopped and explained before implementing**, per explicit instruction. The user's decision: **the backend remains the single source of truth — the frontend must never query Supabase directly for application data.** Where the existing contract is insufficient, extend the backend with well-designed, general-purpose REST endpoints (not shaped to this one frontend — should serve any future client). This is documented in full, with all reasoning and every verification performed, in `apps/backend/PROGRESS.md` §14 — summary in §4 and §9 below.

### 3.5 Monorepo migration

Mid-way into the backend contract work (a clean pause point — one task fully done and verified, the next not yet started), the user asked for a pnpm + Turborepo monorepo with git history preserved, requesting a risk-minimizing plan first. The first draft reached for `git filter-repo` (rewrite history + force-push); asked to justify that against a simpler alternative, the simpler alternative (move `.git` to the new root, physically relocate tracked files, one ordinary commit) turned out to be strictly better — proven empirically in a throwaway repo before touching the real one (see §4 for the detail). Result: `apps/backend` (full original history intact, zero rewritten hashes) + `apps/frontend` (added fresh, no prior history) + `packages/{config,types,shared}`, real pnpm/Turborepo wiring, CI and Dockerfile reworked for the new structure. Full detail in the git history itself (commits `9708493`, `5541264`) and this document's §4-§7.

After the monorepo migration, backend contract work resumed and finished (§3.4's endpoints implemented, tested, verified, documented) — then this closing session: reviewed all uncommitted work, wrote this document, and produced one commit grouping the backend REST contract work (§3.4) together (the monorepo commits from §3.5 were already made separately, before this work started).

---

## 4. Architectural Decisions (what, and why)

1. **Backend is the single source of truth; frontend never queries Supabase directly for application data.** (User decision, §3.4.) Supersedes the original plan's resolution for backend gaps #1/#5 (frontend-side RLS reads for History/stats) — those are now real backend endpoints instead (§8). The one exception, deliberately not a violation of this rule: `@supabase/ssr` for session/cookie management is identity plumbing (the same category as the backend talking to Supabase Auth directly for token verification), not an application-data query.
2. **Session-only document preview, behind a swappable abstraction.** (User decision.) The backend never persists uploaded files; a persistent preview isn't achievable without new infrastructure, and isn't needed for the immediate upload→results flow that matters for v1. Built behind a `DocumentPreviewSource` union type (`session-blob | remote-url | unavailable`) specifically so a persistent backend-provided URL can replace it later without touching any UI component — an explicit requirement, not an implementation nicety. **Not yet implemented** (this is Stage 4/Results work) — the decision and the required shape are locked in, nothing built yet.
3. **`@supabase/ssr` hybrid auth session model.** Backend still owns signup/login orchestration (org+profile creation, with rollback) — bypassing it would leave orphaned `auth.users` rows. Immediately after, `setSession()` hydrates an `@supabase/ssr` server client, which then owns cookie/refresh lifecycle. Refresh centralized in `proxy.ts` (Server Components can't write cookies themselves). Logout calls `signOut()` for real server-side revocation, not just cookie clearing. `SameSite=Lax`, deliberately — `Strict` would drop the session cookie on the top-level GET redirect back from Stripe Checkout, silently logging the user out right after they pay.
4. **Hand-written Zod schemas + `AssertExact`, not Eden/openapi-typescript.** Both alternatives were tried and don't work (§3.3) — this isn't a fallback chosen for convenience, it's the only approach that actually functions given the two projects' independent `tsconfig`s and the backend's broken Swagger JSON output. Arguably *stronger* than either alternative would have been: real runtime validation at every call site, not just a compile-time promise.
5. **Keyset (cursor) pagination over offset, for `GET /documents`.** Offset pagination (`.range()`) drifts under concurrent inserts — a real case here, since a batch upload can add rows while someone's paging through their own history. Cursor is on `created_at` alone (no `id` tiebreaker) — a compound cursor would need Supabase's `.or()` raw-filter-string DSL, meaning decoded client-supplied cursor content would be interpolated into a filter *expression* rather than a filter *value*. Accepted trade: two jobs created in the exact same instant could theoretically land on opposite sides of a page boundary — rare enough (each row is a separate awaited round trip) not to be worth the larger attack surface. Cursor is opaque on the wire (base64url); a malformed one is treated as "first page," not an error.
6. **`successRate`/`averageConfidence`/etc. are `null`, never a fabricated `0`, when there's no data to compute them from.** A `0` success rate reads as "100% failure" when the honest state is "no data yet"; `generic` documents (Azure's `prebuilt-layout` model) have no per-field confidence at all, and forcing a `0` there would be a lie, not a default.
7. **Stats' daily-count series is gap-filled server-side, in the service layer**, not left sparse for clients to reconstruct. The Postgres function only returns days with actual activity; a day missing from that result is indistinguishable from "no data at all" to a client that doesn't know the query's internals — filling every day once, in one place, means every consumer gets a complete, chart-ready series.
8. **No history rewrite for the monorepo migration — verified, not assumed.** `git filter-repo` was the first instinct; asked to justify it against a simpler move-and-commit approach, that simpler approach was proven (in a throwaway repo, against a real bare "remote," before touching the real one) to preserve every commit hash unchanged, push as an ordinary fast-forward, and support `git log --follow`/`git blame` correctly across the move. No force-push anywhere in this migration.
9. **`packages/types`/`packages/shared` are scaffolded and workspace-wired, but deliberately left empty.** The backend's schemas are Zod v3, the frontend's are Zod v4 (an already-made, deliberate choice — not an oversight); backend code assumes Bun-only APIs in places. Moving code into a shared package now wouldn't remove the need for the hand-verification work already done, just relocate it. Real future sharing is a *deliberate* decision to make later, not a speculative one to force now.
10. **CSRF is covered by `SameSite=Lax` + all-mutations-are-POST, deliberately, not a token.** `SameSite=Lax` already withholds the cookie on cross-site subrequests; combined with every mutating route being POST, that closes the practical gap without adding a separate mechanism.
11. **No optimistic updates in the frontend, for now — considered per-feature, not a gap.** Checked against every real mutation in the app (upload-queue entries are already transient client-only state; "mark as reviewed" is explicitly local-only since there's no backend field to persist it to yet; a plan change redirects to Stripe and can't be optimistically shown; History has no mutations at all). Recorded so this reads as a considered decision if revisited later.
12. **Call paths are fixed and enforced, not just documented, in the frontend.** Server Components import `services/*.service.ts` directly (in-process); Client Components only reach the same code indirectly through this app's own `/api/*` Route Handlers. Every file under `services/` starts with `import "server-only"` so an accidental Client Component import fails the build instead of silently risking a path to tokens in a client bundle.

---

## 5. Bugs Found & Fixed This Session

| Bug | Where | Fix |
|---|---|---|
| `AssertExact` type-check was a silent no-op (`declare const` never validates anything) | `frontend/types/api.ts` | Switched to a real assignment (`export const _checkX: T = true`), which actually forces TypeScript to reject a `never` result. Caught by a deliberate-break test, not by inspection. |
| Two lint issues in Stage 1: `window.location.assign()` flagged for internal navigation; shadcn's generated `use-mobile.ts` flagged by `react-hooks/set-state-in-effect` | `frontend/features/auth/hooks.ts`, `frontend/hooks/use-mobile.ts` | Logout switched to `queryClient.clear()` + `router.push()` (a genuinely better fix, not a workaround). `use-mobile.ts`'s flagged line is a deliberate SSR-hydration-safety pattern (server and the client's first render must both start from the same `undefined` value) — kept as-is with a documented `eslint-disable-next-line`, since the "fix" the rule implies would reintroduce a real hydration-mismatch bug. |
| `@types/bun` doesn't resolve `bun-types` under pnpm | `apps/backend/package.json` | `tsconfig.json` points `types` at `bun-types`, a *different* package `@types/bun` only depends on transitively. Bun's own installer hoisted loosely enough not to notice; pnpm's strict `node_modules` doesn't. Fixed by depending on `bun-types` directly. Found by a real `tsc` failure on the first `pnpm install`, not by inspection. |
| Turborepo couldn't find the package manager binary | Monorepo tooling setup | `pnpm` was only reachable via `corepack pnpm ...`, not directly on `PATH` — turbo execs `pnpm` directly. Fixed with `corepack enable`. |
| A stray, harmless `~/dev-mode-danilo/backend/.claude/` directory appeared during the `apps/backend` move | Filesystem, outside the repo | Looks like a side effect of this session's own path-tracking reacting to the rename (this session's "additional working directory" was configured as the pre-move `TNDA-AI/backend` path, which stopped existing). Contains only inert session config, no project files. Left alone rather than deleted unilaterally — safe to remove whenever noticed. |
| Verified with `test`+`lint` but not `typecheck` again after adding new test files | Backend REST contract work | Vitest's transpilation doesn't fully type-check the way `tsc --noEmit` does, so a real type error (a test helper's inferred return type too loose for `DocumentJobRow`, plus `Response.json()` typing as `unknown` under this project's non-DOM lib config) sat undetected until the next full-workspace `typecheck` run. Fixed by giving the test helper an explicit return type and parsing HTTP response bodies through a real Zod schema instead of accessing properties on an `unknown` value directly. **Process note for future work: always re-run `typecheck` after adding test files, not just `test`+`lint`.** |

---

## 6. Verification Summary

- **Backend**: `bun run typecheck`/`lint`/`test` clean (94/94 tests). Every new/changed endpoint live-verified against the real Supabase project with real HTTP requests (not just unit tests) — signup, session persistence, org data, logout+revocation, document list pagination/filtering (seeded synthetic data, verified no gaps/overlaps across pages, every filter independently correct, invalid inputs rejected cleanly), and stats (default/custom windows, gap-filled daily series, both out-of-range rejections). Migration `0010_document_analytics.sql` applied to and verified against the live database.
- **Frontend**: `bun run typecheck`/`lint` clean. Full Stage-1 auth flow verified end-to-end via `curl` against the real backend + Supabase project (no browser tool available in this environment — this is the closest achievable to real verification here).
- **Monorepo**: `pnpm install` clean from the root; `turbo run typecheck/lint/test` green across every package; both dev servers boot from their new `apps/*` locations; the Stage-1 auth flow re-verified end-to-end after the relocation; git history integrity confirmed (`git log --follow`, `git blame`, a real non-force `git push` all behaving correctly).
- **Not verified — both real gaps, not overlooked**:
  - `apps/backend/Dockerfile` (reworked for the pnpm-workspace build context): reasoned through carefully and every `COPY` path confirmed to exist, but `docker build` itself couldn't run — the Docker socket isn't accessible without `sudo` in this sandbox, and `sudo` wasn't invoked without being asked. **Run an actual `docker build -f apps/backend/Dockerfile -t tnda-ai-backend .` from the repo root before relying on this in CI/deployment.**
  - Pushing to `origin/master`: no GitHub push credentials configured in this sandbox (confirmed at two separate points this session). All work is committed locally; push whenever convenient.

---

## 7. Technical Debt & Known Limitations

Inherited from the backend's own build (see `apps/backend/PROGRESS.md` §15 for the full list) — the ones most relevant to frontend work:
- **No team/role-management endpoints** (`profiles.role` exists, no invite/change-role route) — Settings (Stage 7) should not build non-functional UI for this.
- **No background job worker** — `GET /documents/jobs/:id` polls Azure synchronously, on-demand. The frontend's polling-with-backoff design (planned, not yet built — Stage 3) is load-bearing here, not just nice-to-have UX: the backend's rate limiter is IP-keyed and becomes a bucket shared across all users once every call is proxied through one Next.js server. This can be managed (backoff) but not fixed from the frontend — see the original plan file's Auth section for the full reasoning.
- **Rate limiting is single-instance/in-memory** on the backend — fine for now, would need a shared store before horizontal scaling.
- **`.zip` batches have one `documentType` for the whole archive**, not per-file.
- New from this session:
  - `packages/types`/`packages/shared` are empty scaffolds (§4, decision 9) — don't be surprised they're unpopulated; that's intentional.
  - Frontend has no test suite yet (backend does; frontend Stage 1 was verified via manual `curl` checks only).
  - Multi-tab logout is eventually-, not immediately, consistent (a second open tab discovers logout on its next request, not instantly) — accepted default, documented in the frontend's original plan.

---

## 8. API Contract Reference (current, complete, as of this session's close)

Base URL: backend's own origin (e.g. `http://localhost:3000`), all JSON except upload. Every route below except signup/login/webhook requires `Authorization: Bearer <access_token>`.

| Method & Path | Body / Query | Response |
|---|---|---|
| `POST /api/v1/auth/signup` | `{email, password, organizationName}` | 201 `{user, session}` |
| `POST /api/v1/auth/login` | `{email, password}` | 200 `{user, session}` |
| `GET /api/v1/auth/me` | — | `AuthenticatedUser` |
| `GET /api/v1/organizations/me` | — | `{organization, usage}` |
| `GET /api/v1/organizations/me/usage` | — | `UsageSummary` (strict subset of the above — frontend should keep calling `/me` only, never both) |
| `GET /api/v1/organizations/me/stats` **(new this session)** | `?since=<ISO datetime>` optional, default 30d back, bounded 0-400 days | `{completedJobs, failedJobs, totalJobs, successRate: number\|null, avgProcessingSeconds: number\|null, dailyCounts: [{date, count}]}` — `dailyCounts` is a complete, gap-filled, contiguous series |
| `GET /api/v1/billing/plans` | — | `PlanRow[]` |
| `GET /api/v1/billing/subscription` | — | `{plan, subscription}` — `subscription` is a real row **or** `{status:"active", planId, note}` for the implicit free tier |
| `POST /api/v1/billing/checkout` | `{planId: "basic"\|"pro", redirectUrl?}` | `{url}` — **always pass `redirectUrl`**, computed from the current request origin, or Stripe redirects to the bare backend |
| `POST /api/v1/billing/portal` | `{returnUrl?}` | `{url}` — same caveat |
| `POST /api/v1/billing/webhook` | raw Stripe payload, `stripe-signature` header | public, not used by the frontend directly |
| `POST /api/v1/documents` | multipart `{file, documentType?}` (`invoice\|receipt\|identity_document\|generic`, default `invoice`) | 202 `{kind:"single", job: JobDto}` or `{kind:"batch", batch: BatchResult}` |
| `GET /api/v1/documents` **(new this session)** | `?status&documentType&search&dateFrom&dateTo&cursor&limit` (1-100, default 20), all optional | `{data: JobDto[], pagination: {nextCursor: string\|null, hasMore: boolean}}` |
| `GET /api/v1/documents/jobs/:id` | — | `JobDto` |

`JobDto` (now includes two fields it didn't have before this session): `{jobId, status, fileName, fileSizeBytes, pageCount, documentType, averageConfidence, resultJson, errorMessage, createdAt, updatedAt}`.

**Frontend BFF routes that already exist** (`apps/frontend/app/api/`): `auth/{login,signup,logout}`, `organization` (proxies `GET /organizations/me`). **Frontend BFF routes that do NOT exist yet** and are needed for Stage 2 onward: a stats route (proxy `GET /organizations/me/stats`), a documents list route (proxy `GET /documents`), and billing routes (proxy `plans`/`subscription`/`checkout`/`portal`) — see §9.

---

## 9. Next Session

### Current state
Backend is feature-complete and verified for everything built so far (§2, §6). Frontend has a working, verified shell + auth (Stage 1) and nothing else. All work this session is committed; nothing is pushed (no credentials in this sandbox).

### Finished
- Backend: auth, organizations (incl. new stats/analytics), billing, documents (upload, poll, **new: list/filter/paginate**). 94 tests passing.
- Frontend: bootstrap, app shell, auth (signup/login/logout/session/route-protection), 5 stub pages wired into the sidebar.
- Monorepo: pnpm + Turborepo workspace, both apps relocated with history intact, CI/Docker reworked (Docker not build-tested — see §6).

### Intentionally postponed
- `packages/types`/`packages/shared` population (§4 decision 9) — revisit only when there's a concrete, real thing to share.
- Team/role management UI (backend has no endpoints for it).
- A frontend test suite.
- Docker build verification and the actual `git push` (both blocked by this sandbox's environment, not by any unresolved design question).

### Exact next milestone: Frontend Stage 2 — Dashboard

Before writing any Dashboard UI, the frontend needs plumbing that doesn't exist yet, all following the exact pattern already established in Stage 1 (`lib/api/backend-client.ts` + Zod parsing, `server-only` services, thin BFF Route Handlers):

1. **Extend `frontend/types/api.ts`**: add `documentType`/`averageConfidence` to the existing job-related schema; add a new schema for the stats response (`organizationStatsSchema` or similar, matching §8's shape exactly); add a schema for the documents-list response (`{data, pagination}`) — needed for Stage 5 too, but cheap to do alongside stats now.
2. **Add `frontend/services/documents.service.ts`** (doesn't exist yet — only `auth.service.ts`/`organization.service.ts` do): `listDocuments(params)`, calling `GET /documents` server-side.
3. **Extend `frontend/services/organization.service.ts`** with `getJobStats(since?)`, calling the new `GET /organizations/me/stats`.
4. **New BFF routes**: `app/api/organization/stats/route.ts`, `app/api/documents/route.ts` (GET only, for now). Both thin — parse query params, call the service, return JSON, matching `app/api/organization/route.ts`'s existing shape exactly.
5. **Then** build the actual Dashboard page: stat cards (documents/pages used vs. plan limits — already available via existing `/api/organization`), success rate + avg processing time (new stats endpoint), a documents-per-day chart (`dailyCounts` from the same endpoint, already gap-filled — don't re-derive it from anything else), current plan (needs a billing BFF route too — see below), empty state for a brand-new org.
6. Dashboard also needs current-subscription data, which means **billing BFF routes don't exist yet either** (`app/api/billing/{plans,subscription,checkout,portal}/route.ts`) — either build a minimal `subscription` route now as part of Stage 2, or scope Stage 2's "current plan" card to skip it and build full billing BFF routes when Stage 6 (Billing) arrives. Recommend the former (small, same pattern, avoids a half-populated Dashboard) — Stage 6 still does the fuller Checkout/Portal flow.

### Recommended order for the remaining stages

Keep the original plan's order — it follows the natural product journey, and nothing about this session's work argues for reordering it:

**Stage 2 (Dashboard) → Stage 3 (Upload + Processing) → Stage 4 (Results) → Stage 5 (History) → Stage 6 (Billing) → Stage 7 (Settings + polish).**

Stage 5 (History) is now fully unblocked by real backend contract (the list endpoint), same as Stage 2 — no reason to reorder around that, just note it's ready when its turn comes: reuse `documents.service.ts#listDocuments` and the `/api/documents` BFF route already built for Stage 2's needs, add the query-param passthrough (status/type/search/date/cursor) the Dashboard didn't need. Stage 4 (Results) is where the `DocumentPreviewSource` abstraction (§4 decision 2) actually gets built — it's decided, not yet implemented.

### Cautions — do not forget

- **The original architecture plan file** (`~/.claude/plans/flickering-wandering-hejlsberg.md`, if still consulted) **describes an outdated approach for Dashboard/History**: direct-Supabase RLS reads. That was superseded by the §3.4/§4 decision — those features now go through real backend endpoints via the standard BFF pattern, same as everything else. Don't build the direct-Supabase version described there.
- **`GET /organizations/me` already returns `{organization, usage}`** — never call `/me/usage` separately from the frontend (already true in Stage 1, stays true).
- **Billing `redirectUrl`/`returnUrl` must be computed from the current request's origin at call time**, never hardcoded — the backend defaults to its own URL if omitted, which would strand the user on the bare API after Stripe.
- **Job-status polling needs a backoff schedule** (not a fixed fast interval) — the backend's rate limiter is IP-keyed and shared across all users once proxied; this is a real production ceiling, not just UX polish (§7).
- **`resultJson` is genuinely heterogeneous** across document types — `generic` (`prebuilt-layout`) has no per-field confidence at all; Results page (Stage 4) needs to handle that as a distinct case, not force it into the confidence-badge UI the other three types get.
- **Don't add a database migration without checking `apps/backend/supabase/migrations/`'s current highest number first** (`0010` as of this session) — and remember migrations, once applied to the live database, should be extended with a new migration file, not edited in place (this was the approach used for the gap-filling logic that ended up living in the service layer instead, specifically to avoid a second migration for something simple enough to do in JS — see `apps/backend/PROGRESS.md` §14 for that reasoning if a similar trade-off comes up again).
