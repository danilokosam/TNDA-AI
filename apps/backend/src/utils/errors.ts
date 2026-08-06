export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "QUOTA_EXCEEDED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_FILE_TYPE"
  | "RATE_LIMITED"
  | "AZURE_SERVICE_ERROR"
  | "INTERNAL_ERROR";

/**
 * Base class for every error the application deliberately raises. Carries
 * an HTTP status and a stable machine-readable `code` so the centralized
 * error middleware can produce consistent structured JSON without having
 * to pattern-match on error messages.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: AppErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: AppErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, "VALIDATION_ERROR", message, details);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication is required to access this resource.") {
    super(401, "UNAUTHORIZED", message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to access this resource.") {
    super(403, "FORBIDDEN", message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found.") {
    super(404, "NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, "CONFLICT", message);
    this.name = "ConflictError";
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(413, "PAYLOAD_TOO_LARGE", message, details);
    this.name = "PayloadTooLargeError";
  }
}

export class UnsupportedFileTypeError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(415, "UNSUPPORTED_FILE_TYPE", message, details);
    this.name = "UnsupportedFileTypeError";
  }
}

/** Raised when a document would push the org over its plan's page/document quota. */
export class QuotaExceededError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(422, "QUOTA_EXCEEDED", message, details);
    this.name = "QuotaExceededError";
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many requests. Please try again later.", details?: Record<string, unknown>) {
    super(429, "RATE_LIMITED", message, details);
    this.name = "RateLimitedError";
  }
}

/** Raised when Azure Document Intelligence itself fails or is unreachable. */
export class AzureServiceError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(502, "AZURE_SERVICE_ERROR", message, details);
    this.name = "AzureServiceError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
