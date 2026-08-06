import type { z } from "zod";
import { apiErrorBodySchema, type AppErrorCode } from "@/types/api";

/**
 * Thrown by both `apiFetch` (client, same-origin) and `backendFetch`
 * (server, real backend) — one shape, regardless of which side of the BFF
 * boundary the failing call was on.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: AppErrorCode | "UNKNOWN_ERROR";
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: AppErrorCode | "UNKNOWN_ERROR", message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Shared response-handling for every API call this app makes, in either
 * direction: on failure, parses the uniform `{error:{code,message,details?}}`
 * envelope into an `ApiError`; on success, parses the body through the
 * caller's Zod schema so a shape mismatch is caught here, at the boundary,
 * not wherever the caller happens to first touch the data.
 */
export async function parseApiResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const parsedError = apiErrorBodySchema.safeParse(body);

    if (parsedError.success) {
      throw new ApiError(
        response.status,
        parsedError.data.error.code,
        parsedError.data.error.message,
        parsedError.data.error.details,
      );
    }

    throw new ApiError(response.status, "UNKNOWN_ERROR", `Request failed with status ${response.status}.`);
  }

  const body: unknown = await response.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw new ApiError(response.status, "UNKNOWN_ERROR", "Response did not match the expected shape.", {
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}
