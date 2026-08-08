-- Append-only lifecycle/domain event log for document_jobs (Wave 2 of
-- docs/document-domain-architecture.md §4.1). Records that a meaningful
-- state transition happened, when, and (if applicable) who caused it —
-- NOT event sourcing: document_jobs stays the authoritative source of
-- current state, written the exact same direct way it is today. This
-- table is a durable *side effect* of a state change, never the mechanism
-- that produces one. See docs/adr/0011-lifecycle-event-log-and-retry-state.md
-- for the full reasoning, including the write-order consistency model.
--
-- Deliberately independent of document_field_corrections (field-level
-- audit history) — no FK either direction, no folding. Different
-- question, different table: this answers "what happened to this
-- document's lifecycle," that answers "what field value changed, by
-- whom, from what, to what."

create type public.document_job_event_type as enum (
  'job_created',
  'processing_started',
  'processing_completed',
  'processing_failed',
  'review_confirmed',
  'review_rejected',
  'review_reset',
  'file_removed',
  'document_deleted'
);

create table public.document_job_events (
  id                uuid primary key default gen_random_uuid(),
  document_job_id   uuid not null references public.document_jobs (id) on delete cascade,
  event_type        public.document_job_event_type not null,
  actor_user_id     uuid references public.profiles (id) on delete set null,
  from_status       text,
  to_status         text,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

comment on column public.document_job_events.actor_user_id is
  'Who caused this transition. Null means system-caused (e.g. Azure '
  'processing outcomes observed via polling) — never attributed to '
  'whichever user happened to be polling at the time. On delete set '
  'null, not cascade: this records mere involvement, not ownership, '
  'matching document_jobs.reviewed_by''s existing convention.';

comment on column public.document_job_events.from_status is
  'Free-text, not FK''d to any one enum: different event types record a '
  'transition on different axes (processing status, review status, file '
  'presence, retention) that don''t share a type. Null where a prior '
  'state doesn''t apply (e.g. job_created).';

comment on column public.document_job_events.metadata is
  'Small, bounded, event-specific detail that from_status/to_status/actor '
  'don''t already capture (e.g. the error message and retry '
  'classification for processing_failed). Not a general-purpose payload '
  'dumping ground — most event types record {}.';

-- Powers the one real access pattern this table has: fetch a job's
-- ordered history. Low volume by design (single digits to low tens of
-- rows per document, ever - see the architecture doc), so a single
-- index is sufficient; no composite index needed at this scale.
create index document_job_events_document_job_id_idx
  on public.document_job_events (document_job_id);

alter table public.document_job_events enable row level security;

-- No organization_id column of its own — scoped via a subquery against
-- document_jobs, the exact same tenant-boundary pattern
-- document_field_corrections already uses on the same parent table. Real
-- enforcement is the backend's service-role client (ADR 0005); this is
-- defense-in-depth for a hypothetical future direct-from-client read.
create policy "document_job_events_select_same_org"
  on public.document_job_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.document_jobs dj
      where dj.id = document_job_events.document_job_id
        and dj.organization_id = public.current_organization_id()
    )
  );

-- Deliberately no insert/update/delete policy for `authenticated` —
-- writes are service-role only (same as every other write path in this
-- schema), and there is no update/delete policy at all, anywhere, for
-- any role: this table is append-only by construction, not just by
-- application-code convention.
