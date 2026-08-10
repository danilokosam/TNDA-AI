import { describe, expect, it } from "vitest";
import { ApiError, parseApiFileResponse } from "@/lib/api/response";

describe("parseApiFileResponse", () => {
  it("returns the raw Response unchanged on a 200", async () => {
    const response = new Response("csv,content", { status: 200, headers: { "Content-Type": "text/csv" } });

    const result = await parseApiFileResponse(response);

    expect(result).toBe(response);
    expect(await result.text()).toBe("csv,content");
  });

  it("throws an ApiError parsed from the {error:{...}} envelope on a non-OK response", async () => {
    const response = new Response(
      JSON.stringify({ error: { code: "PAYLOAD_TOO_LARGE", message: "Too many documents." } }),
      { status: 413 },
    );

    await expect(parseApiFileResponse(response)).rejects.toMatchObject({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "Too many documents.",
    });
  });

  it("throws a generic ApiError when the non-OK body isn't the expected error shape", async () => {
    const response = new Response("not json", { status: 500 });

    await expect(parseApiFileResponse(response)).rejects.toBeInstanceOf(ApiError);
    await expect(parseApiFileResponse(response)).rejects.toMatchObject({ status: 500, code: "UNKNOWN_ERROR" });
  });
});
