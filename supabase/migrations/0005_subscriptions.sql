-- Subscriptions: which plan an organization is currently on.
create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'canceled', 'incomplete'
);

create table if not exists public.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  plan_id               text not null references public.plans (id),
  status                public.subscription_status not null default 'active',
  current_period_start  timestamptz not null default now(),
  current_period_end    timestamptz not null,
  created_at            timestamptz not null default now(),

  constraint subscriptions_period_valid check (current_period_end > current_period_start)
);

-- One active/trialing subscription per organization at a time.
create unique index if not exists subscriptions_one_active_per_org
  on public.subscriptions (organization_id)
  where status in ('trialing', 'active', 'past_due');

create index if not exists subscriptions_organization_id_idx on public.subscriptions (organization_id);

alter table public.subscriptions enable row level security;

create policy "subscriptions_select_own_org"
  on public.subscriptions
  for select
  to authenticated
  using (organization_id = public.current_organization_id());

-- Subscription lifecycle (creation, upgrades, billing webhooks) is managed
-- exclusively by service-role backend code, never directly by clients.
