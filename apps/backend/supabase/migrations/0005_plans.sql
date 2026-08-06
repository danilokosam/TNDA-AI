-- Plans: global catalog of subscription tiers and their quota limits.
-- `id` is a human-readable slug (free / basic / pro) rather than a uuid so it
-- can be referenced directly in application code and seed data.
create table if not exists public.plans (
  id                        text primary key,
  name                      text not null,
  price_monthly             numeric(10, 2) not null default 0 check (price_monthly >= 0),
  max_documents_per_month   integer not null check (max_documents_per_month > 0),
  max_pages_per_document    integer not null check (max_pages_per_document > 0),
  max_pages_per_month       integer not null check (max_pages_per_month > 0),
  max_file_size_mb          integer not null check (max_file_size_mb > 0),
  created_at                timestamptz not null default now()
);

alter table public.plans enable row level security;

-- The plan catalog is not tenant data; any authenticated user may read it
-- (e.g. to render a pricing/upgrade page). Writes are service-role only.
create policy "plans_select_all"
  on public.plans
  for select
  to authenticated
  using (true);

insert into public.plans
  (id, name, price_monthly, max_documents_per_month, max_pages_per_document, max_pages_per_month, max_file_size_mb)
values
  ('free',  'Free',  0,    5,   1,  2,   5),
  ('basic', 'Basic', 29,   100, 10, 500, 15),
  ('pro',   'Pro',   99,   1000, 50, 5000, 50)
on conflict (id) do update set
  name                     = excluded.name,
  price_monthly            = excluded.price_monthly,
  max_documents_per_month  = excluded.max_documents_per_month,
  max_pages_per_document   = excluded.max_pages_per_document,
  max_pages_per_month      = excluded.max_pages_per_month,
  max_file_size_mb         = excluded.max_file_size_mb;
