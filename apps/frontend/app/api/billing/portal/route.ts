import { NextResponse } from "next/server";
import { createPortalSession } from "@/services/billing.service";
import { toErrorResponse } from "@/lib/api/route-handler";

export async function POST(request: Request) {
  try {
    // returnUrl is always computed from this request's own origin, never
    // taken from a client-supplied value — see
    // services/billing.service.ts#createPortalSession's doc comment. No
    // request body is required (the backend's own portalRequestSchema is
    // optional too).
    const returnUrl = `${new URL(request.url).origin}/billing`;
    const result = await createPortalSession({ returnUrl });
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
