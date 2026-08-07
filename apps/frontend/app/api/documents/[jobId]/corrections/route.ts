import { NextResponse } from "next/server";
import { getFieldCorrections, saveFieldCorrections } from "@/services/documents.service";
import { toErrorResponse } from "@/lib/api/route-handler";
import type { DocumentCorrectionsRequest } from "@/types/api";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    const result = await getFieldCorrections(jobId);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    const body = (await request.json()) as DocumentCorrectionsRequest;
    const result = await saveFieldCorrections(jobId, body);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
