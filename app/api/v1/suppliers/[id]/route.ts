import { NextRequest, NextResponse } from "next/server";
import { resolveVerifiedRequestActor } from "@/lib/auth/request-auth";
import {
  deleteVerifiedSupplier,
  updateVerifiedSupplier,
} from "@/lib/services/supplier-discovery";
import { ManajerkuAppError } from "@/lib/services/platform-core";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const actor = resolveVerifiedRequestActor(req, undefined, "OWNER");

    const updated = updateVerifiedSupplier({
      actorRole: actor.actorRole,
      supplierId: id,
      name: body.name ? String(body.name) : undefined,
      phoneWhatsapp: body.phoneWhatsapp ? String(body.phoneWhatsapp) : undefined,
      address: body.address ? String(body.address) : undefined,
      googleRating:
        typeof body.googleRating === "number" ? body.googleRating : undefined,
      isVerifiedB2BPartner:
        typeof body.isVerifiedB2BPartner === "boolean"
          ? body.isVerifiedB2BPartner
          : undefined,
      commissionRatePct:
        typeof body.commissionRatePct === "number"
          ? body.commissionRatePct
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
    const actor = resolveVerifiedRequestActor(req, undefined, "OWNER");

    const deleted = deleteVerifiedSupplier({
      actorRole: actor.actorRole,
      supplierId: id,
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

