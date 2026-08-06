import { Elysia } from "elysia";
import { env } from "@/config/env";
import { isAppError } from "@/utils/errors";

interface StructuredErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

function structuredError(code: string, message: string, details?: Record<string, unknown>): StructuredErrorBody {
  return details ? { error: { code, message, details } } : { error: { code, message } };
}

/**
 * Centralized error handler: every thrown `AppError` (and every error
 * Elysia itself raises, e.g. schema validation) is normalized into the
 * same `{ error: { code, message, details? } }` shape, so API consumers
 * never have to special-case response formats per endpoint.
 */
export const errorMiddleware = new Elysia({ name: "error-middleware" }).onError(
  { as: "global" },
  ({ error, code, set }) => {
    if (isAppError(error)) {
      set.status = error.statusCode;
      return structuredError(error.code, error.message, error.details);
    }

    if (code === "VALIDATION") {
      set.status = 400;
      const issues = error.all.map((issue) => ({
        path: issue.path,
        message: issue.summary ?? issue.message,
      }));
      return structuredError("VALIDATION_ERROR", "The request did not pass validation.", { issues });
    }

    if (code === "NOT_FOUND") {
      set.status = 404;
      return structuredError("NOT_FOUND", "The requested resource was not found.");
    }

    if (code === "PARSE") {
      set.status = 400;
      return structuredError("VALIDATION_ERROR", "The request body could not be parsed.");
    }

    set.status = 500;
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    console.error("[unhandled_error]", error);

    return structuredError(
      "INTERNAL_ERROR",
      env.NODE_ENV === "production" ? "An unexpected error occurred." : message,
    );
  },
);
