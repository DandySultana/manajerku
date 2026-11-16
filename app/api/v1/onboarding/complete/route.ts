import { NextRequest, NextResponse } from "next/server";
import {
  completeStoreOnboarding,
  ManajerkuAppError,
} from "@/lib/services/platform-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = completeStoreOnboarding({
      storeName: String(body.storeName || ""),
      branchName: body.branchName ? String(body.branchName) : undefined,
      address: body.address ? String(body.address) : undefined,
      coldChainCode: body.coldChainCode ? String(body.coldChainCode) : undefined,
      initialTempC:
        typeof body.initialTempC === "number" ? body.initialTempC : undefined,
      latitude: typeof body.latitude === "number" ? body.latitude : undefined,
      longitude: typeof body.longitude === "number" ? body.longitude : undefined,
      initialKulakanCash: Number(body.initialKulakanCash ?? 0),
      dailyFreezerElecCost:
        typeof body.dailyFreezerElecCost === "number"
          ? body.dailyFreezerElecCost
          : undefined,
      ownerName: String(body.ownerName || ""),
      ownerPhone: String(body.ownerPhone || ""),
      otpCode: String(body.otpCode || ""),
      cashierName: body.cashierName ? String(body.cashierName) : undefined,
      cashierPhone: body.cashierPhone ? String(body.cashierPhone) : undefined,
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

