import { describe, expect, it } from "vitest";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  QuotaExceededError,
  RateLimitedError,
  UnauthorizedError,
  UnsupportedFileTypeError,
  ValidationError,
  isAppError,
} from "@/utils/errors";

describe("AppError subclasses", () => {
  it("carries the right statusCode and code for each subclass", () => {
    const cases: Array<[AppError, number, string]> = [
      [new ValidationError("bad input"), 400, "VALIDATION_ERROR"],
      [new UnauthorizedError(), 401, "UNAUTHORIZED"],
      [new ForbiddenError(), 403, "FORBIDDEN"],
      [new NotFoundError(), 404, "NOT_FOUND"],
      [new ConflictError("already exists"), 409, "CONFLICT"],
      [new PayloadTooLargeError("too big"), 413, "PAYLOAD_TOO_LARGE"],
      [new UnsupportedFileTypeError("bad type"), 415, "UNSUPPORTED_FILE_TYPE"],
      [new QuotaExceededError("over quota"), 422, "QUOTA_EXCEEDED"],
      [new RateLimitedError(), 429, "RATE_LIMITED"],
    ];

    for (const [error, statusCode, code] of cases) {
      expect(error.statusCode).toBe(statusCode);
      expect(error.code).toBe(code);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it("preserves the message and optional details payload", () => {
    const error = new QuotaExceededError("Monthly page limit reached.", { maxPagesPerMonth: 2 });

    expect(error.message).toBe("Monthly page limit reached.");
    expect(error.details).toEqual({ maxPagesPerMonth: 2 });
  });

  it("defaults details to undefined when none is given", () => {
    const error = new UnauthorizedError();

    expect(error.details).toBeUndefined();
  });

  it("uses sensible default messages", () => {
    expect(new UnauthorizedError().message).toContain("Authentication");
    expect(new ForbiddenError().message).toContain("permission");
    expect(new NotFoundError().message).toContain("not found");
  });
});

describe("isAppError", () => {
  it("returns true for any AppError subclass", () => {
    expect(isAppError(new ValidationError("x"))).toBe(true);
    expect(isAppError(new NotFoundError())).toBe(true);
  });

  it("returns false for plain errors and non-error values", () => {
    expect(isAppError(new Error("plain"))).toBe(false);
    expect(isAppError("just a string")).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
  });
});
