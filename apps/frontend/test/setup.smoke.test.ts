import { describe, expect, it } from "vitest";

/**
 * Not a real feature test — confirms the harness itself works before
 * anything depends on it: jsdom is live, the server-only alias doesn't
 * throw, and the @ path alias resolves.
 */
describe("test harness", () => {
  it("runs in a jsdom environment", () => {
    expect(typeof document).toBe("object");
  });

  it("resolves the server-only alias without throwing", async () => {
    await expect(import("server-only")).resolves.toBeDefined();
  });

  it("resolves the @ path alias", async () => {
    const mod = await import("@/lib/utils");
    expect(typeof mod.cn).toBe("function");
  });
});
