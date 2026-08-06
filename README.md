# TNDA-AI

A multi-tenant SaaS platform for automated document processing (invoices, receipts, identity documents, and generic scans — single files or `.zip` batches) via Azure Document Intelligence, with Stripe-backed subscription billing.

This is a pnpm + Turborepo monorepo with two applications:

| App | What it is | Docs |
|---|---|---|
| [`apps/backend`](./apps/backend) | Bun + ElysiaJS REST API — the single source of truth for business logic, querying, filtering, pagination, aggregation, and analytics | [`apps/backend/README.md`](./apps/backend/README.md) |
| [`apps/frontend`](./apps/frontend) | Next.js SaaS dashboard consuming the backend's API — presentation, interaction, and state management only, never a direct data-access path of its own | [`apps/frontend/README.md`](./apps/frontend/README.md) |

`packages/` holds cross-cutting workspace infrastructure — currently `config` (a shared base `tsconfig.json`, real and in use by both apps) and `types`/`shared` (scaffolded and wired into the workspace, intentionally not yet populated — see [`PROGRESS.md`](./PROGRESS.md) for why).

## Getting started

```bash
# Install dependencies for the whole workspace
pnpm install

# Run both apps in dev mode
pnpm dev

# Or scope to one app
pnpm --filter @tnda-ai/backend dev
pnpm --filter @tnda-ai/frontend dev
```

Each app needs its own `.env` — see `apps/backend/.env.example` and `apps/frontend/.env.example`.

## Available scripts

Run from the root, fanned out across the workspace via [Turborepo](https://turborepo.dev):

| Command | Description |
|---|---|
| `pnpm dev` | Starts both apps' dev servers |
| `pnpm build` | Production build (applies to `apps/frontend`; the backend runs directly from source via Bun) |
| `pnpm typecheck` | `tsc --noEmit` across every app and package |
| `pnpm lint` | ESLint across every app |
| `pnpm test` | Backend's Vitest suite (the frontend has no test suite yet) |

## Repository structure

```
TNDA-AI/
├── apps/
│   ├── backend/     # Bun + ElysiaJS API (full git history preserved from before the monorepo migration)
│   └── frontend/    # Next.js dashboard
├── packages/
│   ├── config/      # Shared tsconfig base — real, in use
│   ├── types/       # Scaffolded for future shared types — not yet populated
│   └── shared/      # Scaffolded for future shared utilities — not yet populated
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

## License & Legal Notice

**Notice:** Although this source code is hosted publicly for demonstration and open-source inspection, all rights are strictly reserved. Unauthorized copying, distribution, modification, commercial use, or creation of derivative works for monetary gain or competitive business purposes without explicit written authorization is strictly prohibited and subject to legal action.

© TNDA-AI. All rights reserved.
