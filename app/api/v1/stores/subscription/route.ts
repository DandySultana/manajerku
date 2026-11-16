import { NextRequest, NextResponse } from "next/server";
import {
  checkSkuQuotaBeforeInsert,
  ManajerkuAppError,
  updateStoreSubscriptionTier,
  type SubscriptionTier,
  type UserRole,
} from "@/lib/services/platform-core";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId") || undefined;
    const quota = checkSkuQuotaBeforeInsert(storeId);
    return NextResponse.json({
      success: true,
      data: quota,
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
    const targetTier: SubscriptionTier =
      body.targetTier === "FREEMIUM_STARTER"
        ? "FREEMIUM_STARTER"
        : "MANAJERKU_PRO";

    const result = updateStoreSubscriptionTier({
      storeId: body.storeId ? String(body.storeId) : undefined,
      actorRole,
      targetTier,
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

