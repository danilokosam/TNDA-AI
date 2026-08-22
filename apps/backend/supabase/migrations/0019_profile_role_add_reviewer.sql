-- Additive only. Existing owner/admin/member rows are untouched by this
-- statement alone — see 0020 for the member→reviewer backfill that
-- actually changes data, kept as a separate migration for the same reason
-- this is separate from 0018.
alter type public.profile_role add value 'reviewer';
