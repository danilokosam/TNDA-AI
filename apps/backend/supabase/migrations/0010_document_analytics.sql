-- Adds the columns and aggregate functions needed for the frontend's
-- document list/history and analytics views. Both were previously gaps:
-- document_type was computed at upload time but never persisted, and
-- confidence lived only inside result_json (and only for some document
-- types). Rather than have the frontend read document_jobs directly to
-- work around this, the backend now owns list/filter/aggregate access to
-- its own domain data, same as everything else.

create type public.document_type as enum (
  'invoice', 'receipt', 'identity_document', 'generic'
);

alter table public.document_jobs
  add column document_type public.document_type not null default 'invoice';

-- Nullable: pending/processing/failed/rejected_quota jobs have no result to
-- score, and `generic` (Azure's prebuilt-layout model) never has per-field
-- confidence even once completed — see documents.strategy.ts.
alter table public.document_jobs
  add column average_confidence real check (average_confidence >= 0 and average_confidence <= 1);

-- Powers GET /api/v1/organizations/me/stats's success-rate/avg-processing-
-- time numbers. `completed`/`failed` only (not `pending`/`processing`,
-- which haven't resolved yet, and not `rejected_quota`, which was never
-- actually attempted) — matches the existing status-transition semantics
-- in documents.service.ts.
create or replace function public.get_organization_job_stats(p_organization_id uuid, p_since timestamptz)
returns table (
  completed_jobs bigint,
  failed_jobs bigint,
  avg_processing_seconds double precision
)
language sql
stable
as $$
  select
    count(*) filter (where status = 'completed') as completed_jobs,
    count(*) filter (where status = 'failed') as failed_jobs,
    avg(extract(epoch from (updated_at - created_at))) filter (where status in ('completed', 'failed')) as avg_processing_seconds
  from public.document_jobs
  where organization_id = p_organization_id
    and created_at >= p_since
$$;

-- Powers the same endpoint's daily-volume chart.
create or replace function public.get_organization_daily_job_counts(p_organization_id uuid, p_since timestamptz)
returns table (day date, job_count bigint)
language sql
stable
as $$
  select date_trunc('day', created_at)::date as day, count(*) as job_count
  from public.document_jobs
  where organization_id = p_organization_id
    and created_at >= p_since
    and status in ('completed', 'failed')
  group by day
  order by day
$$;

-- Deliberately not `security definer` + `grant execute to authenticated`
-- (unlike get_organization_monthly_usage in 0008): these are called only
-- by the backend's service-role client, which already bypasses RLS
-- regardless of the function's own security context, and the frontend
-- must never query Supabase directly for application data — so there's no
-- caller for these functions that needs `authenticated`-role access at all.
