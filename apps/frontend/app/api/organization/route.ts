import { NextResponse } from "next/server";
import { getOrganizationOverview } from "@/services/organization.service";
import { toErrorResponse } from "@/lib/api/route-handler";

export async function GET() {
  try {
    const overview = await getOrganizationOverview();
    return NextResponse.json(overview);
  } catch (error) {
    return toErrorResponse(error);
  }
}
