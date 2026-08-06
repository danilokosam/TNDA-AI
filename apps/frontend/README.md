# TNDA-AI Frontend

## Overview

**TNDA-AI Frontend** is the customer-facing SaaS dashboard for TNDA-AI's document-processing platform — upload invoices, receipts, identity documents, and generic scans (single files or `.zip` batches), track processing in real time, review extracted fields with confidence indicators, and manage billing/usage. It's a Next.js (App Router) application that consumes the [TNDA-AI backend](../backend) over HTTP; **this repository never modifies the backend**.

This README documents the frontend only. See [`../backend/README.md`](../backend/README.md) for the API this app consumes.

Status: early build-out, in progress. See [`PROGRESS.md`](./PROGRESS.md) for a dated log of what's been built and why.

---

## Tech Stack & Key Libraries

| Concern | Choice | Why |
|---|---|---|
| **Framework** | [Next.js](https://nextjs.org) 16 (App Router) | Server Components by default, streaming/Suspense, Route Handlers as a BFF layer in front of the backend. |
| **Language** | TypeScript 5.9, strict | `strict` + `noUncheckedIndexedAccess` + `noUnusedLocals`/`noUnusedParameters` — no `any`, matching the backend's own zero-`as` discipline. |
| **Styling** | [Tailwind CSS](https://tailwindcss.com) v4 | CSS-first config (`@theme` in `app/globals.css`), no `tailwind.config.ts`. |
| **Components** | [shadcn/ui](https://ui.shadcn.com) (Radix primitives) | Owned, composable component source (not a bundled dependency) — one design-token system (OKLCH CSS variables) shared by every component, including charts. |
| **Icons** | [Lucide](https://lucide.dev) | |
| **Server state** | [TanStack Query](https://tanstack.com/query) v5 | Caching, polling (job status), mutations, cache invalidation — no bespoke data-fetching state. |
| **Tables** | [TanStack Table](https://tanstack.com/table) v9 | Server-side pagination/sorting/filtering for Document History — never assumes the backend returns a full unpaginated list. |
| **Forms** | React Hook Form v7 + Zod v4 | |
| **Animation** | [Motion](https://motion.dev) v13 (formerly Framer Motion) | Used deliberately, never decorative-only — staged processing UI, confirmations. |
| **Auth/session** | [`@supabase/ssr`](https://supabase.com/docs/guides/auth/server-side/nextjs) | Owns the httpOnly-cookie session/refresh lifecycle *after* the backend's own signup/login orchestration — see Architecture below. Server-only; the browser never holds a raw access token. |
| **Type safety across the API boundary** | Hybrid: type-only imports + hand-written Zod, parsed at runtime | Raw DB row shapes (`Database`, error codes) are type-only imported directly from the backend's own source (zero duplication) where that's mechanically possible; everything else is hand-written Zod in `types/api.ts`, verified against real backend source and parsed at every call site — so drift is caught at runtime, not just hoped not to happen. (An Elysia Eden Treaty import of the backend's full `App` type was tried first; doesn't work given the two projects' independently-aliased `tsconfig`s. See PROGRESS.md §3.) |
| **Package manager** | Bun | Matches the backend's toolchain. |

---

## Architecture

The backend has no list/history, refresh, or logout endpoints, never persists original uploaded files, and has no `document_type`/confidence columns on its `document_jobs` table. Rather than touch the backend, this app is built around those constraints explicitly:

- **Every backend call is server-side.** Server Components call a shared `services/*.service.ts` layer directly (in-process); Client Components reach the same layer indirectly through this app's own `/api/*` Route Handlers. The browser never talks to the backend directly and never holds a bearer token.
- **Session lifecycle:** the backend's `/auth/signup`/`/auth/login` still do all the real orchestration (org + profile creation). Immediately after, `@supabase/ssr` takes over the cookie/session/refresh lifecycle (`setSession()` once, then transparent `getUser()`-based refresh centralized in `proxy.ts` on every request — Server Components can't write cookies themselves, so refresh can't live there).
- **Document history & stats** are read directly from Supabase (RLS-scoped to the caller's own organization) rather than added to the backend, since `document_jobs` already has a same-org `select` policy — a gap the backend's own schema anticipated.
- **Document preview** (Results page) is session-only for v1 — the backend never persists originals — rendered through a small `DocumentPreviewSource` abstraction so a persistent backend-provided URL can replace it later without touching any UI component.

Full reasoning for every decision above — including things deliberately *not* done (a generic catch-all proxy, an `/api/auth/refresh` route, optimistic updates, a CSRF token) and why — is in `PROGRESS.md`, added as each piece is built.

### Project structure

```
frontend/
├── app/
│   ├── (auth)/            # login, signup — no dashboard shell
│   ├── (dashboard)/        # sidebar + topbar shell; dashboard, upload, documents, billing, settings
│   └── api/                 # Route Handlers — thin adapters over services/*.service.ts, for Client Components only
├── proxy.ts                 # route protection + centralized session refresh (Next 16's `middleware.ts` renamed)
├── components/
│   ├── ui/                  # shadcn primitives
│   └── <feature>/           # AppSidebar, Dropzone, DocumentPreviewPanel, DataTable, PlanCard, ...
├── features/                 # TanStack Query hooks per domain — caching/polling/invalidation
├── services/                  # server-only — the one implementation per backend operation, called by both Route Handlers and Server Components
├── lib/
│   ├── api/                   # http.ts (client-safe fetch) · backend-client.ts (server-only backend caller)
│   └── supabase/server-client.ts
├── providers/, hooks/, types/, styles/
```

---

## Getting Started

### Prerequisites
- [Bun](https://bun.sh) ≥ 1.3
- The TNDA-AI backend running locally (see `../backend/README.md`) — defaults to `http://localhost:3000`
- The same Supabase project the backend uses (URL + anon key)

### Setup

```bash
# 1. Copy the environment template and fill in real values
cp .env.example .env

# 2. Install dependencies
bun install

# 3. Run the dev server (hot reload, Turbopack)
bun run dev
```

The dev server runs on **`http://localhost:3001`** (not 3000) so it never collides with the backend's own default port when both run locally at once.

### Available scripts

| Command | Description |
|---|---|
| `bun run dev` | Starts the dev server on port 3001 |
| `bun run build` | Production build |
| `bun run start` | Runs the production build on port 3001 |
| `bun run typecheck` | `tsc --noEmit` — strict mode |
| `bun run lint` | ESLint over the whole project |

---

## License & Legal Notice

**Notice:** Although this source code is hosted publicly for demonstration and open-source inspection, all rights are strictly reserved. Unauthorized copying, distribution, modification, commercial use, or creation of derivative works for monetary gain or competitive business purposes without explicit written authorization is strictly prohibited and subject to legal action.

© TNDA-AI. All rights reserved.
