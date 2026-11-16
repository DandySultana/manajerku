import { NextRequest, NextResponse } from "next/server";
import { approveAndIssuePurchaseOrder } from "@/lib/services/whatsapp-ai-procurement";
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

    const result = approveAndIssuePurchaseOrder({
      storeId: body.storeId ? String(body.storeId) : undefined,
      actorRole,
      senderPhone: body.senderPhone ? String(body.senderPhone) : undefined,
      rfqSessionId: id,
      selectedOptionRank:
        typeof body.selectedOptionRank === "number"
          ? body.selectedOptionRank
          : 1,
      deliveryNotes: body.deliveryNotes
        ? String(body.deliveryNotes)
        : "Setujui PO #1, kirim sore ini",
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

