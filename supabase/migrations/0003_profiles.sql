-- Profiles: one row per auth.users, scoped to an organization.
--
-- RLS is enabled and policies are added in 0004_authorization.sql, not
-- here — see that file for why (current_organization_id() needs this
-- table to exist first, so it can't be defined any earlier than this
-- migration, and the policies that call it can't either).
create type public.profile_role as enum ('owner', 'admin', 'member');

create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email           text not null,
  role            public.profile_role not null default 'member',
  created_at      timestamptz not null default now()
);

create index if not exists profiles_organization_id_idx on public.profiles (organization_id);
