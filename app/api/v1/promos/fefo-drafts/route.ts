import { NextRequest, NextResponse } from "next/server";
import { resolveVerifiedRequestActor } from "@/lib/auth/request-auth";
import { listFefoPromoCampaigns } from "@/lib/services/reseller-promo-broadcast";
import { ManajerkuAppError } from "@/lib/services/platform-core";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const actor = resolveVerifiedRequestActor(
      req,
      searchParams.get("storeId") || undefined
    );
    const referenceDate = searchParams.get("referenceDate") || undefined;
    const campaigns = listFefoPromoCampaigns(actor.storeId, referenceDate);
    return NextResponse.json({
      success: true,
      data: campaigns,
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

