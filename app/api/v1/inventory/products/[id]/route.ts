import { NextRequest, NextResponse } from "next/server";
import { resolveVerifiedRequestActor } from "@/lib/auth/request-auth";
import {
  deleteMasterProduct,
  updateMasterProduct,
} from "@/lib/services/fefo-inventory";
import { ManajerkuAppError, type UserRole } from "@/lib/services/platform-core";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const fallbackRole: UserRole =
      body.actorRole === "CASHIER" || body.actorRole === "ADMIN"
        ? body.actorRole
        : "OWNER";
    const actor = resolveVerifiedRequestActor(
      req,
      body.storeId ? String(body.storeId) : undefined,
      fallbackRole
    );

    const updated = updateMasterProduct({
      storeId: actor.storeId,
      actorRole: actor.actorRole,
      productId: id,
      name: body.name ? String(body.name) : undefined,
      category: body.category ? String(body.category) : undefined,
      packsPerBox:
        typeof body.packsPerBox === "number" ? body.packsPerBox : undefined,
      retailPricePerPack:
        typeof body.retailPricePerPack === "number"
          ? body.retailPricePerPack
          : undefined,
      wholesalePricePerBox:
        typeof body.wholesalePricePerBox === "number"
          ? body.wholesalePricePerBox
          : undefined,
      reorderPointPacks:
        typeof body.reorderPointPacks === "number"
          ? body.reorderPointPacks
          : undefined,
      defaultReorderBoxes:
        typeof body.defaultReorderBoxes === "number"
          ? body.defaultReorderBoxes
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

    const deleted = deleteMasterProduct({
      storeId: actor.storeId,
      actorRole: actor.actorRole,
      productId: id,
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

