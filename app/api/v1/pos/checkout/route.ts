import { NextRequest, NextResponse } from "next/server";
import { executePosCheckout } from "@/lib/services/smart-pos";
import { ManajerkuAppError, type UserRole } from "@/lib/services/platform-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const actorRole: UserRole =
      body.actorRole === "OWNER" || body.actorRole === "ADMIN"
        ? body.actorRole
        : "CASHIER";

    const result = executePosCheckout({
      storeId: body.storeId ? String(body.storeId) : undefined,
      actorRole,
      cashierUserId: body.cashierUserId ? String(body.cashierUserId) : undefined,
      cashierLabel: body.cashierLabel ? String(body.cashierLabel) : "Kasir 01",
      resellerId: body.resellerId ? String(body.resellerId) : null,
      customerName: body.customerName ? String(body.customerName) : undefined,
      serviceType:
        body.serviceType === "DELIVERY" ? "DELIVERY" : "TAKEAWAY_PICKUP",
      paymentMethod: body.paymentMethod === "CASH" ? "CASH" : "QRIS",
      cashReceived:
        typeof body.cashReceived === "number" ? body.cashReceived : undefined,
      items: Array.isArray(body.items) ? body.items : [],
      transactionDate: body.transactionDate
        ? String(body.transactionDate)
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

