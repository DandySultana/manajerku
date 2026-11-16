import { NextRequest, NextResponse } from "next/server";
import { resolveVerifiedRequestActor } from "@/lib/auth/request-auth";
import {
  checkOpenWaServerHealth,
  dispatchOpenWaText,
  updateOpenWaConfig,
} from "@/lib/services/openwa-client";

export async function GET(req: NextRequest) {
  try {
    resolveVerifiedRequestActor(req);
    const status = await checkOpenWaServerHealth();
    return NextResponse.json({
      success: true,
      data: status,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "OPENWA_STATUS_ERROR",
          message:
            err instanceof Error
              ? err.message
              : "Gagal memeriksa status server OpenWA.",
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    resolveVerifiedRequestActor(req);
    const body = await req.json();

    if (body.apiUrl || typeof body.apiKey === "string" || body.webhookUrl) {
      updateOpenWaConfig({
        apiUrl: body.apiUrl ? String(body.apiUrl) : undefined,
        apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
        webhookUrl: body.webhookUrl ? String(body.webhookUrl) : undefined,
      });
    }

    const health = await checkOpenWaServerHealth();

    let testDispatchResult = null;
    if (body.testPhone) {
      testDispatchResult = await dispatchOpenWaText({
        toPhone: String(body.testPhone),
        content:
          body.testMessage ||
          "Halo Owner! Koneksi OpenWA Manajerku berhasil terhubung untuk Asisten AI & WA Blast Reseller.",
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...health,
        testDispatchResult,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "OPENWA_CONFIG_ERROR",
          message:
            err instanceof Error
              ? err.message
              : "Gagal memperbarui konfigurasi OpenWA.",
        },
      },
      { status: 500 }
    );
  }
}
