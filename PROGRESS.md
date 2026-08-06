# TNDA-AI — Monorepo Migration Progress

## 1. Migration to a pnpm + Turborepo monorepo (2026-08-06)

### Why

The git repository had lived inside `backend/` since the project started (`backend/.git`, tracking `github.com/danilokosam/TNDA-AI`). Once `frontend/` (Next.js) was added alongside it as a second, real application, the repo structure no longer matched the product — one directory was "the repo," the other was an untracked sibling. This migration makes the actual project root (`TNDA-AI/`) the git root, relocates both apps under `apps/`, and sets up a real pnpm workspace + Turborepo pipeline.

### History was relocated, not rewritten

The first draft of the migration plan reached for `git filter-repo --to-subdirectory-filter` — the standard tool for making history look as if code always lived at a new path. Asked to justify that against a simpler alternative before implementing anything, the simpler alternative turned out to be strictly better here: move `.git` itself to the new root, physically relocate the files it tracks into `apps/backend/`, and commit that as one ordinary new commit.

Verified directly (built the scenario in a throwaway repo against a real bare "remote" before touching the real one) rather than assumed:
- Every one of the original 11 commits keeps its exact original hash — nothing about their content, tree, or parent pointers changes, because nothing rewrites them; a 12th (documenting Stage 2 backend persistence work already done this session) and a 13th (the move itself) land on top as ordinary new commits.
- `git status` reported the relocated files as `R` (renamed), not delete+add — git's similarity-based rename detection picked it up automatically across all 125 tracked files.
- `git log --follow` and `git blame` on the new `apps/backend/...` paths both trace correctly back through the move into the original pre-move commits, with original authorship and dates intact (spot-checked: `apps/backend/src/config/env.ts` still blames to the original `b6295c5` commit and its original author/date).
- `git push origin master` after the move went through as a **plain fast-forward** — proof by construction that history wasn't rewritten (a non-fast-forward push is exactly what git refuses without `--force`). There is no history rewrite and no force-push anywhere in this migration.

A `.gitignore`-respecting `rsync` copy of the whole project (excluding `node_modules`/`.next`/`.turbo`) was taken to a sibling `TNDA-AI.pre-monorepo-backup/` directory before any of this, as a free, unconditional safety net — left in place afterward, not deleted.

### What actually moved

- `apps/backend/` — the former `backend/`, full git history preserved as above.
- `apps/frontend/` — the former `frontend/`, no prior git history (it was bootstrapped with `--disable-git` and had never been version-controlled), added fresh in the same commit as the backend relocation.
- `packages/config/` — a real, in-use shared base `tsconfig.json`, extracted from the settings both apps had already independently converged on identically (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `forceConsistentCasingInFileNames`, plus the shared module/emit settings) — genuine duplication that existed before this migration, not something invented for it. Both `apps/*/tsconfig.json` now `extend` it, keeping only their real differences (Bun's `types:["bun-types"]`/`@/*→src/*`/`verbatimModuleSyntax` for the backend; DOM lib/Next's plugin/`@/*→./*` for the frontend).
- `packages/types/`, `packages/shared/` — scaffolded and wired into the workspace (real `package.json`, `tsconfig.json`, a placeholder export each, `pnpm install` links them correctly) but **deliberately left empty of real migrated code**. The backend's schemas are Zod v3, the frontend's are Zod v4 — a deliberate, already-made choice, not an oversight — and the frontend's hand-written `types/api.ts` was verified field-by-field against backend source specifically *because* two cross-project-import approaches (Eden Treaty, `openapi-typescript`) turned out not to work (see `apps/frontend/PROGRESS.md` §3). Moving that into a shared package now wouldn't remove the hand-verification requirement, just relocate it. These packages end this migration real and importable, ready for a deliberate future decision about what actually moves in.
- Both apps' standalone `bun.lock` files and local `.gitignore`s were removed — one root `pnpm-lock.yaml` and one root `.gitignore` (a union of both apps' previous rules, with the backend's root-scoped manual-test-fixture ignores adjusted to `apps/backend/*.pdf` etc. to preserve their original narrow scope) now cover both, instead of three separate, partially-duplicated ignore files.
- Backend's runtime is unchanged — it still runs on Bun (`bun run --watch src/index.ts`), which uses Bun-specific APIs throughout and was never in question. Only *how dependencies get installed and linked* changed, from Bun's own package manager to pnpm workspaces. Verified this combination actually works (not assumed): a throwaway pnpm workspace with a `bun run`-executed script correctly resolved and ran a pnpm-installed dependency via Bun's standard Node-compatible module resolution.

### Package naming

Both apps' `package.json` `name` fields were changed to scoped names (`@tnda-ai/backend`, `@tnda-ai/frontend`) to match the new `packages/@tnda-ai/*` convention and to give Turborepo/pnpm's `--filter` flags a consistent, unambiguous target.
