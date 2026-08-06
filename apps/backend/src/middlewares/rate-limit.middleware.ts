import { Elysia } from "elysia";
import { env } from "@/config/env";
import { RateLimitedError } from "@/utils/errors";

interface WindowState {
  count: number;
  resetAt: number;
}

/**
 * Simple fixed-window in-memory rate limiter keyed by client IP. Adequate
 * for a single-instance deployment; if the app is ever scaled horizontally,
 * swap the `Map` below for a shared store (e.g. Redis `INCR` + `EXPIRE`)
 * without changing the plugin's external behavior.
 */
const windowsByKey = new Map<string, WindowState>();

function takeRequestSlot(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const existing = windowsByKey.get(key);

  if (!existing || existing.resetAt <= now) {
    windowsByKey.set(key, { count: 1, resetAt: now + env.RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= env.RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export const rateLimitMiddleware = new Elysia({ name: "rate-limit-middleware" }).onBeforeHandle(
  { as: "global" },
  ({ server, request }) => {
    const key = server?.requestIP(request)?.address ?? "unknown";
    const { allowed, retryAfterSeconds } = takeRequestSlot(key);

    if (!allowed) {
      throw new RateLimitedError("Too many requests. Please try again later.", {
        retryAfterSeconds,
      });
    }
  },
);
