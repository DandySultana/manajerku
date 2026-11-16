import { NextRequest, NextResponse } from "next/server";
import { runHybridSupplierDiscovery } from "@/lib/services/supplier-discovery";
import { ManajerkuAppError } from "@/lib/services/platform-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await runHybridSupplierDiscovery({
      storeId: body.storeId ? String(body.storeId) : undefined,
      productId: String(body.productId || ""),
      requestedQtyBoxes:
        typeof body.requestedQtyBoxes === "number"
          ? body.requestedQtyBoxes
          : undefined,
      maxRadiusKm:
        typeof body.maxRadiusKm === "number" ? body.maxRadiusKm : 10.0,
      minRating: typeof body.minRating === "number" ? body.minRating : 4.5,
      forceRefreshApi: Boolean(body.forceRefreshApi),
      createRfqDraft: body.createRfqDraft !== false,
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

