import { NextRequest, NextResponse } from "next/server";
import {
  ManajerkuAppError,
  updateColdChainTemperature,
} from "@/lib/services/platform-core";

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const result = updateColdChainTemperature({
      storeId: body.storeId ? String(body.storeId) : undefined,
      temperatureC: Number(body.temperatureC),
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

