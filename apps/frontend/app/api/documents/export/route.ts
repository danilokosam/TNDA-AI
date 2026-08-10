import { exportDocuments } from "@/services/documents.service";
import { toErrorResponse } from "@/lib/api/route-handler";
import type { DocumentType } from "@/types/api";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;

    const backendResponse = await exportDocuments({
      documentType: (params.get("documentType") as DocumentType | null) ?? undefined,
      search: params.get("search") ?? undefined,
      dateFrom: params.get("dateFrom") ?? undefined,
      dateTo: params.get("dateTo") ?? undefined,
    });

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      headers: {
        "Content-Type": backendResponse.headers.get("Content-Type") ?? "text/csv; charset=utf-8",
        "Content-Disposition": backendResponse.headers.get("Content-Disposition") ?? "attachment",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
