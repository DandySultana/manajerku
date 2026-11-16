import { NextRequest, NextResponse } from "next/server";
import { resolveVerifiedRequestActor } from "@/lib/auth/request-auth";
import { getFinancialLedgerAndKurSummary } from "@/lib/services/finance-kur";
import { ManajerkuAppError, type UserRole } from "@/lib/services/platform-core";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const roleParam = (searchParams.get("role") || "OWNER").toUpperCase();
    const fallbackRole: UserRole =
      roleParam === "CASHIER" || roleParam === "ADMIN" ? roleParam : "OWNER";
    const actor = resolveVerifiedRequestActor(
      req,
      searchParams.get("storeId") || undefined,
      fallbackRole
    );

    const data = getFinancialLedgerAndKurSummary({
      storeId: actor.storeId,
      actorRole: actor.actorRole,
    });

    return NextResponse.json({
      success: true,
      data,
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
