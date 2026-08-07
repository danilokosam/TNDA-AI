# Backend as the Single Source of Truth for Application Data

## Status

Accepted

## Context

The original plan for this frontend, drafted before any Dashboard code was written, resolved a real backend gap — no aggregate stats endpoint, no document list/history endpoint — by having the frontend read `document_jobs` directly from Supabase, using Row Level Security to scope reads to the caller's own organization. This looked reasonable on paper: `document_jobs`'s RLS policy already restricts `select` to same-org rows, so a direct read couldn't leak another tenant's data.

Building the Dashboard's stats aggregate against that plan surfaced a real architectural tension worth stopping for, not working around: a second, parallel data-access path (frontend directly querying Postgres, alongside the backend's own querying/filtering/aggregation logic) means the same kind of logic — "what counts as a completed job," "how is a date range applied," "what does an average confidence mean for a document type with no per-field confidence" — has to exist correctly in two places that can silently drift from each other. It also means the backend stops being a real, necessary API for this data: anything the frontend can read straight from Postgres is something the backend's own REST surface no longer has to expose or be trusted for, one query at a time, until the "backend" is only actually load-bearing for writes and external integrations.

## Decision

The backend remains the single source of truth for all application data. The frontend will never query Supabase directly for anything except authentication session/cookie state (via `@supabase/ssr`) — that is identity plumbing, not application data, and is not an exception to this rule.

Where the existing backend contract is insufficient for something the frontend needs, the backend gets a new, well-designed, general-purpose REST endpoint — not shaped narrowly to this one frontend's current screen, but a stable contract any future client could use. The Dashboard's stats need becomes a new `GET /organizations/me/stats` endpoint; a future document history/list need becomes a new `GET /documents` endpoint. Both are designed and owned on the backend, with the frontend as one consumer among possible future ones.

## Consequences

- Every list, stat, job status, and mutation the frontend needs from now on requires backend work first — there is no shortcut through a direct Supabase read, even when RLS would technically make it safe. This is accepted as the correct tradeoff, not an inconvenience to route around later.
- The backend's REST surface grows to genuinely cover what a real client needs (filtering, pagination, aggregation), rather than staying minimal because the frontend has its own side door for anything more complex.
- Query logic, filtering rules, and aggregation exist in exactly one place (the backend), so there is nothing for the two applications' understanding of "what the data means" to drift apart on.
- This does not change how the frontend reaches the backend — that question (a direct browser-to-backend call vs. a mediating layer inside the Next.js app) is a separate decision. See `0002-bff-architecture.md`.
