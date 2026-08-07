import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { beginDocumentAnalysis } = await import("@/services/azure-document-intelligence.service");

beforeEach(() => {
  fetchMock.mockReset();
});

describe("beginDocumentAnalysis", () => {
  it("submits to the model's :analyze endpoint with no outputContentFormat by default", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202, headers: { "operation-location": "https://op" } }));

    await beginDocumentAnalysis(new Uint8Array([1]), "application/pdf", "prebuilt-invoice");

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://test.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=2024-11-30",
    );
  });

  it("appends &outputContentFormat=markdown when requested", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202, headers: { "operation-location": "https://op" } }));

    await beginDocumentAnalysis(new Uint8Array([1]), "application/pdf", "prebuilt-layout", "markdown");

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://test.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30&outputContentFormat=markdown",
    );
  });

  it("sends the file bytes as the request body and the subscription key header", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202, headers: { "operation-location": "https://op" } }));
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    await beginDocumentAnalysis(bytes, "application/pdf", "prebuilt-invoice");

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(bytes);
    expect(init.headers["Content-Type"]).toBe("application/pdf");
    expect(init.headers["Ocp-Apim-Subscription-Key"]).toBe("test-azure-key");
  });

  it("returns the Operation-Location header on a 202", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 202, headers: { "operation-location": "https://example.com/op/123" } }),
    );

    const result = await beginDocumentAnalysis(new Uint8Array([1]), "application/pdf", "prebuilt-invoice");

    expect(result).toEqual({ operationLocation: "https://example.com/op/123" });
  });

  it("throws AzureServiceError on a non-202 response", async () => {
    fetchMock.mockResolvedValue(new Response("bad request", { status: 400 }));

    await expect(
      beginDocumentAnalysis(new Uint8Array([1]), "application/pdf", "prebuilt-invoice"),
    ).rejects.toThrow(/rejected the analysis request/);
  });

  it("throws AzureServiceError when a 202 response is missing the Operation-Location header", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));

    await expect(
      beginDocumentAnalysis(new Uint8Array([1]), "application/pdf", "prebuilt-invoice"),
    ).rejects.toThrow(/no Operation-Location header/);
  });
});
