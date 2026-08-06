-- Document jobs: one row per file submitted for Azure Document Intelligence
-- analysis. Tracks the full lifecycle from upload through Azure polling.
create type public.document_job_status as enum (
  'pending', 'processing', 'completed', 'failed', 'rejected_quota'
);

create table if not exists public.document_jobs (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  user_id             uuid not null references public.profiles (id) on delete cascade,
  file_name           text not null,
  file_size_bytes     bigint not null check (file_size_bytes > 0),
  page_count          integer check (page_count > 0),
  azure_operation_id  text,
  status              public.document_job_status not null default 'pending',
  result_json         jsonb,
  error_message       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists document_jobs_organization_id_idx on public.document_jobs (organization_id);
create index if not exists document_jobs_user_id_idx on public.document_jobs (user_id);
-- Powers the monthly-usage aggregation query in the pre-flight quota check
-- (sum of page_count for an org within the current billing period).
create index if not exists document_jobs_org_created_status_idx
  on public.document_jobs (organization_id, created_at, status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger document_jobs_set_updated_at
  before update on public.document_jobs
  for each row
  execute function public.set_updated_at();

alter table public.document_jobs enable row level security;

create policy "document_jobs_select_same_org"
  on public.document_jobs
  for select
  to authenticated
  using (organization_id = public.current_organization_id());

-- Clients may create a job for themselves within their own org; the backend
-- still re-validates quota server-side with the service-role key before
-- ever calling Azure, so this policy only needs to stop cross-tenant writes.
create policy "document_jobs_insert_own"
  on public.document_jobs
  for insert
  to authenticated
  with check (
    organization_id = public.current_organization_id()
    and user_id = auth.uid()
  );

-- Status/result updates happen exclusively via backend polling code using
-- the service-role key (which bypasses RLS), so no update/delete policy is
-- granted to authenticated clients.
