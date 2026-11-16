import { NextRequest, NextResponse } from "next/server";
import { writeOffInventoryBatch } from "@/lib/services/fefo-inventory";
import { ManajerkuAppError, type UserRole } from "@/lib/services/platform-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const actorRole: UserRole =
      body.actorRole === "CASHIER" || body.actorRole === "ADMIN"
        ? body.actorRole
        : "OWNER";

    const result = writeOffInventoryBatch({
      storeId: body.storeId ? String(body.storeId) : undefined,
      actorRole,
      batchId: String(body.batchId || ""),
      writeOffQtyPacks:
        typeof body.writeOffQtyPacks === "number"
          ? body.writeOffQtyPacks
          : undefined,
      reason:
        body.reason === "COLD_CHAIN_SPOILAGE"
          ? "COLD_CHAIN_SPOILAGE"
          : "EXPIRED",
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

