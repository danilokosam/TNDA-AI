import { NextResponse } from "next/server";
import { listDocuments } from "@/services/documents.service";
import { toErrorResponse } from "@/lib/api/route-handler";
import type { ListDocumentsParams } from "@/types/api";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const limitParam = params.get("limit");

    const query = {
      status: params.get("status") ?? undefined,
      documentType: params.get("documentType") ?? undefined,
      search: params.get("search") ?? undefined,
      dateFrom: params.get("dateFrom") ?? undefined,
      dateTo: params.get("dateTo") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
      limit: limitParam ? Number(limitParam) : undefined,
    } as ListDocumentsParams;

    const result = await listDocuments(query);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
