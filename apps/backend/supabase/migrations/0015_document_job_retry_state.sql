-- Durable retry-state representation for the Processing axis (Wave 2 of
-- docs/document-domain-architecture.md §3.2/§5). Schema only — no worker,
-- no queue, no automatic retry, no backoff scheduling. See
-- docs/adr/0011-lifecycle-event-log-and-retry-state.md for the full
-- retry-state decision and why a "not before" scheduling timestamp is
-- deliberately not added here.

alter table public.document_jobs
  add column retry_count integer not null default 0,
  add column is_retryable boolean;

comment on column public.document_jobs.retry_count is
  'Durable count of retry attempts made beyond the original submission. '
  'Always 0 today — nothing in this codebase resubmits a failed job yet. '
  'Exists so Wave 3''s worker has somewhere durable to record an attempt '
  'count without a schema change of its own.';

comment on column public.document_jobs.is_retryable is
  'Set only when status = failed: whether the failure is transient '
  '(worth retrying, e.g. an Azure 5xx/timeout during submission) or '
  'terminal (retrying the identical request would fail the same way, '
  'e.g. Azure itself reported it cannot process this document''s '
  'content). Classified in documents.service.ts at the point each '
  'failure is caught. Null for a job that has never failed. No '
  'automatic retry acts on this value yet — see the ADR.';

-- Defense-in-depth for the same rule documents.service.ts enforces:
-- mirrors document_jobs_review_requires_completed's existing "app logic
-- is primary, a DB constraint backs it up" pattern.
alter table public.document_jobs
  add constraint document_jobs_is_retryable_requires_failed
  check (is_retryable is null or status = 'failed');
