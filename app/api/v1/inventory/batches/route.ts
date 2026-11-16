import { NextRequest, NextResponse } from "next/server";
import { resolveVerifiedRequestActor } from "@/lib/auth/request-auth";
import {
  addInventoryBatch,
  listFefoBatches,
} from "@/lib/services/fefo-inventory";
import { ManajerkuAppError } from "@/lib/services/platform-core";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const actor = resolveVerifiedRequestActor(
      req,
      searchParams.get("storeId") || undefined
    );
    const productId = searchParams.get("productId") || undefined;
    const statusFilter = searchParams.get("status") || undefined;
    const referenceDate = searchParams.get("referenceDate") || undefined;

    const batches = listFefoBatches({
      storeId: actor.storeId,
      productId,
      statusFilter,
      referenceDate,
    });

    return NextResponse.json({
      success: true,
      data: batches,
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const actor = resolveVerifiedRequestActor(
      req,
      body.storeId ? String(body.storeId) : undefined
    );
    const created = addInventoryBatch({
      storeId: actor.storeId,
      productId: String(body.productId || ""),
      batchNumber: String(body.batchNumber || ""),
      qtyBoxes: typeof body.qtyBoxes === "number" ? body.qtyBoxes : undefined,
      qtyPacks: typeof body.qtyPacks === "number" ? body.qtyPacks : undefined,
      unitCogsPack:
        typeof body.unitCogsPack === "number" ? body.unitCogsPack : undefined,
      expiryDate: String(body.expiryDate || ""),
      receivedVia: body.receivedVia === "VISION_OCR" ? "VISION_OCR" : "MANUAL",
      sourcePoId: body.sourcePoId ? String(body.sourcePoId) : null,
      referenceDate: body.referenceDate ? String(body.referenceDate) : undefined,
    });

    return NextResponse.json({
      success: true,
      data: created,
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

