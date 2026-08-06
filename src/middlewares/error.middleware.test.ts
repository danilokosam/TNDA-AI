import { describe, expect, it } from "vitest";
import { Elysia, t } from "elysia";
import { z } from "zod";
import { errorMiddleware } from "@/middlewares/error.middleware";
import { NotFoundError, QuotaExceededError } from "@/utils/errors";

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

async function parseErrorBody(response: Response) {
  return errorEnvelopeSchema.parse(await response.json());
}

/**
 * A throwaway app, never `.listen()`ed — routes are exercised in-process
 * via Elysia's `.handle(request)`, so no port is ever bound and no real
 * Supabase/Azure/Stripe config is needed for these routes specifically.
 */
const app = new Elysia()
  .use(errorMiddleware)
  .get("/boom/quota", () => {
    throw new QuotaExceededError("Monthly page limit reached.", { maxPagesPerMonth: 2 });
  })
  .get("/boom/not-found", () => {
    throw new NotFoundError();
  })
  .get("/boom/unknown", () => {
    throw new Error("something unexpected broke");
  })
  .post("/echo", ({ body }) => body, { body: t.Object({ name: t.String() }) });

describe("errorMiddleware", () => {
  it("maps a QuotaExceededError to its statusCode and structured JSON body", async () => {
    const response = await app.handle(new Request("http://localhost/boom/quota"));

    expect(response.status).toBe(422);
    const body = await parseErrorBody(response);
    expect(body).toEqual({
      error: {
        code: "QUOTA_EXCEEDED",
        message: "Monthly page limit reached.",
        details: { maxPagesPerMonth: 2 },
      },
    });
  });

  it("maps a NotFoundError to 404 with no details key when none was given", async () => {
    const response = await app.handle(new Request("http://localhost/boom/not-found"));

    expect(response.status).toBe(404);
    const body = await parseErrorBody(response);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.details).toBeUndefined();
  });

  it("falls back to 500 INTERNAL_ERROR for an error that isn't an AppError", async () => {
    const response = await app.handle(new Request("http://localhost/boom/unknown"));

    expect(response.status).toBe(500);
    const body = await parseErrorBody(response);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("maps Elysia's own body validation failures to 400 VALIDATION_ERROR with per-field issues", async () => {
    const response = await app.handle(
      new Request("http://localhost/echo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: 123 }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await parseErrorBody(response);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.error.details?.issues)).toBe(true);
  });

  it("routes that don't exist get a normalized 404, not Elysia's default HTML", async () => {
    const response = await app.handle(new Request("http://localhost/does-not-exist"));

    expect(response.status).toBe(404);
    const body = await parseErrorBody(response);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
