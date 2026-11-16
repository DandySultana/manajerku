import { NextRequest, NextResponse } from "next/server";
import { resolveVerifiedRequestActor } from "@/lib/auth/request-auth";
import {
  getUnifiedTransactions,
  ManajerkuAppError,
  type SyncFilterType,
} from "@/lib/services/platform-core";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const actor = resolveVerifiedRequestActor(
      req,
      searchParams.get("storeId") || undefined
    );
    const rawType = (searchParams.get("type") || "ALL").toUpperCase();
    const filterType: SyncFilterType =
      rawType === "PO" || rawType === "POS" ? rawType : "ALL";
    const search = searchParams.get("search") || "";

    const result = getUnifiedTransactions({
      storeId: actor.storeId,
      filterType,
      search,
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
