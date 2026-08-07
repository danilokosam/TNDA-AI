import { NextResponse } from "next/server";
import { getJobStats } from "@/services/organization.service";
import { toErrorResponse } from "@/lib/api/route-handler";

export async function GET(request: Request) {
  try {
    const since = new URL(request.url).searchParams.get("since") ?? undefined;
    const stats = await getJobStats(since);
    return NextResponse.json(stats);
  } catch (error) {
    return toErrorResponse(error);
  }
}
