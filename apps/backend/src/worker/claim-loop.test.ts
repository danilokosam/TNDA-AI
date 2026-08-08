import { describe, expect, it, vi } from "vitest";
import type { ClaimDocumentJobParams } from "@/modules/documents/documents.repository";
import { runClaimSlot, runSlots, type ClaimLoopConfig, type ClaimLoopDeps } from "@/worker/claim-loop";

// Mirrors this codebase's own testing philosophy: mock one layer below
// what's under test (the repository call shape and the two service-layer
// handlers), never the loop's own orchestration logic. Real timers are
// never used — `sleep`/`now` are injected and fully controlled per test,
// so every scenario runs instantly and deterministically.

function jobRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "job_1",
    status: "pending",
    retry_count: 0,
    lease_epoch: 1,
    azure_operation_id: null,
    ...overrides,
  };
}

function baseConfig(overrides: Partial<ClaimLoopConfig> = {}): ClaimLoopConfig {
  return {
    slotId: "worker-1:0",
    leaseSeconds: 180,
    maxRetries: 3,
    pollIntervalMs: 5000,
    renewalIntervalMs: 90000,
    ...overrides,
  };
}

/** A `shouldContinue` that returns true a fixed number of times, then false forever. */
function stopAfter(n: number): () => boolean {
  let calls = 0;
  return () => calls++ < n;
}

function makeDeps(overrides: Partial<ClaimLoopDeps> = {}): ClaimLoopDeps {
  let clock = 0;
  return {
    claim: vi.fn().mockResolvedValue(null),
    submit: vi.fn(async (job) => job),
    poll: vi.fn(async (job) => job),
    sleep: vi.fn(async () => {
      clock += 1; // deterministic, no real waiting
    }),
    now: vi.fn(() => clock),
    log: vi.fn(),
    ...overrides,
  };
}

describe("runClaimSlot", () => {
  it("sleeps and retries when nothing is available to claim, and stops once shouldContinue is false", async () => {
    const deps = makeDeps({ claim: vi.fn().mockResolvedValue(null) });

    await runClaimSlot(baseConfig(), deps, stopAfter(3));

    expect(deps.claim).toHaveBeenCalledTimes(3);
    expect(deps.claim).toHaveBeenCalledWith({ workerId: "worker-1:0", leaseSeconds: 180, maxRetries: 3 } satisfies ClaimDocumentJobParams);
    expect(deps.sleep).toHaveBeenCalledTimes(3);
  });

  it("stops immediately when shouldContinue is already false and nothing is held", async () => {
    const deps = makeDeps();

    await runClaimSlot(baseConfig(), deps, () => false);

    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("submits a freshly claimed pending job, then polls it once it's processing, then stops on completion", async () => {
    const deps = makeDeps({
      claim: vi
        .fn()
        .mockResolvedValueOnce(jobRow({ status: "pending" })) // initial claim
        .mockResolvedValue(null), // no more work after this job finishes
      submit: vi.fn().mockResolvedValue(jobRow({ status: "processing", azure_operation_id: "op_1" })),
      poll: vi.fn().mockResolvedValue(jobRow({ status: "completed" })),
    });

    await runClaimSlot(baseConfig(), deps, stopAfter(2));

    expect(deps.submit).toHaveBeenCalledTimes(1);
    expect(deps.submit).toHaveBeenCalledWith(jobRow({ status: "pending" }));
    expect(deps.poll).toHaveBeenCalledTimes(1);
    expect(deps.poll).toHaveBeenCalledWith(jobRow({ status: "processing", azure_operation_id: "op_1" }));
  });

  it("resumes a claimed job that's already `processing` by polling directly, without calling submit", async () => {
    const deps = makeDeps({
      claim: vi.fn().mockResolvedValueOnce(jobRow({ status: "processing", azure_operation_id: "op_1" })).mockResolvedValue(null),
      poll: vi.fn().mockResolvedValue(jobRow({ status: "completed" })),
    });

    await runClaimSlot(baseConfig(), deps, stopAfter(2));

    expect(deps.submit).not.toHaveBeenCalled();
    expect(deps.poll).toHaveBeenCalledTimes(1);
  });

  it("goes back to looking for new work immediately (no sleep) after a job reaches a terminal state", async () => {
    const deps = makeDeps({
      claim: vi
        .fn()
        .mockResolvedValueOnce(jobRow({ status: "processing" }))
        .mockResolvedValue(null),
      poll: vi.fn().mockResolvedValue(jobRow({ status: "failed" })),
    });

    await runClaimSlot(baseConfig(), deps, stopAfter(2));

    // One claim for the initial job, one claim afterward looking for new
    // work — with no sleep call *between* finishing the terminal job and
    // that next claim attempt.
    expect(deps.claim).toHaveBeenCalledTimes(2);
  });

  it("treats submit/poll returning null as lost ownership: stops tracking the job and looks for new work immediately", async () => {
    const deps = makeDeps({
      claim: vi.fn().mockResolvedValueOnce(jobRow({ status: "pending" })).mockResolvedValue(null),
      submit: vi.fn().mockResolvedValue(null),
    });

    await runClaimSlot(baseConfig(), deps, stopAfter(2));

    expect(deps.poll).not.toHaveBeenCalled();
    expect(deps.claim).toHaveBeenCalledTimes(2);
  });

  it("renews on schedule (once renewalIntervalMs has elapsed) rather than on every poll tick", async () => {
    let clock = 0;
    const deps = makeDeps({
      claim: vi
        .fn()
        .mockResolvedValueOnce(jobRow({ status: "processing" })) // initial claim
        .mockResolvedValueOnce(jobRow({ status: "processing" })) // the one renewal that's due
        .mockResolvedValue(null), // nothing left once this job finishes
      poll: vi
        .fn()
        .mockResolvedValueOnce(jobRow({ status: "processing" }))
        .mockResolvedValueOnce(jobRow({ status: "processing" }))
        .mockResolvedValueOnce(jobRow({ status: "processing" }))
        .mockResolvedValue(jobRow({ status: "completed" })), // terminates on the 4th poll tick
      now: vi.fn(() => clock),
      sleep: vi.fn(async () => {
        clock += 1000; // 1s per poll tick
      }),
    });

    // renewalIntervalMs=2500 with 1000ms sleep ticks: renewal should not
    // fire on the 2nd or 3rd iteration, only once elapsed time crosses it
    // (on the 4th), and the job completes right after.
    await runClaimSlot(baseConfig({ renewalIntervalMs: 2500 }), deps, stopAfter(2));

    // 1 initial claim + exactly 1 renewal call once due, but not one per tick.
    const claimCallCount = vi.mocked(deps.claim).mock.calls.length;
    expect(claimCallCount).toBeGreaterThan(1);
    expect(claimCallCount).toBeLessThan(4); // strictly fewer renewals than poll ticks
  });

  it("adopts a genuinely different job when a renewal call falls through to a fresh claim (stale-lease scenario)", async () => {
    let clock = 0;
    const deps = makeDeps({
      claim: vi
        .fn()
        .mockResolvedValueOnce(jobRow({ id: "job_A", status: "processing" })) // initial claim
        .mockResolvedValueOnce(jobRow({ id: "job_B", status: "pending" })) // "renewal" call actually returns a different job
        .mockResolvedValue(null),
      poll: vi.fn().mockImplementation(async (job) => job),
      submit: vi.fn().mockResolvedValue(jobRow({ id: "job_B", status: "processing" })),
      now: vi.fn(() => clock),
      sleep: vi.fn(async () => {
        clock += 100000; // force the renewal check to trigger next iteration
      }),
    });

    await runClaimSlot(baseConfig({ renewalIntervalMs: 1 }), deps, stopAfter(3));

    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("lost ownership"));
    // job_B, being pending, must go through submit — not be treated as
    // already-processing just because it arrived via a "renewal" call.
    expect(deps.submit).toHaveBeenCalledWith(jobRow({ id: "job_B", status: "pending" }));
  });

  it("adopts nothing (goes idle) when a renewal call returns null (lease lost, nothing else available)", async () => {
    let clock = 0;
    const deps = makeDeps({
      claim: vi.fn().mockResolvedValueOnce(jobRow({ status: "processing" })).mockResolvedValue(null),
      poll: vi.fn().mockImplementation(async (job) => job),
      now: vi.fn(() => clock),
      sleep: vi.fn(async () => {
        clock += 100000;
      }),
    });

    await runClaimSlot(baseConfig({ renewalIntervalMs: 1 }), deps, stopAfter(3));

    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("lost ownership"));
  });

  it("graceful shutdown: stops claiming new work but lets an already-held job finish first", async () => {
    let allowContinue = true;
    const deps = makeDeps({
      claim: vi.fn().mockResolvedValueOnce(jobRow({ status: "processing" })).mockResolvedValue(null),
      poll: vi
        .fn()
        .mockResolvedValueOnce(jobRow({ status: "processing" })) // still running when shutdown is signaled
        .mockResolvedValueOnce(jobRow({ status: "completed" })), // finishes on the next tick
    });

    let ticks = 0;
    const shouldContinue = () => {
      ticks++;
      const result = allowContinue;
      if (ticks === 1) allowContinue = false; // signal shutdown right after the first claim
      return result;
    };

    await runClaimSlot(baseConfig(), deps, shouldContinue);

    // The held job was polled to completion even though shouldContinue
    // went false while it was still in flight — never abandoned mid-flight.
    expect(deps.poll).toHaveBeenCalledTimes(2);
    // No further claim call was made once idle again post-shutdown.
    expect(deps.claim).toHaveBeenCalledTimes(1);
  });

  // Added after a real, live worker process crashed entirely on a single
  // unexpected polling exception (see docs/adr/0013's live-verification
  // follow-up) — an unhandled AzureServiceError from a stale/malformed
  // row propagated all the way out of Promise.all(slots) and killed the
  // whole process, including every other slot's in-flight work. These
  // prove claim/submit/poll failures are now contained per-slot.

  it("an unexpected exception during poll is caught and logged, and does not kill the slot", async () => {
    const deps = makeDeps({
      claim: vi.fn().mockResolvedValueOnce(jobRow({ status: "processing" })).mockResolvedValue(null),
      poll: vi.fn().mockRejectedValueOnce(new Error("simulated Azure failure")),
    });

    await expect(runClaimSlot(baseConfig(), deps, stopAfter(3))).resolves.toBeUndefined();

    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("unexpected error"));
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("simulated Azure failure"));
  });

  it("an unexpected exception during the initial claim call is caught and logged, and does not kill the slot", async () => {
    const deps = makeDeps({
      claim: vi.fn().mockRejectedValueOnce(new Error("simulated DB connectivity error")).mockResolvedValue(null),
    });

    await expect(runClaimSlot(baseConfig(), deps, stopAfter(2))).resolves.toBeUndefined();

    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("simulated DB connectivity error"));
  });

  it("does not attempt any write from the error-handling path itself — no epoch-gated write, no re-entrant claim/submit/poll call within the same catch", async () => {
    const deps = makeDeps({
      claim: vi.fn().mockResolvedValueOnce(jobRow({ status: "processing" })).mockResolvedValue(null),
      poll: vi.fn().mockRejectedValueOnce(new Error("simulated Azure failure")),
    });

    await runClaimSlot(baseConfig(), deps, stopAfter(2));

    // poll was called exactly once (the failing attempt) — recovery relies
    // entirely on the existing lease-expiry mechanism, not a retry-in-place.
    expect(deps.poll).toHaveBeenCalledTimes(1);
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it("recovers after an unexpected error and successfully processes a subsequent job", async () => {
    const deps = makeDeps({
      claim: vi
        .fn()
        .mockResolvedValueOnce(jobRow({ id: "job_broken", status: "processing" }))
        .mockResolvedValueOnce(jobRow({ id: "job_healthy", status: "pending" }))
        .mockResolvedValue(null),
      poll: vi.fn().mockRejectedValueOnce(new Error("simulated failure")),
      submit: vi.fn().mockResolvedValue(jobRow({ id: "job_healthy", status: "completed" })),
    });

    await runClaimSlot(baseConfig(), deps, stopAfter(3));

    expect(deps.submit).toHaveBeenCalledWith(jobRow({ id: "job_healthy", status: "pending" }));
  });
});

describe("runSlots", () => {
  it("waits for every slot to settle and logs a rejection without throwing", async () => {
    const log = vi.fn();
    const healthy = Promise.resolve();
    const broken = Promise.reject(new Error("simulated unexpected slot crash"));

    await expect(runSlots([healthy, broken], log)).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(expect.stringContaining("simulated unexpected slot crash"));
  });

  it("keeps a healthy sibling slot running to completion even when another slot's promise rejects", async () => {
    const healthyDeps = makeDeps({
      claim: vi.fn().mockResolvedValueOnce(jobRow({ id: "job_sibling", status: "pending" })).mockResolvedValue(null),
      submit: vi.fn().mockResolvedValue(jobRow({ id: "job_sibling", status: "completed" })),
    });
    const healthySlot = runClaimSlot(baseConfig({ slotId: "slot-healthy" }), healthyDeps, stopAfter(2));
    const brokenSlot = Promise.reject(new Error("simulated unexpected slot crash"));

    const log = vi.fn();
    await runSlots([healthySlot, brokenSlot], log);

    expect(healthyDeps.submit).toHaveBeenCalledWith(jobRow({ id: "job_sibling", status: "pending" }));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("simulated unexpected slot crash"));
  });

  it("logs nothing when every slot settles normally", async () => {
    const log = vi.fn();

    await runSlots([Promise.resolve(), Promise.resolve()], log);

    expect(log).not.toHaveBeenCalled();
  });
});
