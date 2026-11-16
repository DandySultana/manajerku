import { NextRequest, NextResponse } from "next/server";
import { executeFefoResellerPromoBroadcast } from "@/lib/services/reseller-promo-broadcast";
import { ManajerkuAppError, type UserRole } from "@/lib/services/platform-core";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const actorRole: UserRole =
      body.actorRole === "CASHIER" || body.actorRole === "ADMIN"
        ? body.actorRole
        : "OWNER";

    const result = executeFefoResellerPromoBroadcast({
      storeId: body.storeId ? String(body.storeId) : undefined,
      actorRole,
      campaignId: id,
      customDiscountPct:
        typeof body.customDiscountPct === "number"
          ? body.customDiscountPct
          : undefined,
    });

    return NextResponse.json({
      success: true,
      data: result,
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

