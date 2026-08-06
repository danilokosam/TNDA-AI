import { NextResponse } from "next/server";
import { login } from "@/services/auth.service";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { parseJsonBody, toErrorResponse } from "@/lib/api/route-handler";
import { loginRequestSchema } from "@/types/api";

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, loginRequestSchema);
  if ("errorResponse" in parsed) {
    return parsed.errorResponse;
  }

  try {
    const result = await login(parsed.data);

    const supabase = await createSupabaseServerClient();
    await supabase.auth.setSession({
      access_token: result.session.accessToken,
      refresh_token: result.session.refreshToken,
    });

    return NextResponse.json({ user: result.user });
  } catch (error) {
    return toErrorResponse(error);
  }
}
