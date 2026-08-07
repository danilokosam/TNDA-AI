import { NextResponse } from "next/server";
import { getSubscription } from "@/services/billing.service";
import { toErrorResponse } from "@/lib/api/route-handler";

export async function GET() {
  try {
    const subscription = await getSubscription();
    return NextResponse.json(subscription);
  } catch (error) {
    return toErrorResponse(error);
  }
}
