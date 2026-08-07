import { NextResponse } from "next/server";
import { removeDocumentFile } from "@/services/documents.service";
import { toErrorResponse } from "@/lib/api/route-handler";

export async function DELETE(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    const job = await removeDocumentFile(jobId);
    return NextResponse.json(job);
  } catch (error) {
    return toErrorResponse(error);
  }
}
