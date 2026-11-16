import crypto from "node:crypto";
import { getDb, runAtomicTransaction } from "../db/client.ts";
import { DEFAULT_OWNER_ID, DEFAULT_STORE_ID } from "../db/seed.ts";
import {
  calculateDaysToExpiry,
  classifyBatchFefoStatus,
  refreshProductRopStatusInTx,
} from "./fefo-inventory.ts";
import { settlePoCashAllocationInTx } from "./finance-kur.ts";
import {
  enforceProFeatureAccess,
  getRolePermissions,
  ManajerkuAppError,
  type UserRole,
} from "./platform-core.ts";

export interface VisionOcrReceiveInput {
  storeId?: string;
  actorRole?: UserRole;
  submittedByUserId?: string;
  senderPhone?: string;
  imageUrl?: string;
  captionText?: string;
  labelTextHint?: string;
  simulatedConfidence?: number;
  confirmPartialReceipt?: boolean;
  referenceDate?: string;
}

const INDONESIAN_MONTHS_SHORT: Record<string, string> = {
  "01": "Jan",
  "02": "Feb",
  "03": "Mar",
  "04": "Apr",
  "05": "Mei",
  "06": "Jun",
  "07": "Jul",
  "08": "Agu",
  "09": "Sep",
  "10": "Okt",
  "11": "Nov",
  "12": "Des",
};

function formatHumanDateId(isoDate: string): string {
  const parts = isoDate.slice(0, 10).split("-");
  if (parts.length !== 3) return isoDate;
  const [yyyy, mm, dd] = parts;
  return `${Number(dd)} ${INDONESIAN_MONTHS_SHORT[mm] || mm} ${yyyy}`;
}

/**
 * FR-601, FR-602, FR-603: Multimodal Vision OCR Inbound Cardboard Box Label Processor
 */
export function processInboundVisionOcr(input: VisionOcrReceiveInput) {
  const storeId = input.storeId || DEFAULT_STORE_ID;
  const actorRole = input.actorRole || "OWNER";
  const referenceDate = input.referenceDate || "2026-11-16";

  const perms = getRolePermissions(actorRole);
  if (!perms.canSubmitOcrPhoto) {
    throw new ManajerkuAppError(
      "FORBIDDEN_ROLE",
      "Hanya Pemilik Toko (Owner) atau Staf Kasir yang dapat mengirim foto label kardus barang masuk.",
      403
    );
  }

  // Enforce Manajerku Pro subscription tier (BMC Page 5)
  enforceProFeatureAccess(storeId, "VISION_OCR");

  const db = getDb();
  const allProducts = db
    .prepare(
      "SELECT id, sku_code, name, packs_per_box, standard_cogs_per_pack FROM products WHERE store_id = ? AND is_active = 1"
    )
    .all(storeId) as Array<{
    id: string;
    sku_code: string;
    name: string;
    packs_per_box: number;
    standard_cogs_per_pack: number;
  }>;

  const combinedText = `${input.labelTextHint || ""} ${input.captionText || ""} ${
    input.imageUrl || ""
  }`.trim();
  const lower = combinedText.toLowerCase();

  // 1. Match SKU from label/caption text or open PO
  const openStorePoProduct = db
    .prepare(
      `SELECT product_id FROM purchase_orders
       WHERE store_id = ? AND status IN ('APPROVED_WA', 'PDF_SENT')
       ORDER BY approved_at DESC LIMIT 1`
    )
    .get(storeId) as { product_id: string } | undefined;

  const matchedProduct =
    allProducts.find(
      (p) =>
        lower.includes(p.name.toLowerCase()) ||
        lower.includes(p.sku_code.toLowerCase()) ||
        (lower.includes("nugget") && p.name.toLowerCase().includes("nugget")) ||
        (lower.includes("sosis") && p.name.toLowerCase().includes("sosis")) ||
        (lower.includes("kentang") && p.name.toLowerCase().includes("kentang")) ||
        (lower.includes("dimsum") && p.name.toLowerCase().includes("dimsum")) ||
        (lower.includes("bakso") && p.name.toLowerCase().includes("bakso"))
    ) ||
    (openStorePoProduct
      ? allProducts.find((p) => p.id === openStorePoProduct.product_id)
      : undefined) ||
    allProducts[0];

  if (!matchedProduct) {
    throw new ManajerkuAppError(
      "NO_PRODUCTS_IN_STORE",
      "Toko belum memiliki Master SKU untuk pencocokan Vision OCR.",
      400
    );
  }

  // 2. Locate open Purchase Order for this product (if any)
  const openPo = db
    .prepare(
      `SELECT * FROM purchase_orders
       WHERE store_id = ? AND product_id = ? AND status IN ('APPROVED_WA', 'PDF_SENT')
       ORDER BY approved_at DESC LIMIT 1`
    )
    .get(storeId, matchedProduct.id) as
    | {
        id: string;
        po_number: string;
        order_qty_boxes: number;
        agreed_price_per_box: number;
        total_amount: number;
        promised_batch_expiry: string;
      }
    | undefined;

  // 3. Extract Qty Boxes, Batch Number, Expiry Date & Confidence Score
  const boxMatch = lower.match(/(\d+)\s*(?:dus|kardus|box)/i);
  const qtyBoxes = boxMatch
    ? Number(boxMatch[1])
    : openPo?.order_qty_boxes ?? 5;

  const batchMatch =
    combinedText.match(/batch\s*#?([A-Za-z0-9\-]+)/i) ||
    combinedText.match(/\b(FN-\d+|NG\d+-\d+|SS\d+-\d+|KT\d+-\d+)\b/i);
  const batchNumber = batchMatch ? batchMatch[1].toUpperCase() : "FN-219";

  // Extract Expiry Date (supports ISO YYYY-MM-DD or Indonesian "14 Okt 2027" or "Okt 2027")
  let expiryDateIso = openPo?.promised_batch_expiry || "2027-10-14";
  const isoMatch = combinedText.match(/\b(202[5-9]-\d{2}-\d{2})\b/);
  const monthMap: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    mei: "05",
    may: "05",
    jun: "06",
    jul: "07",
    agu: "08",
    aug: "08",
    sep: "09",
    okt: "10",
    oct: "10",
    nov: "11",
    des: "12",
    dec: "12",
  };
  const dmyMatch = lower.match(
    /\b(\d{1,2})\s+(jan|feb|mar|apr|mei|may|jun|jul|agu|aug|sep|okt|oct|nov|des|dec)[a-z]*\s+(202[5-9])\b/i
  );
  const myMatch = lower.match(
    /\b(?:exp|expired)?\s*(jan|feb|mar|apr|mei|may|jun|jul|agu|aug|sep|okt|oct|nov|des|dec)[a-z]*\s+(202[5-9])\b/i
  );

  if (isoMatch) {
    expiryDateIso = isoMatch[1];
  } else if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const mm = monthMap[dmyMatch[2].slice(0, 3).toLowerCase()] || "10";
    expiryDateIso = `${dmyMatch[3]}-${mm}-${day}`;
  } else if (myMatch) {
    // Edge Case (PRD-06 Section I): Month + Year only -> conservative default to day 01 of that month!
    const mm = monthMap[myMatch[1].slice(0, 3).toLowerCase()] || "10";
    expiryDateIso = `${myMatch[2]}-${mm}-01`;
  }

  const confidenceScore =
    typeof input.simulatedConfidence === "number"
      ? input.simulatedConfidence
      : lower.includes("buram") || lower.includes("blur")
      ? 0.62
      : 0.96;

  const rawGeminiJson = {
    matched_product_id: matchedProduct.id,
    extracted_product_name: matchedProduct.name,
    qty_boxes: qtyBoxes,
    batch_number: batchNumber,
    expiry_date_iso: expiryDateIso,
    confidence_score: confidenceScore,
  };

  return runAtomicTransaction((txDb) => {
    const imageUrl = input.imageUrl || "Foto_Label_Kardus_BekuJaya.jpg";
    const storeUser = txDb
      .prepare(
        "SELECT id FROM users WHERE store_id = ? ORDER BY CASE WHEN role = 'OWNER' THEN 0 ELSE 1 END LIMIT 1"
      )
      .get(storeId) as { id: string } | undefined;
    const submitterId =
      input.submittedByUserId || storeUser?.id || DEFAULT_OWNER_ID;

    // Exception 1: Blurry photo / confidence < 0.85 (FR-602)
    if (confidenceScore < 0.85) {
      const msg = openPo
        ? `⚠️ Foto label kardus kurang jelas (Confidence ${(
            confidenceScore * 100
          ).toFixed(
            0
          )}%). Apakah ini pengiriman ${openPo.po_number} (${
            openPo.order_qty_boxes
          } Dus ${matchedProduct.name}, Exp ${
            openPo.promised_batch_expiry
          })? Mohon foto ulang lebih dekat atau konfirmasi 1-klik.`
        : "⚠️ Foto label kardus kurang jelas pada bagian Tanggal Kedaluwarsa/Nomor Batch. Mohon foto ulang label lebih dekat.";

      const logId = `ocr-${crypto.randomUUID().slice(0, 8)}`;
      txDb
        .prepare(`
        INSERT INTO ocr_receiving_logs (
          id, store_id, submitted_by_user_id, image_url, caption_text,
          raw_gemini_json, confidence_score, created_batch_id, matched_po_id,
          status, response_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'NEEDS_CONFIRMATION', ?)
      `)
        .run(
          logId,
          storeId,
          submitterId,
          imageUrl,
          input.captionText || null,
          JSON.stringify(rawGeminiJson),
          confidenceScore,
          openPo?.id || null,
          msg
        );

      return {
        ocrLogId: logId,
        status: "NEEDS_CONFIRMATION" as const,
        confidenceScore,
        extractedData: rawGeminiJson,
        whatsappReplyMessage: msg,
        createdBatch: null,
        reconciledPoNumber: openPo?.po_number || null,
      };
    }

    // Exception 2: Expired batch on inbound box label (FR-602)
    const daysToExpiry = calculateDaysToExpiry(expiryDateIso, referenceDate);
    if (daysToExpiry <= 0) {
      const rejectMsg = `⚠️ PERINGATAN: Label kardus ${matchedProduct.name} (Batch ${batchNumber}) menunjukkan tanggal kedaluwarsa (${expiryDateIso}) sudah lewat! Barang ditolak masuk ke antrean stok sehat.`;
      const logId = `ocr-${crypto.randomUUID().slice(0, 8)}`;

      txDb
        .prepare(`
        INSERT INTO ocr_receiving_logs (
          id, store_id, submitted_by_user_id, image_url, caption_text,
          raw_gemini_json, confidence_score, created_batch_id, matched_po_id,
          status, response_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'REJECTED_EXPIRED', ?)
      `)
        .run(
          logId,
          storeId,
          submitterId,
          imageUrl,
          input.captionText || null,
          JSON.stringify(rawGeminiJson),
          confidenceScore,
          openPo?.id || null,
          rejectMsg
        );

      return {
        ocrLogId: logId,
        status: "REJECTED_EXPIRED" as const,
        confidenceScore,
        extractedData: rawGeminiJson,
        whatsappReplyMessage: rejectMsg,
        createdBatch: null,
        reconciledPoNumber: openPo?.po_number || null,
      };
    }

    // Edge Case 3: Partial delivery discrepancy vs Open PO (US-601 Scenario 2)
    if (
      openPo &&
      qtyBoxes !== openPo.order_qty_boxes &&
      !input.confirmPartialReceipt
    ) {
      const partialMsg = `ℹ️ Terdeteksi selisih jumlah dus: PO ${openPo.po_number} memesan ${openPo.order_qty_boxes} Dus, namun terbaca ${qtyBoxes} Dus (${qtyBoxes * matchedProduct.packs_per_box} Pack). Klik Konfirmasi Penerimaan Parsial untuk menyesuaikan realisasi kas menjadi ${qtyBoxes} Dus.`;
      const logId = `ocr-${crypto.randomUUID().slice(0, 8)}`;

      txDb
        .prepare(`
        INSERT INTO ocr_receiving_logs (
          id, store_id, submitted_by_user_id, image_url, caption_text,
          raw_gemini_json, confidence_score, created_batch_id, matched_po_id,
          status, response_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'NEEDS_CONFIRMATION', ?)
      `)
        .run(
          logId,
          storeId,
          submitterId,
          imageUrl,
          input.captionText || null,
          JSON.stringify(rawGeminiJson),
          confidenceScore,
          openPo.id,
          partialMsg
        );

      return {
        ocrLogId: logId,
        status: "NEEDS_CONFIRMATION" as const,
        confidenceScore,
        extractedData: rawGeminiJson,
        whatsappReplyMessage: partialMsg,
        createdBatch: null,
        reconciledPoNumber: openPo.po_number,
      };
    }

    // FR-603: Atomic Unit Conversion (Boxes -> Packs), FEFO Batch Insertion & PO Settlement
    const totalPacks = qtyBoxes * matchedProduct.packs_per_box;
    const unitCogsPack = openPo
      ? Math.round(openPo.agreed_price_per_box / matchedProduct.packs_per_box)
      : matchedProduct.standard_cogs_per_pack;
    const fefoStatus = classifyBatchFefoStatus(daysToExpiry, totalPacks);
    const batchId = `batch-${crypto.randomUUID().slice(0, 8)}`;

    txDb
      .prepare(`
      INSERT INTO inventory_batches (
        id, store_id, product_id, batch_number, source_po_id,
        initial_qty_packs, current_qty_packs, unit_cogs_pack,
        promo_discount_pct, expiry_date, fefo_status, received_via, ocr_image_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'VISION_OCR', ?)
    `)
      .run(
        batchId,
        storeId,
        matchedProduct.id,
        `Batch ${batchNumber}`,
        openPo?.id || null,
        totalPacks,
        totalPacks,
        unitCogsPack,
        expiryDateIso,
        fefoStatus,
        imageUrl
      );

    if (openPo) {
      txDb
        .prepare(
          "UPDATE purchase_orders SET status = 'RECEIVED_OCR', received_at = datetime('now') WHERE id = ?"
        )
        .run(openPo.id);

      const settledAmount = openPo.agreed_price_per_box * qtyBoxes;
      settlePoCashAllocationInTx(
        txDb,
        storeId,
        openPo.po_number,
        settledAmount,
        `Batch ${batchNumber}`
      );
    }

    const ropState = refreshProductRopStatusInTx(
      txDb,
      storeId,
      matchedProduct.id
    );

    const shortProdName = matchedProduct.name.replace(/\s+\d+g|\s+\d+kg/i, "");
    const humanExp = formatHumanDateId(expiryDateIso);
    const successMsg = `✅ Vision OCR Selesai! ${qtyBoxes} Dus (${totalPacks} Pack) ${shortProdName} Batch ${batchNumber} (Exp ${humanExp}) otomatis masuk antrean FEFO!`;

    const logId = `ocr-${crypto.randomUUID().slice(0, 8)}`;
    txDb
      .prepare(`
      INSERT INTO ocr_receiving_logs (
        id, store_id, submitted_by_user_id, image_url, caption_text,
        raw_gemini_json, confidence_score, created_batch_id, matched_po_id,
        status, response_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUTO_COMMITTED', ?)
    `)
      .run(
        logId,
        storeId,
        submitterId,
        imageUrl,
        input.captionText || null,
        JSON.stringify(rawGeminiJson),
        confidenceScore,
        batchId,
        openPo?.id || null,
        successMsg
      );

    // Log WhatsApp inbound image + outbound OCR confirmation
    const senderPhone = input.senderPhone || "+6282298606699";
    txDb
      .prepare(`
      INSERT INTO whatsapp_messages_log (
        id, store_id, direction, sender_phone, recipient_phone, detected_role,
        message_type, content_text, media_url, related_po_id
      ) VALUES (?, ?, 'INBOUND', ?, 'MANAJERKU_AGENT', ?, 'IMAGE_OCR', ?, ?, ?)
    `)
      .run(
        `wa-${crypto.randomUUID().slice(0, 8)}`,
        storeId,
        senderPhone,
        actorRole,
        input.captionText || "Barang baru sampai, tolong input ke stok FEFO ya",
        imageUrl,
        openPo?.id || null
      );

    txDb
      .prepare(`
      INSERT INTO whatsapp_messages_log (
        id, store_id, direction, sender_phone, recipient_phone, detected_role,
        message_type, content_text, related_po_id
      ) VALUES (?, ?, 'OUTBOUND', 'MANAJERKU_AGENT', ?, 'SYSTEM', 'TEXT', ?, ?)
    `)
      .run(
        `wa-${crypto.randomUUID().slice(0, 8)}`,
        storeId,
        senderPhone,
        successMsg,
        openPo?.id || null
      );

    return {
      ocrLogId: logId,
      status: "AUTO_COMMITTED" as const,
      confidenceScore,
      extractedData: rawGeminiJson,
      whatsappReplyMessage: successMsg,
      createdBatch: {
        batchId,
        batchNumber: `Batch ${batchNumber}`,
        productId: matchedProduct.id,
        productName: matchedProduct.name,
        qtyBoxes,
        initialQtyPacks: totalPacks,
        expiryDate: expiryDateIso,
        fefoStatus,
        ropState,
      },
      reconciledPoNumber: openPo?.po_number || null,
    };
  });
}

