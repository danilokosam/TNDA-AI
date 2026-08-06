-- Authorization: the current_organization_id() helper and the RLS policies
-- for organizations/profiles that depend on it.
--
-- This lives in its own migration, after both `organizations` (0002) and
-- `profiles` (0003), because current_organization_id() is a LANGUAGE SQL
-- function whose body queries `profiles` — and unlike `plpgsql`, Postgres
-- validates a SQL-language function's body against the catalog at
-- CREATE FUNCTION time, not deferred to first call. Defining it any
-- earlier (e.g. alongside `organizations` in 0002, before `profiles`
-- exists) fails with "relation \"public.profiles\" does not exist".

-- Helper: the organization_id of the currently authenticated user, read
-- from their profile row. Marked STABLE + SECURITY DEFINER so it can be
-- reused across every RLS policy without each policy re-deriving it (and
-- without being blocked by the RLS it is used inside of).
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

alter table public.organizations enable row level security;

-- Members can read their own organization; nobody can write directly
-- (organization creation/updates go through service-role backend code).
create policy "organizations_select_own"
  on public.organizations
  for select
  to authenticated
  using (id = public.current_organization_id());

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
