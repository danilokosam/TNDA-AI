import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { ApiError } from "@/lib/api/response";

/**
 * Reads and validates a Route Handler's JSON body against `schema` in one
 * step. Returns either the typed data or a ready-to-return 400 response —
 * callers just do `if ("errorResponse" in result) return result.errorResponse`.
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ data: T } | { errorResponse: NextResponse }> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return {
      errorResponse: NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "The request body did not match the expected shape.",
            details: { issues: parsed.error.issues },
          },
        },
        { status: 400 },
      ),
    };
  }

  return { data: parsed.data };
}

/**
 * Centralized catch-block handler for every Route Handler in this app —
 * mirrors the backend's own `error.middleware.ts`: one place that turns a
 * thrown error into the uniform `{error:{code,message,details?}}` envelope,
 * instead of every route re-inventing that translation.
 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }

  console.error("[route-handler] unexpected error", error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } },
    { status: 500 },
  );
}
