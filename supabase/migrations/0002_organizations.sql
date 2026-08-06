-- Organizations: the tenant boundary for the entire application.
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) > 0),
  created_at  timestamptz not null default now()
);

alter table public.organizations enable row level security;

-- Helper: the organization_id of the currently authenticated user, read from
-- their profile row. Marked STABLE + SECURITY DEFINER so it can be reused
-- across every RLS policy without each policy re-deriving it (and without
-- being blocked by the RLS it is used inside of).
create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.profiles
  where id = auth.uid()
$$;

-- Members can read their own organization; nobody can write directly
-- (organization creation/updates go through service-role backend code).
create policy "organizations_select_own"
  on public.organizations
  for select
  to authenticated
  using (id = public.current_organization_id());
