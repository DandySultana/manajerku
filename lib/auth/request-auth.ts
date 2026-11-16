import { NextRequest, NextResponse } from "next/server";
import {
  assertStoreOwnership,
  SESSION_COOKIE_NAME,
  verifySessionToken,
  type AuthenticatedUserContext,
} from "./auth-service.ts";
import { ManajerkuAppError, type UserRole } from "../services/platform-core.ts";

/**
 * Extracts raw session token from HTTP-only cookie or Authorization Bearer header.
 */
export function extractSessionTokenFromRequest(req: NextRequest): string | null {
  const cookieToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  return null;
}

/**
 * Requires an active, verified server session or throws 401 UNAUTHORIZED.
 */
export function requireAuthenticatedSession(
  req: NextRequest
): AuthenticatedUserContext {
  const rawToken = extractSessionTokenFromRequest(req);
  const context = verifySessionToken(rawToken);
  if (!context) {
    throw new ManajerkuAppError(
      "UNAUTHORIZED",
      "Sesi autentikasi tidak ditemukan atau telah berakhir. Silakan login terlebih dahulu.",
      401
    );
  }
  return context;
}

/**
 * Resolves the actor's identity and store context from the server session when present,
 * enforcing strict ownership checks so a logged-in user cannot spoof another role or storeId.
 */
export function resolveVerifiedRequestActor(
  req: NextRequest,
  fallbackStoreId?: string,
  fallbackRole?: UserRole
): {
  storeId: string;
  actorRole: UserRole;
  userId?: string;
  sessionContext: AuthenticatedUserContext | null;
} {
  const rawToken = extractSessionTokenFromRequest(req);
  const sessionContext = verifySessionToken(rawToken);

  if (sessionContext) {
    const requestedStoreId = fallbackStoreId || sessionContext.storeId;
    assertStoreOwnership(sessionContext, requestedStoreId);
    return {
      storeId: requestedStoreId,
      // Server session role ALWAYS overrides any client-supplied role!
      actorRole: sessionContext.role,
      userId: sessionContext.userId,
      sessionContext,
    };
  }

  return {
    storeId: fallbackStoreId || "store-orienix-01",
    actorRole: fallbackRole || "OWNER",
    sessionContext: null,
  };
}

/**
 * Attaches the HTTP-only session cookie to a NextResponse.
 */
export function setSessionCookieOnResponse(
  res: NextResponse,
  sessionToken: string,
  expiresAtIso: string
): void {
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionToken,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAtIso),
  });
}

export function clearSessionCookieOnResponse(res: NextResponse): void {
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

