-- Organizations: the tenant boundary for the entire application.
--
-- RLS is enabled and policies are added in 0004_authorization.sql, not
-- here, because they depend on current_organization_id() which itself
-- queries `profiles` (created in 0003) — see that file for why.
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) > 0),
  created_at  timestamptz not null default now()
);
