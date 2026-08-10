import type { z } from "zod";
import { parseApiFileResponse, parseApiResponse } from "@/lib/api/response";

/**
 * Client-safe same-origin fetch wrapper — the only thing `features/*`
 * hooks are allowed to call directly. Always same-origin (a plain path,
 * never a full URL to the backend), so cookies ride along automatically
 * and no bearer token ever needs to exist in browser-reachable code.
 */
export async function apiFetch<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;

  const response = await fetch(path, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });

  return parseApiResponse(response, schema);
}

/** Same-origin fetch for a non-JSON (file download) response — see parseApiFileResponse. The only thing features/* hooks are allowed to call directly for this, mirroring apiFetch's own role for JSON calls. */
export async function apiFetchFile(path: string): Promise<Response> {
  const response = await fetch(path);
  return parseApiFileResponse(response);
}
