import { resolveVerifiedRequestActor } from "@/lib/auth/request-auth";
import { ManajerkuAppError } from "@/lib/services/platform-core";
import { cancelPurchaseOrderAndReleaseCash } from "@/lib/services/whatsapp-ai-procurement";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const actor = resolveVerifiedRequestActor(
      req,
      body.storeId ? String(body.storeId) : undefined,
      "OWNER",
    );

    const result = cancelPurchaseOrderAndReleaseCash({
      storeId: actor.storeId,
      actorRole: actor.actorRole,
      poIdOrNumber: decodeURIComponent(id),
      reason: body.reason ? String(body.reason) : undefined,
    });

    return NextResponse.json({
      success: true,
      data: result,
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
