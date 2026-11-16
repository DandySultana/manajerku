import { NextRequest, NextResponse } from "next/server";
import { resolveVerifiedRequestActor } from "@/lib/auth/request-auth";
import {
  deleteStoreUserById,
  ManajerkuAppError,
  updateStoreUserById,
  type UserRole,
} from "@/lib/services/platform-core";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const actor = resolveVerifiedRequestActor(
      req,
      body.storeId ? String(body.storeId) : undefined,
      "OWNER"
    );

    const updated = updateStoreUserById({
      storeId: actor.storeId,
      actorRole: actor.actorRole,
      userId: id,
      fullName: body.fullName ? String(body.fullName) : undefined,
      phoneWhatsapp: body.phoneWhatsapp ? String(body.phoneWhatsapp) : undefined,
      role:
        body.role === "OWNER" || body.role === "CASHIER" || body.role === "ADMIN"
          ? (body.role as UserRole)
          : undefined,
      accountStatus:
        body.accountStatus === "ACTIVE" ||
        body.accountStatus === "SUSPENDED" ||
        body.accountStatus === "DEACTIVATED"
          ? body.accountStatus
          : undefined,
    });

    return NextResponse.json({
      success: true,
      data: updated,
    });
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

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const actor = resolveVerifiedRequestActor(
      req,
      searchParams.get("storeId") || undefined,
      "OWNER"
    );

    const deleted = deleteStoreUserById({
      storeId: actor.storeId,
      actorRole: actor.actorRole,
      userId: id,
    });

    return NextResponse.json({
      success: true,
      data: deleted,
    });
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

