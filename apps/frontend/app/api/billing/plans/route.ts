import { NextResponse } from "next/server";
import { getPlans } from "@/services/billing.service";
import { toErrorResponse } from "@/lib/api/route-handler";

export async function GET() {
  try {
    const plans = await getPlans();
    return NextResponse.json(plans);
  } catch (error) {
    return toErrorResponse(error);
  }
}
