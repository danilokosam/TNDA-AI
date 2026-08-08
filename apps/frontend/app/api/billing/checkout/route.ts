import { NextResponse } from "next/server";
import { createCheckoutSession } from "@/services/billing.service";
import { parseJsonBody, toErrorResponse } from "@/lib/api/route-handler";
import { checkoutRequestSchema } from "@/types/api";

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, checkoutRequestSchema);
  if ("errorResponse" in parsed) {
    return parsed.errorResponse;
  }

  try {
    // redirectUrl is always computed from this request's own origin, never
    // taken from the client body (checkoutRequestSchema allows one, but a
    // client-supplied value is never trusted here) — see
    // services/billing.service.ts#createCheckoutSession's doc comment.
    const redirectUrl = `${new URL(request.url).origin}/billing`;
    const result = await createCheckoutSession({ planId: parsed.data.planId, redirectUrl });
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
