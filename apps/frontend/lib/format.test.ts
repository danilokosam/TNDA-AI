import { describe, expect, it } from "vitest";
import { formatDate, formatFileSize } from "@/lib/format";

// Only formatFileSize (new for Stage 3) is covered here — the pre-existing
// formatters were verified via real end-to-end checks in Stage 2, not
// retrofitted with unit tests as part of this pass.
describe("formatFileSize", () => {
  it.each([
    [0, "0 B"],
    [500, "500 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [2048, "2.0 KB"],
    [1024 * 1024, "1.0 MB"],
    [1.5 * 1024 * 1024, "1.5 MB"],
    [1024 * 1024 * 1024, "1.0 GB"],
  ])("formats %i bytes as %s", (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});

describe("formatDate", () => {
  // Deliberately doesn't hardcode an expected string — formatDate renders
  // in the viewer's *local* timezone by design (see its own doc comment),
  // so a fixture computed the same way keeps this test correct regardless
  // of which timezone it actually runs in, rather than assuming one.
  it("matches a direct Intl.DateTimeFormat call with the same options", () => {
    const iso = "2026-08-08T14:30:00.000Z";
    const expected = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(
      new Date(iso),
    );

    expect(formatDate(iso)).toBe(expected);
  });

  it("includes the year, unlike formatShortDate", () => {
    expect(formatDate("2026-08-08T00:00:00.000Z")).toMatch(/2026/);
  });
});
