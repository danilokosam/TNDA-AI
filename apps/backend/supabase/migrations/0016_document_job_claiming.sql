-- Wave 3 Phase 1 — the claim/lease/fencing mechanism that lets a
-- background worker safely own a document_jobs row without a second
-- worker (or a crashed-and-reclaimed former owner) processing it
-- concurrently. Schema + claiming primitive ONLY: no worker exists yet,
-- Azure submission/polling still happen synchronously in the HTTP
-- request exactly as before this migration. See
-- docs/adr/0012-background-job-claiming.md for the full reasoning,
-- including why this is a Postgres RPC rather than a message broker,
-- and why claim state lives on document_jobs rather than a separate
-- table (the same orthogonal-attribute pattern already used for
-- deleted_at/archived_at/retry_count/is_retryable).

alter table public.document_jobs
  add column claimed_by       text,
  add column claimed_at       timestamptz,
  add column lease_expires_at timestamptz,
  add column lease_epoch      integer not null default 0,
  add column next_attempt_at  timestamptz;

comment on column public.document_jobs.claimed_by is
  'Opaque identifier of the claim slot currently responsible for '
  'advancing this job (submission or polling). Not a FK — not a human '
  'actor. IMPORTANT: this must be unique per concurrently-held claim, '
  'not merely per worker process — claim_or_renew_document_job keys its '
  'renew-vs-claim-new decision purely on this value already matching '
  'exactly one row, so a worker process handling more than one job at '
  'once (see WORKER_CONCURRENCY) must mint a distinct id per concurrent '
  'slot (e.g. "{processId}:{slotIndex}"), never reuse one id for '
  'multiple simultaneously-held jobs. Null means unclaimed/available.';

comment on column public.document_jobs.claimed_at is
  'When the current claim was acquired. Null together with claimed_by '
  'and lease_expires_at (see the CHECK constraint below) — this triple '
  'is always all-null or all-set.';

comment on column public.document_jobs.lease_expires_at is
  'When the current claim expires if not renewed. A job is available to '
  '(re)claim when this is null or already in the past — a lease, not a '
  'lock: the worker must renew it periodically while genuinely still '
  'working the job (see claim_or_renew_document_job below).';

comment on column public.document_jobs.lease_epoch is
  'Fencing token. Incremented only when a job is claimed fresh (by any '
  'worker, including a former owner reclaiming after losing its lease) '
  '— never on a plain renewal of an already-held claim. Any write a '
  'worker makes based on a claim it holds should be conditioned on this '
  'value matching what it was given at claim time, so a worker that has '
  'silently lost its lease (reclaimed by someone else) fails to write '
  'instead of clobbering the new holder''s work. Not yet consumed by any '
  'write in Phase 1 — the column exists so later phases have it without '
  'a further migration.';

comment on column public.document_jobs.next_attempt_at is
  'Earliest time a failed, retryable job becomes eligible to be claimed '
  'again. Null except while status = failed and is_retryable = true — '
  'the backoff-scheduling column Wave 2''s ADR explicitly deferred '
  '("reserved for Wave 3... needs a real backoff formula"). The formula '
  'itself is not implemented in Phase 1; only the column and the claim '
  'query''s use of it are.';

-- Same "app logic is primary, a DB constraint backs it up" pattern as
-- document_jobs_review_requires_completed / _is_retryable_requires_failed.
alter table public.document_jobs
  add constraint document_jobs_claim_fields_consistent
  check (
    (claimed_by is null) = (claimed_at is null)
    and (claimed_by is null) = (lease_expires_at is null)
  );

alter table public.document_jobs
  add constraint document_jobs_next_attempt_requires_retryable_failure
  check (next_attempt_at is null or (status = 'failed' and is_retryable = true));

-- Covers the common-case claim query (an available pending/processing
-- job) — the query that runs on every worker poll cycle, unlike the
-- rest of this schema's low-frequency tables. The rarer retry-eligible
-- branch (status = failed) isn't covered by this index; not worth a
-- more complex expression index until real retry volume shows it
-- matters — avoids guessing at a shape before there's real data.
create index document_jobs_claimable_idx
  on public.document_jobs (created_at)
  where deleted_at is null and status in ('pending', 'processing');

-- Atomically claims the next available job, OR renews the caller's
-- existing claim if it already holds one. One RPC covers both so a
-- worker's heartbeat and its initial claim attempt are the exact same
-- call — see docs/adr/0012.
--
-- p_worker_id identifies one CLAIM SLOT, not a worker process: the
-- renew-vs-claim-new decision is purely "does a row already have
-- claimed_by = p_worker_id," so a worker holding several jobs at once
-- (WORKER_CONCURRENCY > 1) must call this with a distinct id per
-- concurrently-held job, not its own shared process id — otherwise a
-- "renew" call would silently renew every job that process holds instead
-- of claiming a new one. See the claimed_by column comment above.
--
-- SECURITY: unlike this schema's four existing (read-only) RPCs, this
-- one must NOT be callable by `authenticated`/`anon` — and getting that
-- right on THIS project takes two explicit REVOKEs, not zero:
-- PostgreSQL grants EXECUTE on a newly created function to PUBLIC by
-- default (a different default than tables), AND this Supabase project
-- separately grants EXECUTE directly to `authenticated`/`anon`/
-- `service_role` on every new function in `public` (confirmed empirically
-- via information_schema.routine_privileges while verifying this
-- migration — a project-level `ALTER DEFAULT PRIVILEGES` rule, not
-- something any migration in this repo sets up). Revoking only from
-- PUBLIC leaves that second, direct grant untouched and the function
-- fully callable by any signed-in end user regardless. This function is
-- security definer and claims across every organization by design (a
-- background worker has no per-tenant scope) — reachable by
-- `authenticated` would let any signed-in end user claim and mutate
-- other organizations' document_jobs rows directly, bypassing RLS
-- entirely. It's reachable only via the service-role client
-- (supabaseAdmin) after the revokes below — service_role's own EXECUTE
-- grant is untouched (only PUBLIC/authenticated/anon are revoked), the
-- same trust boundary every other write path in this backend already
-- uses (ADR 0005).
create or replace function public.claim_or_renew_document_job(
  p_worker_id text,
  p_lease_seconds integer,
  p_max_retries integer
)
returns public.document_jobs
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_job public.document_jobs;
begin
  -- Renew: this worker already holds a live claim on some job. Keyed
  -- purely on claimed_by matching plus an unexpired lease — if another
  -- worker has since reclaimed this row, claimed_by no longer matches
  -- this caller and this UPDATE simply affects zero rows, which is
  -- exactly the "stale worker cannot renew" guarantee: no separate
  -- epoch check is needed here because claimed_by itself already moved.
  update public.document_jobs
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where claimed_by = p_worker_id
    and status in ('pending', 'processing')
    and lease_expires_at > now()
  returning * into v_job;

  if found then
    return v_job;
  end if;

  -- Claim: atomically pick one eligible row and take it. FOR UPDATE
  -- SKIP LOCKED is what makes concurrent claim calls structurally
  -- unable to pick the same row — a second concurrent transaction never
  -- blocks on a row another one is already claiming, it just skips past
  -- it to the next candidate (or finds none).
  --
  -- Eligible means: not soft-deleted, not currently under a live lease,
  -- and either an ordinary pending/processing job OR a failed job that
  -- is genuinely retryable, still within its attempt budget, and past
  -- its scheduled next-attempt time.
  --
  -- Claiming a failed-but-retryable row is also where that row's retry
  -- transition happens, atomically, in the same statement: status moves
  -- back to pending, retry_count increments, is_retryable and
  -- next_attempt_at both reset to null (satisfying both CHECK
  -- constraints above by construction). Non-failed rows pass through
  -- these four columns unchanged.
  update public.document_jobs
  set
    claimed_by = p_worker_id,
    claimed_at = now(),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    lease_epoch = lease_epoch + 1,
    status = case when status = 'failed' then 'pending' else status end,
    retry_count = case when status = 'failed' then retry_count + 1 else retry_count end,
    is_retryable = case when status = 'failed' then null else is_retryable end,
    next_attempt_at = case when status = 'failed' then null else next_attempt_at end
  where id = (
    select dj.id
    from public.document_jobs dj
    where dj.deleted_at is null
      and (dj.claimed_at is null or dj.lease_expires_at <= now())
      and (
        dj.status in ('pending', 'processing')
        or (
          dj.status = 'failed'
          and dj.is_retryable = true
          and dj.retry_count < p_max_retries
          and (dj.next_attempt_at is null or dj.next_attempt_at <= now())
        )
      )
    order by dj.created_at asc
    for update skip locked
    limit 1
  )
  returning * into v_job;

  -- v_job is NULL here (not a row of nulls) when the subquery found
  -- nothing to claim: RETURNING ... INTO on zero affected rows sets the
  -- target to NULL, which is exactly what a "nothing available" answer
  -- should be — PostgREST/postgres-js surface this as a real JSON null,
  -- not an object full of nulls.
  return v_job;
end;
$$;

-- The actual enforcement for the SECURITY note above. Both revokes are
-- required on this project: PUBLIC's default grant, and this Supabase
-- project's own separate direct grant to authenticated/anon on new
-- functions. service_role is deliberately left untouched.
revoke execute on function public.claim_or_renew_document_job(text, integer, integer) from public;
revoke execute on function public.claim_or_renew_document_job(text, integer, integer) from authenticated;
revoke execute on function public.claim_or_renew_document_job(text, integer, integer) from anon;
