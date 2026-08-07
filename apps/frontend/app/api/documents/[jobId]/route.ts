import { NextResponse } from "next/server";
import { deleteDocument, getJobStatus } from "@/services/documents.service";
import { toErrorResponse } from "@/lib/api/route-handler";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    const job = await getJobStatus(jobId);
    return NextResponse.json(job);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    const result = await deleteDocument(jobId);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
