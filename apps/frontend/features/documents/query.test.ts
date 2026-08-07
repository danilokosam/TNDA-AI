import { describe, expect, it } from "vitest";
import { buildDocumentsListPath } from "@/features/documents/query";

describe("buildDocumentsListPath", () => {
  it("returns the bare path with no query string for empty params", () => {
    expect(buildDocumentsListPath({})).toBe("/api/documents");
  });

  it("includes every provided param", () => {
    const path = buildDocumentsListPath({
      status: "completed",
      documentType: "invoice",
      search: "acme",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      cursor: "abc123",
      limit: 10,
    });

    const [base, queryString] = path.split("?");
    expect(base).toBe("/api/documents");
    const query = new URLSearchParams(queryString);
    expect(query.get("status")).toBe("completed");
    expect(query.get("documentType")).toBe("invoice");
    expect(query.get("search")).toBe("acme");
    expect(query.get("dateFrom")).toBe("2026-01-01");
    expect(query.get("dateTo")).toBe("2026-01-31");
    expect(query.get("cursor")).toBe("abc123");
    expect(query.get("limit")).toBe("10");
  });

  it("omits params that weren't provided", () => {
    expect(buildDocumentsListPath({ status: "failed" })).toBe("/api/documents?status=failed");
  });

  it("URL-encodes special characters in a search term", () => {
    const path = buildDocumentsListPath({ search: "acme & co" });
    expect(path).toBe("/api/documents?search=acme+%26+co");
  });
});
