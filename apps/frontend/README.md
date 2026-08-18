# TNDA-AI Frontend

## Overview

**TNDA-AI Frontend** is the customer-facing SaaS dashboard for TNDA-AI's document-processing platform — upload invoices, receipts, identity documents, and generic scans (single files or `.zip` batches), track processing in real time, and review extracted fields with confidence indicators. It's a Next.js (App Router) application that consumes the [TNDA-AI backend](../backend) over HTTP; **this repository never modifies the backend**.

This README documents the frontend only. See [`../backend/README.md`](../backend/README.md) for the API this app consumes, and the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md) for the full, current, cross-app architecture reference.

Status: all planned stages are built, tested, and verified — Shell + Auth, Dashboard, Upload + Processing, Results (including the full document review workflow — edit/correct fields, confirm/reject, remove file, delete document), Document History (including multi-format CSV/XLSX/JSON/XML export with configurable column selection/ordering/renaming), the Billing UI (upgrade/manage a plan via Stripe Checkout and the Billing Portal), and Settings (intentionally read-only — no backend support yet for self-service edits). See [`PROGRESS.md`](./PROGRESS.md) for the dated build log.

---

## Tech Stack & Key Libraries

| Concern | Choice | Why |
|---|---|---|
| **Framework** | [Next.js](https://nextjs.org) 16 (App Router) | Server Components by default, streaming/Suspense, Route Handlers as a BFF layer in front of the backend. |
| **Language** | TypeScript, strict | `strict` + `noUncheckedIndexedAccess` + `noUnusedLocals`/`noUnusedParameters` (shared with the backend via `@tnda-ai/config`'s base `tsconfig.json`) — no `any`, matching the backend's own zero-`as` discipline. |
| **Styling** | [Tailwind CSS](https://tailwindcss.com) v4 | CSS-first config (`@theme` in `app/globals.css`), no `tailwind.config.ts`. |
| **Components** | [shadcn/ui](https://ui.shadcn.com) (Radix primitives) | Owned, composable component source (not a bundled dependency) — one design-token system (OKLCH CSS variables) shared by every component, including charts. |
| **Icons** | [Lucide](https://lucide.dev) | |
| **Server state** | [TanStack Query](https://tanstack.com/query) v5 | Caching, polling (job status), mutations — no bespoke data-fetching state. |
| **Forms** | React Hook Form v7 + Zod v4 | |
| **Auth/session** | [`@supabase/ssr`](https://supabase.com/docs/guides/auth/server-side/nextjs) | Owns the httpOnly-cookie session/refresh lifecycle *after* the backend's own signup/login orchestration — see Architecture below. Server-only; the browser never holds a raw access token. |
| **Type safety across the API boundary** | Hybrid: type-only imports + hand-written Zod, parsed at runtime | Raw DB row shapes (`Database`, error codes) are type-only imported directly from the backend's own source (zero duplication) where that's mechanically possible; everything else is hand-written Zod in `types/api.ts`, verified against real backend source and parsed at every call site — so drift is caught at runtime, not just hoped not to happen. (An Elysia Eden Treaty import of the backend's full `App` type was tried first; doesn't work given the two projects' independently-aliased `tsconfig`s. See `PROGRESS.md` §3.) |
| **Package manager** | Bun (scripts) + pnpm (workspace install) | This app is one member of the repository's pnpm + Turborepo workspace — see Getting Started below. Bun still runs the actual dev/build/test scripts, matching the backend's toolchain. |

**Installed, not yet used**: `@tanstack/react-table` v9 and `motion` v13 (Framer Motion's successor) are both dependencies today with no current call sites anywhere in this app. They were pre-installed for planned future work — a server-side-paginated table for Document History, and deliberate (non-decorative) animation for staged processing UI — neither of which is built yet. Don't assume either is wired into anything until `PROGRESS.md` says otherwise.

---

## Architecture

**The backend is the single source of truth for all application data.** This app has no data-access path of its own: every list, stat, job status, and mutation goes through a real backend endpoint. The one exception — and it is not an exception to the rule above, it's a different concern entirely — is session/cookie management via `@supabase/ssr`, which never reads or writes application data, only identity state.

- **Every backend call is server-side, through one of two paths that converge on the same code.** Server Components call a shared `services/*.service.ts` layer directly, in-process. Client Components never call the real backend and never hold a bearer token — they call this app's own `/api/*` Route Handlers (a same-origin, cookie-authenticated `fetch`), which resolve the caller's access token from that same session cookie and call the *same* `services/*` functions a Server Component would. Both paths end at `backendFetch`, the one place that actually reaches the real backend, with a `Bearer` header.
- **Session lifecycle:** the backend's `/auth/signup`/`/auth/login` still do all the real orchestration (org + profile creation, with rollback on partial failure). Immediately after, `@supabase/ssr` takes over the cookie/session/refresh lifecycle (`setSession()` once, then transparent `getUser()`-based refresh centralized in `proxy.ts` on every request — Server Components can't write cookies themselves, so refresh can't live there). Logout calls Supabase's real `signOut()` for server-side token revocation, not just cookie clearing.
- **Document data — lists, stats, job status, upload — is read and written exclusively through real backend endpoints**, never Supabase directly. `GET /organizations/me/stats` backs the Dashboard, `GET /documents` (paginated, filterable) is what a future History page will use, `POST /documents` + `GET /documents/jobs/:id` back the upload-and-poll flow. (An earlier iteration of this app considered reading `document_jobs` directly via its own same-org RLS policy, as a workaround for gaps the backend used to have. That workaround was never built — the backend gained the real endpoints instead, and stayed the single source of truth. If you find an older reference to a direct-Supabase read anywhere, it describes a plan that was reversed before being implemented; trust `PROGRESS.md`'s decision log over it.)
- **Document preview** (the Results page) is backend-provided: the original file is persisted to a private Supabase Storage bucket on upload, and the Results page resolves a signed URL for it — for any job, not just one reached immediately after upload. A `DocumentPreviewSource` abstraction still exists (`session-blob | remote-url | unavailable`), now with `remote-url` as the primary source; `session-blob` is only ever a fast-path/fallback — an instant render for the tab that just uploaded while the signed-URL fetch is in flight, or a last resort if the backend genuinely has nothing persisted — and never overrides a real signed URL once one is known. `unavailable` covers a job whose file was explicitly removed (see `PROGRESS.md` for the review workflow's file-lifecycle actions).

Full reasoning for every decision above — including things deliberately *not* done (a generic catch-all proxy, an `/api/auth/refresh` route, optimistic updates, a CSRF token) and why — is in `PROGRESS.md`, added as each piece is built. The root [`ARCHITECTURE.md`](../../ARCHITECTURE.md) is the distilled, current-state view across both apps; this section is the frontend-specific summary of it.

### Project structure

```
frontend/
├── app/
│   ├── (auth)/                # login, signup — no dashboard shell
│   ├── (dashboard)/            # sidebar + topbar shell; dashboard, upload, documents, documents/[jobId], billing, settings
│   └── api/                     # Route Handlers — thin adapters over services/*.service.ts, for Client Components only
├── proxy.ts                     # route protection + centralized session refresh (Next 16's `middleware.ts` renamed)
├── components/
│   ├── ui/                      # shadcn primitives
│   └── <feature>/                # auth/, dashboard/, upload/, results/, layout/, common/
├── features/                      # hooks + local state per domain — TanStack Query hooks, the upload-queue reducer, the preview cache
├── services/                       # server-only — the one implementation per backend operation, called by both Route Handlers and Server Components
├── lib/
│   ├── api/                        # http.ts (client-safe fetch) · backend-client.ts (server-only backend caller) · response.ts / route-handler.ts (shared parsing + error helpers)
│   ├── supabase/server-client.ts
│   └── env.ts                       # Zod-validated process.env, eager — same pattern as the backend's own config/env.ts
├── providers/, hooks/, types/
└── test/                             # Vitest + Testing Library harness — setup.ts, a server-only stub, a shared QueryClientProvider wrapper
```

---

## Getting Started

### Prerequisites
- [Bun](https://bun.sh) ≥ 1.3 — runs this app's scripts (`dev`/`build`/`test`), matching the backend's toolchain
- pnpm — this app is one member of the repository's pnpm + Turborepo workspace, not a standalone install (see the [root README](../../README.md))
- The TNDA-AI backend running locally (see [`../backend/README.md`](../backend/README.md)) — defaults to `http://localhost:3000`
- The same Supabase project the backend uses (URL + anon key)

### Setup

```bash
# 1. From the repository root — installs the whole workspace, not just this app
pnpm install

# 2. Copy the environment template and fill in real values
cp apps/frontend/.env.example apps/frontend/.env

# 3. Run the dev server (hot reload, Turbopack)
pnpm --filter @tnda-ai/frontend dev
# — or, from inside apps/frontend/ —
bun run dev
```

The dev server runs on **`http://localhost:3001`** (not 3000) so it never collides with the backend's own default port when both run locally at once.

### Available scripts

| Command | Description |
|---|---|
| `bun run dev` | Starts the dev server on port 3001 |
| `bun run build` | Production build |
| `bun run start` | Runs the production build on port 3001 |
| `bun run typecheck` | `next typegen && tsc --noEmit` — strict mode (the `next typegen` step generates Next 16's route types, which aren't checked into version control) |
| `bun run lint` | ESLint over the whole project |
| `bun run test` | Runs the Vitest suite once (`vitest run`) |
| `bun run test:watch` | Runs Vitest in watch mode |

All of the above also run fanned-out across the whole workspace via `pnpm typecheck`/`lint`/`test` from the repository root (Turborepo) — that's the standard verification unit this project's history refers to as "full workspace verification," and what CI (`.github/workflows/ci.yml`) actually runs.

---

## Testing

Vitest + `@testing-library/react` + jsdom — 277 tests across 38 files, built entirely test-first: for each feature, the type/contract is defined, a failing test is written, the minimum implementation is added to pass it, then the full workspace is re-verified before moving on. See `PROGRESS.md` for the stage-by-stage build log this produced.

Two environment-specific patterns exist because this stack genuinely needs them:
- Route Handler tests that construct a `FormData`/`File` run under `@vitest-environment node` — jsdom's own `File`/`FormData` fail undici's native `Request.formData()` brand check, and Route Handlers are server code regardless, so this is also the semantically correct environment.
- Tests that need real timer control over a polling interval use a small local fake-timer-aware helper, since Testing-Library's `waitFor` polls via a real `setInterval` that never fires while Vitest's fake timers are frozen.

No browser automation tool has been available in this project's development environment — interactive/rendering behavior (drag-and-drop, live polling, actual visual output) is ultimately verified either via a real end-to-end `curl` check against the real backend and Supabase project, or by manually exercising the running app in a real browser. This has already caught one real bug (a client-side infinite re-render loop) that the automated suite could not reproduce — manual browser verification is treated as a required step for interactive work, not optional polish on top of automated tests.

---

## License & Legal Notice

**Notice:** Although this source code is hosted publicly for demonstration and open-source inspection, all rights are strictly reserved. Unauthorized copying, distribution, modification, commercial use, or creation of derivative works for monetary gain or competitive business purposes without explicit written authorization is strictly prohibited and subject to legal action.

© TNDA-AI. All rights reserved.
