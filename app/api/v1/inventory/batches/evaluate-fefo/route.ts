import { NextRequest, NextResponse } from "next/server";
import { evaluateStoreFefoRadar } from "@/lib/services/fefo-inventory";
import { ManajerkuAppError } from "@/lib/services/platform-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = evaluateStoreFefoRadar({
      storeId: body.storeId ? String(body.storeId) : undefined,
      referenceDate: body.referenceDate ? String(body.referenceDate) : undefined,
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

