import { NextRequest, NextResponse } from "next/server";
import {
  listDownstreamResellers,
  registerDownstreamReseller,
} from "@/lib/services/reseller-promo-broadcast";
import { ManajerkuAppError } from "@/lib/services/platform-core";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId") || undefined;
    const resellers = listDownstreamResellers(storeId);
    return NextResponse.json({
      success: true,
      data: resellers,
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
    const created = registerDownstreamReseller({
      storeId: body.storeId ? String(body.storeId) : undefined,
      businessName: String(body.businessName || ""),
      contactName: String(body.contactName || ""),
      phoneWhatsapp: String(body.phoneWhatsapp || ""),
      culinarySegment: body.culinarySegment
        ? String(body.culinarySegment)
        : "BURGER",
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

