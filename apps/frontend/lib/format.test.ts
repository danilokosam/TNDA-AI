import { describe, expect, it } from "vitest";
import { formatFileSize } from "@/lib/format";

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
