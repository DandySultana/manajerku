import { NextRequest, NextResponse } from "next/server";
import {
  listSuppliersDirectory,
  registerVerifiedSupplier,
} from "@/lib/services/supplier-discovery";
import { ManajerkuAppError, type UserRole } from "@/lib/services/platform-core";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId") || undefined;
    const data = listSuppliersDirectory(storeId);
    return NextResponse.json({
      success: true,
      data,
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
    const actorRole: UserRole =
      body.actorRole === "CASHIER" || body.actorRole === "ADMIN"
        ? body.actorRole
        : "OWNER";

    const created = registerVerifiedSupplier({
      storeId: body.storeId ? String(body.storeId) : undefined,
      actorRole,
      name: String(body.name || ""),
      phoneWhatsapp: String(body.phoneWhatsapp || ""),
      address: String(body.address || ""),
      latitude: typeof body.latitude === "number" ? body.latitude : undefined,
      longitude: typeof body.longitude === "number" ? body.longitude : undefined,
      googleRating: Number(body.googleRating ?? 4.8),
      isVerifiedB2BPartner: Boolean(body.isVerifiedB2BPartner),
      commissionRatePct:
        typeof body.commissionRatePct === "number"
          ? body.commissionRatePct
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

