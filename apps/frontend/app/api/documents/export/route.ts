import { exportDocuments } from "@/services/documents.service";
import { toErrorResponse } from "@/lib/api/route-handler";
import type { DocumentType, ExportDocumentsParams, ExportFormat } from "@/types/api";

function toExportResponse(backendResponse: Response): Response {
  return new Response(backendResponse.body, {
    status: backendResponse.status,
    headers: {
      "Content-Type": backendResponse.headers.get("Content-Type") ?? "text/csv; charset=utf-8",
      "Content-Disposition": backendResponse.headers.get("Content-Disposition") ?? "attachment",
    },
  });
}

/** Default/unconfigured export — mirrors the backend's `GET /documents/export` query shape. */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;

    const backendResponse = await exportDocuments({
      format: (params.get("format") as ExportFormat | null) ?? "csv",
      documentType: (params.get("documentType") as DocumentType | null) ?? undefined,
      search: params.get("search") ?? undefined,
      dateFrom: params.get("dateFrom") ?? undefined,
      dateTo: params.get("dateTo") ?? undefined,
    });

    return toExportResponse(backendResponse);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Configured export (column selection/ordering/renaming) — a thin
 * passthrough, same as every other POST BFF route: the body isn't
 * re-validated here, since the backend's own Zod schema
 * (exportDocumentsBodySchema) is the single source of truth and already
 * returns a proper {error:{...}} envelope on a bad shape (ADR 0001).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExportDocumentsParams;
    const backendResponse = await exportDocuments(body);

    return toExportResponse(backendResponse);
  } catch (error) {
    return toErrorResponse(error);
  }
}
