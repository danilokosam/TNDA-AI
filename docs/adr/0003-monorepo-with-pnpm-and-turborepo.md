# Monorepo with pnpm Workspaces and Turborepo

## Status

Accepted

## Context

The backend and the newly-built frontend started as two separate applications — the backend with its own, already-established git history from before the frontend existed. They are deployed independently and can be developed independently, but they share one thing that must never silently drift apart without being noticed: the shape of the REST contract between them. A backend field rename or a new required parameter is only safe if the frontend's understanding of that contract (its hand-written Zod schemas, see `0004-runtime-validation-with-zod.md`) changes in the same review, not in some later, disconnected commit.

Consolidating the two into one repository was requested with an explicit ask for a risk-minimizing plan first, since the backend's existing git history was not to be treated as disposable. The first instinct for combining two independent repositories' histories was `git filter-repo` — rewriting and grafting history, then force-pushing the result. Asked to justify that against a simpler alternative before doing anything irreversible, a plain filesystem move (physically relocating the backend's tracked files under `apps/backend/`, adding the frontend fresh under `apps/frontend/`, one ordinary commit) was proven — in a throwaway repository, against a real bare "remote," before ever touching the real one — to preserve every commit hash unchanged, push as a normal fast-forward, and keep `git log --follow`/`git blame` working correctly across the move. It was strictly better for this case: no rewritten hashes, no force-push, no risk to history that already existed and was worth keeping intact.

## Decision

Adopt a pnpm workspace (`pnpm-workspace.yaml`: `apps/*`, `packages/*`) with Turborepo orchestrating cross-package tasks (`build`, `dev`, `typecheck`, `lint`, `test`), all fanned out from single root-level commands. The backend's existing repository is relocated into `apps/backend/` via a plain filesystem move and commit — not a history rewrite — preserving its full git history intact. The frontend is added fresh under `apps/frontend/`. A new `packages/config` holds the one thing genuinely identical between the two apps today (a shared base `tsconfig.json`); `packages/types` and `packages/shared` are scaffolded and wired into the workspace but deliberately left empty (see `0008-shared-packages-strategy.md`).

## Consequences

- A contract change and its consumer are reviewable together, in one PR, without the overhead of publishing and version-bumping an internal package.
- `pnpm typecheck`/`lint`/`test` from the repository root becomes the standard "full workspace verification" unit this project's history refers to repeatedly — every package checked, with Turborepo caching unchanged packages' results rather than re-running them.
- The backend's Docker build context becomes the monorepo root, not `apps/backend/` alone, since pnpm needs the root lockfile and every workspace member's `package.json` to resolve the dependency graph even when the actual install is `--filter`-scoped to one package.
- No commit hash in the backend's pre-migration history changed, and no force-push was required — the migration is a normal, auditable part of the commit history rather than a rewritten one.
- The two applications remain independently deployable; the monorepo changes how they are developed and reviewed together, not how they run in production.
