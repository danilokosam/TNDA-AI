import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Elysia } from "elysia";
import { z } from "zod";
import { errorMiddleware } from "@/middlewares/error.middleware";
import { rateLimitMiddleware } from "@/middlewares/rate-limit.middleware";

/** `Response.json()` types as `Promise<unknown>` here (Bun-native, non-DOM lib) — parsed through a real schema, matching documents.routes.test.ts's convention. */
const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.object({ retryAfterSeconds: z.number() }) }),
});

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 100;

const app = new Elysia().use(errorMiddleware).use(rateLimitMiddleware).get("/ping", () => "pong");

/**
 * `rate-limit.middleware.ts` keeps its window state in a module-level
 * `Map`, deliberately (a real, shared, single-process limiter — see the
 * module's own docstring), so it's a singleton across every test in this
 * file. Rather than `vi.resetModules()` (which would also reload
 * `@/utils/errors` as a fresh module, breaking `errorMiddleware`'s
 * `instanceof AppError` check against errors thrown by a separately
 * re-imported copy of this middleware), each test starts by advancing the
 * fake clock past a full window — the same natural-expiry path the
 * middleware itself uses, not a special test-only reset hook.
 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.advanceTimersByTime(WINDOW_MS + 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rateLimitMiddleware", () => {
  it(`allows up to ${MAX_REQUESTS} requests within one window`, async () => {
    for (let i = 0; i < MAX_REQUESTS; i++) {
      const response = await app.handle(new Request("http://localhost/ping"));
      expect(response.status).toBe(200);
    }
  });

  it(`blocks the request immediately after the limit with 429 and a matching Retry-After`, async () => {
    for (let i = 0; i < MAX_REQUESTS; i++) {
      await app.handle(new Request("http://localhost/ping"));
    }
    const blocked = await app.handle(new Request("http://localhost/ping"));

    expect(blocked.status).toBe(429);
    const body = errorEnvelopeSchema.parse(await blocked.json());
    expect(body.error.code).toBe("RATE_LIMITED");
    // A fresh window just started, so the full window should remain.
    expect(body.error.details.retryAfterSeconds).toBe(WINDOW_MS / 1000);
  });

  it("reports a shrinking retryAfterSeconds as the window elapses, not a constant/stale value", async () => {
    for (let i = 0; i < MAX_REQUESTS; i++) {
      await app.handle(new Request("http://localhost/ping"));
    }
    await vi.advanceTimersByTimeAsync(45_000);
    const blocked = await app.handle(new Request("http://localhost/ping"));

    expect(blocked.status).toBe(429);
    const body = errorEnvelopeSchema.parse(await blocked.json());
    expect(body.error.details.retryAfterSeconds).toBe(15);
  });

  it("allows requests again once the window has fully reset, and starts a new window (not a permanent block)", async () => {
    for (let i = 0; i < MAX_REQUESTS; i++) {
      await app.handle(new Request("http://localhost/ping"));
    }
    const stillBlocked = await app.handle(new Request("http://localhost/ping"));
    expect(stillBlocked.status).toBe(429);

    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    const afterReset = await app.handle(new Request("http://localhost/ping"));

    expect(afterReset.status).toBe(200);

    // The new window enforces its own limit from scratch, not "0 remaining
    // forever" — confirms this is a real reset, not an off-by-one that
    // happens to let exactly one more request through.
    for (let i = 0; i < MAX_REQUESTS - 1; i++) {
      const response = await app.handle(new Request("http://localhost/ping"));
      expect(response.status).toBe(200);
    }
    const blockedAgain = await app.handle(new Request("http://localhost/ping"));
    expect(blockedAgain.status).toBe(429);
  });
});
