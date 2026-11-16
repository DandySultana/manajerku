import { NextRequest, NextResponse } from "next/server";
import { resolveVerifiedRequestActor } from "@/lib/auth/request-auth";
import {
  createMasterProduct,
  listInventoryProducts,
} from "@/lib/services/fefo-inventory";
import { ManajerkuAppError, type UserRole } from "@/lib/services/platform-core";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const actor = resolveVerifiedRequestActor(
      req,
      searchParams.get("storeId") || undefined
    );
    const referenceDate = searchParams.get("referenceDate") || undefined;
    const products = listInventoryProducts(actor.storeId, referenceDate);
    return NextResponse.json({
      success: true,
      data: products,
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
    const fallbackRole: UserRole =
      body.actorRole === "CASHIER" || body.actorRole === "ADMIN"
        ? body.actorRole
        : "OWNER";
    const actor = resolveVerifiedRequestActor(
      req,
      body.storeId ? String(body.storeId) : undefined,
      fallbackRole
    );

    const created = createMasterProduct({
      storeId: actor.storeId,
      actorRole: actor.actorRole,
      skuCode: String(body.skuCode || ""),
      name: String(body.name || ""),
      category: body.category ? String(body.category) : undefined,
      retailUnitName: body.retailUnitName ? String(body.retailUnitName) : undefined,
      wholesaleUnitName: body.wholesaleUnitName
        ? String(body.wholesaleUnitName)
        : undefined,
      packsPerBox: Number(body.packsPerBox),
      retailPricePerPack: Number(body.retailPricePerPack),
      wholesalePricePerBox: Number(body.wholesalePricePerBox),
      standardCogsPerPack:
        typeof body.standardCogsPerPack === "number"
          ? body.standardCogsPerPack
          : undefined,
      reorderPointPacks:
        typeof body.reorderPointPacks === "number"
          ? body.reorderPointPacks
          : undefined,
      defaultReorderBoxes:
        typeof body.defaultReorderBoxes === "number"
          ? body.defaultReorderBoxes
          : undefined,
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

