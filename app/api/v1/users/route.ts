import { resolveVerifiedRequestActor } from "@/lib/auth/request-auth";
import {
  addStoreUser,
  listStoreUsers,
  ManajerkuAppError,
  type UserRole,
} from "@/lib/services/platform-core";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const actor = resolveVerifiedRequestActor(
      req,
      searchParams.get("storeId") || undefined,
    );
    const users = listStoreUsers(actor.storeId);
    return NextResponse.json({
      success: true,
      data: users,
    });
  } catch (err) {
    if (err instanceof ManajerkuAppError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message:
            err instanceof Error ? err.message : "Terjadi kesalahan sistem.",
        },
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const fallbackRole: UserRole =
      body.actorRole === "CASHIER" || body.actorRole === "ADMIN"
        ? body.actorRole
        : "OWNER";
    const actor = resolveVerifiedRequestActor(
      req,
      body.storeId ? String(body.storeId) : undefined,
      fallbackRole,
    );

    const role: UserRole =
      body.role === "OWNER" || body.role === "ADMIN" ? body.role : "CASHIER";

    const created = addStoreUser({
      storeId: actor.storeId,
      actorRole: actor.actorRole,
      fullName: String(body.fullName || ""),
      email: body.email ? String(body.email) : undefined,
      phoneWhatsapp: String(body.phoneWhatsapp || ""),
      password: body.password ? String(body.password) : undefined,
      role,
    });

    return NextResponse.json({
      success: true,
      data: created,
    });
  } catch (err) {
    if (err instanceof ManajerkuAppError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message:
            err instanceof Error ? err.message : "Terjadi kesalahan sistem.",
        },
      },
      { status: 500 },
    );
  }
}
