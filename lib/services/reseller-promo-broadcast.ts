import crypto from "node:crypto";
import { getDb, runAtomicTransaction } from "../db/client.ts";
import { DEFAULT_OWNER_ID, DEFAULT_STORE_ID } from "../db/seed.ts";
import { calculateDaysToExpiry } from "./fefo-inventory.ts";
import {
  enforceProFeatureAccess,
  getRolePermissions,
  ManajerkuAppError,
  normalizePhoneE164,
  type UserRole,
} from "./platform-core.ts";

/**
 * FR-701: List & Register Downstream Culinary Micro-Vendors (Reseller Terdaftar)
 */
export function listDownstreamResellers(storeId = DEFAULT_STORE_ID) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, store_id, business_name, contact_name, phone_whatsapp,
              culinary_segment, is_promo_subscribed, created_at
       FROM resellers
       WHERE store_id = ?
       ORDER BY business_name ASC`
    )
    .all(storeId) as Array<{
    id: string;
    store_id: string;
    business_name: string;
    contact_name: string;
    phone_whatsapp: string;
    culinary_segment: string;
    is_promo_subscribed: number;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    storeId: r.store_id,
    businessName: r.business_name,
    contactName: r.contact_name,
    phoneWhatsapp: r.phone_whatsapp,
    culinarySegment: r.culinary_segment,
    isPromoSubscribed: Boolean(r.is_promo_subscribed),
    createdAt: r.created_at,
  }));
}

export function registerDownstreamReseller(params: {
  storeId?: string;
  businessName: string;
  contactName: string;
  phoneWhatsapp: string;
  culinarySegment?: string;
}) {
  const storeId = params.storeId || DEFAULT_STORE_ID;
  if (!params.businessName || params.businessName.trim().length < 2) {
    throw new ManajerkuAppError(
      "INVALID_BUSINESS_NAME",
      "Nama usaha kuliner reseller wajib diisi.",
      400
    );
  }
  const normalizedPhone = normalizePhoneE164(params.phoneWhatsapp);
  const db = getDb();

  const id = `reseller-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO resellers (
      id, store_id, business_name, contact_name, phone_whatsapp,
      culinary_segment, is_promo_subscribed
    ) VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(
    id,
    storeId,
    params.businessName.trim(),
    (params.contactName || params.businessName).trim(),
    normalizedPhone,
    (params.culinarySegment || "BURGER").toUpperCase()
  );

  return {
    id,
    storeId,
    businessName: params.businessName.trim(),
    contactName: (params.contactName || params.businessName).trim(),
    phoneWhatsapp: normalizedPhone,
    culinarySegment: (params.culinarySegment || "BURGER").toUpperCase(),
    isPromoSubscribed: true,
  };
}

export function updateDownstreamReseller(params: {
  storeId?: string;
  resellerId: string;
  businessName?: string;
  contactName?: string;
  phoneWhatsapp?: string;
  culinarySegment?: string;
  isPromoSubscribed?: boolean;
}) {
  const storeId = params.storeId || DEFAULT_STORE_ID;
  return runAtomicTransaction((db) => {
    const existing = db
      .prepare("SELECT * FROM resellers WHERE id = ? AND store_id = ?")
      .get(params.resellerId, storeId) as
      | {
          id: string;
          business_name: string;
          contact_name: string;
          phone_whatsapp: string;
          culinary_segment: string;
          is_promo_subscribed: number;
        }
      | undefined;

    if (!existing) {
      throw new ManajerkuAppError(
        "RESELLER_NOT_FOUND",
        "Mitra reseller tidak ditemukan.",
        404
      );
    }

    const nextBiz = params.businessName
      ? params.businessName.trim()
      : existing.business_name;
    const nextContact = params.contactName
      ? params.contactName.trim()
      : existing.contact_name;
    const nextPhone = params.phoneWhatsapp
      ? normalizePhoneE164(params.phoneWhatsapp)
      : existing.phone_whatsapp;
    const nextSeg = params.culinarySegment
      ? params.culinarySegment.toUpperCase()
      : existing.culinary_segment;
    const nextSub =
      params.isPromoSubscribed !== undefined
        ? params.isPromoSubscribed
          ? 1
          : 0
        : existing.is_promo_subscribed;

    db.prepare(`
      UPDATE resellers
      SET business_name = ?, contact_name = ?, phone_whatsapp = ?,
          culinary_segment = ?, is_promo_subscribed = ?
      WHERE id = ? AND store_id = ?
    `).run(nextBiz, nextContact, nextPhone, nextSeg, nextSub, existing.id, storeId);

    return {
      id: existing.id,
      storeId,
      businessName: nextBiz,
      contactName: nextContact,
      phoneWhatsapp: nextPhone,
      culinarySegment: nextSeg,
      isPromoSubscribed: Boolean(nextSub),
    };
  });
}

export function deleteDownstreamReseller(params: {
  storeId?: string;
  actorRole: UserRole;
  resellerId: string;
}) {
  const storeId = params.storeId || DEFAULT_STORE_ID;
  const perms = getRolePermissions(params.actorRole);
  if (!perms.canBroadcastPromo) {
    throw new ManajerkuAppError(
      "FORBIDDEN_ROLE",
      "Hanya Pemilik Toko (Owner) yang dapat menghapus mitra reseller.",
      403
    );
  }

  const db = getDb();
  const res = db
    .prepare("DELETE FROM resellers WHERE id = ? AND store_id = ?")
    .run(params.resellerId, storeId);

  if (Number(res.changes) === 0) {
    throw new ManajerkuAppError(
      "RESELLER_NOT_FOUND",
      "Mitra reseller tidak ditemukan.",
      404
    );
  }

  return { deletedResellerId: params.resellerId, deleted: true };
}

/**
 * FR-702: List FEFO Clearance Promo Drafts & Active Campaigns (< 30 Days Shelf Life)
 */
export function listFefoPromoCampaigns(
  storeId = DEFAULT_STORE_ID,
  referenceDate = "2026-11-16"
) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.*, b.batch_number, b.current_qty_packs, b.unit_cogs_pack, b.expiry_date, b.fefo_status,
              p.name as product_name, p.sku_code, p.retail_price_per_pack, p.wholesale_price_per_box, p.packs_per_box
       FROM fefo_promo_campaigns c
       JOIN inventory_batches b ON b.id = c.batch_id
       JOIN products p ON p.id = c.product_id
       WHERE c.store_id = ?
       ORDER BY c.created_at DESC`
    )
    .all(storeId) as Array<{
    id: string;
    batch_id: string;
    product_id: string;
    title: string;
    discount_pct: number;
    promo_price_per_pack: number;
    promo_price_per_box: number;
    target_reseller_count: number;
    sent_count: number;
    message_template: string;
    status: string;
    broadcasted_at: string | null;
    created_at: string;
    batch_number: string;
    current_qty_packs: number;
    unit_cogs_pack: number;
    expiry_date: string;
    fefo_status: string;
    product_name: string;
    sku_code: string;
    retail_price_per_pack: number;
    wholesale_price_per_box: number;
    packs_per_box: number;
  }>;

  return rows.map((r) => {
    const daysToExpiry = calculateDaysToExpiry(r.expiry_date, referenceDate);
    const capitalAtRiskRp = r.current_qty_packs * r.unit_cogs_pack;
    const projectedRecoveryRp = r.current_qty_packs * r.promo_price_per_pack;
    const isBelowCogsWarning = r.promo_price_per_pack < r.unit_cogs_pack;

    return {
      id: r.id,
      batchId: r.batch_id,
      batchNumber: r.batch_number,
      productId: r.product_id,
      productName: r.product_name,
      skuCode: r.sku_code,
      title: r.title,
      discountPct: r.discount_pct,
      normalPricePerPackRp: r.retail_price_per_pack,
      promoPricePerPackRp: r.promo_price_per_pack,
      normalPricePerBoxRp: r.wholesale_price_per_box,
      promoPricePerBoxRp: r.promo_price_per_box,
      unitCogsPackRp: r.unit_cogs_pack,
      isBelowCogsWarning,
      currentQtyPacks: r.current_qty_packs,
      expiryDate: r.expiry_date,
      daysToExpiry,
      capitalAtRiskRp,
      projectedRecoveryRp,
      targetResellerCount: r.target_reseller_count,
      sentCount: r.sent_count,
      messageTemplate: r.message_template,
      status: r.status,
      broadcastedAt: r.broadcasted_at,
    };
  });
}

/**
 * FR-703: Execute 1-Click Owner Approval & Rate-Limited WhatsApp Promo Broadcast to Resellers
 * Also synchronizes promo discount percentage to the target FEFO batch for Web POS checkout!
 */
export function executeFefoResellerPromoBroadcast(params: {
  storeId?: string;
  actorRole: UserRole;
  campaignId: string;
  customDiscountPct?: number;
}) {
  const storeId = params.storeId || DEFAULT_STORE_ID;
  const perms = getRolePermissions(params.actorRole);
  if (!perms.canBroadcastPromo) {
    throw new ManajerkuAppError(
      "FORBIDDEN_ROLE",
      "Hanya Pemilik Toko (Owner) yang dapat menyetujui dan menyiarkan broadcast promosi diskon FEFO ke reseller.",
      403
    );
  }

  // Enforce Manajerku Pro subscription tier (BMC Page 5)
  enforceProFeatureAccess(storeId, "RESELLER_BROADCAST");

  return runAtomicTransaction((db) => {
    const campaign = db
      .prepare(
        `SELECT c.*, b.batch_number, b.current_qty_packs, b.unit_cogs_pack,
                p.name as product_name, p.retail_price_per_pack, p.wholesale_price_per_box
         FROM fefo_promo_campaigns c
         JOIN inventory_batches b ON b.id = c.batch_id
         JOIN products p ON p.id = c.product_id
         WHERE c.id = ? AND c.store_id = ?`
      )
      .get(params.campaignId, storeId) as
      | {
          id: string;
          batch_id: string;
          product_id: string;
          title: string;
          discount_pct: number;
          batch_number: string;
          current_qty_packs: number;
          unit_cogs_pack: number;
          product_name: string;
          retail_price_per_pack: number;
          wholesale_price_per_box: number;
        }
      | undefined;

    if (!campaign) {
      throw new ManajerkuAppError(
        "CAMPAIGN_NOT_FOUND",
        "Kampanye promo FEFO tidak ditemukan.",
        404
      );
    }

    const discountPct =
      typeof params.customDiscountPct === "number" &&
      params.customDiscountPct > 0 &&
      params.customDiscountPct < 90
        ? Number(params.customDiscountPct.toFixed(1))
        : campaign.discount_pct;

    const promoPricePack = Math.round(
      campaign.retail_price_per_pack * (1 - discountPct / 100)
    );
    const promoPriceBox = Math.round(
      campaign.wholesale_price_per_box * (1 - discountPct / 100)
    );
    const isBelowCogsWarning = promoPricePack < campaign.unit_cogs_pack;

    const resellers = db
      .prepare(
        `SELECT id, business_name, contact_name, phone_whatsapp
         FROM resellers
         WHERE store_id = ? AND is_promo_subscribed = 1
         ORDER BY business_name ASC`
      )
      .all(storeId) as Array<{
      id: string;
      business_name: string;
      contact_name: string;
      phone_whatsapp: string;
    }>;

    // 1. Update batch promo_discount_pct so Smart POS (PRD-02) applies it automatically!
    db.prepare(
      "UPDATE inventory_batches SET promo_discount_pct = ? WHERE id = ?"
    ).run(discountPct, campaign.batch_id);

    // 2. Update campaign status to ACTIVE_SENT
    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE fefo_promo_campaigns
      SET discount_pct = ?,
          promo_price_per_pack = ?,
          promo_price_per_box = ?,
          target_reseller_count = ?,
          sent_count = ?,
          status = 'ACTIVE_SENT',
          approved_by_user_id = ?,
          broadcasted_at = ?
      WHERE id = ?
    `).run(
      discountPct,
      promoPricePack,
      promoPriceBox,
      resellers.length,
      resellers.length,
      DEFAULT_OWNER_ID,
      nowIso,
      campaign.id
    );

    // 3. Dispatch personalized rate-limited WhatsApp broadcast messages
    const insertWaLog = db.prepare(`
      INSERT INTO whatsapp_messages_log (
        id, store_id, direction, sender_phone, recipient_phone, detected_role,
        message_type, content_text
      ) VALUES (?, ?, 'OUTBOUND', 'MANAJERKU_AGENT', ?, 'RESELLER', 'PROMO_BROADCAST', ?)
    `);

    const deliveries = resellers.map((r, index) => {
      const personalizedMsg = `Halo Kak ${r.contact_name} (${
        r.business_name
      })! 🔥 Promo Cepat Stok Segar *${
        campaign.product_name
      }* (${campaign.batch_number}) Diskon *-${discountPct}%* khusus Mitra Reseller: Rp ${promoPricePack.toLocaleString(
        "id-ID"
      )}/pack (Grosir Rp ${promoPriceBox.toLocaleString(
        "id-ID"
      )}/dus). Sisa ${
        campaign.current_qty_packs
      } pack di freezer, tebus langsung di kasir hari ini!`;

      insertWaLog.run(
        `wa-${crypto.randomUUID().slice(0, 8)}`,
        storeId,
        r.phone_whatsapp,
        personalizedMsg
      );

      return {
        resellerId: r.id,
        businessName: r.business_name,
        phoneWhatsapp: r.phone_whatsapp,
        personalizedMessage: personalizedMsg,
        rateLimitDelaySec: index * 3,
      };
    });

    return {
      campaignId: campaign.id,
      batchId: campaign.batch_id,
      batchNumber: campaign.batch_number,
      productName: campaign.product_name,
      discountPct,
      promoPricePerPackRp: promoPricePack,
      promoPricePerBoxRp: promoPriceBox,
      isBelowCogsWarning,
      sentCount: deliveries.length,
      status: "ACTIVE_SENT" as const,
      deliveries,
    };
  });
}

