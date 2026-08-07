import { beginDocumentAnalysis } from "@/services/azure-document-intelligence.service";
import type { SupportedDocumentMimeType } from "@/utils/file-inspector";

/**
 * The kinds of documents this system knows how to process. Extend this
 * tuple (and `STRATEGIES` below) to support a new kind — nothing outside
 * this file needs to change to add one.
 */
export const DOCUMENT_TYPES = ["invoice", "receipt", "identity_document", "generic"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface DocumentAnalysisSubmission {
  /**
   * Opaque reference the caller polls later to check progress. Named
   * generically rather than "operationLocation" (Azure's own term for
   * this), since a non-Azure strategy could hand back something with a
   * different shape entirely — see the scope note on
   * `DocumentProcessingStrategy` below about why polling itself is still
   * Azure-specific today regardless.
   */
  operationReference: string;
}

/**
 * A processing strategy owns *how* a document gets analyzed for a given
 * `DocumentType` — which model, which provider, or even a multi-step
 * pipeline (e.g. Azure OCR followed by an LLM extraction pass) — without
 * the domain service that calls it needing to know or care which. Every
 * strategy today happens to call Azure; a future strategy for, say,
 * `identity_document` could call a different provider entirely just by
 * implementing this same interface and being registered below.
 *
 * Scope note: only *submission* is abstracted here. Status polling
 * (`getJobStatus` in `documents.service.ts`) and persistence
 * (`document_jobs.azure_operation_id`) still assume Azure's
 * Operation-Location model, since every strategy today is Azure-backed.
 * A genuinely non-Azure strategy would also need to address how *that*
 * provider's progress gets checked — deliberately out of scope here,
 * which is specifically about decoupling model *selection* from a single
 * global config value, not about generalizing status polling too.
 */
export interface DocumentProcessingStrategy {
  readonly documentType: DocumentType;
  submit(bytes: Uint8Array, mimeType: SupportedDocumentMimeType): Promise<DocumentAnalysisSubmission>;
}

/** A strategy that delegates straight to an Azure Document Intelligence prebuilt model. */
function createAzurePrebuiltStrategy(
  documentType: DocumentType,
  azureModelId: string,
  outputContentFormat?: "markdown",
): DocumentProcessingStrategy {
  return {
    documentType,
    async submit(bytes, mimeType) {
      const { operationLocation } = await beginDocumentAnalysis(bytes, mimeType, azureModelId, outputContentFormat);
      return { operationReference: operationLocation };
    },
  };
}

/**
 * The domain's own mapping of document type → processing strategy. This
 * replaces the old single global `AZURE_DOCUMENT_INTELLIGENCE_MODEL_ID`
 * env var: model selection is now a runtime decision made here, in code,
 * not an application-wide setting. Swapping any one entry to a different
 * Azure model, a different provider, or a multi-step pipeline only
 * touches this file — `documents.service.ts`, the routes, and the Azure
 * REST adapter itself are unaffected either way.
 */
const STRATEGIES: Record<DocumentType, DocumentProcessingStrategy> = {
  invoice: createAzurePrebuiltStrategy("invoice", "prebuilt-invoice"),
  receipt: createAzurePrebuiltStrategy("receipt", "prebuilt-receipt"),
  identity_document: createAzurePrebuiltStrategy("identity_document", "prebuilt-idDocument"),
  // "prebuilt-document" (Azure's older general key-value-extraction model)
  // returns 404 ModelNotFound against the 2024-11-30 API version this
  // adapter targets — verified against a real Azure resource. "generic"
  // uses prebuilt-layout instead: still a real, current model, and a
  // better fit for "generic" anyway (pure OCR/structure, no domain
  // assumptions at all, vs. prebuilt-document's key-value heuristics).
  //
  // Requests markdown output specifically: generic is the one document
  // type whose raw `content` is shown to the user as-is (the other three
  // are field-shaped — see extract-fields.ts on the frontend), and Azure's
  // default (flat, reading-order) text loses table/section structure that
  // markdown output reconstructs instead. Scoped to generic only, not
  // applied to the other three strategies, since their `content` isn't
  // surfaced in the UI and this hasn't been verified against a live Azure
  // call for those models.
  generic: createAzurePrebuiltStrategy("generic", "prebuilt-layout", "markdown"),
};

export function getProcessingStrategy(documentType: DocumentType): DocumentProcessingStrategy {
  return STRATEGIES[documentType];
}
