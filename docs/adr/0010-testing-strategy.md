# Testing Strategy: Boundary-Mocked Unit/Integration Tests, TDD for New Frontend Work

## Status

Accepted

## Context

Neither application had any automated tests originally. The backend reached a point where its auth, billing, and document-processing logic was real and consequential enough that manual smoke-testing alone was no longer a sufficient safety net before every change — a test suite, and a CI pipeline enforcing it, was added in one pass. The frontend, built later, faced the same need earlier in its life, and specifically needed a workflow, not just eventual coverage: incremental, test-driven development was requested for feature work from Stage 3 (Upload + Processing) onward — define the type/contract first, write a failing test, implement only enough to pass it, verify the whole workspace is still green, then move to the next slice — specifically to produce many small, independently-verified increments instead of one large, harder-to-verify batch of change.

A recurring, deliberate question for every test in both suites is which layer to mock. Mocking too deep (e.g., stubbing out the Supabase client's internals inside a route test, or stubbing `fetch` itself inside a service test) means the test mostly exercises the mock, not real code. Mocking too shallow (no mocking at all, hitting real Supabase/Azure/Stripe) makes tests slow, flaky, and dependent on real credentials and external service state.

## Decision

Test one layer below whatever is actually under test, and no deeper:

- **Backend**: route tests exercise the real routes and the real error middleware in-process, via Elysia's `app.handle(request)` — no port ever bound — mocking only `services/*`'s own dependencies where needed (e.g., `supabaseAdmin.auth.getUser` for an authenticated route test). Repository tests mock `supabaseAdmin`'s query builder directly, covering both the success and the `AppError`-on-failure path for every exported function. Stripe webhook signature verification is tested for real, with zero network calls, by signing a plain payload locally with Stripe's own test-header helper and handing it to the real verification code. Dummy, non-secret environment values (set in `vitest.config.ts`) satisfy the app's eager env validation, so the suite never needs real Supabase/Azure/Stripe credentials to run, locally or in CI.
- **Frontend**: service tests mock `backendFetch`/`apiFetch`, not `fetch` itself; Route Handler tests mock `services/*`, not the services' own internals; component tests mock `apiFetch`, not React Query's internals. New frontend feature work follows the TDD loop described above as a standing workflow, not a one-off practice scoped to a single feature.
- Both suites run via Vitest, and are part of "full workspace verification" — `typecheck`/`lint`/`test`, fanned out across every workspace package via Turborepo, is the standard bar a change must clear, enforced identically in CI.

## Consequences

- Re-verifying a lower layer's own correctness inside every test above it is deliberately avoided — a repository test proves the repository is correct; a route test built on top of it trusts that and focuses on what the route itself adds (validation, auth gating, error shaping).
- New frontend features arrive as a sequence of small, verified commits rather than one large, hard-to-review batch — at real cost in short-term velocity for the benefit of each increment being independently trustworthy.
- Neither suite requires real external credentials to run, which is what keeps CI free of secrets and keeps the suite runnable identically in any environment, including one with no network access to Supabase, Azure, or Stripe at all.
- This is unit/integration coverage, not end-to-end coverage against a real browser or a real deployed backend. A class of bug exists that only manifests as real client-side rendering behavior in an actual browser, and this strategy does not claim to catch that class — manual verification remains a required, separate step for frontend work with real interactive or rendering risk, not something this test suite is expected to replace.
