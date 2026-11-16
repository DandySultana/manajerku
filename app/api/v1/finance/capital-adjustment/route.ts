import { NextRequest, NextResponse } from "next/server";
import { recordOwnerCapitalAdjustment } from "@/lib/services/finance-kur";
import { ManajerkuAppError, type UserRole } from "@/lib/services/platform-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const actorRole: UserRole =
      body.actorRole === "CASHIER" || body.actorRole === "ADMIN"
        ? body.actorRole
        : "OWNER";

    const adjustmentType =
      body.adjustmentType === "OWNER_DRAWING" ||
      body.adjustmentType === "INITIAL_CAPITAL"
        ? body.adjustmentType
        : "PROFIT_REINVESTMENT";

    const result = recordOwnerCapitalAdjustment({
      storeId: body.storeId ? String(body.storeId) : undefined,
      actorRole,
      adjustmentType,
      amountRp: Number(body.amountRp),
      notes: body.notes ? String(body.notes) : undefined,
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

