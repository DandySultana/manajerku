import { NextRequest, NextResponse } from "next/server";
import { loginWithCredentials } from "@/lib/auth/auth-service";
import { setSessionCookieOnResponse } from "@/lib/auth/request-auth";
import { ManajerkuAppError } from "@/lib/services/platform-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = loginWithCredentials({
      identifier: String(body.identifier || ""),
      password: String(body.password || ""),
      ipAddress: req.headers.get("x-forwarded-for") || "127.0.0.1",
      userAgent: req.headers.get("user-agent") || undefined,
    });

    const res = NextResponse.json({
      success: true,
      data: result,
    });
    setSessionCookieOnResponse(res, result.sessionToken, result.expiresAt);
    return res;
  } catch (err) {
    if (err instanceof ManajerkuAppError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : "Terjadi kesalahan sistem.",
        },
      },
      { status: 500 }
    );
  }
}

