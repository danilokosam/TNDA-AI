-- Returns the total page count already consumed by an organization within
-- its current subscription billing period (or the calendar month if no
-- subscription row exists yet, e.g. a brand-new org still on the implicit
-- free tier). Only jobs that actually count against quota are summed:
-- pending/processing/completed all reserve pages; failed/rejected_quota do
-- not, since they never consumed Azure processing.
create or replace function public.get_organization_monthly_usage(p_organization_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with period as (
    select
      coalesce(
        (
          select s.current_period_start
          from public.subscriptions s
          where s.organization_id = p_organization_id
            and s.status in ('trialing', 'active', 'past_due')
          order by s.created_at desc
          limit 1
        ),
        date_trunc('month', now())
      ) as period_start
  )
  select coalesce(sum(dj.page_count), 0)::integer
  from public.document_jobs dj, period
  where dj.organization_id = p_organization_id
    and dj.created_at >= period.period_start
    and dj.status in ('pending', 'processing', 'completed')
$$;

grant execute on function public.get_organization_monthly_usage(uuid) to authenticated;
