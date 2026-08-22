-- Hardens profiles_update_self so a user can update their own row (name,
-- future self-service fields) but can never change their own `role` via a
-- direct PostgREST/Supabase call using their own session — only the
-- service-role backend can do that (and today, nothing does; role is set
-- once at signup). The policy's own original comment already claimed this
-- was disallowed ("may not... grant themselves a new role") but the old
-- `with check` never actually enforced it. This is the fix.
--
-- The subquery reads `profiles.role` for the same row being updated. Within
-- a single UPDATE statement, an RLS `with check` subquery on the same table
-- sees the pre-update snapshot, so this compares the proposed new `role`
-- against the row's current, pre-update value — the standard pattern for
-- making one column immutable via RLS without a trigger.
drop policy "profiles_update_self" on public.profiles;

create policy "profiles_update_self"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and organization_id = public.current_organization_id()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );
