import { NextRequest, NextResponse } from "next/server";
import { resolveVerifiedRequestActor } from "@/lib/auth/request-auth";
import {
  deleteDownstreamReseller,
  updateDownstreamReseller,
} from "@/lib/services/reseller-promo-broadcast";
import { ManajerkuAppError } from "@/lib/services/platform-core";

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

    const updated = updateDownstreamReseller({
      storeId: actor.storeId,
      resellerId: id,
      businessName: body.businessName ? String(body.businessName) : undefined,
      contactName: body.contactName ? String(body.contactName) : undefined,
      phoneWhatsapp: body.phoneWhatsapp ? String(body.phoneWhatsapp) : undefined,
      culinarySegment: body.culinarySegment
        ? String(body.culinarySegment)
        : undefined,
      isPromoSubscribed:
        typeof body.isPromoSubscribed === "boolean"
          ? body.isPromoSubscribed
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

    const deleted = deleteDownstreamReseller({
      storeId: actor.storeId,
      actorRole: actor.actorRole,
      resellerId: id,
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

