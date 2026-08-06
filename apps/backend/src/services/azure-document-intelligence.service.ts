import { z } from "zod";
import { azureDocumentIntelligenceConfig } from "@/config/azure";
import { AzureServiceError } from "@/utils/errors";
import type { SupportedDocumentMimeType } from "@/utils/file-inspector";

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps `fetch` with exponential backoff (+ jitter) specifically for
 * Azure's `429 Too Many Requests` responses, honoring its `Retry-After`
 * header when present. Any other response (including other error statuses)
 * is returned as-is for the caller to interpret.
 */
async function fetchWithRetry(url: string, init: RequestInit, attempt = 0): Promise<Response> {
  const response = await fetch(url, init);

  if (response.status !== 429 || attempt >= MAX_RETRIES) {
    return response;
  }

  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  const backoffMs = Number.isFinite(retryAfterSeconds)
    ? retryAfterSeconds * 1000
    : BASE_DELAY_MS * 2 ** attempt;

  await sleep(backoffMs + Math.random() * 100);
  return fetchWithRetry(url, init, attempt + 1);
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

export interface AzureAnalysisSubmission {
  operationLocation: string;
}

/**
 * Kicks off analysis for a single document (the HTTP 202 pattern). Returns
 * only the `Operation-Location` URL — the caller persists it on the
 * `document_jobs` row and polls it later via `getAnalysisOperationStatus`,
 * potentially from a completely separate request.
 *
 * `modelId` is a required parameter, not a config value: this module is a
 * pure infrastructure adapter for Azure's REST API and has no opinion on
 * *which* model a document should be analyzed with — that decision belongs
 * to the domain layer (see `src/modules/documents/documents.strategy.ts`).
 */
export async function beginDocumentAnalysis(
  bytes: Uint8Array,
  contentType: SupportedDocumentMimeType,
  modelId: string,
): Promise<AzureAnalysisSubmission> {
  const url = `${azureDocumentIntelligenceConfig.endpoint}/documentintelligence/documentModels/${modelId}:analyze?api-version=${azureDocumentIntelligenceConfig.apiVersion}`;

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "Ocp-Apim-Subscription-Key": azureDocumentIntelligenceConfig.apiKey,
    },
    body: bytes,
  });

  if (response.status !== 202) {
    const body = await safeReadText(response);
    throw new AzureServiceError(
      `Azure Document Intelligence rejected the analysis request (HTTP ${response.status}).`,
      { status: response.status, body },
    );
  }

  const operationLocation = response.headers.get("operation-location");
  if (!operationLocation) {
    throw new AzureServiceError(
      "Azure Document Intelligence accepted the request but returned no Operation-Location header.",
    );
  }

  return { operationLocation };
}

const azureOperationStatusSchema = z.object({
  status: z.enum(["notStarted", "running", "succeeded", "failed"]),
  createdDateTime: z.string().optional(),
  lastUpdatedDateTime: z.string().optional(),
  analyzeResult: z.record(z.string(), z.unknown()).optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

export type AzureOperationStatus = z.infer<typeof azureOperationStatusSchema>;

/** Polls a previously-started analysis operation exactly once. */
export async function getAnalysisOperationStatus(operationLocation: string): Promise<AzureOperationStatus> {
  const response = await fetchWithRetry(operationLocation, {
    method: "GET",
    headers: {
      "Ocp-Apim-Subscription-Key": azureDocumentIntelligenceConfig.apiKey,
    },
  });

  if (!response.ok) {
    const body = await safeReadText(response);
    throw new AzureServiceError(
      `Failed to fetch analysis status from Azure Document Intelligence (HTTP ${response.status}).`,
      { status: response.status, body },
    );
  }

  const json: unknown = await response.json();
  const parsed = azureOperationStatusSchema.safeParse(json);

  if (!parsed.success) {
    throw new AzureServiceError(
      "Azure Document Intelligence returned a response with an unexpected shape.",
      { issues: parsed.error.issues },
    );
  }

  return parsed.data;
}
