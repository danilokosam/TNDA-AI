-- Existing `member`-role accounts historically had review/edit/approve/
-- export access (RBAC didn't exist before this). This backfill preserves
-- their effective capabilities under the new, more restrictive `member`
-- definition by promoting them to `reviewer` once, at rollout. Signup
-- (`auth.repository.ts`) always creates a brand-new org with the
-- signer-upper as its `owner` — no current code path creates a `member`
-- or `reviewer` row, so this statement only ever touches rows that
-- already existed before RBAC; the restricted `member` role only becomes
-- reachable once a real invite/role-assignment endpoint exists.
update public.profiles set role = 'reviewer' where role = 'member';
