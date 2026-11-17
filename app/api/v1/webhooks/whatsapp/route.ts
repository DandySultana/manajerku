import { NextRequest, NextResponse } from "next/server";
import {
  getWhatsappProcurementState,
  identifyWhatsappSender,
  processOwnerWhatsappAssistantCommand,
  processSupplierRfqReply,
} from "@/lib/services/whatsapp-ai-procurement";
import { ManajerkuAppError } from "@/lib/services/platform-core";
import { resolveVerifiedRequestActor } from "@/lib/auth/request-auth";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const actor = resolveVerifiedRequestActor(
      req,
      searchParams.get("storeId") || undefined
    );
    const state = getWhatsappProcurementState(actor.storeId);
    return NextResponse.json({
      success: true,
      data: state,
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

/**
 * FR-501: Two-Way WhatsApp Webhook Receiver & Dynamic Phone Role Router
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Support both native OpenWA (@open-wa/wa-automate) webhook payload (body.data.from / body.data.body)
    // and direct Manajerku webhook payload (body.fromPhone / body.messageText)
    const openWaData =
      body && typeof body.data === "object" && body.data !== null
        ? body.data
        : null;

    const rawFromPhone = String(
      body.fromPhone ||
        openWaData?.from ||
        openWaData?.sender?.id ||
        body.from ||
        ""
    );
    const rawMessageText = String(
      body.messageText ||
        openWaData?.caption ||
        openWaData?.body ||
        openWaData?.content ||
        body.text ||
        ""
    );
    const mediaUrl =
      body.mediaUrl || openWaData?.mediaUrl || openWaData?.filename || undefined;
    const requestedStoreId = body.storeId ? String(body.storeId) : undefined;
    const rfqSessionId = body.rfqSessionId
      ? String(body.rfqSessionId)
      : undefined;
    const skipOpenWaDispatch = body.skipOpenWaDispatch === true;

    const identity = identifyWhatsappSender(rawFromPhone, requestedStoreId);
    const effectiveStoreId = requestedStoreId || identity.storeId;

    // Path A: Incoming message from Candidate Distributor (Negotiator Role)
    if (identity.actorType === "SUPPLIER") {
      const replyResult = await processSupplierRfqReply({
        storeId: effectiveStoreId,
        rfqSessionId,
        supplierPhone: identity.normalizedPhone,
        messageText: rawMessageText,
        skipOpenWaDispatch,
      });

      return NextResponse.json({
        success: true,
        routedRole: "NEGOTIATOR_SUPPLIER",
        senderIdentity: identity,
        data: replyResult,
      });
    }

    // Path B: Incoming message from Owner or Staff directly from WhatsApp via OpenWA (Personal Assistant Role)
    if (
      identity.actorType === "OWNER" ||
      identity.actorType === "CASHIER" ||
      identity.actorType === "ADMIN"
    ) {
      const assistantResult = processOwnerWhatsappAssistantCommand({
        storeId: effectiveStoreId,
        senderPhone: identity.normalizedPhone,
        senderRole: identity.actorType,
        senderName: identity.displayName,
        messageText: rawMessageText,
        rfqSessionId,
        mediaUrl: mediaUrl ? String(mediaUrl) : undefined,
        skipOpenWaDispatch,
      });

      return NextResponse.json({
        success: true,
        routedRole: assistantResult.routedRole,
        senderIdentity: identity,
        data: assistantResult.data,
      });
    }

    // Path C: Unknown phone number
    return NextResponse.json({
      success: true,
      routedRole: "UNKNOWN_SENDER_SAFE_REPLY",
      senderIdentity: identity,
      data: {
        replyMessage:
          "Halo, ini adalah nomor resmi Asisten Operasional Manajerku. Nomor Anda belum terdaftar sebagai Staf Toko atau Mitra Distributor aktif.",
      },
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

