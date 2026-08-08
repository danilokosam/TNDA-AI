import { randomUUID } from "node:crypto";
import { env } from "@/config/env";
import { claimOrRenewDocumentJob } from "@/modules/documents/documents.repository";
import { checkClaimedJobProgress, submitClaimedJobForProcessing } from "@/modules/documents/documents.service";
import { runClaimSlot, runSlots, type ClaimLoopConfig, type ClaimLoopDeps } from "@/worker/claim-loop";

// Wave 3 Phase 2, Step 6: claim/renew against the real Phase 1 RPC, and
// submit/poll against the real Step 3 service functions — this process now
// makes actual Azure Document Intelligence calls. See docs/adr/0013.
const baseWorkerId = randomUUID();

const config: ClaimLoopConfig = {
  slotId: "", // set per-slot below
  leaseSeconds: env.WORKER_LEASE_SECONDS,
  maxRetries: env.WORKER_MAX_RETRIES,
  pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
  renewalIntervalMs: Math.floor((env.WORKER_LEASE_SECONDS * 1000) / 2), // renew at 50% of lease duration — see locked decision #4
};

function makeDeps(slotId: string): ClaimLoopDeps {
  return {
    claim: claimOrRenewDocumentJob,
    submit: (job) => submitClaimedJobForProcessing(job, slotId, env.WORKER_MAX_RETRIES),
    poll: checkClaimedJobProgress,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (message) => console.log(`[worker:${slotId}] ${message}`),
  };
}

let shuttingDown = false;
const shouldContinue = () => !shuttingDown;

const slots = Array.from({ length: env.WORKER_CONCURRENCY }, (_, index) => {
  const slotId = `${baseWorkerId}:${index}`;
  return runClaimSlot({ ...config, slotId }, makeDeps(slotId), shouldContinue);
});

console.log(
  `TNDA-AI worker ${baseWorkerId} started with ${env.WORKER_CONCURRENCY} slot(s) ` +
    `(lease=${env.WORKER_LEASE_SECONDS}s, poll=${env.WORKER_POLL_INTERVAL_MS}ms, maxRetries=${env.WORKER_MAX_RETRIES})`,
);

function shutdown(signal: string) {
  if (shuttingDown) return;
  console.log(`[worker:${baseWorkerId}] received ${signal}, finishing in-flight jobs before exit`);
  shuttingDown = true;
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

await runSlots(slots, (message) => console.log(`[worker:${baseWorkerId}] ${message}`));
console.log(`[worker:${baseWorkerId}] all slots drained, exiting`);
