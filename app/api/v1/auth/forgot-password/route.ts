import {
  requestPasswordReset,
  resetPasswordWithToken,
} from "@/lib/auth/auth-service";
import { ManajerkuAppError } from "@/lib/services/platform-core";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Supports both requesting a reset token and executing the reset with token
    if (body.action === "RESET" || body.resetToken) {
      const resetRes = resetPasswordWithToken({
        resetToken: String(body.resetToken || ""),
        newPassword: String(body.newPassword || ""),
        newPasswordConfirmation: String(body.newPasswordConfirmation || ""),
      });
      return NextResponse.json({
        success: true,
        data: resetRes,
      });
    }

    const reqRes = requestPasswordReset(String(body.identifier || ""));
    return NextResponse.json({
      success: true,
      data: reqRes,
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
