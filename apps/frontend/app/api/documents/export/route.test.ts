// @vitest-environment node
//
// Same reasoning as app/api/documents/route.test.ts: this Route Handler is
// server code that constructs/reads real Response bodies, not DOM code —
// jsdom's own Response/Blob implementations don't apply here.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/documents.service", () => ({
  exportDocuments: vi.fn(),
}));

const documentsService = await import("@/services/documents.service");
const { GET, POST } = await import("@/app/api/documents/export/route");

describe("GET /api/documents/export", () => {
  it("proxies the backend's CSV body and headers", async () => {
    // Built from raw bytes (not a plain string) and asserted via
    // arrayBuffer() below, not text() — Response#text() strips a leading
    // UTF-8 BOM per the WHATWG decode algorithm, which would make this
    // test fail on a property of *reading* the body, not of whether the
    // route actually proxied the BOM byte through untouched. Byte-for-byte
    // comparison is what actually proves the passthrough is lossless.
    const bodyBytes = new TextEncoder().encode("﻿Job ID\r\njob_1");
    const backendResponse = new Response(bodyBytes, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="documents-export-2026-08-10.csv"',
      },
    });
    vi.mocked(documentsService.exportDocuments).mockResolvedValue(backendResponse);

    const request = new Request("http://localhost/api/documents/export?format=csv&documentType=invoice&search=acme");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="documents-export-2026-08-10.csv"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bodyBytes);
    expect(documentsService.exportDocuments).toHaveBeenCalledWith({
      format: "csv",
      documentType: "invoice",
      search: "acme",
      dateFrom: undefined,
      dateTo: undefined,
    });
  });

  it("defaults to format=csv when no format query param is given", async () => {
    vi.mocked(documentsService.exportDocuments).mockResolvedValue(new Response("csv content"));

    await GET(new Request("http://localhost/api/documents/export"));

    expect(documentsService.exportDocuments).toHaveBeenCalledWith(expect.objectContaining({ format: "csv" }));
  });

  it("proxies a binary XLSX body untouched", async () => {
    const bodyBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]);
    const backendResponse = new Response(bodyBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="documents-export-2026-08-10.xlsx"',
      },
    });
    vi.mocked(documentsService.exportDocuments).mockResolvedValue(backendResponse);

    const response = await GET(new Request("http://localhost/api/documents/export?format=xlsx"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bodyBytes);
  });

  it("translates a thrown service error into the uniform error envelope", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(documentsService.exportDocuments).mockRejectedValue(
      new ApiError(413, "PAYLOAD_TOO_LARGE", "Too many documents."),
    );

    const request = new Request("http://localhost/api/documents/export");
    const response = await GET(request);

    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("POST /api/documents/export", () => {
  it("forwards the parsed JSON body to the service and proxies the response", async () => {
    const bodyBytes = new TextEncoder().encode("Total,Supplier\r\n199.99,Acme");
    const backendResponse = new Response(bodyBytes, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="documents-export-2026-08-10.csv"',
      },
    });
    vi.mocked(documentsService.exportDocuments).mockResolvedValue(backendResponse);

    const requestBody = {
      format: "csv",
      fieldSelection: [
        { field: "InvoiceTotal", label: "Total" },
        { field: "VendorName", label: "Supplier" },
      ],
    };
    const request = new Request("http://localhost/api/documents/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bodyBytes);
    expect(documentsService.exportDocuments).toHaveBeenCalledWith(requestBody);
  });

  it("translates a thrown service error into the uniform error envelope", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(documentsService.exportDocuments).mockRejectedValue(
      new ApiError(400, "VALIDATION_ERROR", "Field is selected more than once."),
    );

    const request = new Request("http://localhost/api/documents/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "csv", fieldSelection: [{ field: "jobId" }, { field: "jobId" }] }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
