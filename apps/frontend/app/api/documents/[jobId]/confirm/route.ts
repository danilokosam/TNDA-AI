import { NextResponse } from "next/server";
import { confirmDocumentReview } from "@/services/documents.service";
import { toErrorResponse } from "@/lib/api/route-handler";
import type { DocumentCorrectionsRequest } from "@/types/api";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    const body = (await request.json()) as DocumentCorrectionsRequest;
    const result = await confirmDocumentReview(jobId, body);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
