-- Profiles: one row per auth.users, scoped to an organization.
create type public.profile_role as enum ('owner', 'admin', 'member');

create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email           text not null,
  role            public.profile_role not null default 'member',
  created_at      timestamptz not null default now()
);

create index if not exists profiles_organization_id_idx on public.profiles (organization_id);

alter table public.profiles enable row level security;

-- Members can see every profile within their own organization (needed for
-- team management screens) but never rows from another tenant.
create policy "profiles_select_same_org"
  on public.profiles
  for select
  to authenticated
  using (organization_id = public.current_organization_id());

-- A user may only ever update their own row, and may not move themselves
-- to a different organization or grant themselves a new role.
create policy "profiles_update_self"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and organization_id = public.current_organization_id());
