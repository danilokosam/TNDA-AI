-- Soft-deletes document_jobs: the row (and everything in it — result_json,
-- the full correction history) is always preserved; "deleted" means hidden
-- from normal views, never actually gone. Deliberately a separate migration
-- from 0012's review-workflow columns even though both add columns to
-- document_jobs — this one ships alongside Phase 2 (file lifecycle) of the
-- review-workflow redesign, a later, independent piece of work.

alter table public.document_jobs
  add column deleted_at timestamptz;

comment on column public.document_jobs.deleted_at is
  'Set when a document is deleted via DELETE /jobs/:id (soft-delete — the '
  'row and its data are never removed). Application code filters this out '
  'of normal list/get queries (documents.repository.ts), but deliberately '
  'NOT out of the quota pre-flight checks (organization.repository.ts''s '
  'getMonthlyPagesUsed/getDocumentsSubmittedSince) — quota counts what was '
  'submitted in a billing period, not what is currently visible; deleting '
  'a job must never retroactively free up quota.';
