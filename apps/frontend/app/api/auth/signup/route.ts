import { NextResponse } from "next/server";
import { signUp } from "@/services/auth.service";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { parseJsonBody, toErrorResponse } from "@/lib/api/route-handler";
import { signUpRequestSchema } from "@/types/api";

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, signUpRequestSchema);
  if ("errorResponse" in parsed) {
    return parsed.errorResponse;
  }

  try {
    const result = await signUp(parsed.data);

    const supabase = await createSupabaseServerClient();
    await supabase.auth.setSession({
      access_token: result.session.accessToken,
      refresh_token: result.session.refreshToken,
    });

    return NextResponse.json({ user: result.user }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
