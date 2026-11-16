import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "../auth/password.ts";

export const DEFAULT_STORE_ID = "store-orienix-01";
export const DEFAULT_OWNER_ID = "user-owner-01";
export const DEFAULT_CASHIER_ID = "user-cashier-01";

export function seedInitialOrienixData(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE TRANSACTION;");
  try {
    // Clean any orphaned baseline records before idempotent seeding
    db.exec(`
      DELETE FROM pos_transaction_items WHERE pos_transaction_id = 'inv-2611-49';
      DELETE FROM pos_transactions WHERE store_id = 'store-orienix-01';
      DELETE FROM fefo_promo_campaigns WHERE store_id = 'store-orienix-01';
      DELETE FROM inventory_batches WHERE store_id = 'store-orienix-01';
      DELETE FROM purchase_orders WHERE store_id = 'store-orienix-01';
      DELETE FROM rfq_sessions WHERE store_id = 'store-orienix-01';
      DELETE FROM suppliers WHERE id IN ('supp-beku-jaya', 'supp-grosir-makmur', 'supp-rantai-dingin');
      DELETE FROM resellers WHERE store_id = 'store-orienix-01';
      DELETE FROM products WHERE store_id = 'store-orienix-01';
      DELETE FROM cash_ledger WHERE store_id = 'store-orienix-01';
      DELETE FROM daily_financial_snapshots WHERE store_id = 'store-orienix-01';
      DELETE FROM whatsapp_messages_log WHERE store_id = 'store-orienix-01';
      DELETE FROM users WHERE store_id = 'store-orienix-01';
      DELETE FROM stores WHERE id = 'store-orienix-01';
    `);

    // 1. Seed Default Store (Cabang Utama • Cold-Chain ID-01)
    db.prepare(`
      INSERT INTO stores (
        id, name, branch_name, address, cold_chain_code, last_recorded_temp_c,
        latitude, longitude, daily_freezer_elec_cost, profit_reinvestment_pct,
        rfq_timeout_minutes, subscription_tier, subscription_expires_at, created_at
      ) VALUES (
        ?, 'Manajerku Frozen Food', 'Cabang Utama', 'Jl. T. Nyak Arief No. 14, Kopelma Darussalam, Banda Aceh',
        'Cold-Chain ID-01', -18.4, 5.5682900, 95.3637530, 45000, 20.0,
        15, 'MANAJERKU_PRO', '2027-11-16T23:59:59Z', '2026-10-01T08:00:00Z'
      )
    `).run(DEFAULT_STORE_ID);

    // 2. Seed Users (Owner, Cashier, Admin) with real scrypt password hashes
    const ownerCred = hashPassword("Orienix2026!");
    const cashierCred = hashPassword("Kasir2026!");
    const adminCred = hashPassword("Admin2026!");

    const insertUser = db.prepare(`
      INSERT INTO users (
        id, store_id, full_name, email, phone_whatsapp,
        password_hash, password_salt, role, account_status, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, '2026-10-01T08:05:00Z')
    `);
    insertUser.run(
      DEFAULT_OWNER_ID,
      DEFAULT_STORE_ID,
      "Muhammad Hukman Fathir",
      "mhukmanfathir@gmail.com",
      "+6282298606699",
      ownerCred.passwordHash,
      ownerCred.passwordSalt,
      "OWNER"
    );
    insertUser.run(
      DEFAULT_CASHIER_ID,
      DEFAULT_STORE_ID,
      "Dandy Sultana (Kasir 01)",
      "dandy@manajerku.id",
      "+6282211112222",
      cashierCred.passwordHash,
      cashierCred.passwordSalt,
      "CASHIER"
    );
    insertUser.run(
      "user-admin-01",
      DEFAULT_STORE_ID,
      "Muhammad Nashih (Admin)",
      "nashih@manajerku.id",
      "+6282200009999",
      adminCred.passwordHash,
      adminCred.passwordSalt,
      "ADMIN"
    );

    // 3. Seed Master Products (SKUs)
    const insertProduct = db.prepare(`
      INSERT INTO products (
        id, store_id, sku_code, name, category, retail_unit_name, wholesale_unit_name,
        packs_per_box, retail_price_per_pack, wholesale_price_per_box, standard_cogs_per_pack,
        reorder_point_packs, default_reorder_boxes, is_below_rop, is_active
      ) VALUES (?, ?, ?, ?, ?, 'Pack', 'Dus', ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    // 2 SKU Kritis (is_below_rop = 1) + 3 SKU Aman
    insertProduct.run(
      "prod-nugget-500",
      DEFAULT_STORE_ID,
      "SKU-NUG-500",
      "Nugget Crispy 500g",
      "Nugget & Olahan Ayam",
      20, // 1 Dus = 20 Pack (matches mockup: 5 Dus = 100 Pack)
      25000,
      460000,
      20250, // Rp 405.000 / 20
      40, // ROP = 40 Pack (2 Dus)
      5,
      1 // SKU Kritis #1
    );

    insertProduct.run(
      "prod-sosis-1000",
      DEFAULT_STORE_ID,
      "SKU-SOS-1000",
      "Sosis Sapi Bakar 1kg",
      "Sosis & Bakso",
      15, // 1 Dus = 15 Pack
      45000,
      630000,
      34000,
      30, // ROP = 30 Pack
      4,
      1 // SKU Kritis #2
    );

    insertProduct.run(
      "prod-kentang-1000",
      DEFAULT_STORE_ID,
      "SKU-KNT-1000",
      "Kentang Goreng Shoestring 1kg",
      "Kentang Beku",
      10, // 1 Dus = 10 Pack
      34000,
      301500,
      24500,
      30,
      6,
      0
    );

    insertProduct.run(
      "prod-dimsum-500",
      DEFAULT_STORE_ID,
      "SKU-DMS-500",
      "Dimsum Ayam Udang 500g",
      "Dimsum & Oriental",
      20,
      28000,
      520000,
      21000,
      30,
      5,
      0
    );

    insertProduct.run(
      "prod-bakso-500",
      DEFAULT_STORE_ID,
      "SKU-BKS-500",
      "Bakso Sapi Super 500g",
      "Sosis & Bakso",
      20,
      26000,
      480000,
      19500,
      30,
      5,
      0
    );

    // 4. Seed 3 Verified Distributors (Rating >= 4.5, Radius <= 10 km, WA Aktif)
    const insertSupplier = db.prepare(`
      INSERT INTO suppliers (
        id, store_id, google_place_id, name, phone_whatsapp, is_whatsapp_active,
        address, latitude, longitude, distance_km, google_rating, user_ratings_total,
        is_verified_b2b_partner, commission_rate_pct, cached_catalog_json
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertSupplier.run(
      "supp-beku-jaya",
      DEFAULT_STORE_ID,
      "ChIJ_BekuJaya_BandaAceh_01",
      "CV Beku Jaya Distribusi",
      "+628116800101",
      "Jl. Teuku Umar No. 88, Seutui, Banda Aceh",
      5.5451,
      95.3175,
      2.4,
      4.8,
      142,
      1,
      1.25,
      JSON.stringify({
        "SKU-NUG-500": {
          price_per_box: 405000,
          moq_boxes: 5,
          freezer_delivery: true,
          last_batch_exp: "2027-10-14",
        },
      })
    );

    insertSupplier.run(
      "supp-grosir-makmur",
      DEFAULT_STORE_ID,
      "ChIJ_GrosirMakmur_BandaAceh_02",
      "Grosir Makmur Cold-Chain",
      "+628116800102",
      "Jl. Soekarno-Hatta, Lampeuneurut, Aceh Besar",
      5.5214,
      95.3312,
      4.8,
      4.6,
      98,
      1,
      1.0,
      JSON.stringify({
        "SKU-NUG-500": {
          price_per_box: 420000,
          moq_boxes: 15,
          freezer_delivery: true,
          last_batch_exp: "2027-08-20",
        },
      })
    );

    insertSupplier.run(
      "supp-rantai-dingin",
      DEFAULT_STORE_ID,
      "ChIJ_RantaiDingin_BandaAceh_03",
      "UD Rantai Dingin Aceh",
      "+628116800103",
      "Jl. Sultan Iskandar Muda, Ulee Lheue, Banda Aceh",
      5.5591,
      95.2918,
      7.1,
      4.5,
      64,
      0,
      0.0,
      JSON.stringify({
        "SKU-NUG-500": {
          price_per_box: 430000,
          moq_boxes: 10,
          freezer_delivery: true,
          last_batch_exp: "2027-07-15",
        },
      })
    );

    // 5. Seed RFQ Session & Approved PO (#PO-2611-02) matching Mockup Pages 1 & 8
    db.prepare(`
      INSERT INTO rfq_sessions (
        id, store_id, rfq_code, product_id, requested_qty_boxes, trigger_source,
        status, supplier_quotes_json, recommended_supplier_id, best_price_per_box,
        estimated_po_total, cash_usage_pct, owner_rfq_approved_at, created_at
      ) VALUES (?, ?, 'RFQ-2611-02', 'prod-nugget-500', 5, 'AUTO_ROP', 'PO_ISSUED', ?, 'supp-beku-jaya', 405000, 2025000, 13.6, '2026-11-16T06:55:00Z', '2026-11-16T06:50:00Z')
    `).run(
      "rfq-session-01",
      DEFAULT_STORE_ID,
      JSON.stringify([
        {
          supplier_id: "supp-beku-jaya",
          supplier_name: "CV Beku Jaya Distribusi",
          phone: "+628116800101",
          rating: 4.8,
          slot_price_per_box: 405000,
          slot_moq_boxes: 5,
          slot_batch_expiry_date: "2027-10-14",
          slot_freezer_delivery: true,
          turn_count: 1,
          status: "COMPLETE",
        },
        {
          supplier_id: "supp-grosir-makmur",
          supplier_name: "Grosir Makmur Cold-Chain",
          phone: "+628116800102",
          rating: 4.6,
          slot_price_per_box: 420000,
          slot_moq_boxes: 15,
          slot_batch_expiry_date: "2027-08-20",
          slot_freezer_delivery: true,
          turn_count: 2,
          status: "COMPLETE",
        },
        {
          supplier_id: "supp-rantai-dingin",
          supplier_name: "UD Rantai Dingin Aceh",
          phone: "+628116800103",
          rating: 4.5,
          slot_price_per_box: 430000,
          slot_moq_boxes: 10,
          slot_batch_expiry_date: "2027-07-15",
          slot_freezer_delivery: true,
          turn_count: 1,
          status: "COMPLETE",
        },
      ])
    );

    db.prepare(`
      INSERT INTO purchase_orders (
        id, store_id, po_number, rfq_session_id, supplier_id, product_id,
        order_qty_boxes, order_qty_packs, agreed_price_per_box, reference_market_price_per_box,
        discount_pct, total_amount, cash_usage_pct, promised_batch_expiry, batch_code_note,
        delivery_notes, status, pdf_document_url, b2b_commission_amount, approved_by_user_id,
        approved_at, created_at
      ) VALUES (
        'po-2611-02', ?, '#PO-2611-02', 'rfq-session-01', 'supp-beku-jaya', 'prod-nugget-500',
        5, 100, 405000, 442600, 8.5, 2025000, 13.6, '2027-10-14', 'Batch #NG26-09',
        'Setujui PO #1, kirim sore ini', 'APPROVED_WA', '/api/v1/procurement/po/po-2611-02/pdf',
        25313, ?, '2026-11-16T07:15:00Z', '2026-11-16T07:15:00Z'
      )
    `).run(DEFAULT_STORE_ID, DEFAULT_OWNER_ID);

    // 6. Seed 24 Freezer Batches: 21 SAFE, 1 PRIORITY_FEFO (<30d), 2 CRITICAL (18d & 15d)
    const insertBatch = db.prepare(`
      INSERT INTO inventory_batches (
        id, store_id, product_id, batch_number, source_po_id, initial_qty_packs,
        current_qty_packs, unit_cogs_pack, promo_discount_pct, expiry_date,
        fefo_status, received_via, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-10-15T09:00:00Z')
    `);

    // 2 CRITICAL Batches (<= 18 days from 2026-11-16 -> 2026-12-04 is exactly 18 days!)
    insertBatch.run(
      "batch-crit-01",
      DEFAULT_STORE_ID,
      "prod-nugget-500",
      "Batch #NG26-09",
      null,
      40,
      24, // <= 40 ROP
      20250,
      0,
      "2026-12-04", // 18 days remaining from 16 Nov 2026! Matches "1 Batch Exp 18 Hr"
      "CRITICAL",
      "VISION_OCR"
    );

    insertBatch.run(
      "batch-crit-02",
      DEFAULT_STORE_ID,
      "prod-sosis-1000",
      "Batch #SS26-04",
      null,
      30,
      10,
      34000,
      20.0,
      "2026-12-04",
      "CRITICAL",
      "VISION_OCR"
    );

    // 1 PRIORITY_FEFO Batch (< 30 days: 24 days remaining -> 2026-12-10)
    insertBatch.run(
      "batch-prio-01",
      DEFAULT_STORE_ID,
      "prod-sosis-1000",
      "Batch #SS26-08",
      null,
      30,
      15, // Total sosis = 10 + 15 = 25 packs (<= 30 ROP -> SKU Kritis #2)
      34000,
      20.0,
      "2026-12-10",
      "PRIORITY_FEFO",
      "VISION_OCR"
    );

    // 21 SAFE Batches (>= 30 days) across Kentang, Dimsum, and Bakso
    const safeProducts = [
      { id: "prod-kentang-1000", prefix: "KT", cogs: 24500, packs: 20 },
      { id: "prod-dimsum-500", prefix: "DM", cogs: 21000, packs: 25 },
      { id: "prod-bakso-500", prefix: "BK", cogs: 19500, packs: 25 },
    ];
    for (let i = 1; i <= 21; i++) {
      const p = safeProducts[(i - 1) % safeProducts.length];
      const month = ((i % 8) + 2).toString().padStart(2, "0");
      const day = ((i % 20) + 5).toString().padStart(2, "0");
      insertBatch.run(
        `batch-safe-${i.toString().padStart(2, "0")}`,
        DEFAULT_STORE_ID,
        p.id,
        `Batch #${p.prefix}27-${i.toString().padStart(2, "0")}`,
        null,
        p.packs,
        p.packs,
        p.cogs,
        0,
        `2027-${month}-${day}`,
        "SAFE",
        "VISION_OCR"
      );
    }

    // 7. Seed 14 Downstream Resellers (including "Burger Bang Jago")
    const resellerNames = [
      ["reseller-01", "Burger Bang Jago", "Bang Jago", "+6285260001001", "BURGER"],
      ["reseller-02", "Dimsum Sultan Aceh", "Cut Putri", "+6285260001002", "DIMSUM"],
      ["reseller-03", "Sosis Bakar Krueng Aceh", "Teuku Ryan", "+6285260001003", "SOSIS_BAKAR"],
      ["reseller-04", "Kebab & Burger Simpang Lima", "Rizky Maulana", "+6285260001004", "BURGER"],
      ["reseller-05", "Katering Berkah Darussalam", "Hj. Aminah", "+6285260001005", "CATERING"],
      ["reseller-06", "Corndog & Sosis Blang Padang", "Fajar Siddiq", "+6285260001006", "SOSIS_BAKAR"],
      ["reseller-07", "Burger Malam Peunayong", "Hendra Wijaya", "+6285260001007", "BURGER"],
      ["reseller-08", "Dimsum Kukus Ulee Kareng", "Nadia Safitri", "+6285260001008", "DIMSUM"],
      ["reseller-09", "Warung Steak & Kentang Syiah Kuala", "Irwanda", "+6285260001009", "OTHER"],
      ["reseller-10", "Sosis Bakar Kampus USK", "M. Farhan", "+6285260001010", "SOSIS_BAKAR"],
      ["reseller-11", "Burger & Toast Lhoknga", "Zulfikar", "+6285260001011", "BURGER"],
      ["reseller-12", "KateringRasa Bunda Aceh", "Siti Sarah", "+6285260001012", "CATERING"],
      ["reseller-13", "Bakso & Sosis Bakar Neusu", "Rahmat Hidayat", "+6285260001013", "SOSIS_BAKAR"],
      ["reseller-14", "Foodtruck Burger Lampineung", "Dicky Pratama", "+6285260001014", "BURGER"],
    ];

    const insertReseller = db.prepare(`
      INSERT INTO resellers (id, store_id, business_name, contact_name, phone_whatsapp, culinary_segment, is_promo_subscribed)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    for (const r of resellerNames) {
      insertReseller.run(r[0], DEFAULT_STORE_ID, r[1], r[2], r[3], r[4]);
    }

    // 8. Seed FEFO Promo Campaign Draft ("Draf Promo FEFO Sosis (-20%) • Siap kirim ke 14 Pedagang Reseller")
    db.prepare(`
      INSERT INTO fefo_promo_campaigns (
        id, store_id, batch_id, product_id, title, discount_pct,
        promo_price_per_pack, promo_price_per_box, target_reseller_count,
        sent_count, message_template, status, created_at
      ) VALUES (
        'promo-fefo-sosis-01', ?, 'batch-prio-01', 'prod-sosis-1000',
        'Draf Promo FEFO Sosis (-20%)', 20.0, 36000, 504000, 14, 0,
        'Halo Mitra Kuliner! Promo Cepat Stok Segar Sosis Sapi Bakar 1kg Diskon 20% (Rp 36.000/pack atau Rp 504.000/dus). Sisa 15 pack di toko, ambil hari ini!',
        'DRAFT_READY', '2026-11-16T06:30:00Z'
      )
    `).run(DEFAULT_STORE_ID);

    // 9. Seed POS Transaction (#INV-2611-49 | Burger Bang Jago | 2 Dus Kentang + 4 Sosis + 5 Nugget | Rp 908.000 | QRIS Lunas)
    db.prepare(`
      INSERT INTO pos_transactions (
        id, store_id, invoice_number, cashier_user_id, cashier_label, reseller_id,
        customer_name_snapshot, customer_type_label, service_type, payment_method,
        payment_status, items_summary_text, total_amount, total_discount, total_cogs,
        gross_profit, cash_received, change_amount, created_at
      ) VALUES (
        'inv-2611-49', ?, '#INV-2611-49', ?, 'Kasir 01', 'reseller-01',
        'Burger Bang Jago', 'Reseller Terdaftar', 'TAKEAWAY_PICKUP', 'QRIS',
        'PAID', '2 Dus Kentang + 4 Sosis + 5 Nugget', 908000, 0, 727250,
        180750, 908000, 0, '2026-11-16T06:50:00Z'
      )
    `).run(DEFAULT_STORE_ID, DEFAULT_CASHIER_ID);

    const insertPosItem = db.prepare(`
      INSERT INTO pos_transaction_items (
        id, pos_transaction_id, product_id, product_name_snapshot, sold_unit_type,
        sold_qty, deducted_packs_qty, unit_selling_price, discount_amount,
        subtotal_amount, cogs_amount, batch_allocations_json
      ) VALUES (?, 'inv-2611-49', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `);

    // 2 Dus Kentang (20 Pack) = Rp 603.000, 4 Pack Sosis = Rp 180.000, 5 Pack Nugget = Rp 125.000 -> Total = Rp 908.000!
    insertPosItem.run(
      "item-49-1",
      "prod-kentang-1000",
      "Kentang Goreng Shoestring 1kg",
      "BOX",
      2,
      20,
      301500,
      603000,
      490000,
      JSON.stringify([{ batch_id: "batch-safe-01", batch_number: "Batch #KT27-01", packs_deducted: 20, unit_cogs: 24500 }])
    );
    insertPosItem.run(
      "item-49-2",
      "prod-sosis-1000",
      "Sosis Sapi Bakar 1kg",
      "PACK",
      4,
      4,
      45000,
      180000,
      136000,
      JSON.stringify([{ batch_id: "batch-crit-02", batch_number: "Batch #SS26-04", packs_deducted: 4, unit_cogs: 34000 }])
    );
    insertPosItem.run(
      "item-49-3",
      "prod-nugget-500",
      "Nugget Crispy 500g",
      "PACK",
      5,
      5,
      25000,
      125000,
      101250,
      JSON.stringify([{ batch_id: "batch-crit-01", batch_number: "Batch #NG26-09", packs_deducted: 5, unit_cogs: 20250 }])
    );

    // 10. Seed Cash Ledger entries so current available_kulakan_cash = Rp 14.850.000 and locked_po_cash = Rp 2.025.000
    const insertLedger = db.prepare(`
      INSERT INTO cash_ledger (
        id, store_id, entry_type, reference_type, reference_id, amount,
        cogs_component, profit_component, available_kulakan_cash_after,
        locked_po_cash_after, net_profit_balance_after, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertLedger.run(
      "ledger-01",
      DEFAULT_STORE_ID,
      "INITIAL_CAPITAL",
      "MANUAL",
      "INIT-2611",
      13211744,
      13211744,
      0,
      13211744,
      0,
      3820000,
      "Saldo awal Kas Siap Kulakan minggu berjalan",
      "2026-11-10T08:00:00Z"
    );

    insertLedger.run(
      "ledger-02",
      DEFAULT_STORE_ID,
      "POS_SALE_REVENUE",
      "POS_INV",
      "#INV-2611-01..48",
      2512000,
      2935506,
      512500,
      16147250,
      0,
      4332500,
      "Rekap 47 Nota Kasir Pagi-Siang & Reinvestasi Laba Mingguan (16 Nov 2026)",
      "2026-11-16T06:30:00Z"
    );

    insertLedger.run(
      "ledger-03",
      DEFAULT_STORE_ID,
      "POS_SALE_REVENUE",
      "POS_INV",
      "#INV-2611-49",
      908000,
      727750,
      177500,
      16875000,
      0,
      4510000,
      "Penjualan Grosir & Eceran Burger Bang Jago (QRIS Lunas)",
      "2026-11-16T06:50:00Z"
    );

    insertLedger.run(
      "ledger-04",
      DEFAULT_STORE_ID,
      "FREEZER_ELECTRICITY_EXPENSE",
      "DAILY_CRON",
      "ELEC-261116",
      -45000,
      0,
      -45000,
      16875000,
      0,
      4465000,
      "Alokasi Beban Listrik Penyimpanan Dingin 24 Jam (Cold-Chain ID-01)",
      "2026-11-16T07:00:00Z"
    );

    insertLedger.run(
      "ledger-05",
      DEFAULT_STORE_ID,
      "PO_CASH_LOCK",
      "PO_DOC",
      "#PO-2611-02",
      2025000,
      2025000,
      0,
      14850000, // Exact match with Mockup: Kas Siap Kulakan Rp 14.850.000!
      2025000, // Locked PO #PO-2611-02 Rp 2.025.000
      4465000,
      "Kunci Alokasi Saldo Kas Kulakan untuk #PO-2611-02 (CV Beku Jaya)",
      "2026-11-16T07:15:00Z"
    );

    // 11. Seed 7-Day Financial Snapshots (Sen, Sel, Rab, Kam, Jum, Sab, Min) matching Mockup Chart
    const sevenDays = [
      ["snap-1", "2026-11-10", "Sen", 2650000, 1400000, 38, 495000],
      ["snap-2", "2026-11-11", "Sel", 2950000, 1200000, 41, 550000],
      ["snap-3", "2026-11-12", "Rab", 2480000, 1850000, 35, 440000],
      ["snap-4", "2026-11-13", "Kam", 3120000, 1500000, 44, 590000],
      ["snap-5", "2026-11-14", "Jum", 3450000, 2100000, 49, 660000],
      ["snap-6", "2026-11-15", "Sab", 3680000, 1750000, 52, 710000],
      ["snap-7", "2026-11-16", "Min", 3420000, 2025000, 48, 645000], // Exact match: Rp 3.420.000 | 48 Nota | Laba Rp 645rb | PO Rp 2.025.000
    ];

    const insertSnap = db.prepare(`
      INSERT INTO daily_financial_snapshots (
        id, store_id, snapshot_date, day_label, pos_revenue_amount,
        po_kulakan_amount, pos_invoice_count, net_profit_amount, freezer_elec_cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 45000)
    `);
    for (const d of sevenDays) {
      insertSnap.run(d[0], DEFAULT_STORE_ID, d[1], d[2], d[3], d[4], d[5], d[6]);
    }

    // 12. Seed WhatsApp Messages Log matching Right Mockup on Page 8
    const insertWaLog = db.prepare(`
      INSERT INTO whatsapp_messages_log (
        id, store_id, direction, sender_phone, recipient_phone, detected_role,
        message_type, content_text, media_url, related_rfq_id, related_po_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertWaLog.run(
      "wa-msg-01",
      DEFAULT_STORE_ID,
      "OUTBOUND",
      "MANAJERKU_AGENT",
      "+6282298606699",
      "SYSTEM",
      "TEXT",
      "Hasil Nego 3 Distributor:\n1. CV Beku Jaya (★4.8): Rp 405rb/dus\n2. Grosir Makmur: Rp 420rb (MOQ 15)\n✓ PO Rp 2.025.000 Aman (13,6% Kas)",
      null,
      "rfq-session-01",
      null,
      "2026-11-16T07:12:00Z"
    );

    insertWaLog.run(
      "wa-msg-02",
      DEFAULT_STORE_ID,
      "INBOUND",
      "+6282298606699",
      "MANAJERKU_AGENT",
      "OWNER",
      "TEXT",
      "Setujui PO #1, kirim sore ini",
      null,
      "rfq-session-01",
      "po-2611-02",
      "2026-11-16T07:15:00Z"
    );

    insertWaLog.run(
      "wa-msg-03",
      DEFAULT_STORE_ID,
      "INBOUND",
      "+6282298606699",
      "MANAJERKU_AGENT",
      "OWNER",
      "IMAGE_OCR",
      "Barang baru sampai, tolong input ke stok FEFO ya",
      "Foto_Label_Kardus_BekuJaya.jpg",
      null,
      "po-2611-02",
      "2026-11-16T07:30:00Z"
    );

    insertWaLog.run(
      "wa-msg-04",
      DEFAULT_STORE_ID,
      "OUTBOUND",
      "MANAJERKU_AGENT",
      "+6282298606699",
      "SYSTEM",
      "TEXT",
      "✅ Vision OCR Selesai! 5 Dus (100 Pack) Nugget Crispy Batch FN-219 (Exp 14 Okt 2027) otomatis masuk antrean FEFO!",
      null,
      null,
      "po-2611-02",
      "2026-11-16T07:30:05Z"
    );

    db.exec("COMMIT;");
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore
    }
    throw err;
  }
}
