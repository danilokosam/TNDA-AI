import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/azure-document-intelligence.service", () => ({
  beginDocumentAnalysis: vi.fn(),
}));

const azureService = await import("@/services/azure-document-intelligence.service");
const { DOCUMENT_TYPES, getProcessingStrategy } = await import("@/modules/documents/documents.strategy");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getProcessingStrategy", () => {
  it("returns a strategy for every declared document type", () => {
    for (const documentType of DOCUMENT_TYPES) {
      const strategy = getProcessingStrategy(documentType);
      expect(strategy.documentType).toBe(documentType);
      expect(typeof strategy.submit).toBe("function");
    }
  });

  it("each document type maps to a distinct Azure prebuilt model", async () => {
    vi.mocked(azureService.beginDocumentAnalysis).mockResolvedValue({ operationLocation: "https://example.com/op" });

    const modelIdsUsed = new Set<string>();
    for (const documentType of DOCUMENT_TYPES) {
      await getProcessingStrategy(documentType).submit(new Uint8Array([1]), "application/pdf");
      const lastCall = vi.mocked(azureService.beginDocumentAnalysis).mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      if (lastCall) {
        modelIdsUsed.add(lastCall[2]);
      }
    }

    expect(modelIdsUsed.size).toBe(DOCUMENT_TYPES.length);
  });

  it("submit() forwards bytes/mimeType to the Azure adapter and maps operationLocation to operationReference", async () => {
    vi.mocked(azureService.beginDocumentAnalysis).mockResolvedValue({
      operationLocation: "https://example.com/documentModels/prebuilt-invoice/analyzeResults/abc123",
    });

    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const result = await getProcessingStrategy("invoice").submit(bytes, "application/pdf");

    expect(azureService.beginDocumentAnalysis).toHaveBeenCalledWith(bytes, "application/pdf", "prebuilt-invoice");
    expect(result).toEqual({
      operationReference: "https://example.com/documentModels/prebuilt-invoice/analyzeResults/abc123",
    });
  });

  it("the invoice strategy uses Azure's prebuilt-invoice model (preserves pre-refactor default behavior)", async () => {
    vi.mocked(azureService.beginDocumentAnalysis).mockResolvedValue({ operationLocation: "https://example.com/op" });

    await getProcessingStrategy("invoice").submit(new Uint8Array([1]), "application/pdf");

    expect(azureService.beginDocumentAnalysis).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "prebuilt-invoice",
    );
  });
});
