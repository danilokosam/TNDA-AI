# Lifecycle Event Log: Consistency Model and Retry-State Representation

## Status

Accepted

## Context

`docs/document-domain-architecture.md` (§4.1) proposed a durable, append-only log of document-domain lifecycle transitions — closing a real, named gap: `document_jobs.reviewed_by`/`reviewed_at` only ever hold the *latest* review decision, so a confirm → correct → reconfirm cycle silently loses the fact that the document was ever confirmed the first time, by whom, and when. The same document (§3.2, §5) left the Processing axis's retry-state shape explicitly unresolved, deferring it to whichever session actually builds durable lifecycle foundations — this one.

Two implementation-shaped questions had to be answered before writing any code, neither purely mechanical:

1. **Consistency.** A lifecycle event is only meaningful if it can never claim a transition happened when it didn't. This backend talks to Postgres exclusively through Supabase's PostgREST interface (`supabaseAdmin.from(...)`), which has no client-side multi-table transaction primitive — two separate `.from(...)` calls are two independent HTTP requests, not atomic together. The only way to get true same-transaction atomicity for a two-table write is a Postgres RPC function wrapping both in one `plpgsql` body — a pattern this codebase has never used for a *write* (its four existing RPCs are all read-only aggregations: `get_organization_monthly_usage`, `get_organization_job_stats`, `get_organization_daily_job_counts`, `current_organization_id`).
2. **Retry state.** `document_jobs.status = 'failed'` today makes no distinction between a transient Azure hiccup and a genuinely terminal failure — every failure looks the same and requires a fresh upload to recover from. Wave 3's real background worker (§5 of the architecture doc) needs this distinction, plus a durable attempt count, to exist *before* it can safely decide what to retry — but Wave 3's own backoff/claiming/scheduling machinery is explicitly out of scope for this pass.

## Decision

### 1. Why lifecycle events are persisted

`document_job_events` (migration `0014`) is a single, append-only table: one row per domain-meaningful transition (`job_created`, `processing_started`, `processing_completed`, `processing_failed`, `review_confirmed`, `review_rejected`, `review_reset`, `file_removed`, `document_deleted`), each carrying the affected job, an actor (nullable), a from/to status pair, a small bounded JSON payload, and a timestamp. This is the exact nine-item taxonomy derivable from the transitions that exist in `documents.service.ts` today — no event type was added for functionality (archive, purge, auto-confirm, rejection follow-up) that doesn't yet exist.

### 2. Why `document_jobs` remains authoritative

Nothing reads `document_job_events` to determine a job's current state. Every transition is still written to `document_jobs` first, the exact same direct way it is today (`updateDocumentJob`/`createDocumentJob`); the event row is a second, subsequent write recording that the first one happened. If the event log were deleted entirely, `document_jobs` would be unaffected — the system would only lose its history, never its correctness.

### 3. Why this is not event sourcing

Event sourcing means current state is *derived* by replaying history. This is the opposite: state is written directly and eagerly, and history is recorded as a side effect for humans (and, later, tooling) to read — never replayed to reconstruct anything. No consumer of `document_jobs` was changed by this wave; the event log is purely additive.

### 4. Why the write-order model, not a database write RPC

A write RPC would give true same-transaction atomicity, but at a real cost disproportionate to this wave: it introduces a new interaction pattern (write-RPCs) this codebase has never used, and a generic version flexible enough to cover nine structurally different transitions (different columns, different call sites, some with corrections inserted in between) would need either per-transition SQL functions — real, ongoing maintenance surface, one function per event type — or a dynamic-patch function accepting arbitrary column names, which trades one risk (a crash-window gap) for another (a class of dynamic-SQL surface this schema has otherwise avoided everywhere).

Instead, this wave reuses the pattern this codebase already established, deliberately, for the same class of problem: `PROGRESS.md`'s decision 34 ("the write that could make a false claim always goes last") already governs `saveFieldCorrections`/`setDocumentReview`'s ordering between `document_field_corrections` and `document_jobs.review_status`. The lifecycle event log extends the same discipline one step further: the state-transition write happens first (already true — `document_jobs` is unconditionally the first write in every transition), and the event insert happens immediately after, awaited. **The invariant this guarantees**: a `document_job_events` row can never exist claiming a transition succeeded unless that transition's own write already committed successfully — because the event insert's own call site is unreachable unless the preceding `await` on the state write returned without throwing.

### 5. The known limitation

This does **not** guarantee the reverse. If the process crashes, or the second HTTP request to PostgREST fails, in the narrow window between the state write committing and the event insert committing, the result is a real transition with no corresponding event row. `recordLifecycleEvent` (`documents.service.ts`) catches and logs (`console.error`) any failure recording an event — deliberately non-fatal, matching the same tier of caution already applied to `persistOriginalFile`'s Storage write — so an event-logging failure never fails, retries, or duplicates the user-facing operation itself. This is accepted, not hidden: the architecture doc itself frames the log as "not event sourcing... a durable side effect," and a rare missing event is a strictly smaller failure than a false one. No distributed-transaction infrastructure (a message queue, a two-phase commit, an outbox pattern) was introduced to close this gap — doing so would be exactly the kind of complexity this wave was scoped to avoid.

### 6. Retry-state representation, and why retry mechanics are deferred

Two columns were added to `document_jobs` (migration `0015`):

- `retry_count integer not null default 0` — a durable attempt counter. It stays `0` today; nothing in this codebase resubmits a failed job. It exists so Wave 3's worker has somewhere durable to record an attempt without a schema change of its own.
- `is_retryable boolean` — set only when `status = 'failed'` (CHECK-constrained, mirroring `document_jobs_review_requires_completed`'s existing "app logic is primary, a DB constraint backs it up" pattern), classifying the failure as transient or terminal at the exact point it's caught, per the architecture doc's own instruction (§5): "this distinction has to be made where the failure is caught."

Classification uses the real signal already available, at the two places `document_jobs.status` is ever actually set to `'failed'`:

- A submission-time failure (`submitForAnalysis`'s catch block, `documents.service.ts`) is retryable **unless** it's an `AzureServiceError` carrying an HTTP status in the 4xx range — Azure explicitly rejected the request, and retrying the identical request would fail the same way. A network-level failure, a 5xx, or a malformed-response error (no HTTP status attached at all) is retryable. Local validation failures (corrupt file, wrong format, over quota) never reach this branch — `inspectDocumentFile`/`assertFileMeetsPlanConstraints` run, and are handled, before a job is ever submitted to Azure.
- An Azure-*reported* operation failure (`getJobStatus`, when a normal poll response carries `status: "failed"` with Azure's own `error` object) is always terminal. Azure fully processed the request and concluded, on the document's actual content, that it cannot extract from it — retrying without changing the input won't help.

Deliberately **not** added: a backoff/"not before" scheduling timestamp. Computing one needs a real backoff formula, which the architecture doc's own Wave 3 contract (§5) explicitly reserves for whoever builds the worker, with real queue-depth/latency data this wave has none of. Adding an unpopulated scheduling column now, for a formula that doesn't exist yet, would be exactly the "speculative column" this wave was told to avoid. Worker claiming, leases, visibility timeouts, and automatic retry execution are all Wave 3 concerns, untouched here.

## Consequences

- Every future lifecycle transition added to `documents.service.ts` must remember to call `recordLifecycleEvent` after its state write, the same way every future correction had to remember `insertFieldCorrections` — this is a discipline requirement enforced by code review and tests, not by the database.
- A rare crash/network-partition window can produce a real transition with no event row. Anything that later depends on the event log being a *complete* record (not just an accurate one) needs to know this going in.
- `is_retryable`'s classification is a heuristic based on HTTP status alone, not Azure's own documented error-code taxonomy (which this codebase doesn't have visibility into today). It is not consumed by anything yet — refining it is cheap and safe to do whenever Wave 3 actually needs it to drive a real retry decision, with real failure data available at that point.
- No new dependency, migration-runner behavior, or interaction pattern (queues, RPCs, background jobs) was introduced. The next architectural session (Wave 3) still starts from a clean slate on all of those.
