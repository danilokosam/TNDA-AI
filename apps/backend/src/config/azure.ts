import { env } from "@/config/env";

/**
 * We talk to Azure Document Intelligence over its plain REST API rather
 * than the `@azure/ai-form-recognizer` SDK. The SDK's poller is built to
 * live and poll within a single process; our architecture instead persists
 * the operation location to `document_jobs` and resumes polling later from
 * a separate HTTP request (possibly handled by a different server
 * instance), so driving the 202/Operation-Location pattern by hand is a
 * better fit and keeps the integration fully type-safe.
 */
export const azureDocumentIntelligenceConfig = {
  endpoint: env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT.replace(/\/+$/, ""),
  apiKey: env.AZURE_DOCUMENT_INTELLIGENCE_API_KEY,
  apiVersion: "2024-11-30",
} as const;
