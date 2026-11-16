import crypto from "node:crypto";
import { getDb, runAtomicTransaction } from "../db/client.ts";
import { DEFAULT_CASHIER_ID, DEFAULT_STORE_ID } from "../db/seed.ts";
import {
  listInventoryProducts,
  refreshProductRopStatusInTx,
  type FefoStatus,
} from "./fefo-inventory.ts";
import {
  getRolePermissions,
  ManajerkuAppError,
  type UserRole,
} from "./platform-core.ts";

export interface PosCartItemInput {
  productId: string;
  soldUnitType: "PACK" | "BOX";
  soldQty: number;
}

export interface PosCheckoutInput {
  storeId?: string;
  actorRole?: UserRole;
  cashierUserId?: string;
  cashierLabel?: string;
  resellerId?: string | null;
  customerName?: string;
  serviceType?: "TAKEAWAY_PICKUP" | "DELIVERY";
  paymentMethod: "CASH" | "QRIS";
  cashReceived?: number;
  items: PosCartItemInput[];
  transactionDate?: string;
}

export interface BatchAllocationRecord {
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  packsDeducted: number;
  unitCogsPack: number;
  promoDiscountPct: number;
}

/**
 * FR-201 & FR-202: Retrieve POS Catalog (Multi-Unit Products + Registered Resellers)
 */
export function getPosCatalog(
  storeId = DEFAULT_STORE_ID,
  referenceDate = "2026-11-16"
) {
  const db = getDb();
  const products = listInventoryProducts(storeId, referenceDate);
  const resellers = db
    .prepare(
      `SELECT id, business_name, contact_name, phone_whatsapp, culinary_segment
       FROM resellers WHERE store_id = ? ORDER BY business_name ASC`
    )
    .all(storeId) as Array<{
    id: string;
    business_name: string;
    contact_name: string;
    phone_whatsapp: string;
    culinary_segment: string;
  }>;

  return {
    products,
    resellers: resellers.map((r) => ({
      id: r.id,
      businessName: r.business_name,
      contactName: r.contact_name,
      phoneWhatsapp: r.phone_whatsapp,
      culinarySegment: r.culinary_segment,
    })),
  };
}

/**
 * FR-203 & FR-204: Atomic Multi-Unit POS Checkout, FEFO Multi-Batch Deduction,
 * Separated Cash Ledger Recording, and Automatic ROP Procurement Trigger.
 */
export function executePosCheckout(input: PosCheckoutInput) {
  const storeId = input.storeId || DEFAULT_STORE_ID;
  const actorRole = input.actorRole || "CASHIER";
  const perms = getRolePermissions(actorRole);
  if (!perms.canOperatePos) {
    throw new ManajerkuAppError(
      "FORBIDDEN_ROLE",
      "Anda tidak memiliki izin untuk mengoperasikan Kasir POS.",
      403
    );
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ManajerkuAppError(
      "EMPTY_CART",
      "Keranjang belanja kasir tidak boleh kosong.",
      400
    );
  }

  if (input.paymentMethod !== "CASH" && input.paymentMethod !== "QRIS") {
    throw new ManajerkuAppError(
      "INVALID_PAYMENT_METHOD",
      "Metode pembayaran harus CASH (Tunai) atau QRIS.",
      400
    );
  }

  return runAtomicTransaction((db) => {
    // 1. Resolve Customer / Reseller identity (FR-202)
    let customerName = (input.customerName || "Pelanggan Umum").trim();
    let customerTypeLabel = "Walk-in Eceran";
    let resellerId: string | null = null;

    if (input.resellerId) {
      const reseller = db
        .prepare(
          "SELECT id, business_name FROM resellers WHERE id = ? AND store_id = ?"
        )
        .get(input.resellerId, storeId) as
        | { id: string; business_name: string }
        | undefined;

      if (reseller) {
        resellerId = reseller.id;
        customerName = reseller.business_name;
        customerTypeLabel = "Reseller Terdaftar";
      }
    }

    // 2. First pass: validate items & check total required packs per product
    const requiredPacksByProduct = new Map<string, number>();
    const productCache = new Map<
      string,
      {
        id: string;
        sku_code: string;
        name: string;
        retail_unit_name: string;
        wholesale_unit_name: string;
        packs_per_box: number;
        retail_price_per_pack: number;
        wholesale_price_per_box: number;
        reorder_point_packs: number;
        default_reorder_boxes: number;
      }
    >();

    for (const item of input.items) {
      if (!Number.isInteger(item.soldQty) || item.soldQty <= 0) {
        throw new ManajerkuAppError(
          "INVALID_ITEM_QTY",
          "Kuantitas item harus berupa bilangan bulat lebih dari 0.",
          400
        );
      }
      if (item.soldUnitType !== "PACK" && item.soldUnitType !== "BOX") {
        throw new ManajerkuAppError(
          "INVALID_UNIT_TYPE",
          "Satuan penjualan harus PACK (Bungkus) atau BOX (Dus).",
          400
        );
      }

      let prod = productCache.get(item.productId);
      if (!prod) {
        prod = db
          .prepare(
            "SELECT * FROM products WHERE id = ? AND store_id = ? AND is_active = 1"
          )
          .get(item.productId, storeId) as
          | {
              id: string;
              sku_code: string;
              name: string;
              retail_unit_name: string;
              wholesale_unit_name: string;
              packs_per_box: number;
              retail_price_per_pack: number;
              wholesale_price_per_box: number;
              reorder_point_packs: number;
              default_reorder_boxes: number;
            }
          | undefined;

        if (!prod) {
          throw new ManajerkuAppError(
            "PRODUCT_NOT_FOUND",
            `Produk dengan ID "${item.productId}" tidak ditemukan.`,
            404
          );
        }
        productCache.set(item.productId, prod);
      }

      const packsNeeded =
        item.soldUnitType === "BOX"
          ? item.soldQty * prod.packs_per_box
          : item.soldQty;

      requiredPacksByProduct.set(
        prod.id,
        (requiredPacksByProduct.get(prod.id) || 0) + packsNeeded
      );
    }

    // 3. Validate healthy stock availability before mutating (US-201 Scenario 2)
    for (const [productId, totalPacksNeeded] of requiredPacksByProduct.entries()) {
      const prod = productCache.get(productId)!;
      const healthyRow = db
        .prepare(
          `SELECT COALESCE(SUM(current_qty_packs), 0) as healthy_packs
           FROM inventory_batches
           WHERE store_id = ? AND product_id = ?
             AND current_qty_packs > 0
             AND fefo_status IN ('SAFE', 'PRIORITY_FEFO', 'CRITICAL')`
        )
        .get(storeId, productId) as { healthy_packs: number };

      if (healthyRow.healthy_packs < totalPacksNeeded) {
        const expiredRow = db
          .prepare(
            `SELECT COALESCE(SUM(current_qty_packs), 0) as exp_packs
             FROM inventory_batches
             WHERE store_id = ? AND product_id = ?
               AND current_qty_packs > 0
               AND fefo_status = 'EXPIRED'`
          )
          .get(storeId, productId) as { exp_packs: number };

        if (expiredRow.exp_packs > 0 && healthyRow.healthy_packs === 0) {
          throw new ManajerkuAppError(
            "EXPIRED_STOCK_BLOCKED",
            `Stok sehat ${prod.name} habis. Terdapat ${expiredRow.exp_packs} Pack pada batch yang telah melewati tanggal kedaluwarsa dan diblokir dari penjualan.`,
            409
          );
        }

        throw new ManajerkuAppError(
          "INSUFFICIENT_HEALTHY_STOCK",
          `Stok sehat ${prod.name} tidak mencukupi. Dibutuhkan ${totalPacksNeeded} Pack, tersedia ${healthyRow.healthy_packs} Pack.`,
          409
        );
      }
    }

    // 4. Deduct FEFO Batches sequentially per line item (BL-001 & BL-002)
    let totalInvoiceAmount = 0;
    let totalInvoiceDiscount = 0;
    let totalInvoiceCogs = 0;
    const summaryParts: string[] = [];

    const processedItems: Array<{
      id: string;
      productId: string;
      productName: string;
      soldUnitType: "PACK" | "BOX";
      soldQty: number;
      deductedPacksQty: number;
      unitSellingPrice: number;
      discountAmount: number;
      subtotalAmount: number;
      cogsAmount: number;
      batchAllocations: BatchAllocationRecord[];
    }> = [];

    const updateBatchStmt = db.prepare(`
      UPDATE inventory_batches
      SET current_qty_packs = ?, fefo_status = ?
      WHERE id = ?
    `);

    for (const item of input.items) {
      const prod = productCache.get(item.productId)!;
      const deductedPacksQty =
        item.soldUnitType === "BOX"
          ? item.soldQty * prod.packs_per_box
          : item.soldQty;

      // Fetch available healthy batches in strict FEFO order
      const candidateBatches = db
        .prepare(
          `SELECT id, batch_number, current_qty_packs, unit_cogs_pack, promo_discount_pct, expiry_date, fefo_status
           FROM inventory_batches
           WHERE store_id = ? AND product_id = ?
             AND current_qty_packs > 0
             AND fefo_status IN ('SAFE', 'PRIORITY_FEFO', 'CRITICAL')
           ORDER BY expiry_date ASC, created_at ASC`
        )
        .all(storeId, prod.id) as Array<{
        id: string;
        batch_number: string;
        current_qty_packs: number;
        unit_cogs_pack: number;
        promo_discount_pct: number;
        expiry_date: string;
        fefo_status: FefoStatus;
      }>;

      let remainingToDeduct = deductedPacksQty;
      let itemCogs = 0;
      let weightedPromoPctSum = 0;
      const allocations: BatchAllocationRecord[] = [];

      for (const batch of candidateBatches) {
        if (remainingToDeduct <= 0) break;
        const takePacks = Math.min(batch.current_qty_packs, remainingToDeduct);
        const newBatchQty = batch.current_qty_packs - takePacks;
        const newBatchStatus: FefoStatus =
          newBatchQty === 0 ? "DEPLETED" : batch.fefo_status;

        updateBatchStmt.run(newBatchQty, newBatchStatus, batch.id);

        // If batch depleted, mark any active promo campaign for this batch as COMPLETED_SOLD_OUT (US-701 Scenario 2)
        if (newBatchQty === 0) {
          db.prepare(
            `UPDATE fefo_promo_campaigns
             SET status = 'COMPLETED_SOLD_OUT'
             WHERE store_id = ? AND batch_id = ? AND status IN ('DRAFT_READY', 'ACTIVE_SENT')`
          ).run(storeId, batch.id);
        }

        remainingToDeduct -= takePacks;
        itemCogs += takePacks * batch.unit_cogs_pack;
        weightedPromoPctSum += takePacks * (batch.promo_discount_pct || 0);

        allocations.push({
          batchId: batch.id,
          batchNumber: batch.batch_number,
          expiryDate: batch.expiry_date,
          packsDeducted: takePacks,
          unitCogsPack: batch.unit_cogs_pack,
          promoDiscountPct: batch.promo_discount_pct || 0,
        });
      }

      const unitSellingPrice =
        item.soldUnitType === "BOX"
          ? prod.wholesale_price_per_box
          : prod.retail_price_per_pack;
      const grossLineAmount = unitSellingPrice * item.soldQty;

      // Apply FEFO promo discount if applicable
      const avgPromoPct = weightedPromoPctSum / deductedPacksQty;
      const lineDiscount =
        avgPromoPct > 0 ? Math.round(grossLineAmount * (avgPromoPct / 100)) : 0;
      const subtotalAmount = grossLineAmount - lineDiscount;

      totalInvoiceAmount += subtotalAmount;
      totalInvoiceDiscount += lineDiscount;
      totalInvoiceCogs += itemCogs;

      const unitLabel =
        item.soldUnitType === "BOX"
          ? prod.wholesale_unit_name
          : prod.retail_unit_name;
      summaryParts.push(`${item.soldQty} ${unitLabel} ${prod.name.split(" ")[0]}`);

      processedItems.push({
        id: `pos-item-${crypto.randomUUID().slice(0, 8)}`,
        productId: prod.id,
        productName: prod.name,
        soldUnitType: item.soldUnitType,
        soldQty: item.soldQty,
        deductedPacksQty,
        unitSellingPrice,
        discountAmount: lineDiscount,
        subtotalAmount,
        cogsAmount: itemCogs,
        batchAllocations: allocations,
      });
    }

    // 5. Validate Cash Received if paymentMethod === 'CASH'
    const cashReceived =
      input.paymentMethod === "CASH"
        ? Math.round(input.cashReceived ?? totalInvoiceAmount)
        : totalInvoiceAmount;

    if (input.paymentMethod === "CASH" && cashReceived < totalInvoiceAmount) {
      throw new ManajerkuAppError(
        "INSUFFICIENT_CASH_PAYMENT",
        `Uang tunai diterima (Rp ${cashReceived.toLocaleString(
          "id-ID"
        )}) kurang dari total tagihan (Rp ${totalInvoiceAmount.toLocaleString(
          "id-ID"
        )}).`,
        400
      );
    }

    const changeAmount =
      input.paymentMethod === "CASH" ? cashReceived - totalInvoiceAmount : 0;
    const grossProfit = totalInvoiceAmount - totalInvoiceCogs;

    // 6. Generate Globally Unique Invoice Number (#INV-2611-XX)
    const countRow = db
      .prepare("SELECT COUNT(*) as cnt FROM pos_transactions WHERE store_id = ?")
      .get(storeId) as { cnt: number };
    let nextSeq =
      storeId === DEFAULT_STORE_ID ? 49 + countRow.cnt : 1 + countRow.cnt;
    let invoiceNumber = `#INV-2611-${nextSeq.toString().padStart(2, "0")}`;
    const checkInvExistsStmt = db.prepare(
      "SELECT 1 FROM pos_transactions WHERE invoice_number = ?"
    );
    while (checkInvExistsStmt.get(invoiceNumber)) {
      nextSeq++;
      invoiceNumber = `#INV-2611-${nextSeq.toString().padStart(2, "0")}`;
    }

    const storeInfo = db
      .prepare("SELECT name, branch_name, address FROM stores WHERE id = ?")
      .get(storeId) as
      | { name: string; branch_name: string; address: string }
      | undefined;

    const storeUser = db
      .prepare(
        "SELECT id, full_name, phone_whatsapp FROM users WHERE store_id = ? ORDER BY CASE WHEN role = 'OWNER' THEN 0 ELSE 1 END LIMIT 1"
      )
      .get(storeId) as
      | { id: string; full_name: string; phone_whatsapp: string }
      | undefined;
    const resolvedCashierUserId =
      input.cashierUserId || storeUser?.id || DEFAULT_CASHIER_ID;
    const resolvedCashierLabel =
      storeUser?.full_name || input.cashierLabel || "Kasir 01";

    const posTxId = `inv-${crypto.randomUUID().slice(0, 8)}`;
    const itemsSummaryText = summaryParts.join(" + ");

    db.prepare(`
      INSERT INTO pos_transactions (
        id, store_id, invoice_number, cashier_user_id, cashier_label,
        reseller_id, customer_name_snapshot, customer_type_label, service_type,
        payment_method, payment_status, items_summary_text,
        total_amount, total_discount, total_cogs, gross_profit,
        cash_received, change_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAID', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      posTxId,
      storeId,
      invoiceNumber,
      resolvedCashierUserId,
      resolvedCashierLabel,
      resellerId,
      customerName,
      customerTypeLabel,
      input.serviceType || "TAKEAWAY_PICKUP",
      input.paymentMethod,
      itemsSummaryText,
      totalInvoiceAmount,
      totalInvoiceDiscount,
      totalInvoiceCogs,
      grossProfit,
      cashReceived,
      changeAmount
    );

    const insertItemStmt = db.prepare(`
      INSERT INTO pos_transaction_items (
        id, pos_transaction_id, product_id, product_name_snapshot,
        sold_unit_type, sold_qty, deducted_packs_qty, unit_selling_price,
        discount_amount, subtotal_amount, cogs_amount, batch_allocations_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const pi of processedItems) {
      insertItemStmt.run(
        pi.id,
        posTxId,
        pi.productId,
        pi.productName,
        pi.soldUnitType,
        pi.soldQty,
        pi.deductedPacksQty,
        pi.unitSellingPrice,
        pi.discountAmount,
        pi.subtotalAmount,
        pi.cogsAmount,
        JSON.stringify(pi.batchAllocations)
      );
    }

    // 7. Update Separated Cash Ledger Atomically (FR-801: HPP returns to Kas Siap Kulakan, Profit to Net Profit)
    const latestLedger = db
      .prepare(
        `SELECT available_kulakan_cash_after, locked_po_cash_after, net_profit_balance_after
         FROM cash_ledger WHERE store_id = ?
         ORDER BY rowid DESC LIMIT 1`
      )
      .get(storeId) as
      | {
          available_kulakan_cash_after: number;
          locked_po_cash_after: number;
          net_profit_balance_after: number;
        }
      | undefined;

    const newAvailableKulakanCash =
      (latestLedger?.available_kulakan_cash_after ?? 0) + totalInvoiceCogs;
    const lockedPoCash = latestLedger?.locked_po_cash_after ?? 0;
    const newNetProfitBalance =
      (latestLedger?.net_profit_balance_after ?? 0) + grossProfit;

    db.prepare(`
      INSERT INTO cash_ledger (
        id, store_id, entry_type, reference_type, reference_id, amount,
        cogs_component, profit_component, available_kulakan_cash_after,
        locked_po_cash_after, net_profit_balance_after, notes
      ) VALUES (?, ?, 'POS_SALE_REVENUE', 'POS_INV', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `led-${crypto.randomUUID().slice(0, 8)}`,
      storeId,
      invoiceNumber,
      totalInvoiceAmount,
      totalInvoiceCogs,
      grossProfit,
      newAvailableKulakanCash,
      lockedPoCash,
      newNetProfitBalance,
      `Penjualan Kasir ${invoiceNumber} (${customerName} - ${input.paymentMethod} Lunas)`
    );

    // Update Today's Financial Snapshot for 7-Day Chart & Daily KPI
    const txDate = (input.transactionDate || "2026-11-16").slice(0, 10);
    const snapUpd = db
      .prepare(`
        UPDATE daily_financial_snapshots
        SET pos_revenue_amount = pos_revenue_amount + ?,
            pos_invoice_count = pos_invoice_count + 1,
            net_profit_amount = net_profit_amount + ?
        WHERE store_id = ? AND snapshot_date = ?
      `)
      .run(totalInvoiceAmount, grossProfit, storeId, txDate);

    if (Number(snapUpd.changes) === 0) {
      const dayNames = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
      const parsedDate = new Date(`${txDate}T00:00:00Z`);
      const dayLabel = Number.isNaN(parsedDate.getTime())
        ? "Min"
        : dayNames[parsedDate.getUTCDay()];
      db.prepare(`
        INSERT INTO daily_financial_snapshots (
          id, store_id, snapshot_date, day_label, pos_revenue_amount,
          po_kulakan_amount, pos_invoice_count, net_profit_amount, freezer_elec_cost
        ) VALUES (?, ?, ?, ?, ?, 0, 1, ?, 0)
      `).run(
        `snap-${storeId}-${txDate.replace(/-/g, "")}`,
        storeId,
        txDate,
        dayLabel,
        totalInvoiceAmount,
        grossProfit
      );
    }

    // 8. FR-204: Post-Transaction ROP Evaluation & Auto-Procurement Trigger
    const triggeredRfqSessions: Array<{
      rfqSessionId: string;
      rfqCode: string;
      productId: string;
      productName: string;
      healthyStockPacks: number;
      reorderPointPacks: number;
    }> = [];

    for (const productId of requiredPacksByProduct.keys()) {
      const prod = productCache.get(productId)!;
      const ropResult = refreshProductRopStatusInTx(db, storeId, productId);

      if (ropResult.isBelowRop) {
        // Check if there is already an open RFQ or active unreceived PO for this product
        const existingOpenRfq = db
          .prepare(
            `SELECT id FROM rfq_sessions
             WHERE store_id = ? AND product_id = ?
               AND status IN ('AWAITING_OWNER_RFQ_APPROVAL', 'NEGOTIATING', 'AWAITING_OWNER_PO_APPROVAL')`
          )
          .get(storeId, productId);

        const existingOpenPo = db
          .prepare(
            `SELECT id FROM purchase_orders
             WHERE store_id = ? AND product_id = ?
               AND status IN ('APPROVED_WA', 'PDF_SENT')`
          )
          .get(storeId, productId);

        if (!existingOpenRfq && !existingOpenPo) {
          // Automatically discover top 3 verified suppliers & prepare Human-in-the-Loop RFQ Session!
          const topSuppliers = db
            .prepare(
              `SELECT id, name, phone_whatsapp, google_rating
               FROM suppliers
               WHERE (store_id = ? OR store_id IS NULL)
                 AND is_whatsapp_active = 1
                 AND google_rating >= 4.5
                 AND distance_km <= 10.0
               ORDER BY is_verified_b2b_partner DESC, google_rating DESC, distance_km ASC
               LIMIT 3`
            )
            .all(storeId) as Array<{
            id: string;
            name: string;
            phone_whatsapp: string;
            google_rating: number;
          }>;

          const rfqId = `rfq-${crypto.randomUUID().slice(0, 8)}`;
          let rfqSeq = Math.floor(10 + Math.random() * 89);
          let rfqCode = `RFQ-2611-${rfqSeq}`;
          const checkRfqStmt = db.prepare(
            "SELECT 1 FROM rfq_sessions WHERE rfq_code = ?"
          );
          while (checkRfqStmt.get(rfqCode)) {
            rfqSeq++;
            rfqCode = `RFQ-2611-${rfqSeq}`;
          }
          const quotesInit = topSuppliers.map((s) => ({
            supplier_id: s.id,
            supplier_name: s.name,
            phone: s.phone_whatsapp,
            rating: s.google_rating,
            slot_price_per_box: null,
            slot_moq_boxes: null,
            slot_batch_expiry_date: null,
            slot_freezer_delivery: null,
            turn_count: 0,
            status: "PENDING_SEND",
          }));

          db.prepare(`
            INSERT INTO rfq_sessions (
              id, store_id, rfq_code, product_id, requested_qty_boxes,
              trigger_source, status, supplier_quotes_json
            ) VALUES (?, ?, ?, ?, ?, 'AUTO_ROP', 'AWAITING_OWNER_RFQ_APPROVAL', ?)
          `).run(
            rfqId,
            storeId,
            rfqCode,
            productId,
            prod.default_reorder_boxes,
            JSON.stringify(quotesInit)
          );

          triggeredRfqSessions.push({
            rfqSessionId: rfqId,
            rfqCode,
            productId,
            productName: prod.name,
            healthyStockPacks: ropResult.healthyStockPacks,
            reorderPointPacks: ropResult.reorderPointPacks,
          });
        }
      }
    }

    return {
      transactionId: posTxId,
      invoiceNumber,
      storeId,
      storeName: storeInfo?.name || "Manajerku Frozen Food",
      storeBranchName: storeInfo?.branch_name || "Cabang Utama",
      storeAddress: storeInfo?.address || "Banda Aceh",
      storePhone: storeUser?.phone_whatsapp || "08116800101",
      cashierName: resolvedCashierLabel,
      createdAtIso: new Date().toISOString(),
      customerName,
      customerTypeLabel,
      paymentMethod: input.paymentMethod,
      paymentStatus: "PAID",
      itemsSummaryText,
      totalAmountRp: totalInvoiceAmount,
      totalDiscountRp: totalInvoiceDiscount,
      totalCogsRp: totalInvoiceCogs,
      grossProfitRp: grossProfit,
      cashReceivedRp: cashReceived,
      changeAmountRp: changeAmount,
      availableKulakanCashAfterRp: newAvailableKulakanCash,
      items: processedItems,
      triggeredRfqSessions,
    };
  });
}

/**
 * FR-205: Retrieve Formatted POS Receipt (#INV-YYMM-XX) for Thermal Printing / WhatsApp
 */
export function getPosReceiptById(transactionIdOrInvoice: string) {
  const db = getDb();
  const tx = db
    .prepare(
      `SELECT t.*, s.name as store_name, s.branch_name, s.address as store_address, s.cold_chain_code
       FROM pos_transactions t
       JOIN stores s ON s.id = t.store_id
       WHERE t.id = ? OR t.invoice_number = ?`
    )
    .get(transactionIdOrInvoice, transactionIdOrInvoice) as
    | {
        id: string;
        store_id: string;
        invoice_number: string;
        cashier_label: string;
        customer_name_snapshot: string;
        customer_type_label: string;
        service_type: string;
        payment_method: string;
        payment_status: string;
        items_summary_text: string;
        total_amount: number;
        total_discount: number;
        total_cogs: number;
        gross_profit: number;
        cash_received: number;
        change_amount: number;
        created_at: string;
        store_name: string;
        branch_name: string;
        store_address: string;
        cold_chain_code: string;
      }
    | undefined;

  if (!tx) {
    throw new ManajerkuAppError(
      "RECEIPT_NOT_FOUND",
      "Data struk transaksi tidak ditemukan.",
      404
    );
  }

  const items = db
    .prepare(
      `SELECT * FROM pos_transaction_items WHERE pos_transaction_id = ?`
    )
    .all(tx.id) as Array<{
    id: string;
    product_id: string;
    product_name_snapshot: string;
    sold_unit_type: "PACK" | "BOX";
    sold_qty: number;
    deducted_packs_qty: number;
    unit_selling_price: number;
    discount_amount: number;
    subtotal_amount: number;
    cogs_amount: number;
    batch_allocations_json: string;
  }>;

  return {
    transactionId: tx.id,
    invoiceNumber: tx.invoice_number,
    storeName: tx.store_name,
    branchName: tx.branch_name,
    storeAddress: tx.store_address,
    coldChainCode: tx.cold_chain_code,
    cashierLabel: tx.cashier_label,
    customerName: tx.customer_name_snapshot,
    customerTypeLabel: tx.customer_type_label,
    serviceType: tx.service_type,
    paymentMethod: tx.payment_method,
    paymentStatusLabel:
      tx.payment_method === "QRIS" ? "QRIS Lunas" : "Tunai Lunas",
    totalAmountRp: tx.total_amount,
    totalDiscountRp: tx.total_discount,
    cashReceivedRp: tx.cash_received,
    changeAmountRp: tx.change_amount,
    createdAt: tx.created_at,
    items: items.map((i) => ({
      id: i.id,
      productName: i.product_name_snapshot,
      soldUnitType: i.sold_unit_type,
      soldQty: i.sold_qty,
      deductedPacksQty: i.deducted_packs_qty,
      unitSellingPriceRp: i.unit_selling_price,
      discountAmountRp: i.discount_amount,
      subtotalAmountRp: i.subtotal_amount,
      batchAllocations: JSON.parse(
        i.batch_allocations_json
      ) as BatchAllocationRecord[],
    })),
  };
}
