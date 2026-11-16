import { resolveVerifiedRequestActor } from "@/lib/auth/request-auth";
import { ManajerkuAppError, type UserRole } from "@/lib/services/platform-core";
import { processInboundVisionOcr } from "@/lib/services/vision-ocr-receiving";
import { NextRequest, NextResponse } from "next/server";

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

    const result = processInboundVisionOcr({
      storeId: actor.storeId,
      actorRole: actor.actorRole,
      submittedByUserId: actor.userId,
      senderPhone: body.senderPhone ? String(body.senderPhone) : undefined,
      imageUrl: body.imageUrl ? String(body.imageUrl) : undefined,
      captionText: body.captionText ? String(body.captionText) : undefined,
      labelTextHint: body.labelTextHint
        ? String(body.labelTextHint)
        : undefined,
      simulatedConfidence:
        typeof body.simulatedConfidence === "number"
          ? body.simulatedConfidence
          : undefined,
      confirmPartialReceipt: Boolean(body.confirmPartialReceipt),
      referenceDate: body.referenceDate
        ? String(body.referenceDate)
        : undefined,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    if (err instanceof ManajerkuAppError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message:
            err instanceof Error ? err.message : "Terjadi kesalahan sistem.",
        },
      },
      { status: 500 },
    );
  }
}
