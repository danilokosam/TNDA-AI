# Shared Packages Are Scaffolded but Deliberately Left Empty

## Status

Accepted

## Context

Moving both applications into one workspace (see `0003-monorepo-with-pnpm-and-turborepo.md`) raises an obvious next question: should the two apps share code — types, validation schemas, small utilities — through a workspace package, now that doing so is mechanically trivial?

Looking at what would actually need to move surfaces two real, non-cosmetic obstacles. The backend's validation schemas are written against Zod's v3 API; the frontend's are written against Zod v4 — an already-made, deliberate choice on the frontend's side, not an oversight waiting to be reconciled. The two major versions are not source-compatible enough to have one schema module satisfy both without either upgrading the backend (a real, independent piece of work with its own risk) or maintaining a compatibility shim. Separately, backend code in places assumes Bun-only runtime APIs that don't exist in the frontend's Node/Edge-oriented Next.js runtime. Moving either app's current schema or utility code into a shared package today would not be a mechanical relocation — it would require solving one or both of those problems first, for the sake of sharing code that, as of this decision, has no actual duplication to eliminate: the two apps' schemas describe the same wire contract but are independently hand-written and independently verified against backend source already (see `0004-runtime-validation-with-zod.md`), which is itself deliberate, not a gap.

## Decision

Scaffold `packages/types` and `packages/shared` as real, wired-in workspace members (each with its own `package.json`, contributing to the workspace's dependency graph and `tsconfig` resolution) but leave both empty (`export {}`) until a concrete, specific piece of code actually needs to exist in both applications, unmodified. `packages/config` is the one exception, populated immediately, because it holds something that genuinely is identical between the two apps today: a shared base `tsconfig.json`.

## Consequences

- No premature abstraction is built to solve a sharing problem that doesn't concretely exist yet — the two apps' Zod-version mismatch and Bun-API assumptions stay exactly where they are until a real reason to reconcile them shows up.
- The workspace plumbing (package registration, `tsconfig` paths, Turborepo task wiring) already exists and works, so populating either package later is adding code to a working slot, not a structural change to the workspace itself.
- Anyone encountering `packages/types`/`packages/shared` as empty stubs should read that as intentional, not as unfinished setup work — this decision is the record of that intent, so it doesn't need to be re-derived or second-guessed each time it's noticed.
- Some duplication is accepted as the ongoing cost of this choice: the frontend's hand-written Zod schemas and the backend's own schemas describe overlapping shapes without sharing a single definition. That duplication is deliberately kept in check by verifying the frontend's schemas against real backend source at write time and by parsing every response at runtime (`0004-runtime-validation-with-zod.md`), not by sharing the schema module itself.
