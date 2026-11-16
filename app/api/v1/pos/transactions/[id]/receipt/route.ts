import { NextRequest, NextResponse } from "next/server";
import { getPosReceiptById } from "@/lib/services/smart-pos";
import { ManajerkuAppError } from "@/lib/services/platform-core";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const receipt = getPosReceiptById(decodeURIComponent(id));
    return NextResponse.json({
      success: true,
      data: receipt,
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

