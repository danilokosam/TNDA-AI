import { NextResponse } from "next/server";
import { listDocuments, uploadDocument } from "@/services/documents.service";
import { toErrorResponse } from "@/lib/api/route-handler";
import type { DocumentType, ListDocumentsParams } from "@/types/api";

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

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "A file is required." } },
        { status: 400 },
      );
    }

    const documentTypeValue = formData.get("documentType");
    const documentType = typeof documentTypeValue === "string" ? (documentTypeValue as DocumentType) : undefined;

    const result = await uploadDocument({ file, documentType });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
