import test from "node:test";
import assert from "node:assert/strict";
import { resetTestDatabase, getDb } from "../lib/db/client.ts";
import { DEFAULT_STORE_ID } from "../lib/db/seed.ts";
import {
  addStoreUser,
  checkSkuQuotaBeforeInsert,
  completeStoreOnboarding,
  enforceProFeatureAccess,
  getCommandCenterSummary,
  getRolePermissions,
  getUnifiedTransactions,
  listStoreUsers,
  ManajerkuAppError,
  normalizePhoneE164,
  requestOnboardingOtp,
  updateColdChainTemperature,
  updateStoreSubscriptionTier,
} from "../lib/services/platform-core.ts";

test("PRD-01 Suite: Platform Core, Command Center Dashboard & Access Control", async (t) => {
  await t.test("FR-101 & US-101: Self-Service 5-Minute Onboarding (Happy Path & Atomic Ledger Creation)", () => {
    resetTestDatabase(true);

    const otpRes = requestOnboardingOtp("0812-3456-7890");
    assert.equal(otpRes.normalizedPhone, "+6281234567890");
    assert.equal(otpRes.otpCode.length, 6);

    const onboardRes = completeStoreOnboarding({
      storeName: "Toko Beku Seulawah",
      branchName: "Cabang Darussalam",
      address: "Jl. Syiah Kuala, Banda Aceh",
      coldChainCode: "Cold-Chain ID-02",
      initialTempC: -19.2,
      initialKulakanCash: 10000000,
      dailyFreezerElecCost: 45000,
      ownerName: "Teuku Ahmad",
      ownerPhone: "081234567890",
      otpCode: otpRes.otpCode,
      cashierName: "Siti Kasir",
      cashierPhone: "081299998888",
    });

    assert.ok(onboardRes.storeId.startsWith("store-"));
    assert.equal(onboardRes.subscriptionTier, "FREEMIUM_STARTER");
    assert.equal(onboardRes.initialKulakanCash, 10000000);
    assert.ok(onboardRes.cashierUserId);

    // Verify summary of newly onboarded store
    const summary = getCommandCenterSummary({
      storeId: onboardRes.storeId,
      viewerRole: "OWNER",
    });
    assert.equal(summary.store.name, "Toko Beku Seulawah");
    assert.equal(summary.store.subscriptionTier, "FREEMIUM_STARTER");
    assert.equal(summary.kpis.kasSiapKulakan.amountRp, 10000000);
  });

  await t.test("FR-101 & US-101 Scenario 2: Reject duplicate WhatsApp number & invalid OTP", () => {
    resetTestDatabase(true);

    // +6282298606699 is already registered as Owner of DEFAULT_STORE_ID
    assert.throws(
      () => requestOnboardingOtp("+6282298606699"),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "PHONE_ALREADY_REGISTERED");
        assert.match(err.message, /sudah terhubung ke akun toko lain/);
        return true;
      }
    );

    // Reject landline phone number
    assert.throws(
      () => normalizePhoneE164("0651-23456"),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "INVALID_WHATSAPP_PHONE");
        return true;
      }
    );

    // Wrong OTP verification fails atomically without creating store
    const otpRes = requestOnboardingOtp("081377776666");
    assert.throws(
      () =>
        completeStoreOnboarding({
          storeName: "Toko Gagal OTP",
          initialKulakanCash: 5000000,
          ownerName: "Budi",
          ownerPhone: "081377776666",
          otpCode: "000000", // wrong code
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "INVALID_OTP_CODE");
        return true;
      }
    );
  });

  await t.test("FR-102: RBAC Permissions & WhatsApp Phone Whitelist Management", () => {
    resetTestDatabase(true);

    const ownerPerms = getRolePermissions("OWNER");
    const cashierPerms = getRolePermissions("CASHIER");

    assert.equal(ownerPerms.canApprovePo, true);
    assert.equal(ownerPerms.canExportKurPdf, true);
    assert.equal(cashierPerms.canApprovePo, false);
    assert.equal(cashierPerms.canExportKurPdf, false);
    assert.equal(cashierPerms.canOperatePos, true);
    assert.equal(cashierPerms.canSubmitOcrPhoto, true);

    // Cashier cannot add users
    assert.throws(
      () =>
        addStoreUser({
          storeId: DEFAULT_STORE_ID,
          actorRole: "CASHIER",
          fullName: "Staf Baru",
          phoneWhatsapp: "085211113333",
          role: "CASHIER",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "FORBIDDEN_ROLE");
        assert.equal(err.statusCode, 403);
        return true;
      }
    );

    // Owner can add Cashier to whitelist
    const added = addStoreUser({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      fullName: "M Nafis Sauqy (Kasir 02)",
      phoneWhatsapp: "085211113333",
      role: "CASHIER",
    });
    assert.equal(added.phoneWhatsapp, "+6285211113333");
    assert.equal(added.role, "CASHIER");

    const allUsers = listStoreUsers(DEFAULT_STORE_ID);
    assert.equal(allUsers.length, 4);
  });

  await t.test("FR-103, FR-104, FR-105 & US-102: Command Center KPIs, 7-Day Chart, AI Health & Cashier Masking", () => {
    resetTestDatabase(true);

    const ownerSummary = getCommandCenterSummary({
      storeId: DEFAULT_STORE_ID,
      viewerRole: "OWNER",
      selectedDate: "2026-11-16",
    });

    // Verify exact proposal metrics (Pages 1 & 8)
    assert.equal(ownerSummary.kpis.kasSiapKulakan.amountRp, 14850000);
    assert.equal(ownerSummary.kpis.kasSiapKulakan.plafonStatus, "Plafon PO Aman");
    assert.equal(ownerSummary.kpis.kasSiapKulakan.weeklyGrowthPct, "+12,4%");

    assert.equal(ownerSummary.kpis.omzetHarian.amountRp, 3420000);
    assert.equal(ownerSummary.kpis.omzetHarian.invoiceCount, 48);
    assert.equal(ownerSummary.kpis.omzetHarian.netProfitRp, 645000);

    assert.equal(ownerSummary.kpis.radarStokFefo.criticalSkuCount, 2);
    assert.equal(ownerSummary.kpis.radarStokFefo.closestExpiryDays, 18);

    assert.equal(ownerSummary.kpis.efisiensiPengadaanAi.marginImprovementLabel, "+18,8% Margin");
    assert.equal(ownerSummary.kpis.efisiensiPengadaanAi.verifiedSupplierCount, 3);

    assert.equal(ownerSummary.chart7Days.days.length, 7);
    assert.equal(ownerSummary.chart7Days.coverageRatio, 2.3);
    assert.equal(ownerSummary.chart7Days.dailyFreezerElecCostRp, 45000);

    assert.equal(
      ownerSummary.aiAndFefoHealth.batchSummary.summaryText,
      "24 Batch Freezer: 21 Aman • 1 Prioritas FEFO • 2 Kritis"
    );

    // US-102 Scenario 2: Cashier role masks sensitive Kas Siap Kulakan & Net Profit
    const cashierSummary = getCommandCenterSummary({
      storeId: DEFAULT_STORE_ID,
      viewerRole: "CASHIER",
      selectedDate: "2026-11-16",
    });
    assert.equal(cashierSummary.kpis.kasSiapKulakan.amountRp, null);
    assert.equal(cashierSummary.kpis.omzetHarian.netProfitRp, null);
  });

  await t.test("FR-106 & US-102 Scenario 1: Unified Cashier & PO Sync Table Filtering & Search", () => {
    resetTestDatabase(true);

    const allTx = getUnifiedTransactions({
      storeId: DEFAULT_STORE_ID,
      filterType: "ALL",
    });
    assert.equal(allTx.totalCount, 2);
    assert.equal(allTx.items[0].referenceCode, "#PO-2611-02");
    assert.equal(allTx.items[1].referenceCode, "#INV-2611-49");

    const poOnly = getUnifiedTransactions({
      storeId: DEFAULT_STORE_ID,
      filterType: "PO",
    });
    assert.equal(poOnly.totalCount, 1);
    assert.equal(poOnly.items[0].referenceCode, "#PO-2611-02");
    assert.equal(poOnly.items[0].actionLabel, "Lihat PO");

    const posOnly = getUnifiedTransactions({
      storeId: DEFAULT_STORE_ID,
      filterType: "POS",
    });
    assert.equal(posOnly.totalCount, 1);
    assert.equal(posOnly.items[0].referenceCode, "#INV-2611-49");
    assert.equal(posOnly.items[0].actionLabel, "Cetak Struk");

    const searched = getUnifiedTransactions({
      storeId: DEFAULT_STORE_ID,
      filterType: "ALL",
      search: "Burger Bang Jago",
    });
    assert.equal(searched.totalCount, 1);
    assert.equal(searched.items[0].referenceCode, "#INV-2611-49");
  });

  await t.test("FR-107 & US-103: Subscription Tier Quota Enforcement (30 SKU Limit on Freemium vs Unlimited on Pro)", () => {
    resetTestDatabase(true);
    const db = getDb();

    // Downgrade store to FREEMIUM_STARTER for quota testing
    updateStoreSubscriptionTier({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      targetTier: "FREEMIUM_STARTER",
    });

    // Pro features must be blocked on FREEMIUM_STARTER
    assert.throws(
      () => enforceProFeatureAccess(DEFAULT_STORE_ID, "AUTO_RFQ_WA"),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "SUBSCRIPTION_PRO_REQUIRED");
        assert.equal(err.statusCode, 403);
        return true;
      }
    );

    // Seed has 5 SKUs; insert 25 more SKUs to reach 30 SKUs
    const insertSku = db.prepare(`
      INSERT INTO products (
        id, store_id, sku_code, name, packs_per_box, retail_price_per_pack, wholesale_price_per_box
      ) VALUES (?, ?, ?, ?, 10, 20000, 180000)
    `);
    for (let i = 6; i <= 30; i++) {
      assert.equal(checkSkuQuotaBeforeInsert(DEFAULT_STORE_ID).allowed, true);
      insertSku.run(`prod-extra-${i}`, DEFAULT_STORE_ID, `SKU-EX-${i}`, `Produk Extra ${i}`);
    }

    // Now at 30 SKUs: attempting to check quota for the 31st SKU must throw SUBSCRIPTION_SKU_QUOTA_EXCEEDED
    assert.throws(
      () => checkSkuQuotaBeforeInsert(DEFAULT_STORE_ID),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "SUBSCRIPTION_SKU_QUOTA_EXCEEDED");
        assert.match(err.message, /Kuota 30 SKU Paket Freemium Starter telah penuh/);
        return true;
      }
    );

    // Upgrade back to MANAJERKU_PRO -> 31st SKU and Pro features are unlocked
    updateStoreSubscriptionTier({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      targetTier: "MANAJERKU_PRO",
    });
    const proQuota = checkSkuQuotaBeforeInsert(DEFAULT_STORE_ID);
    assert.equal(proQuota.allowed, true);
    assert.equal(proQuota.maxAllowed, null);
    assert.doesNotThrow(() => enforceProFeatureAccess(DEFAULT_STORE_ID, "AUTO_RFQ_WA"));
  });

  await t.test("FR-108: Cold-Chain Freezer Temperature Recording & Alert Threshold", () => {
    resetTestDatabase(true);

    const stableRes = updateColdChainTemperature({
      storeId: DEFAULT_STORE_ID,
      temperatureC: -18.4,
    });
    assert.equal(stableRes.status, "STABLE");
    assert.equal(stableRes.statusLabel, "Suhu Stabil -18.4°C");

    const warnRes = updateColdChainTemperature({
      storeId: DEFAULT_STORE_ID,
      temperatureC: -12.0,
    });
    assert.equal(warnRes.status, "WARNING_HIGH_TEMP");
    assert.match(warnRes.statusLabel, /Peringatan Suhu Freezer Naik/);
  });
});

