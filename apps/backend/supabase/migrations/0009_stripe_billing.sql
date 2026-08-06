-- Stripe billing: links an organization to its Stripe Customer, and each
-- subscription row to its Stripe Subscription, so webhook events can be
-- synced back to the right rows.
--
-- stripe_customer_id lives on `organizations` (not just `subscriptions`)
-- because an org needs a Stripe Customer before it necessarily has any
-- subscription row at all -- it's created lazily on first checkout, and
-- reused across that org's whole subscription lifecycle (upgrades,
-- cancellations, resubscribes). `subscriptions.stripe_customer_id` is a
-- denormalized copy alongside `stripe_subscription_id`, useful for
-- record-keeping per subscription period and for webhook handlers that
-- only have the subscription/customer id, not the org id, to start from.

alter table public.organizations
  add column if not exists stripe_customer_id text;

create unique index if not exists organizations_stripe_customer_id_idx
  on public.organizations (stripe_customer_id)
  where stripe_customer_id is not null;

alter table public.subscriptions
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

-- Plain (non-partial) unique index, unlike the partial one above:
-- PostgREST's upsert generates `ON CONFLICT (stripe_subscription_id) DO
-- UPDATE ...` with no WHERE clause, which requires a full unique arbiter
-- to match against -- a partial index can't be targeted that way. This is
-- safe for NULLs too: Postgres already treats every NULL as distinct from
-- every other NULL under a plain unique index, so orgs with no Stripe
-- subscription yet don't collide with each other.
create unique index if not exists subscriptions_stripe_subscription_id_idx
  on public.subscriptions (stripe_subscription_id);
