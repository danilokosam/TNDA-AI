-- Adds the human review workflow: confirm/reject a completed extraction, and
-- a full audit-log history of field-level corrections. Deliberately a
-- separate lifecycle from document_job_status (which tracks Azure
-- processing and drives the frontend's polling logic) — a job can be
-- "completed" (Azure succeeded) long before, or without ever, being
-- reviewed by a human.

create type public.document_review_status as enum (
  'unreviewed', 'confirmed', 'rejected'
);

alter table public.document_jobs
  add column review_status public.document_review_status not null default 'unreviewed',
  add column reviewed_by uuid references public.profiles (id) on delete set null,
  add column reviewed_at timestamptz;

-- reviewed_by intentionally uses `on delete set null`, not `on delete
-- cascade` like user_id above it — this column records mere involvement
-- ("who last reviewed this"), not ownership, so deleting an unrelated
-- profile must not silently delete every job they ever reviewed.

-- A job can only leave 'unreviewed' once Azure has actually finished
-- ('completed') — there is nothing to review before that. This is
-- primarily enforced in the service layer (documents.service.ts), which
-- returns a clear error before ever attempting the write; this constraint
-- is defense-in-depth for the same rule.
alter table public.document_jobs
  add constraint document_jobs_review_requires_completed
  check (review_status = 'unreviewed' or status = 'completed');

-- One row per field-edit event, not a single "current value" column: the
-- full history (who changed what, from what, to what, when) is the point —
-- see documents.service.ts for how "current effective value per field" is
-- derived from this table by taking the latest row per field_name.
create table public.document_field_corrections (
  id                uuid primary key default gen_random_uuid(),
  document_job_id   uuid not null references public.document_jobs (id) on delete cascade,
  field_name        text not null,
  previous_value    text,
  new_value         text not null,
  edited_by         uuid references public.profiles (id) on delete set null,
  edited_at         timestamptz not null default now()
);

create index document_field_corrections_job_id_idx
  on public.document_field_corrections (document_job_id);

alter table public.document_field_corrections enable row level security;

-- No organization_id column of its own — scoped via a subquery against
-- document_jobs, the same tenant boundary every other table in this
-- schema uses. As with document_jobs itself, this is defense-in-depth for
-- a hypothetical future direct-from-client read: real enforcement is the
-- backend's service-role client (ADR 0005), which is the only thing that
-- writes to this table today.
create policy "document_field_corrections_select_same_org"
  on public.document_field_corrections
  for select
  to authenticated
  using (
    exists (
      select 1 from public.document_jobs dj
      where dj.id = document_field_corrections.document_job_id
        and dj.organization_id = public.current_organization_id()
    )
  );
