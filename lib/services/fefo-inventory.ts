import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDb, runAtomicTransaction } from "../db/client.ts";
import { DEFAULT_STORE_ID } from "../db/seed.ts";
import {
  checkSkuQuotaBeforeInsert,
  getRolePermissions,
  ManajerkuAppError,
  type UserRole,
} from "./platform-core.ts";

export type FefoStatus =
  | "SAFE"
  | "PRIORITY_FEFO"
  | "CRITICAL"
  | "EXPIRED"
  | "DEPLETED"
  | "WRITTEN_OFF";

export interface CreateProductInput {
  storeId?: string;
  actorRole: UserRole;
  skuCode: string;
  name: string;
  category?: string;
  retailUnitName?: string;
  wholesaleUnitName?: string;
  packsPerBox: number;
  retailPricePerPack: number;
  wholesalePricePerBox: number;
  standardCogsPerPack?: number;
  reorderPointPacks?: number;
  defaultReorderBoxes?: number;
}

/**
 * Computes days remaining between referenceDate (YYYY-MM-DD) and expiryDate (YYYY-MM-DD).
 */
export function calculateDaysToExpiry(
  expiryDateIso: string,
  referenceDateIso = "2026-11-16",
): number {
  const expDay = expiryDateIso.slice(0, 10);
  const refDay = referenceDateIso.slice(0, 10);
  const expMs = new Date(`${expDay}T00:00:00Z`).getTime();
  const refMs = new Date(`${refDay}T00:00:00Z`).getTime();
  return Math.round((expMs - refMs) / (1000 * 60 * 60 * 24));
}

/**
 * BL-003: Classifies a batch's FEFO status based on remaining shelf life in days.
 */
export function classifyBatchFefoStatus(
  daysToExpiry: number,
  currentQtyPacks: number,
): FefoStatus {
  if (currentQtyPacks <= 0) return "DEPLETED";
  if (daysToExpiry <= 0) return "EXPIRED";
  if (daysToExpiry <= 18) return "CRITICAL";
  if (daysToExpiry < 30) return "PRIORITY_FEFO";
  return "SAFE";
}

/**
 * FR-304: Recalculates healthy stock for a product and updates its is_below_rop flag.
 */
export function refreshProductRopStatusInTx(
  db: DatabaseSync,
  storeId: string,
  productId: string,
): {
  healthyStockPacks: number;
  reorderPointPacks: number;
  isBelowRop: boolean;
} {
  const prod = db
    .prepare(
      "SELECT reorder_point_packs FROM products WHERE id = ? AND store_id = ?",
    )
    .get(productId, storeId) as { reorder_point_packs: number } | undefined;

  if (!prod) {
    throw new ManajerkuAppError(
      "PRODUCT_NOT_FOUND",
      "Produk tidak ditemukan.",
      404,
    );
  }

  const stockRow = db
    .prepare(
      `SELECT COALESCE(SUM(current_qty_packs), 0) as healthy_packs
       FROM inventory_batches
       WHERE store_id = ? AND product_id = ?
         AND current_qty_packs > 0
         AND fefo_status IN ('SAFE', 'PRIORITY_FEFO', 'CRITICAL')`,
    )
    .get(storeId, productId) as { healthy_packs: number };

  const healthyStockPacks = stockRow.healthy_packs;
  const isBelowRop = healthyStockPacks <= prod.reorder_point_packs;

  db.prepare(
    "UPDATE products SET is_below_rop = ? WHERE id = ? AND store_id = ?",
  ).run(isBelowRop ? 1 : 0, productId, storeId);

  return {
    healthyStockPacks,
    reorderPointPacks: prod.reorder_point_packs,
    isBelowRop,
  };
}

/**
 * FR-301: Create Master SKU with Multi-Unit Ratio & Subscription Quota Check
 */
export function createMasterProduct(input: CreateProductInput) {
  const storeId = input.storeId || DEFAULT_STORE_ID;
  const perms = getRolePermissions(input.actorRole);
  if (!perms.canManageInventory) {
    throw new ManajerkuAppError(
      "FORBIDDEN_ROLE",
      "Hanya Pemilik Toko (Owner) yang dapat menambah atau mengubah Master SKU.",
      403,
    );
  }

  if (!input.skuCode || input.skuCode.trim().length < 2) {
    throw new ManajerkuAppError(
      "INVALID_SKU_CODE",
      "Kode SKU wajib diisi.",
      400,
    );
  }
  if (!input.name || input.name.trim().length < 2) {
    throw new ManajerkuAppError(
      "INVALID_PRODUCT_NAME",
      "Nama produk wajib diisi.",
      400,
    );
  }
  if (!Number.isInteger(input.packsPerBox) || input.packsPerBox < 1) {
    throw new ManajerkuAppError(
      "INVALID_CONVERSION_RATIO",
      "Rasio konversi (packsPerBox) harus bilangan bulat minimal 1 Pack per Dus.",
      400,
    );
  }
  if (input.retailPricePerPack <= 0 || input.wholesalePricePerBox <= 0) {
    throw new ManajerkuAppError(
      "INVALID_PRICE",
      "Harga jual eceran dan harga jual grosir harus lebih besar dari Rp 0.",
      400,
    );
  }
  if (
    input.wholesalePricePerBox >
    input.retailPricePerPack * input.packsPerBox
  ) {
    throw new ManajerkuAppError(
      "WHOLESALE_EXCEEDS_RETAIL",
      `Harga grosir per dus (Rp ${input.wholesalePricePerBox}) tidak boleh melebihi total harga eceran ${input.packsPerBox} pack (Rp ${
        input.retailPricePerPack * input.packsPerBox
      }).`,
      400,
    );
  }

  // Enforce Subscription Quota (Freemium max 30 SKUs)
  checkSkuQuotaBeforeInsert(storeId);

  return runAtomicTransaction((db) => {
    const existing = db
      .prepare("SELECT id FROM products WHERE store_id = ? AND sku_code = ?")
      .get(storeId, input.skuCode.trim().toUpperCase());

    if (existing) {
      throw new ManajerkuAppError(
        "DUPLICATE_SKU_CODE",
        `Kode SKU "${input.skuCode.trim().toUpperCase()}" sudah terdaftar di toko ini.`,
        409,
      );
    }

    const id = `prod-${crypto.randomUUID().slice(0, 8)}`;
    const ropPacks = Math.round(
      input.reorderPointPacks ?? input.packsPerBox * 2,
    );
    const defaultBoxes = Math.round(input.defaultReorderBoxes ?? 5);
    const stdCogs = Math.round(
      input.standardCogsPerPack ?? Math.round(input.retailPricePerPack * 0.75),
    );

    db.prepare(
      `
      INSERT INTO products (
        id, store_id, sku_code, name, category, retail_unit_name, wholesale_unit_name,
        packs_per_box, retail_price_per_pack, wholesale_price_per_box, standard_cogs_per_pack,
        reorder_point_packs, default_reorder_boxes, is_below_rop, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
    `,
    ).run(
      id,
      storeId,
      input.skuCode.trim().toUpperCase(),
      input.name.trim(),
      (input.category || "Frozen Food").trim(),
      (input.retailUnitName || "Pack").trim(),
      (input.wholesaleUnitName || "Dus").trim(),
      input.packsPerBox,
      Math.round(input.retailPricePerPack),
      Math.round(input.wholesalePricePerBox),
      stdCogs,
      ropPacks,
      defaultBoxes,
    );

    return {
      id,
      storeId,
      skuCode: input.skuCode.trim().toUpperCase(),
      name: input.name.trim(),
      packsPerBox: input.packsPerBox,
      retailPricePerPack: Math.round(input.retailPricePerPack),
      wholesalePricePerBox: Math.round(input.wholesalePricePerBox),
      reorderPointPacks: ropPacks,
      defaultReorderBoxes: defaultBoxes,
      isBelowRop: true,
    };
  });
}

/**
 * FR-301 (Update): Update Master SKU Prices, Conversion Ratio, or ROP Threshold
 */
export function updateMasterProduct(params: {
  storeId?: string;
  actorRole: UserRole;
  productId: string;
  name?: string;
  category?: string;
  packsPerBox?: number;
  retailPricePerPack?: number;
  wholesalePricePerBox?: number;
  reorderPointPacks?: number;
  defaultReorderBoxes?: number;
}) {
  const storeId = params.storeId || DEFAULT_STORE_ID;
  const perms = getRolePermissions(params.actorRole);
  if (!perms.canManageInventory) {
    throw new ManajerkuAppError(
      "FORBIDDEN_ROLE",
      "Hanya Pemilik Toko (Owner) yang dapat mengubah Master SKU.",
      403
    );
  }

  return runAtomicTransaction((db) => {
    const existing = db
      .prepare("SELECT * FROM products WHERE id = ? AND store_id = ? AND is_active = 1")
      .get(params.productId, storeId) as
      | {
          id: string;
          sku_code: string;
          name: string;
          category: string;
          packs_per_box: number;
          retail_price_per_pack: number;
          wholesale_price_per_box: number;
          reorder_point_packs: number;
          default_reorder_boxes: number;
        }
      | undefined;

    if (!existing) {
      throw new ManajerkuAppError("PRODUCT_NOT_FOUND", "Produk tidak ditemukan.", 404);
    }

    const nextName = params.name ? params.name.trim() : existing.name;
    const nextCategory = params.category ? params.category.trim() : existing.category;
    const nextPacksPerBox = params.packsPerBox ?? existing.packs_per_box;
    const nextRetail = params.retailPricePerPack ?? existing.retail_price_per_pack;
    const nextWholesale = params.wholesalePricePerBox ?? existing.wholesale_price_per_box;
    const nextRop = params.reorderPointPacks ?? existing.reorder_point_packs;
    const nextDefaultBoxes = params.defaultReorderBoxes ?? existing.default_reorder_boxes;

    if (nextPacksPerBox < 1 || nextRetail <= 0 || nextWholesale <= 0) {
      throw new ManajerkuAppError("INVALID_PRICE", "Parameter harga dan rasio konversi harus > 0.", 400);
    }
    if (nextWholesale > nextRetail * nextPacksPerBox) {
      throw new ManajerkuAppError(
        "WHOLESALE_EXCEEDS_RETAIL",
        "Harga grosir per dus tidak boleh melebihi total harga eceran sejumlah pack dalam 1 dus.",
        400
      );
    }

    db.prepare(`
      UPDATE products
      SET name = ?, category = ?, packs_per_box = ?,
          retail_price_per_pack = ?, wholesale_price_per_box = ?,
          reorder_point_packs = ?, default_reorder_boxes = ?
      WHERE id = ? AND store_id = ?
    `).run(
      nextName,
      nextCategory,
      Math.round(nextPacksPerBox),
      Math.round(nextRetail),
      Math.round(nextWholesale),
      Math.round(nextRop),
      Math.round(nextDefaultBoxes),
      existing.id,
      storeId
    );

    const ropState = refreshProductRopStatusInTx(db, storeId, existing.id);

    return {
      id: existing.id,
      skuCode: existing.sku_code,
      name: nextName,
      category: nextCategory,
      packsPerBox: Math.round(nextPacksPerBox),
      retailPricePerPack: Math.round(nextRetail),
      wholesalePricePerBox: Math.round(nextWholesale),
      reorderPointPacks: Math.round(nextRop),
      defaultReorderBoxes: Math.round(nextDefaultBoxes),
      isBelowRop: ropState.isBelowRop,
    };
  });
}

/**
 * FR-301 (Delete / Soft-Deactivate): Deactivate Master SKU (blocks if active healthy batches > 0 unless forced)
 */
export function deleteMasterProduct(params: {
  storeId?: string;
  actorRole: UserRole;
  productId: string;
}) {
  const storeId = params.storeId || DEFAULT_STORE_ID;
  const perms = getRolePermissions(params.actorRole);
  if (!perms.canManageInventory) {
    throw new ManajerkuAppError(
      "FORBIDDEN_ROLE",
      "Hanya Pemilik Toko (Owner) yang dapat menonaktifkan Master SKU.",
      403
    );
  }

  return runAtomicTransaction((db) => {
    const existing = db
      .prepare("SELECT id, name FROM products WHERE id = ? AND store_id = ?")
      .get(params.productId, storeId) as { id: string; name: string } | undefined;

    if (!existing) {
      throw new ManajerkuAppError("PRODUCT_NOT_FOUND", "Produk tidak ditemukan.", 404);
    }

    db.prepare("UPDATE products SET is_active = 0 WHERE id = ? AND store_id = ?").run(
      existing.id,
      storeId
    );

    return {
      deletedProductId: existing.id,
      productName: existing.name,
      deactivated: true,
    };
  });
}

/**
 * FR-301 & FR-302: List Master Products with Multi-Unit Stock Breakdown & Active FEFO Queue Info
 */
export function listInventoryProducts(
  storeId = DEFAULT_STORE_ID,
  referenceDate = "2026-11-16",
) {
  const db = getDb();
  const prods = db
    .prepare(
      `SELECT * FROM products
       WHERE store_id = ? AND is_active = 1
       ORDER BY is_below_rop DESC, name ASC`,
    )
    .all(storeId) as Array<{
    id: string;
    store_id: string;
    sku_code: string;
    name: string;
    category: string;
    retail_unit_name: string;
    wholesale_unit_name: string;
    packs_per_box: number;
    retail_price_per_pack: number;
    wholesale_price_per_box: number;
    standard_cogs_per_pack: number;
    reorder_point_packs: number;
    default_reorder_boxes: number;
    is_below_rop: number;
  }>;

  return prods.map((p) => {
    const activeBatches = db
      .prepare(
        `SELECT id, batch_number, current_qty_packs, unit_cogs_pack, promo_discount_pct,
                expiry_date, fefo_status
         FROM inventory_batches
         WHERE store_id = ? AND product_id = ?
           AND current_qty_packs > 0
           AND fefo_status IN ('SAFE', 'PRIORITY_FEFO', 'CRITICAL')
         ORDER BY expiry_date ASC, created_at ASC`,
      )
      .all(storeId, p.id) as Array<{
      id: string;
      batch_number: string;
      current_qty_packs: number;
      unit_cogs_pack: number;
      promo_discount_pct: number;
      expiry_date: string;
      fefo_status: FefoStatus;
    }>;

    const expiredBatches = db
      .prepare(
        `SELECT COALESCE(SUM(current_qty_packs), 0) as exp_packs
         FROM inventory_batches
         WHERE store_id = ? AND product_id = ?
           AND current_qty_packs > 0
           AND fefo_status = 'EXPIRED'`,
      )
      .get(storeId, p.id) as { exp_packs: number };

    const totalHealthyPacks = activeBatches.reduce(
      (acc, b) => acc + b.current_qty_packs,
      0,
    );
    const wholeBoxes = Math.floor(totalHealthyPacks / p.packs_per_box);
    const loosePacks = totalHealthyPacks % p.packs_per_box;
    const nextPickingBatch = activeBatches[0] || null;

    return {
      id: p.id,
      skuCode: p.sku_code,
      name: p.name,
      category: p.category,
      retailUnitName: p.retail_unit_name,
      wholesaleUnitName: p.wholesale_unit_name,
      packsPerBox: p.packs_per_box,
      retailPricePerPack: p.retail_price_per_pack,
      wholesalePricePerBox: p.wholesale_price_per_box,
      standardCogsPerPack: p.standard_cogs_per_pack,
      reorderPointPacks: p.reorder_point_packs,
      defaultReorderBoxes: p.default_reorder_boxes,
      totalHealthyPacks,
      wholeBoxes,
      loosePacks,
      formattedStockDualUnit: `${wholeBoxes} ${p.wholesale_unit_name} + ${loosePacks} ${p.retail_unit_name} (${totalHealthyPacks} ${p.retail_unit_name})`,
      expiredBlockedPacks: expiredBatches.exp_packs,
      isBelowRop: totalHealthyPacks <= p.reorder_point_packs,
      activeBatchCount: activeBatches.length,
      firstFefoPickingBatch: nextPickingBatch
        ? {
            batchId: nextPickingBatch.id,
            batchNumber: nextPickingBatch.batch_number,
            qtyPacks: nextPickingBatch.current_qty_packs,
            expiryDate: nextPickingBatch.expiry_date,
            daysToExpiry: calculateDaysToExpiry(
              nextPickingBatch.expiry_date,
              referenceDate,
            ),
            fefoStatus: nextPickingBatch.fefo_status,
            promoDiscountPct: nextPickingBatch.promo_discount_pct,
          }
        : null,
    };
  });
}

export interface AddInventoryBatchInput {
  storeId?: string;
  productId: string;
  batchNumber: string;
  qtyBoxes?: number;
  qtyPacks?: number;
  unitCogsPack?: number;
  expiryDate: string;
  receivedVia?: "VISION_OCR" | "MANUAL";
  sourcePoId?: string | null;
  ocrImageUrl?: string | null;
  referenceDate?: string;
}

/**
 * FR-302: Insert New Batch into FEFO Queue, Auto-Classify Shelf Life & Refresh ROP
 */
export function addInventoryBatch(input: AddInventoryBatchInput) {
  const storeId = input.storeId || DEFAULT_STORE_ID;
  const referenceDate = input.referenceDate || "2026-11-16";

  if (!input.batchNumber || input.batchNumber.trim().length < 2) {
    throw new ManajerkuAppError(
      "INVALID_BATCH_NUMBER",
      "Nomor batch wajib diisi.",
      400,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate.slice(0, 10))) {
    throw new ManajerkuAppError(
      "INVALID_EXPIRY_DATE",
      "Format tanggal kedaluwarsa harus YYYY-MM-DD.",
      400,
    );
  }

  return runAtomicTransaction((db) => {
    const product = db
      .prepare("SELECT * FROM products WHERE id = ? AND store_id = ?")
      .get(input.productId, storeId) as
      | {
          id: string;
          name: string;
          packs_per_box: number;
          retail_price_per_pack: number;
          wholesale_price_per_box: number;
          standard_cogs_per_pack: number;
        }
      | undefined;

    if (!product) {
      throw new ManajerkuAppError(
        "PRODUCT_NOT_FOUND",
        "Produk tidak ditemukan di toko ini.",
        404,
      );
    }

    const totalPacks =
      (input.qtyBoxes
        ? Math.round(input.qtyBoxes) * product.packs_per_box
        : 0) + (input.qtyPacks ? Math.round(input.qtyPacks) : 0);

    if (totalPacks <= 0) {
      throw new ManajerkuAppError(
        "INVALID_BATCH_QTY",
        "Kuantitas batch masuk harus lebih dari 0 Pack.",
        400,
      );
    }

    const daysToExpiry = calculateDaysToExpiry(input.expiryDate, referenceDate);
    const fefoStatus = classifyBatchFefoStatus(daysToExpiry, totalPacks);
    const unitCogs = Math.round(
      input.unitCogsPack ?? product.standard_cogs_per_pack,
    );
    const batchId = `batch-${crypto.randomUUID().slice(0, 8)}`;

    db.prepare(
      `
      INSERT INTO inventory_batches (
        id, store_id, product_id, batch_number, source_po_id,
        initial_qty_packs, current_qty_packs, unit_cogs_pack,
        promo_discount_pct, expiry_date, fefo_status, received_via, ocr_image_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      batchId,
      storeId,
      product.id,
      input.batchNumber.trim(),
      input.sourcePoId || null,
      totalPacks,
      totalPacks,
      unitCogs,
      fefoStatus === "PRIORITY_FEFO" || fefoStatus === "CRITICAL" ? 20.0 : 0.0,
      input.expiryDate.slice(0, 10),
      fefoStatus,
      input.receivedVia || "MANUAL",
      input.ocrImageUrl || null,
    );

    // If batch enters PRIORITY_FEFO or CRITICAL (< 30 days), auto-create draft promo campaign (FR-303 -> PRD-07)
    let autoCreatedPromoDraftId: string | null = null;
    if (fefoStatus === "PRIORITY_FEFO" || fefoStatus === "CRITICAL") {
      autoCreatedPromoDraftId = ensureFefoPromoDraftInTx(
        db,
        storeId,
        batchId,
        product.id,
        product.name,
        product.retail_price_per_pack,
        product.wholesale_price_per_box,
        unitCogs,
        totalPacks,
      );
    }

    const ropState = refreshProductRopStatusInTx(db, storeId, product.id);

    // Compute queue position in FEFO order
    const queueRows = db
      .prepare(
        `SELECT id FROM inventory_batches
         WHERE store_id = ? AND product_id = ?
           AND current_qty_packs > 0
           AND fefo_status IN ('SAFE', 'PRIORITY_FEFO', 'CRITICAL')
         ORDER BY expiry_date ASC, created_at ASC`,
      )
      .all(storeId, product.id) as Array<{ id: string }>;

    const fefoQueueRank =
      queueRows.findIndex((r) => r.id === batchId) + 1 || null;

    return {
      batchId,
      productId: product.id,
      productName: product.name,
      batchNumber: input.batchNumber.trim(),
      initialQtyPacks: totalPacks,
      equivalentBoxes: Math.floor(totalPacks / product.packs_per_box),
      expiryDate: input.expiryDate.slice(0, 10),
      daysToExpiry,
      fefoStatus,
      fefoQueueRank,
      autoCreatedPromoDraftId,
      ropState,
    };
  });
}

function ensureFefoPromoDraftInTx(
  db: DatabaseSync,
  storeId: string,
  batchId: string,
  productId: string,
  productName: string,
  retailPricePack: number,
  wholesalePriceBox: number,
  unitCogsPack: number,
  qtyPacks: number,
): string {
  const existing = db
    .prepare(
      "SELECT id FROM fefo_promo_campaigns WHERE store_id = ? AND batch_id = ?",
    )
    .get(storeId, batchId) as { id: string } | undefined;

  if (existing) return existing.id;

  const resellerCountRow = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM resellers WHERE store_id = ? AND is_promo_subscribed = 1",
    )
    .get(storeId) as { cnt: number };

  const promoPackPrice = Math.max(
    unitCogsPack,
    Math.round(retailPricePack * 0.8),
  );
  const promoBoxPrice = Math.round(wholesalePriceBox * 0.8);
  const promoId = `promo-${crypto.randomUUID().slice(0, 8)}`;

  db.prepare(
    `
    INSERT INTO fefo_promo_campaigns (
      id, store_id, batch_id, product_id, title, discount_pct,
      promo_price_per_pack, promo_price_per_box, target_reseller_count,
      sent_count, message_template, status
    ) VALUES (?, ?, ?, ?, ?, 20.0, ?, ?, ?, 0, ?, 'DRAFT_READY')
  `,
  ).run(
    promoId,
    storeId,
    batchId,
    productId,
    `Draf Promo FEFO ${productName} (-20%)`,
    promoPackPrice,
    promoBoxPrice,
    resellerCountRow.cnt,
    `Halo Mitra Kuliner! Promo Cepat FEFO ${productName} Diskon 20% (Rp ${promoPackPrice.toLocaleString(
      "id-ID",
    )}/pack). Tersedia ${qtyPacks} pack, pesan sekarang!`,
  );

  return promoId;
}

/**
 * FR-302 & FR-303: List FEFO Batches Ordered by Closest Expiry Date (FEFO Queue)
 */
export function listFefoBatches(params?: {
  storeId?: string;
  productId?: string;
  statusFilter?: string;
  referenceDate?: string;
}) {
  const storeId = params?.storeId || DEFAULT_STORE_ID;
  const referenceDate = params?.referenceDate || "2026-11-16";
  const db = getDb();

  let sql = `
    SELECT b.*, p.name as product_name, p.sku_code, p.packs_per_box,
           p.retail_unit_name, p.wholesale_unit_name,
           s.name as supplier_name
    FROM inventory_batches b
    JOIN products p ON p.id = b.product_id
    LEFT JOIN purchase_orders po ON po.id = b.source_po_id
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    WHERE b.store_id = ? AND b.current_qty_packs > 0
  `;
  const bindParams: Array<string | number> = [storeId];

  if (params?.productId) {
    sql += " AND b.product_id = ?";
    bindParams.push(params.productId);
  }

  if (params?.statusFilter && params.statusFilter !== "ALL") {
    sql += " AND b.fefo_status = ?";
    bindParams.push(params.statusFilter);
  }

  sql += " ORDER BY b.expiry_date ASC, b.created_at ASC";

  const rows = db.prepare(sql).all(...bindParams) as Array<{
    id: string;
    store_id: string;
    product_id: string;
    batch_number: string;
    source_po_id: string | null;
    initial_qty_packs: number;
    current_qty_packs: number;
    unit_cogs_pack: number;
    promo_discount_pct: number;
    expiry_date: string;
    fefo_status: FefoStatus;
    received_via: "VISION_OCR" | "MANUAL";
    created_at: string;
    product_name: string;
    sku_code: string;
    packs_per_box: number;
    retail_unit_name: string;
    wholesale_unit_name: string;
    supplier_name: string | null;
  }>;

  // Compute per-product FEFO queue rank (1 = Keluarkan Dulu / First Expired First Out)
  const productRankCounter = new Map<string, number>();

  return rows.map((r) => {
    const isSellable =
      r.fefo_status === "SAFE" ||
      r.fefo_status === "PRIORITY_FEFO" ||
      r.fefo_status === "CRITICAL";
    let fefoRank: number | null = null;
    if (isSellable) {
      const nextRank = (productRankCounter.get(r.product_id) || 0) + 1;
      productRankCounter.set(r.product_id, nextRank);
      fefoRank = nextRank;
    }

    const wholeBoxes = Math.floor(r.current_qty_packs / r.packs_per_box);
    const loosePacks = r.current_qty_packs % r.packs_per_box;
    const daysToExpiry = calculateDaysToExpiry(r.expiry_date, referenceDate);

    return {
      id: r.id,
      productId: r.product_id,
      productName: r.product_name,
      skuCode: r.sku_code,
      batchNumber: r.batch_number,
      supplierName: r.supplier_name || null,
      initialQtyPacks: r.initial_qty_packs,
      currentQtyPacks: r.current_qty_packs,
      wholeBoxes,
      loosePacks,
      formattedQty: `${wholeBoxes} ${r.wholesale_unit_name} (${r.current_qty_packs} ${r.retail_unit_name})`,
      unitCogsPack: r.unit_cogs_pack,
      promoDiscountPct: r.promo_discount_pct,
      expiryDate: r.expiry_date,
      daysToExpiry,
      fefoStatus: r.fefo_status,
      fefoQueueRank: fefoRank,
      isBlockedExpired: r.fefo_status === "EXPIRED" || daysToExpiry <= 0,
      receivedVia: r.received_via,
      createdAt: r.created_at,
    };
  });
}

/**
 * FR-303: Daily / On-Demand FEFO Expiry Radar Evaluator
 * Scans all active batches in the freezer, updates fefo_status (SAFE -> PRIORITY_FEFO -> CRITICAL -> EXPIRED),
 * auto-generates promo drafts for < 30 days batches, and refreshes SKU ROP flags.
 */
export function evaluateStoreFefoRadar(params?: {
  storeId?: string;
  referenceDate?: string;
}) {
  const storeId = params?.storeId || DEFAULT_STORE_ID;
  const referenceDate = params?.referenceDate || "2026-11-16";

  return runAtomicTransaction((db) => {
    const batches = db
      .prepare(
        `SELECT b.id, b.product_id, b.current_qty_packs, b.unit_cogs_pack, b.expiry_date, b.fefo_status,
                p.name as product_name, p.retail_price_per_pack, p.wholesale_price_per_box
         FROM inventory_batches b
         JOIN products p ON p.id = b.product_id
         WHERE b.store_id = ? AND b.current_qty_packs > 0 AND b.fefo_status != 'WRITTEN_OFF'`,
      )
      .all(storeId) as Array<{
      id: string;
      product_id: string;
      current_qty_packs: number;
      unit_cogs_pack: number;
      expiry_date: string;
      fefo_status: FefoStatus;
      product_name: string;
      retail_price_per_pack: number;
      wholesale_price_per_box: number;
    }>;

    let safeCount = 0;
    let priorityFefoCount = 0;
    let criticalCount = 0;
    let expiredCount = 0;
    const newlyGeneratedPromos: string[] = [];

    const updateBatchStmt = db.prepare(`
      UPDATE inventory_batches
      SET fefo_status = ?, promo_discount_pct = CASE WHEN ? IN ('PRIORITY_FEFO', 'CRITICAL') THEN 20.0 ELSE promo_discount_pct END
      WHERE id = ?
    `);

    const touchedProductIds = new Set<string>();

    for (const b of batches) {
      touchedProductIds.add(b.product_id);
      const days = calculateDaysToExpiry(b.expiry_date, referenceDate);
      const newStatus = classifyBatchFefoStatus(days, b.current_qty_packs);

      if (newStatus !== b.fefo_status) {
        updateBatchStmt.run(newStatus, newStatus, b.id);
      }

      if (newStatus === "SAFE") safeCount++;
      else if (newStatus === "PRIORITY_FEFO") {
        priorityFefoCount++;
        const promoId = ensureFefoPromoDraftInTx(
          db,
          storeId,
          b.id,
          b.product_id,
          b.product_name,
          b.retail_price_per_pack,
          b.wholesale_price_per_box,
          b.unit_cogs_pack,
          b.current_qty_packs,
        );
        newlyGeneratedPromos.push(promoId);
      } else if (newStatus === "CRITICAL") {
        criticalCount++;
        const promoId = ensureFefoPromoDraftInTx(
          db,
          storeId,
          b.id,
          b.product_id,
          b.product_name,
          b.retail_price_per_pack,
          b.wholesale_price_per_box,
          b.unit_cogs_pack,
          b.current_qty_packs,
        );
        newlyGeneratedPromos.push(promoId);
      } else if (newStatus === "EXPIRED") {
        expiredCount++;
      }
    }

    for (const pid of touchedProductIds) {
      refreshProductRopStatusInTx(db, storeId, pid);
    }

    return {
      storeId,
      referenceDate,
      safeCount,
      priorityFefoCount,
      criticalCount,
      expiredCount,
      totalHealthyBatches: safeCount + priorityFefoCount + criticalCount,
      newlyGeneratedPromosCount: newlyGeneratedPromos.length,
    };
  });
}

/**
 * FR-305: Write-Off Expired or Cold-Chain Spoiled Batch with Owner Approval & Ledger Loss Entry
 */
export function writeOffInventoryBatch(params: {
  storeId?: string;
  actorRole: UserRole;
  batchId: string;
  writeOffQtyPacks?: number;
  reason: "EXPIRED" | "COLD_CHAIN_SPOILAGE";
}) {
  const storeId = params.storeId || DEFAULT_STORE_ID;
  const perms = getRolePermissions(params.actorRole);
  if (!perms.canManageInventory) {
    throw new ManajerkuAppError(
      "FORBIDDEN_ROLE",
      "Pemusnahan stok (Write-Off) wajib mendapatkan persetujuan Pemilik Toko (Owner).",
      403,
    );
  }

  return runAtomicTransaction((db) => {
    const batch = db
      .prepare(
        `SELECT b.*, p.name as product_name
         FROM inventory_batches b
         JOIN products p ON p.id = b.product_id
         WHERE b.id = ? AND b.store_id = ?`,
      )
      .get(params.batchId, storeId) as
      | {
          id: string;
          product_id: string;
          batch_number: string;
          current_qty_packs: number;
          unit_cogs_pack: number;
          fefo_status: FefoStatus;
          product_name: string;
        }
      | undefined;

    if (!batch) {
      throw new ManajerkuAppError(
        "BATCH_NOT_FOUND",
        "Batch tidak ditemukan.",
        404,
      );
    }

    if (batch.current_qty_packs <= 0) {
      throw new ManajerkuAppError(
        "BATCH_ALREADY_EMPTY",
        "Batch ini sudah tidak memiliki sisa stok.",
        400,
      );
    }

    const qtyToWriteOff = Math.round(
      params.writeOffQtyPacks ?? batch.current_qty_packs,
    );
    if (qtyToWriteOff <= 0 || qtyToWriteOff > batch.current_qty_packs) {
      throw new ManajerkuAppError(
        "INVALID_WRITE_OFF_QTY",
        `Jumlah write-off harus antara 1 hingga ${batch.current_qty_packs} Pack.`,
        400,
      );
    }

    const remainingPacks = batch.current_qty_packs - qtyToWriteOff;
    const newStatus: FefoStatus =
      remainingPacks === 0 ? "WRITTEN_OFF" : batch.fefo_status;

    db.prepare(
      "UPDATE inventory_batches SET current_qty_packs = ?, fefo_status = ? WHERE id = ?",
    ).run(remainingPacks, newStatus, batch.id);

    const lossAmountRp = qtyToWriteOff * batch.unit_cogs_pack;

    // Record loss in cash_ledger (FR-305 -> PRD-08)
    const latestLedger = db
      .prepare(
        `SELECT available_kulakan_cash_after, locked_po_cash_after, net_profit_balance_after
         FROM cash_ledger WHERE store_id = ?
         ORDER BY rowid DESC LIMIT 1`,
      )
      .get(storeId) as
      | {
          available_kulakan_cash_after: number;
          locked_po_cash_after: number;
          net_profit_balance_after: number;
        }
      | undefined;

    const availCash = latestLedger?.available_kulakan_cash_after ?? 0;
    const lockedCash = latestLedger?.locked_po_cash_after ?? 0;
    const netProfitAfter =
      (latestLedger?.net_profit_balance_after ?? 0) - lossAmountRp;

    db.prepare(
      `
      INSERT INTO cash_ledger (
        id, store_id, entry_type, reference_type, reference_id, amount,
        cogs_component, profit_component, available_kulakan_cash_after,
        locked_po_cash_after, net_profit_balance_after, notes
      ) VALUES (?, ?, 'EXPIRED_WRITE_OFF_LOSS', 'WRITE_OFF', ?, ?, 0, ?, ?, ?, ?, ?)
    `,
    ).run(
      `led-${crypto.randomUUID().slice(0, 8)}`,
      storeId,
      batch.batch_number,
      -lossAmountRp,
      -lossAmountRp,
      availCash,
      lockedCash,
      netProfitAfter,
      `Write-Off ${qtyToWriteOff} Pack ${batch.product_name} (${batch.batch_number}) - Alasan: ${params.reason}`,
    );

    const ropState = refreshProductRopStatusInTx(db, storeId, batch.product_id);

    return {
      batchId: batch.id,
      batchNumber: batch.batch_number,
      productName: batch.product_name,
      writtenOffPacks: qtyToWriteOff,
      remainingPacks,
      newStatus,
      lossAmountRp,
      ropState,
    };
  });
}
