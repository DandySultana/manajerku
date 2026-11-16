import test from "node:test";
import assert from "node:assert/strict";
import { resetTestDatabase, runAtomicTransaction } from "../lib/db/client.ts";
import { DEFAULT_STORE_ID } from "../lib/db/seed.ts";
import {
  exportKurBankVerificationPackage,
  getFinancialLedgerAndKurSummary,
  lockPoCashAllocationInTx,
  recordDailyFreezerElectricityExpense,
  recordOwnerCapitalAdjustment,
  settlePoCashAllocationInTx,
} from "../lib/services/finance-kur.ts";
import {
  ManajerkuAppError,
  updateStoreSubscriptionTier,
} from "../lib/services/platform-core.ts";

test("PRD-08 Suite: Separated Cash Ledger, Freezer Electricity & KUR Reporting", async (t) => {
  await t.test("FR-801 & US-801: Separated Cash Balances & Protection Against Mixing Personal Drawings", () => {
    resetTestDatabase(true);

    // Cashier is forbidden from accessing financial ledger
    assert.throws(
      () =>
        getFinancialLedgerAndKurSummary({
          storeId: DEFAULT_STORE_ID,
          actorRole: "CASHIER",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "FORBIDDEN_ROLE");
        assert.equal(err.statusCode, 403);
        return true;
      }
    );

    const summary = getFinancialLedgerAndKurSummary({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
    });
    assert.equal(summary.balances.availableKulakanCashRp, 14850000);
    assert.equal(summary.balances.lockedPoCashRp, 2025000);
    assert.equal(summary.balances.netProfitBalanceRp, 4465000);
    assert.equal(summary.balances.coverageRatio, 2.3);

    // Owner cannot withdraw personal funds exceeding netProfitBalanceRp (4,465,000)
    assert.throws(
      () =>
        recordOwnerCapitalAdjustment({
          storeId: DEFAULT_STORE_ID,
          actorRole: "OWNER",
          adjustmentType: "OWNER_DRAWING",
          amountRp: 6000000, // > 4,465,000 net profit!
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "DRAWING_EXCEEDS_NET_PROFIT");
        assert.match(err.message, /Saldo Kas Siap Kulakan dilindungi/);
        return true;
      }
    );

    // Reinvesting 500,000 from Net Profit into Kas Siap Kulakan succeeds
    const reinvestRes = recordOwnerCapitalAdjustment({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      adjustmentType: "PROFIT_REINVESTMENT",
      amountRp: 500000,
    });
    assert.equal(reinvestRes.availableKulakanCashAfterRp, 15350000);
    assert.equal(reinvestRes.netProfitBalanceAfterRp, 3965000);
  });

  await t.test("FR-802: PO Cash Allocation Locking & OCR Settlement Lifecycle", () => {
    resetTestDatabase(true);

    // Lock Rp 1.500.000 for a new PO
    const lockRes = runAtomicTransaction((db) =>
      lockPoCashAllocationInTx(
        db,
        DEFAULT_STORE_ID,
        "#PO-2611-03",
        1500000,
        "Grosir Makmur Cold-Chain"
      )
    );
    assert.equal(lockRes.availableKulakanCashAfterRp, 13350000); // 14,850,000 - 1,500,000
    assert.equal(lockRes.lockedPoCashAfterRp, 3525000); // 2,025,000 + 1,500,000

    // Settle #PO-2611-02 (Rp 2.025.000) when goods arrive via Vision OCR
    const settleRes = runAtomicTransaction((db) =>
      settlePoCashAllocationInTx(
        db,
        DEFAULT_STORE_ID,
        "#PO-2611-02",
        2025000,
        "Batch FN-219"
      )
    );
    assert.equal(settleRes.availableKulakanCashAfterRp, 13350000);
    assert.equal(settleRes.lockedPoCashAfterRp, 1500000);

    // Reject locking PO exceeding availableKulakanCashRp
    assert.throws(
      () =>
        runAtomicTransaction((db) =>
          lockPoCashAllocationInTx(
            db,
            DEFAULT_STORE_ID,
            "#PO-OVER-LIMIT",
            50000000,
            "Supplier Mahal"
          )
        ),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "INSUFFICIENT_KULAKAN_CASH");
        return true;
      }
    );
  });

  await t.test("FR-803: Idempotent Daily 24-Hour Freezer Electricity Expense Recording", () => {
    resetTestDatabase(true);

    // 2026-11-16 is already recorded in seed (ELEC-20261116 or ELEC-261116); let's record for 2026-11-17
    const firstRun = recordDailyFreezerElectricityExpense({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      dateIso: "2026-11-17",
    });
    assert.equal(firstRun.alreadyRecorded, false);
    assert.equal(firstRun.elecCostRp, 45000);
    assert.equal(firstRun.netProfitBalanceAfterRp, 4420000); // 4,465,000 - 45,000

    // Second run on the same date (2026-11-17) must be idempotent and NOT deduct twice!
    const secondRun = recordDailyFreezerElectricityExpense({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      dateIso: "2026-11-17",
    });
    assert.equal(secondRun.alreadyRecorded, true);
    assert.equal(secondRun.netProfitBalanceAfterRp, 4420000);
  });

  await t.test("FR-804, FR-805 & US-802: 1-Click KUR Bank Verification Package Export & Pro Tier Gate", () => {
    resetTestDatabase(true);

    const exported = exportKurBankVerificationPackage({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      periodMonths: 3,
    });

    assert.ok(exported.documentNumber.startsWith("KUR-BAS-"));
    assert.ok(exported.integrityHash.startsWith("SHA256:"));
    assert.ok(exported.report.kurReadiness.eligibilityScore >= 85);
    assert.equal(exported.report.verifiedPurchaseOrders.length, 1);
    assert.equal(
      exported.report.verifiedPurchaseOrders[0].poNumber,
      "#PO-2611-02"
    );

    // Downgrade to FREEMIUM_STARTER -> KUR PDF export must be blocked (BMC Page 5)
    updateStoreSubscriptionTier({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      targetTier: "FREEMIUM_STARTER",
    });

    assert.throws(
      () =>
        exportKurBankVerificationPackage({
          storeId: DEFAULT_STORE_ID,
          actorRole: "OWNER",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "SUBSCRIPTION_PRO_REQUIRED");
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });
});

