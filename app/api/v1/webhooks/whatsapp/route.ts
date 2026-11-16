import { NextRequest, NextResponse } from "next/server";
import {
  approveAndIssuePurchaseOrder,
  getWhatsappProcurementState,
  identifyWhatsappSender,
  processSupplierRfqReply,
} from "@/lib/services/whatsapp-ai-procurement";
import { ManajerkuAppError } from "@/lib/services/platform-core";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId") || undefined;
    const state = getWhatsappProcurementState(storeId);
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
    const storeId = body.storeId ? String(body.storeId) : undefined;
    const fromPhone = String(body.fromPhone || "");
    const messageText = String(body.messageText || "");
    const rfqSessionId = body.rfqSessionId ? String(body.rfqSessionId) : undefined;

    const identity = identifyWhatsappSender(fromPhone, storeId);

    // Path A: Incoming message from Candidate Distributor (Negotiator Role)
    if (identity.actorType === "SUPPLIER") {
      const replyResult = await processSupplierRfqReply({
        storeId,
        rfqSessionId,
        supplierPhone: identity.normalizedPhone,
        messageText,
      });

      return NextResponse.json({
        success: true,
        routedRole: "NEGOTIATOR_SUPPLIER",
        senderIdentity: identity,
        data: replyResult,
      });
    }

    // Path B: Incoming message from Owner or Staff (Personal Assistant Role)
    if (identity.actorType === "OWNER" || identity.actorType === "CASHIER") {
      const lower = messageText.toLowerCase();

      // Check if message is PO approval command (e.g., "Setujui PO #1, kirim sore ini")
      const poApproveMatch = lower.match(/setujui\s+po\s*#?(\d+)/i);
      if (poApproveMatch) {
        if (!rfqSessionId) {
          throw new ManajerkuAppError(
            "MISSING_RFQ_ID",
            "ID sesi RFQ diperlukan untuk menyetujui PO.",
            400
          );
        }
        const selectedOptionRank = Number(poApproveMatch[1]);
        const poResult = approveAndIssuePurchaseOrder({
          storeId,
          senderPhone: identity.normalizedPhone,
          rfqSessionId,
          selectedOptionRank,
          deliveryNotes: messageText,
        });

        return NextResponse.json({
          success: true,
          routedRole: "ASSISTANT_OWNER_PO_APPROVAL",
          senderIdentity: identity,
          data: poResult,
        });
      }

      return NextResponse.json({
        success: true,
        routedRole: "ASSISTANT_INTERNAL",
        senderIdentity: identity,
        data: {
          replyMessage: `Halo ${identity.displayName} (${identity.actorType})! Asisten Manajerku AI siap melayani instruksi persetujuan PO, cek laba/kas, maupun pembacaan foto kardus Vision OCR.`,
        },
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

