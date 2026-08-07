import { NextResponse } from "next/server";
import { getPreviewUrl } from "@/services/documents.service";
import { toErrorResponse } from "@/lib/api/route-handler";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    const result = await getPreviewUrl(jobId);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
