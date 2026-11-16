import { NextRequest, NextResponse } from "next/server";
import { logoutSession } from "@/lib/auth/auth-service";
import {
  clearSessionCookieOnResponse,
  extractSessionTokenFromRequest,
} from "@/lib/auth/request-auth";

export async function POST(req: NextRequest) {
  const token = extractSessionTokenFromRequest(req);
  const revoked = logoutSession(token);
  const res = NextResponse.json({
    success: true,
    data: { loggedOut: true, sessionRevokedInDb: revoked },
  });
  clearSessionCookieOnResponse(res);
  return res;
}

