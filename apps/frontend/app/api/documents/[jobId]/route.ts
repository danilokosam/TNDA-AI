import { NextResponse } from "next/server";
import { getJobStatus } from "@/services/documents.service";
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
