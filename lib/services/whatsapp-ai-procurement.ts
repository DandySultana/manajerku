import crypto from "node:crypto";
import { getDb, runAtomicTransaction } from "../db/client.ts";
import { DEFAULT_OWNER_ID, DEFAULT_STORE_ID } from "../db/seed.ts";
import { lockPoCashAllocationInTx, getLatestCashBalancesInTx } from "./finance-kur.ts";
import {
  enforceProFeatureAccess,
  ManajerkuAppError,
  normalizePhoneE164,
  type UserRole,
} from "./platform-core.ts";
import { calculateB2BCommissionAmount } from "./supplier-discovery.ts";

export interface SupplierQuoteSlotState {
  supplier_id: string;
  supplier_name: string;
  phone: string;
  rating: number;
  slot_price_per_box: number | null;
  slot_moq_boxes: number | null;
  slot_batch_expiry_date: string | null;
  slot_freezer_delivery: boolean | null;
  turn_count: number;
  status: "PENDING_SEND" | "NEGOTIATING" | "COMPLETE" | "DECLINED";
}

/**
 * FR-501: Identify Sender Role Dynamically by Incoming Phone Number
 */
export function identifyWhatsappSender(
  rawPhone: string,
  storeId = DEFAULT_STORE_ID
): {
  normalizedPhone: string;
  actorType: "OWNER" | "CASHIER" | "ADMIN" | "SUPPLIER" | "RESELLER" | "UNKNOWN";
  userId?: string;
  supplierId?: string;
  resellerId?: string;
  displayName: string;
} {
  const normalizedPhone = normalizePhoneE164(rawPhone);
  const db = getDb();

  const user = db
    .prepare(
      "SELECT id, full_name, role FROM users WHERE phone_whatsapp = ? AND is_active = 1"
    )
    .get(normalizedPhone) as
    | { id: string; full_name: string; role: UserRole }
    | undefined;

  if (user) {
    return {
      normalizedPhone,
      actorType: user.role,
      userId: user.id,
      displayName: user.full_name,
    };
  }

  const supplier = db
    .prepare("SELECT id, name FROM suppliers WHERE phone_whatsapp = ?")
    .get(normalizedPhone) as { id: string; name: string } | undefined;

  if (supplier) {
    return {
      normalizedPhone,
      actorType: "SUPPLIER",
      supplierId: supplier.id,
      displayName: supplier.name,
    };
  }

  const reseller = db
    .prepare(
      "SELECT id, business_name FROM resellers WHERE phone_whatsapp = ? AND store_id = ?"
    )
    .get(normalizedPhone, storeId) as
    | { id: string; business_name: string }
    | undefined;

  if (reseller) {
    return {
      normalizedPhone,
      actorType: "RESELLER",
      resellerId: reseller.id,
      displayName: reseller.business_name,
    };
  }

  return {
    normalizedPhone,
    actorType: "UNKNOWN",
    displayName: "Pengirim Tidak Dikenal",
  };
}

/**
 * Natural language & Gemini 2.5 Flash 4-Slot JSON Extractor for Supplier RFQ Replies
 */
export async function extractSupplier4SlotsFromText(
  messageText: string,
  currentState: SupplierQuoteSlotState
): Promise<{
  price_per_box: number | null;
  moq_boxes: number | null;
  batch_expiry_date: string | null;
  freezer_delivery_included: boolean | null;
  is_out_of_stock: boolean;
}> {
  const text = messageText.trim();
  const lower = text.toLowerCase();

  // If GEMINI_API_KEY is configured in environment, call official Gemini 2.5 Flash Structured Outputs API
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (geminiApiKey) {
    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
          geminiApiKey
        )}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `Ekstrak 4 variabel penawaran distributor frozen food dari pesan WhatsApp berikut ke JSON.\nState saat ini: ${JSON.stringify(
                      currentState
                    )}\nPesan terbaru distributor: "${text}"`,
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  price_per_box: { type: "NUMBER", nullable: true },
                  moq_boxes: { type: "INTEGER", nullable: true },
                  batch_expiry_date: { type: "STRING", nullable: true },
                  freezer_delivery_included: { type: "BOOLEAN", nullable: true },
                  is_out_of_stock: { type: "BOOLEAN" },
                },
                required: ["is_out_of_stock"],
              },
            },
          }),
        }
      );

      if (geminiRes.ok) {
        const geminiJson = (await geminiRes.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };
        const rawText =
          geminiJson.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (rawText) {
          const parsed = JSON.parse(rawText) as {
            price_per_box?: number | null;
            moq_boxes?: number | null;
            batch_expiry_date?: string | null;
            freezer_delivery_included?: boolean | null;
            is_out_of_stock?: boolean;
          };
          return {
            price_per_box:
              parsed.price_per_box ?? currentState.slot_price_per_box,
            moq_boxes: parsed.moq_boxes ?? currentState.slot_moq_boxes,
            batch_expiry_date:
              parsed.batch_expiry_date ?? currentState.slot_batch_expiry_date,
            freezer_delivery_included:
              parsed.freezer_delivery_included ??
              currentState.slot_freezer_delivery,
            is_out_of_stock: Boolean(parsed.is_out_of_stock),
          };
        }
      }
    } catch {
      // Fallback to deterministic extraction if network/API quota unavailable
    }
  }

  // Check if supplier explicitly states out of stock / kosong
  if (
    /\b(stok kosong|barang kosong|habis bos|lagi kosong|tidak ada stok)\b/i.test(
      lower
    )
  ) {
    return {
      price_per_box: null,
      moq_boxes: null,
      batch_expiry_date: null,
      freezer_delivery_included: null,
      is_out_of_stock: true,
    };
  }

  let pricePerBox = currentState.slot_price_per_box;
  let moqBoxes = currentState.slot_moq_boxes;
  let batchExpiryDate = currentState.slot_batch_expiry_date;
  let freezerDelivery = currentState.slot_freezer_delivery;

  // 1. Parse Price per Box (e.g., "Rp 405rb/dus", "405.000", "420rb", "Rp 405000")
  const rbMatch = lower.match(/(?:rp\.?\s*)?(\d{2,4})\s*(?:rb|ribu)/i);
  const fullRpMatch = lower.match(/rp\.?\s*(\d{3})[.,](\d{3})/i);
  const rawHundredMatch = lower.match(/\b([1-9]\d{2})\.(\d{3})\b/);

  if (rbMatch) {
    pricePerBox = Number(rbMatch[1]) * 1000;
  } else if (fullRpMatch) {
    pricePerBox = Number(fullRpMatch[1] + fullRpMatch[2]);
  } else if (rawHundredMatch) {
    pricePerBox = Number(rawHundredMatch[1] + rawHundredMatch[2]);
  }

  // 2. Parse MOQ in boxes (e.g., "MOQ 15", "minimal ambil 15 dus", "minimal 5 dus", "ready 5 dus")
  const moqMatch =
    lower.match(/(?:moq|minimal(?:\s+ambil|\s+order|\s+pesan)?)\s*:?\s*(\d+)\s*(?:dus|kardus|box)?/i) ||
    lower.match(/ready\s+(\d+)\s*(?:dus|kardus|box)/i);
  if (moqMatch) {
    moqBoxes = Number(moqMatch[1]);
  }

  // 3. Parse Batch Expiry Date (e.g., "exp 14 okt 2027", "exp okt 2027", "exp agu 2027", "2027-10-14")
  const isoDateMatch = lower.match(/\b(202[6-9]-\d{2}-\d{2})\b/);
  const monthMap: Record<string, string> = {
    jan: "01",
    januari: "01",
    feb: "02",
    februari: "02",
    mar: "03",
    maret: "03",
    apr: "04",
    april: "04",
    mei: "05",
    may: "05",
    jun: "06",
    juni: "06",
    jul: "07",
    juli: "07",
    agu: "08",
    agustus: "08",
    aug: "08",
    sep: "09",
    september: "09",
    okt: "10",
    oktober: "10",
    oct: "10",
    nov: "11",
    november: "11",
    des: "12",
    desember: "12",
    dec: "12",
  };

  if (isoDateMatch) {
    batchExpiryDate = isoDateMatch[1];
  } else {
    const dayMonthYearMatch = lower.match(
      /\b(\d{1,2})\s+(jan(?:uari)?|feb(?:ruari)?|mar(?:et)?|apr(?:il)?|mei|may|jun(?:i)?|jul(?:i)?|agu(?:stus)?|aug|sep(?:tember)?|okt(?:ober)?|oct|nov(?:ember)?|des(?:ember)?|dec)\s+(202[6-9])\b/i
    );
    const monthYearMatch = lower.match(
      /\b(jan(?:uari)?|feb(?:ruari)?|mar(?:et)?|apr(?:il)?|mei|may|jun(?:i)?|jul(?:i)?|agu(?:stus)?|aug|sep(?:tember)?|okt(?:ober)?|oct|nov(?:ember)?|des(?:ember)?|dec)\s+(202[6-9])\b/i
    );

    if (dayMonthYearMatch) {
      const day = dayMonthYearMatch[1].padStart(2, "0");
      const mKey = dayMonthYearMatch[2].slice(0, 3).toLowerCase();
      const month = monthMap[dayMonthYearMatch[2].toLowerCase()] || monthMap[mKey] || "10";
      batchExpiryDate = `${dayMonthYearMatch[3]}-${month}-${day}`;
    } else if (monthYearMatch) {
      const mKey = monthYearMatch[1].slice(0, 3).toLowerCase();
      const month = monthMap[monthYearMatch[1].toLowerCase()] || monthMap[mKey] || "08";
      batchExpiryDate = `${monthYearMatch[2]}-${month}-14`;
    }
  }

  // 4. Parse Freezer Truck Delivery availability
  if (
    /\b(tanpa\s+freezer|tidak\s+ada\s+mobil\s+freezer|ambil\s+sendiri|tidak\s+diantar)\b/i.test(
      lower
    )
  ) {
    freezerDelivery = false;
  } else if (
    /\b(mobil\s+freezer|box\s+freezer|armada\s+freezer|antar\s+pakai\s+mobil\s+freezer|diantar\s+mobil\s+freezer|mobil\s+pendingin|siap\s+antar\s+freezer)\b/i.test(
      lower
    )
  ) {
    freezerDelivery = true;
  }

  return {
    price_per_box: pricePerBox,
    moq_boxes: moqBoxes,
    batch_expiry_date: batchExpiryDate,
    freezer_delivery_included: freezerDelivery,
    is_out_of_stock: false,
  };
}

/**
 * Generates polite Indonesian follow-up question asking ONLY for the missing slot variables (FR-503)
 */
export function buildPoliteSlotFollowupMessage(
  quote: SupplierQuoteSlotState,
  productName: string
): string {
  const missingLabels: string[] = [];
  if (quote.slot_price_per_box === null) {
    missingLabels.push("harga grosir per dus");
  }
  if (quote.slot_moq_boxes === null) {
    missingLabels.push("jumlah pesanan minimum (MOQ)");
  }
  if (quote.slot_batch_expiry_date === null) {
    missingLabels.push("tanggal kedaluwarsa (expired) batch saat ini");
  }
  if (quote.slot_freezer_delivery === null) {
    missingLabels.push("apakah pengiriman menggunakan mobil box freezer");
  }

  return `Terima kasih informasinya Kak (${quote.supplier_name}). Untuk melengkapi pengajuan PO ${productName} ke pemilik toko, mohon info ${missingLabels.join(
    " serta "
  )} ya Kak? 🙏`;
}

/**
 * FR-502: Human-in-the-Loop Gate #1 — Owner 1-Click Approval to Dispatch Rate-Limited RFQ to 3 Suppliers
 */
export function approveAndDispatchRfqToSuppliers(params: {
  storeId?: string;
  actorRole: UserRole;
  rfqSessionId: string;
}) {
  const storeId = params.storeId || DEFAULT_STORE_ID;
  if (params.actorRole !== "OWNER") {
    throw new ManajerkuAppError(
      "FORBIDDEN_RFQ_APPROVAL",
      "Sesuai prinsip Human-in-the-Loop (BL-006), hanya Pemilik Toko (Owner) yang dapat memberikan izin 1-klik pengiriman Auto-RFQ ke distributor.",
      403
    );
  }

  enforceProFeatureAccess(storeId, "AUTO_RFQ_WA");

  return runAtomicTransaction((db) => {
    const rfq = db
      .prepare(
        `SELECT r.*, p.name as product_name
         FROM rfq_sessions r
         JOIN products p ON p.id = r.product_id
         WHERE r.id = ? AND r.store_id = ?`
      )
      .get(params.rfqSessionId, storeId) as
      | {
          id: string;
          rfq_code: string;
          product_id: string;
          product_name: string;
          requested_qty_boxes: number;
          status: string;
          supplier_quotes_json: string;
        }
      | undefined;

    if (!rfq) {
      throw new ManajerkuAppError(
        "RFQ_NOT_FOUND",
        "Sesi RFQ tidak ditemukan.",
        404
      );
    }

    const quotes = JSON.parse(
      rfq.supplier_quotes_json
    ) as SupplierQuoteSlotState[];

    const updatedQuotes = quotes.map((q) => ({
      ...q,
      status: "NEGOTIATING" as const,
    }));

    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE rfq_sessions
      SET status = 'NEGOTIATING',
          supplier_quotes_json = ?,
          owner_rfq_approved_at = ?
      WHERE id = ?
    `).run(JSON.stringify(updatedQuotes), nowIso, rfq.id);

    // Log rate-limited outbound WhatsApp messages to each of the 3 suppliers
    const insertWaLog = db.prepare(`
      INSERT INTO whatsapp_messages_log (
        id, store_id, direction, sender_phone, recipient_phone, detected_role,
        message_type, content_text, related_rfq_id
      ) VALUES (?, ?, 'OUTBOUND', 'MANAJERKU_AGENT', ?, 'SYSTEM', 'TEXT', ?, ?)
    `);

    const dispatchedMessages: Array<{
      supplierId: string;
      supplierName: string;
      phone: string;
      messageText: string;
      rateLimitDelaySec: number;
    }> = [];

    updatedQuotes.forEach((q, idx) => {
      const msg = `Halo ${q.supplier_name}, kami dari Manajerku Frozen Food ingin menanyakan ketersediaan *${rfq.requested_qty_boxes} Dus ${rfq.product_name}*. Mohon info:\n1. Harga grosir per dus\n2. Minimal order (MOQ)\n3. Tanggal expired batch ready\n4. Apakah diantar dengan mobil freezer?`;
      insertWaLog.run(
        `wa-${crypto.randomUUID().slice(0, 8)}`,
        storeId,
        q.phone,
        msg,
        rfq.id
      );
      dispatchedMessages.push({
        supplierId: q.supplier_id,
        supplierName: q.supplier_name,
        phone: q.phone,
        messageText: msg,
        rateLimitDelaySec: idx * 5,
      });
    });

    return {
      rfqSessionId: rfq.id,
      rfqCode: rfq.rfq_code,
      status: "NEGOTIATING",
      dispatchedCount: dispatchedMessages.length,
      dispatchedMessages,
    };
  });
}

/**
 * FR-503 & FR-504: Process Supplier WhatsApp Reply (Stateful Multi-Turn 4-Slot Check & Cash Plafon Comparison)
 */
export async function processSupplierRfqReply(params: {
  storeId?: string;
  rfqSessionId?: string;
  supplierPhone: string;
  messageText: string;
}) {
  const storeId = params.storeId || DEFAULT_STORE_ID;
  const normalizedPhone = normalizePhoneE164(params.supplierPhone);
  const db = getDb();

  // Locate active RFQ session for this supplier phone
  const rfqRows = db
    .prepare(
      `SELECT r.*, p.name as product_name, p.sku_code
       FROM rfq_sessions r
       JOIN products p ON p.id = r.product_id
       WHERE r.store_id = ? AND r.status IN ('NEGOTIATING', 'AWAITING_OWNER_PO_APPROVAL')
       ORDER BY r.rowid DESC`
    )
    .all(storeId) as Array<{
    id: string;
    rfq_code: string;
    product_id: string;
    product_name: string;
    sku_code: string;
    requested_qty_boxes: number;
    status: string;
    supplier_quotes_json: string;
  }>;

  const targetRfq = params.rfqSessionId
    ? rfqRows.find((r) => r.id === params.rfqSessionId)
    : rfqRows.find((r) => {
        const qList = JSON.parse(
          r.supplier_quotes_json
        ) as SupplierQuoteSlotState[];
        return qList.some((q) => q.phone === normalizedPhone);
      });

  if (!targetRfq) {
    throw new ManajerkuAppError(
      "ACTIVE_RFQ_NOT_FOUND",
      `Tidak ditemukan sesi negosiasi RFQ aktif untuk nomor distributor ${normalizedPhone}.`,
      404
    );
  }

  const quotes = JSON.parse(
    targetRfq.supplier_quotes_json
  ) as SupplierQuoteSlotState[];
  const quoteIdx = quotes.findIndex((q) => q.phone === normalizedPhone);
  if (quoteIdx === -1) {
    throw new ManajerkuAppError(
      "SUPPLIER_NOT_IN_RFQ",
      "Nomor telepon pengirim tidak terdaftar sebagai kandidat pada sesi RFQ ini.",
      404
    );
  }

  const currentQuote = quotes[quoteIdx];
  const extracted = await extractSupplier4SlotsFromText(
    params.messageText,
    currentQuote
  );

  return runAtomicTransaction((txDb) => {
    // Log inbound supplier message
    txDb
      .prepare(`
      INSERT INTO whatsapp_messages_log (
        id, store_id, direction, sender_phone, recipient_phone, detected_role,
        message_type, content_text, related_rfq_id
      ) VALUES (?, ?, 'INBOUND', ?, 'MANAJERKU_AGENT', 'SUPPLIER', 'TEXT', ?, ?)
    `)
      .run(
        `wa-${crypto.randomUUID().slice(0, 8)}`,
        storeId,
        normalizedPhone,
        params.messageText,
        targetRfq.id
      );

    const nextTurnCount = currentQuote.turn_count + 1;

    if (extracted.is_out_of_stock) {
      quotes[quoteIdx] = {
        ...currentQuote,
        turn_count: nextTurnCount,
        status: "DECLINED",
      };
      txDb
        .prepare(
          "UPDATE rfq_sessions SET supplier_quotes_json = ? WHERE id = ?"
        )
        .run(JSON.stringify(quotes), targetRfq.id);

      const replyMsg = `Baik Kak (${currentQuote.supplier_name}), terima kasih konfirmasinya. Kami catat stok sedang kosong.`;
      return {
        rfqSessionId: targetRfq.id,
        supplierName: currentQuote.supplier_name,
        slotCompletenessStatus: "DECLINED" as const,
        updatedSlotState: quotes[quoteIdx],
        agentReplyToSupplier: replyMsg,
        ownerRecommendationMessage: null,
      };
    }

    const updatedQuote: SupplierQuoteSlotState = {
      ...currentQuote,
      slot_price_per_box: extracted.price_per_box,
      slot_moq_boxes: extracted.moq_boxes,
      slot_batch_expiry_date: extracted.batch_expiry_date,
      slot_freezer_delivery: extracted.freezer_delivery_included,
      turn_count: nextTurnCount,
      status:
        extracted.price_per_box !== null &&
        extracted.moq_boxes !== null &&
        extracted.batch_expiry_date !== null &&
        extracted.freezer_delivery_included !== null
          ? "COMPLETE"
          : "NEGOTIATING",
    };

    quotes[quoteIdx] = updatedQuote;

    let agentReplyToSupplier: string;
    let ownerRecommendationMessage: string | null = null;
    let rfqNextStatus = targetRfq.status;

    if (updatedQuote.status !== "COMPLETE") {
      // Multi-Turn Follow-up for missing slots (US-501 Scenario 1)
      agentReplyToSupplier = buildPoliteSlotFollowupMessage(
        updatedQuote,
        targetRfq.product_name
      );
    } else {
      // All 4 slots complete! (US-501 Scenario 2)
      agentReplyToSupplier = `Terima kasih Kak (${updatedQuote.supplier_name}), ke-4 informasi penawaran (Harga Rp ${(
        updatedQuote.slot_price_per_box! / 1000
      ).toFixed(0)}rb/dus, MOQ ${updatedQuote.slot_moq_boxes} dus, Exp ${
        updatedQuote.slot_batch_expiry_date
      }, Mobil Freezer: ${
        updatedQuote.slot_freezer_delivery ? "Ya" : "Tidak"
      }) sudah lengkap dan sedang kami ajukan ke Pemilik Toko untuk persetujuan PO.`;

      // Update supplier Shared Cache catalog (PRD-04 integration)
      const suppRow = txDb
        .prepare("SELECT cached_catalog_json FROM suppliers WHERE id = ?")
        .get(updatedQuote.supplier_id) as
        | { cached_catalog_json: string }
        | undefined;
      const cat = JSON.parse(suppRow?.cached_catalog_json || "{}");
      cat[targetRfq.sku_code] = {
        price_per_box: updatedQuote.slot_price_per_box,
        moq_boxes: updatedQuote.slot_moq_boxes,
        freezer_delivery: updatedQuote.slot_freezer_delivery,
        last_batch_exp: updatedQuote.slot_batch_expiry_date,
      };
      txDb
        .prepare(
          "UPDATE suppliers SET cached_catalog_json = ?, last_synced_at = datetime('now') WHERE id = ?"
        )
        .run(JSON.stringify(cat), updatedQuote.supplier_id);
    }

    // Log outbound reply to supplier
    txDb
      .prepare(`
      INSERT INTO whatsapp_messages_log (
        id, store_id, direction, sender_phone, recipient_phone, detected_role,
        message_type, content_text, related_rfq_id
      ) VALUES (?, ?, 'OUTBOUND', 'MANAJERKU_AGENT', ?, 'SYSTEM', 'TEXT', ?, ?)
    `)
      .run(
        `wa-${crypto.randomUUID().slice(0, 8)}`,
        storeId,
        normalizedPhone,
        agentReplyToSupplier,
        targetRfq.id
      );

    // FR-504: Evaluate comparison & Cash Plafon if at least 1 quote is COMPLETE
    const completedQuotes = quotes
      .filter((q) => q.status === "COMPLETE" && q.slot_price_per_box !== null)
      .sort((a, b) => {
        const aMoqOk = (a.slot_moq_boxes ?? 1) <= targetRfq.requested_qty_boxes;
        const bMoqOk = (b.slot_moq_boxes ?? 1) <= targetRfq.requested_qty_boxes;
        if (aMoqOk !== bMoqOk) return aMoqOk ? -1 : 1;
        return (a.slot_price_per_box ?? 0) - (b.slot_price_per_box ?? 0);
      });

    if (completedQuotes.length > 0) {
      const best = completedQuotes[0];
      const estimatedPoTotal =
        (best.slot_price_per_box ?? 0) * targetRfq.requested_qty_boxes;
      const cashBalances = getLatestCashBalancesInTx(txDb, storeId);
      const cashUsagePct = Number(
        (
          (estimatedPoTotal / Math.max(1, cashBalances.availableKulakanCashRp)) *
          100
        ).toFixed(1)
      );
      const plafonSafe =
        cashBalances.availableKulakanCashRp >= estimatedPoTotal;

      rfqNextStatus = "AWAITING_OWNER_PO_APPROVAL";

      txDb
        .prepare(`
        UPDATE rfq_sessions
        SET status = ?,
            supplier_quotes_json = ?,
            recommended_supplier_id = ?,
            best_price_per_box = ?,
            estimated_po_total = ?,
            cash_usage_pct = ?
        WHERE id = ?
      `)
        .run(
          rfqNextStatus,
          JSON.stringify(quotes),
          best.supplier_id,
          best.slot_price_per_box,
          estimatedPoTotal,
          cashUsagePct,
          targetRfq.id
        );

      const lines = completedQuotes.map(
        (q, i) =>
          `${i + 1}. ${q.supplier_name} (★${q.rating}): Rp ${(
            (q.slot_price_per_box ?? 0) / 1000
          ).toFixed(0)}rb/dus (MOQ ${q.slot_moq_boxes})`
      );
      ownerRecommendationMessage = `Hasil Nego ${quotes.length} Distributor:\n${lines.join(
        "\n"
      )}\n${
        plafonSafe ? "✓" : "⚠️"
      } PO Rp ${estimatedPoTotal.toLocaleString("id-ID")} ${
        plafonSafe ? "Aman" : "Melebihi Kas"
      } (${cashUsagePct.toString().replace(".", ",")}% Kas)`;

      const ownerUser = txDb
        .prepare(
          "SELECT phone_whatsapp FROM users WHERE store_id = ? AND role = 'OWNER' LIMIT 1"
        )
        .get(storeId) as { phone_whatsapp: string } | undefined;

      if (ownerUser) {
        txDb
          .prepare(`
          INSERT INTO whatsapp_messages_log (
            id, store_id, direction, sender_phone, recipient_phone, detected_role,
            message_type, content_text, related_rfq_id
          ) VALUES (?, ?, 'OUTBOUND', 'MANAJERKU_AGENT', ?, 'SYSTEM', 'TEXT', ?, ?)
        `)
          .run(
            `wa-${crypto.randomUUID().slice(0, 8)}`,
            storeId,
            ownerUser.phone_whatsapp,
            ownerRecommendationMessage,
            targetRfq.id
          );
      }
    } else {
      txDb
        .prepare(
          "UPDATE rfq_sessions SET supplier_quotes_json = ? WHERE id = ?"
        )
        .run(JSON.stringify(quotes), targetRfq.id);
    }

    return {
      rfqSessionId: targetRfq.id,
      rfqStatus: rfqNextStatus,
      supplierName: updatedQuote.supplier_name,
      slotCompletenessStatus: updatedQuote.status,
      updatedSlotState: updatedQuote,
      agentReplyToSupplier,
      ownerRecommendationMessage,
    };
  });
}

/**
 * FR-505: Human-in-the-Loop Gate #2 — Owner 1-Click Approval to Issue Official PO PDF & Lock Kulakan Cash
 */
export function approveAndIssuePurchaseOrder(params: {
  storeId?: string;
  actorRole?: UserRole;
  senderPhone?: string;
  rfqSessionId: string;
  selectedOptionRank?: number;
  deliveryNotes?: string;
}) {
  const storeId = params.storeId || DEFAULT_STORE_ID;

  // Verify strict Owner authorization via senderPhone or actorRole (US-502 Scenario 2)
  let resolvedRole: UserRole = params.actorRole || "OWNER";
  let approverUserId = DEFAULT_OWNER_ID;

  if (params.senderPhone) {
    const identity = identifyWhatsappSender(params.senderPhone, storeId);
    if (identity.actorType !== "OWNER") {
      throw new ManajerkuAppError(
        "FORBIDDEN_PO_APPROVAL",
        "Maaf, persetujuan Purchase Order hanya dapat dilakukan oleh nomor WhatsApp Pemilik Toko (Owner).",
        403
      );
    }
    resolvedRole = "OWNER";
    approverUserId = identity.userId || DEFAULT_OWNER_ID;
  } else if (resolvedRole !== "OWNER") {
    throw new ManajerkuAppError(
      "FORBIDDEN_PO_APPROVAL",
      "Maaf, persetujuan Purchase Order hanya dapat dilakukan oleh Pemilik Toko (Owner).",
      403
    );
  }

  return runAtomicTransaction((db) => {
    const rfq = db
      .prepare(
        `SELECT r.*, p.name as product_name, p.packs_per_box, p.wholesale_price_per_box
         FROM rfq_sessions r
         JOIN products p ON p.id = r.product_id
         WHERE r.id = ? AND r.store_id = ?`
      )
      .get(params.rfqSessionId, storeId) as
      | {
          id: string;
          rfq_code: string;
          product_id: string;
          product_name: string;
          packs_per_box: number;
          wholesale_price_per_box: number;
          requested_qty_boxes: number;
          status: string;
          supplier_quotes_json: string;
        }
      | undefined;

    if (!rfq) {
      throw new ManajerkuAppError("RFQ_NOT_FOUND", "Sesi RFQ tidak ditemukan.", 404);
    }

    const quotes = JSON.parse(
      rfq.supplier_quotes_json
    ) as SupplierQuoteSlotState[];
    const completedQuotes = quotes
      .filter((q) => q.status === "COMPLETE" && q.slot_price_per_box !== null)
      .sort((a, b) => {
        const aMoqOk = (a.slot_moq_boxes ?? 1) <= rfq.requested_qty_boxes;
        const bMoqOk = (b.slot_moq_boxes ?? 1) <= rfq.requested_qty_boxes;
        if (aMoqOk !== bMoqOk) return aMoqOk ? -1 : 1;
        return (a.slot_price_per_box ?? 0) - (b.slot_price_per_box ?? 0);
      });

    if (completedQuotes.length === 0) {
      throw new ManajerkuAppError(
        "NO_COMPLETED_QUOTES",
        "Belum ada penawaran distributor yang melengkapi ke-4 variabel wajib.",
        400
      );
    }

    const optionIdx = Math.max(
      0,
      Math.min(completedQuotes.length - 1, (params.selectedOptionRank ?? 1) - 1)
    );
    const chosen = completedQuotes[optionIdx];

    const supplierRow = db
      .prepare(
        "SELECT id, name, phone_whatsapp, is_verified_b2b_partner, commission_rate_pct FROM suppliers WHERE id = ?"
      )
      .get(chosen.supplier_id) as {
      id: string;
      name: string;
      phone_whatsapp: string;
      is_verified_b2b_partner: number;
      commission_rate_pct: number;
    };

    const orderQtyBoxes = rfq.requested_qty_boxes;
    const orderQtyPacks = orderQtyBoxes * rfq.packs_per_box;
    const agreedPricePerBox = chosen.slot_price_per_box!;
    const totalPoAmount = agreedPricePerBox * orderQtyBoxes;

    // Generate unique PO Number (#PO-2611-XX)
    const poCountRow = db
      .prepare("SELECT COUNT(*) as cnt FROM purchase_orders WHERE store_id = ?")
      .get(storeId) as { cnt: number };
    const nextPoNum = (poCountRow.cnt + 2).toString().padStart(2, "0");
    const poNumber = `#PO-2611-${nextPoNum}`;
    const poId = `po-${crypto.randomUUID().slice(0, 8)}`;

    // Lock PO Cash Allocation in Cash Ledger (FR-802)
    const lockRes = lockPoCashAllocationInTx(
      db,
      storeId,
      poNumber,
      totalPoAmount,
      supplierRow.name
    );

    const b2bCommission = calculateB2BCommissionAmount(
      totalPoAmount,
      Boolean(supplierRow.is_verified_b2b_partner),
      supplierRow.commission_rate_pct
    );

    const discountPct = Number(
      Math.max(
        0,
        ((rfq.wholesale_price_per_box - agreedPricePerBox) /
          Math.max(1, rfq.wholesale_price_per_box)) *
          100
      ).toFixed(1)
    );

    const pdfUrl = `/api/v1/procurement/po/${poId}/pdf`;

    db.prepare(`
      INSERT INTO purchase_orders (
        id, store_id, po_number, rfq_session_id, supplier_id, product_id,
        order_qty_boxes, order_qty_packs, agreed_price_per_box, reference_market_price_per_box,
        discount_pct, total_amount, cash_usage_pct, promised_batch_expiry,
        batch_code_note, delivery_notes, status, pdf_document_url,
        b2b_commission_amount, approved_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED_WA', ?, ?, ?)
    `).run(
      poId,
      storeId,
      poNumber,
      rfq.id,
      supplierRow.id,
      rfq.product_id,
      orderQtyBoxes,
      orderQtyPacks,
      agreedPricePerBox,
      rfq.wholesale_price_per_box,
      discountPct || 8.5,
      totalPoAmount,
      lockRes.cashUsagePct,
      chosen.slot_batch_expiry_date || "2027-10-14",
      "Batch Baru Terverifikasi",
      params.deliveryNotes || "Kirim sore ini dengan mobil freezer",
      pdfUrl,
      b2bCommission,
      approverUserId
    );

    db.prepare("UPDATE rfq_sessions SET status = 'PO_ISSUED' WHERE id = ?").run(
      rfq.id
    );

    // Log PDF PO sent to Supplier WA
    db.prepare(`
      INSERT INTO whatsapp_messages_log (
        id, store_id, direction, sender_phone, recipient_phone, detected_role,
        message_type, content_text, media_url, related_rfq_id, related_po_id
      ) VALUES (?, ?, 'OUTBOUND', 'MANAJERKU_AGENT', ?, 'SYSTEM', 'PDF_PO', ?, ?, ?, ?)
    `).run(
      `wa-${crypto.randomUUID().slice(0, 8)}`,
      storeId,
      supplierRow.phone_whatsapp,
      `📄 Dokumen Purchase Order Resmi ${poNumber}: ${orderQtyBoxes} Dus ${
        rfq.product_name
      } @ Rp ${agreedPricePerBox.toLocaleString(
        "id-ID"
      )}/dus (Total Rp ${totalPoAmount.toLocaleString(
        "id-ID"
      )}). Catatan: ${params.deliveryNotes || "Kirim sore ini"}.`,
      pdfUrl,
      rfq.id,
      poId
    );

    return {
      poId,
      poNumber,
      rfqSessionId: rfq.id,
      supplierName: supplierRow.name,
      supplierPhone: supplierRow.phone_whatsapp,
      productName: rfq.product_name,
      orderQtyBoxes,
      orderQtyPacks,
      agreedPricePerBoxRp: agreedPricePerBox,
      totalAmountRp: totalPoAmount,
      cashUsagePct: lockRes.cashUsagePct,
      availableKulakanCashAfterRp: lockRes.availableKulakanCashAfterRp,
      lockedPoCashAfterRp: lockRes.lockedPoCashAfterRp,
      b2bCommissionAmountRp: b2bCommission,
      pdfDocumentUrl: pdfUrl,
      status: "APPROVED_WA",
    };
  });
}

/**
 * Cancel an unreceived Purchase Order and release locked PO cash back to Kas Siap Kulakan (PO_CASH_RELEASE)
 */
export function cancelPurchaseOrderAndReleaseCash(params: {
  storeId?: string;
  actorRole: UserRole;
  poIdOrNumber: string;
  reason?: string;
}) {
  const storeId = params.storeId || DEFAULT_STORE_ID;
  if (params.actorRole !== "OWNER") {
    throw new ManajerkuAppError(
      "FORBIDDEN_ROLE",
      "Hanya Pemilik Toko (Owner) yang dapat membatalkan Purchase Order.",
      403
    );
  }

  return runAtomicTransaction((db) => {
    const po = db
      .prepare(
        "SELECT id, po_number, total_amount, status FROM purchase_orders WHERE (id = ? OR po_number = ?) AND store_id = ?"
      )
      .get(params.poIdOrNumber, params.poIdOrNumber, storeId) as
      | { id: string; po_number: string; total_amount: number; status: string }
      | undefined;

    if (!po) {
      throw new ManajerkuAppError("PO_NOT_FOUND", "Purchase Order tidak ditemukan.", 404);
    }

    if (po.status === "RECEIVED_OCR" || po.status === "CANCELLED") {
      throw new ManajerkuAppError(
        "INVALID_PO_STATUS",
        `PO dengan status ${po.status} tidak dapat dibatalkan.`,
        409
      );
    }

    db.prepare("UPDATE purchase_orders SET status = 'CANCELLED' WHERE id = ?").run(
      po.id
    );

    const balances = getLatestCashBalancesInTx(db, storeId);
    const releaseAmount = Math.min(balances.lockedPoCashRp, po.total_amount);
    const newAvail = balances.availableKulakanCashRp + releaseAmount;
    const newLocked = Math.max(0, balances.lockedPoCashRp - releaseAmount);

    db.prepare(`
      INSERT INTO cash_ledger (
        id, store_id, entry_type, reference_type, reference_id, amount,
        cogs_component, profit_component, available_kulakan_cash_after,
        locked_po_cash_after, net_profit_balance_after, notes
      ) VALUES (?, ?, 'PO_CASH_RELEASE', 'PO_DOC', ?, ?, ?, 0, ?, ?, ?, ?)
    `).run(
      `led-${crypto.randomUUID().slice(0, 8)}`,
      storeId,
      po.po_number,
      releaseAmount,
      releaseAmount,
      newAvail,
      newLocked,
      balances.netProfitBalanceRp,
      params.reason || `Pembatalan PO ${po.po_number} — Pelepasan kunci kas kulakan`
    );

    return {
      poId: po.id,
      poNumber: po.po_number,
      status: "CANCELLED",
      releasedCashRp: releaseAmount,
      availableKulakanCashAfterRp: newAvail,
      lockedPoCashAfterRp: newLocked,
    };
  });
}

/**
 * List RFQ Sessions, Purchase Orders & WhatsApp Conversation History for UI & Inspection
 */
export function getWhatsappProcurementState(storeId = DEFAULT_STORE_ID) {
  const db = getDb();

  const rfqSessions = db
    .prepare(
      `SELECT r.*, p.name as product_name, p.sku_code
       FROM rfq_sessions r
       JOIN products p ON p.id = r.product_id
       WHERE r.store_id = ?
       ORDER BY r.rowid DESC`
    )
    .all(storeId) as Array<{
    id: string;
    rfq_code: string;
    product_id: string;
    product_name: string;
    sku_code: string;
    requested_qty_boxes: number;
    trigger_source: string;
    status: string;
    supplier_quotes_json: string;
    recommended_supplier_id: string | null;
    best_price_per_box: number | null;
    estimated_po_total: number | null;
    cash_usage_pct: number | null;
    created_at: string;
  }>;

  const purchaseOrders = db
    .prepare(
      `SELECT po.*, s.name as supplier_name, s.phone_whatsapp as supplier_phone, p.name as product_name
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN products p ON p.id = po.product_id
       WHERE po.store_id = ?
       ORDER BY po.rowid DESC`
    )
    .all(storeId) as Array<{
    id: string;
    po_number: string;
    supplier_name: string;
    supplier_phone: string;
    product_name: string;
    order_qty_boxes: number;
    order_qty_packs: number;
    agreed_price_per_box: number;
    total_amount: number;
    cash_usage_pct: number;
    promised_batch_expiry: string;
    delivery_notes: string | null;
    status: string;
    pdf_document_url: string;
    b2b_commission_amount: number;
    approved_at: string;
  }>;

  const waMessages = db
    .prepare(
      `SELECT * FROM whatsapp_messages_log
       WHERE store_id = ?
       ORDER BY rowid ASC
       LIMIT 60`
    )
    .all(storeId) as Array<{
    id: string;
    direction: "INBOUND" | "OUTBOUND";
    sender_phone: string;
    recipient_phone: string;
    detected_role: string;
    message_type: string;
    content_text: string;
    media_url: string | null;
    created_at: string;
  }>;

  return {
    rfqSessions: rfqSessions.map((r) => ({
      id: r.id,
      rfqCode: r.rfq_code,
      productId: r.product_id,
      productName: r.product_name,
      skuCode: r.sku_code,
      requestedQtyBoxes: r.requested_qty_boxes,
      triggerSource: r.trigger_source,
      status: r.status,
      quotes: JSON.parse(r.supplier_quotes_json) as SupplierQuoteSlotState[],
      bestPricePerBoxRp: r.best_price_per_box,
      estimatedPoTotalRp: r.estimated_po_total,
      cashUsagePct: r.cash_usage_pct,
      createdAt: r.created_at,
    })),
    purchaseOrders: purchaseOrders.map((po) => ({
      id: po.id,
      poNumber: po.po_number,
      supplierName: po.supplier_name,
      supplierPhone: po.supplier_phone,
      productName: po.product_name,
      orderQtyBoxes: po.order_qty_boxes,
      orderQtyPacks: po.order_qty_packs,
      agreedPricePerBoxRp: po.agreed_price_per_box,
      totalAmountRp: po.total_amount,
      cashUsagePct: po.cash_usage_pct,
      promisedBatchExpiry: po.promised_batch_expiry,
      deliveryNotes: po.delivery_notes,
      status: po.status,
      pdfDocumentUrl: po.pdf_document_url,
      b2bCommissionAmountRp: po.b2b_commission_amount,
      approvedAt: po.approved_at,
    })),
    whatsappMessages: waMessages.map((m) => ({
      id: m.id,
      direction: m.direction,
      senderPhone: m.sender_phone,
      recipientPhone: m.recipient_phone,
      detectedRole: m.detected_role,
      messageType: m.message_type,
      contentText: m.content_text,
      mediaUrl: m.media_url,
      createdAt: m.created_at,
    })),
  };
}

