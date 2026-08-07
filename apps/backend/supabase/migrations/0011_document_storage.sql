-- Persists the originally-uploaded file, in addition to the extracted
-- result already stored on document_jobs. Previously the app never wrote
-- the raw file anywhere (see PROGRESS.md/ARCHITECTURE.md's prior
-- "session-only preview" decision) — this is the migration away from that,
-- toward a real backend-provided preview.

-- Private bucket: no public read. Access is exclusively through
-- backend-generated signed URLs (src/services/storage.service.ts), which
-- is the same "service-role client + explicit backend-side scoping"
-- security model document_jobs itself already uses (ADR 0005) — the RLS
-- policy below is defense-in-depth for any future direct-from-client
-- access, not the primary enforcement mechanism.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

alter table public.document_jobs
  add column storage_path text;

comment on column public.document_jobs.storage_path is
  'Path of the original uploaded file in the "documents" Storage bucket. '
  'Null means no file is persisted for this job — either because it '
  'predates this migration, storage upload failed (deliberately '
  'non-fatal, see documents.service.ts), or (a later migration) the file '
  'was explicitly removed while the job itself was kept.';

-- Objects are written at {organizationId}/{jobId}/{fileName} by the
-- backend (service-role, bypasses this policy entirely) — this policy
-- only matters for a hypothetical future direct-from-client read.
-- storage.foldername(name) splits the object path on "/"; the first
-- segment is the organization id by construction.
create policy "documents_bucket_same_org_read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (public.current_organization_id())::text
  );
