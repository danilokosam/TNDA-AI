import "server-only";
import type { z } from "zod";
import { env } from "@/lib/env";
import { parseApiResponse } from "@/lib/api/response";

interface BackendFetchOptions extends RequestInit {
  accessToken?: string;
}

/**
 * The one place that talks to the real backend over the network. Server-only
 * — `services/*.service.ts` is the only caller, never a Client Component
 * directly (enforced by `import "server-only"` on every service file, not
 * just documented). Auth-agnostic on purpose: callers resolve their own
 * access token (see `lib/supabase/server-client.ts#getAccessToken`) and
 * pass it in, rather than this file reaching into cookies itself — keeps it
 * a plain, easily-reasoned-about HTTP helper.
 */
export async function backendFetch<T>(path: string, schema: z.ZodType<T>, options?: BackendFetchOptions): Promise<T> {
  const { accessToken, headers, ...rest } = options ?? {};
  const isFormData = rest.body instanceof FormData;

  const response = await fetch(`${env.BACKEND_URL}${path}`, {
    ...rest,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
  });

  return parseApiResponse(response, schema);
}
