import type { ClaimDocumentJobParams, DocumentJobRow } from "@/modules/documents/documents.repository";

/**
 * Injected so this loop's orchestration can be tested deterministically,
 * with no real process, no real timers, and no real database — the same
 * "mock one layer below what's under test" boundary this codebase's
 * service-layer tests already use. `claim` is the repository's
 * `claimOrRenewDocumentJob`; `submit`/`poll` are the two Wave 3 Phase 2
 * service-layer functions (`submitClaimedJobForProcessing`/
 * `checkClaimedJobProgress`) in production, or logging stubs while this
 * skeleton isn't wired to them yet.
 */
export interface ClaimLoopDeps {
  claim: (params: ClaimDocumentJobParams) => Promise<DocumentJobRow | null>;
  submit: (job: DocumentJobRow) => Promise<DocumentJobRow | null>;
  poll: (job: DocumentJobRow) => Promise<DocumentJobRow | null>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (message: string) => void;
}

export interface ClaimLoopConfig {
  /** One claim SLOT's id — never shared with another concurrently-held job. See docs/adr/0012/0013. */
  slotId: string;
  leaseSeconds: number;
  maxRetries: number;
  pollIntervalMs: number;
  renewalIntervalMs: number;
}

const TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set(["completed", "failed"]);

/**
 * A job just obtained — whether from a fresh claim, a retry-reclaim, or a
 * renewal call that unexpectedly fell through to a different job (see
 * below) — is routed the same way regardless of how it arrived: `pending`
 * needs submitting, `processing` (a resume) needs nothing extra before
 * polling.
 */
async function adopt(job: DocumentJobRow, deps: ClaimLoopDeps): Promise<DocumentJobRow | null> {
  if (job.status === "pending") {
    return deps.submit(job);
  }
  return job;
}

/**
 * Runs one claim slot's loop: claim → (submit if pending) → poll while
 * processing, renewing on schedule → repeat. Stops claiming *new* work
 * once `shouldContinue()` returns false, but always finishes a job it's
 * already holding first — shutdown never abandons in-flight work.
 *
 * The renewal call and a fresh claim are the exact same RPC call
 * (`claim_or_renew_document_job`, Wave 3 Phase 1) — a "renewal" can fall
 * through to claiming a genuinely different job if this slot's own lease
 * was lost to a reclaim elsewhere. Whatever comes back from *any* call to
 * `deps.claim` is always routed through `adopt`, never assumed to still
 * be the job this loop thinks it's tracking — that assumption is exactly
 * the gap Phase 2's own consistency review found and closed (see
 * docs/adr/0013).
 */
export async function runClaimSlot(
  config: ClaimLoopConfig,
  deps: ClaimLoopDeps,
  shouldContinue: () => boolean,
): Promise<void> {
  let currentJob: DocumentJobRow | null = null;
  let lastRenewalAt = 0;

  while (true) {
    if (currentJob === null && !shouldContinue()) return;

    try {
      if (currentJob === null) {
        const claimed = await deps.claim({
          workerId: config.slotId,
          leaseSeconds: config.leaseSeconds,
          maxRetries: config.maxRetries,
        });

        if (!claimed) {
          await deps.sleep(config.pollIntervalMs);
          continue;
        }

        deps.log(`claimed job ${claimed.id} (status=${claimed.status}, retry_count=${claimed.retry_count})`);
        lastRenewalAt = deps.now();
        currentJob = await adopt(claimed, deps);
      } else {
        if (deps.now() - lastRenewalAt >= config.renewalIntervalMs) {
          const renewed = await deps.claim({
            workerId: config.slotId,
            leaseSeconds: config.leaseSeconds,
            maxRetries: config.maxRetries,
          });

          if (!renewed) {
            deps.log(`lost ownership of job ${currentJob.id} during renewal`);
            currentJob = null;
          } else if (renewed.id !== currentJob.id) {
            deps.log(`lost ownership of job ${currentJob.id} during renewal; adopted job ${renewed.id} instead`);
            lastRenewalAt = deps.now();
            currentJob = await adopt(renewed, deps);
          } else {
            lastRenewalAt = deps.now();
            currentJob = renewed;
          }
        }

        if (currentJob && currentJob.status === "processing") {
          currentJob = await deps.poll(currentJob);
          if (!currentJob) {
            deps.log("lost ownership while polling");
          }
        }
      }
    } catch (error) {
      // Fault isolation, added after live verification against a real
      // worker process surfaced this exact gap (docs/adr/0013): an
      // unexpected failure from claim/submit/poll — a transient Azure,
      // Storage, or database error, or a malformed row — must never kill
      // this slot, let alone the whole worker process. Deliberately NOT
      // an epoch-gated write here: the row simply keeps whatever claim
      // it already has until Phase 1's existing lease-expiry mechanism
      // makes it reclaimable again, the same self-healing path a
      // genuinely crashed worker process already relies on.
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      deps.log(
        `slot ${config.slotId} hit an unexpected error${currentJob ? ` while processing job ${currentJob.id}` : ""}: ${detail}`,
      );
      currentJob = null;
    }

    if (currentJob && TERMINAL_JOB_STATUSES.has(currentJob.status)) {
      deps.log(`job ${currentJob.id} reached a terminal state (${currentJob.status})`);
      currentJob = null;
    }

    if (currentJob) {
      await deps.sleep(config.pollIntervalMs);
    }
    // currentJob === null falls through to the top of the loop with no
    // extra sleep — re-checking shouldContinue() before trying to claim
    // again, whether we just finished a job, lost one to an unexpected
    // error, or never had one this tick.
  }
}

/**
 * Runs every claim slot's loop to completion without letting one slot's
 * unexpected rejection stop the others. `runClaimSlot` itself already
 * contains ordinary claim/submit/poll failures (above) — a rejection
 * reaching here means a genuinely unanticipated bug in the loop's own
 * control flow, not a normal operational failure. Logged, not silently
 * swallowed, but the remaining slots keep running exactly as if it
 * hadn't happened; a healthy slot's uptime should never depend on a
 * sibling's.
 */
export async function runSlots(slotPromises: Promise<void>[], log: (message: string) => void): Promise<void> {
  const results = await Promise.allSettled(slotPromises);

  for (const result of results) {
    if (result.status === "rejected") {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      log(`a claim slot terminated unexpectedly: ${reason}`);
    }
  }
}
