import { NextRequest, NextResponse } from "next/server";
import { updateUserProfile } from "@/lib/auth/auth-service";
import { requireAuthenticatedSession } from "@/lib/auth/request-auth";
import { ManajerkuAppError } from "@/lib/services/platform-core";

export async function GET(req: NextRequest) {
  try {
    const context = requireAuthenticatedSession(req);
    return NextResponse.json({
      success: true,
      data: context,
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

export async function PATCH(req: NextRequest) {
  try {
    const context = requireAuthenticatedSession(req);
    const body = await req.json();

    const updated = updateUserProfile({
      userId: context.userId,
      fullName: body.fullName ? String(body.fullName) : undefined,
      email: body.email ? String(body.email) : undefined,
      phoneWhatsapp: body.phoneWhatsapp ? String(body.phoneWhatsapp) : undefined,
    });

    return NextResponse.json({
      success: true,
      data: updated,
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

