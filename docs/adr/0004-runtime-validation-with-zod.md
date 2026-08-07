# Hand-Written Zod Schemas, Validated at Runtime, Across the API Boundary

## Status

Accepted

## Context

The frontend needs to know the exact shape of everything the backend returns, and the plan going into Stage 1 called for zero hand-duplicated DTOs: a type-only `import type { App } from "backend/src/index"`, using Elysia's own Eden Treaty pattern, so the frontend's types would be derived directly from the backend's real route definitions with no separate schema layer to keep in sync.

Tested directly before writing any real code, this does not work. `backend/src/index.ts` transitively imports every route module through the backend's own `@/*` path alias. TypeScript resolves those imports using the *importing* project's `tsconfig.json` paths, not the imported file's own — so once pulled into a frontend file, the same alias resolves against the frontend's `@/*` (`./*`) instead of the backend's (`src/*`), and fails outright. This is not fixable without either editing the backend's `tsconfig.json` (not an option) or a much larger TypeScript project-references restructuring that would touch the backend too.

The next alternative considered was `openapi-typescript` codegen against the backend's own mounted Swagger output (`@elysiajs/swagger`, at `/docs/json`). Also tested directly, and also fails: the mounted Swagger endpoint serializes raw Zod-internal `_def` trees instead of real JSON Schema for request bodies, and every response body comes back as a bare `{}` — confirmed by fetching and inspecting the live endpoint, not assumed from documentation. Codegen against that output would produce either build errors or meaningless types.

## Decision

Use a hybrid, verified against real backend source rather than assumed:

- Files with zero internal backend imports — the raw `Database` type and the `AppErrorCode` union — resolve cleanly as type-only cross-project imports, and are imported directly with zero hand-duplication.
- Everything else (request bodies, and response shapes that are service-layer inventions rather than raw database rows) is a hand-written Zod schema in `types/api.ts`, verified field-by-field against the real backend route/service/schema source.
- Where a hand-written schema mirrors a type-importable database row, a compile-time `AssertExact<A, B>` check makes future drift between the two a build error, not just an assumption.
- Every API call, in both directions across the BFF boundary (`apiFetch` client-side, `backendFetch` server-side), parses its response through the matching Zod schema before the caller ever touches the data, via one shared `parseApiResponse` helper.

## Consequences

- A backend field rename or type change becomes an immediate frontend compile error (via `AssertExact`, where applicable) or a runtime `ApiError` at the exact call site that received the mismatched shape (via `parseApiResponse`, everywhere else) — never a silent `undefined` several layers downstream.
- This is a stronger guarantee than the original Eden Treaty plan would have given even if it had worked: Eden Treaty is a compile-time-only guarantee, while parsing every response at runtime also catches drift between what the backend's code claims to return and what it actually sends over the wire in a specific environment.
- There is real, ongoing cost: every backend response shape the frontend consumes has a hand-written schema that a person must keep in sync by re-reading backend source, not a schema generated automatically from one.
- `@elysiajs/eden` is not a dependency of this project — it was installed for the original plan and removed once that plan was found not to work.
