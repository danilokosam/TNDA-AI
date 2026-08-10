import type { z } from "zod";
import { apiErrorBodySchema, type AppErrorCode } from "@/types/api";

/**
 * Thrown by every API call this app makes, on either side of the BFF
 * boundary or for a non-JSON (file) response alike.
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

/** Shared by parseApiResponse and parseApiFileResponse — turns a non-OK Response into a typed ApiError from its {error:{...}} envelope, or a generic ApiError if the body isn't in that shape. */
async function toApiError(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  const parsedError = apiErrorBodySchema.safeParse(body);

  if (parsedError.success) {
    return new ApiError(
      response.status,
      parsedError.data.error.code,
      parsedError.data.error.message,
      parsedError.data.error.details,
    );
  }

  return new ApiError(response.status, "UNKNOWN_ERROR", `Request failed with status ${response.status}.`);
}

/**
 * Shared response-handling for every JSON API call this app makes, in
 * either direction: on failure, throws via `toApiError`; on success, parses
 * the body through the caller's Zod schema so a shape mismatch is caught
 * here, at the boundary, not wherever the caller happens to first touch
 * the data.
 */
export async function parseApiResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) {
    throw await toApiError(response);
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

/**
 * For endpoints that return a non-JSON body (e.g. a generated CSV
 * download) — parses the same {error:{...}} envelope on failure as
 * `parseApiResponse`, but returns the raw `Response` on success so the
 * caller can read it as a blob/text/stream itself, since there's no Zod
 * schema for a file body to parse through.
 */
export async function parseApiFileResponse(response: Response): Promise<Response> {
  if (!response.ok) {
    throw await toApiError(response);
  }
  return response;
}
