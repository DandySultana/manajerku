import test from "node:test";
import assert from "node:assert/strict";
import { resetTestDatabase, getDb } from "../lib/db/client.ts";
import { DEFAULT_STORE_ID } from "../lib/db/seed.ts";
import {
  addInventoryBatch,
  createMasterProduct,
  evaluateStoreFefoRadar,
  listInventoryProducts,
  writeOffInventoryBatch,
} from "../lib/services/fefo-inventory.ts";
import { ManajerkuAppError } from "../lib/services/platform-core.ts";

test("PRD-03 Suite: Cold-Chain Inventory Management & FEFO Batch Queue", async (t) => {
  await t.test("FR-301: Master SKU Multi-Unit Creation, Validation & RBAC Protection", () => {
    resetTestDatabase(true);

    // Cashier is forbidden from creating Master SKUs
    assert.throws(
      () =>
        createMasterProduct({
          storeId: DEFAULT_STORE_ID,
          actorRole: "CASHIER",
          skuCode: "SKU-KEB-500",
          name: "Kulit Kebab Beku 500g",
          packsPerBox: 20,
          retailPricePerPack: 20000,
          wholesalePricePerBox: 360000,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "FORBIDDEN_ROLE");
        assert.equal(err.statusCode, 403);
        return true;
      }
    );

    // Reject wholesale price higher than retail * packsPerBox
    assert.throws(
      () =>
        createMasterProduct({
          storeId: DEFAULT_STORE_ID,
          actorRole: "OWNER",
          skuCode: "SKU-KEB-500",
          name: "Kulit Kebab Beku 500g",
          packsPerBox: 20,
          retailPricePerPack: 20000,
          wholesalePricePerBox: 450000, // > 20 * 20000 (400000)
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "WHOLESALE_EXCEEDS_RETAIL");
        return true;
      }
    );

    // Owner successfully creates Master SKU
    const created = createMasterProduct({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      skuCode: "SKU-KEB-500",
      name: "Kulit Kebab Beku 500g",
      packsPerBox: 20,
      retailPricePerPack: 20000,
      wholesalePricePerBox: 360000,
      reorderPointPacks: 40,
    });
    assert.equal(created.skuCode, "SKU-KEB-500");
    assert.equal(created.packsPerBox, 20);
    assert.equal(created.isBelowRop, true);
  });

  await t.test("FR-302 & FR-304: FEFO Queue Ordering (Closest Expiry First) & ROP Clearing", () => {
    resetTestDatabase(true);

    // Initially prod-nugget-500 has 24 packs in Batch #NG26-09 (Exp 2026-12-04) and ROP = 40 -> isBelowRop = true
    const beforeProds = listInventoryProducts(DEFAULT_STORE_ID, "2026-11-16");
    const nuggetBefore = beforeProds.find((p) => p.id === "prod-nugget-500")!;
    assert.equal(nuggetBefore.isBelowRop, true);
    assert.equal(nuggetBefore.totalHealthyPacks, 24);
    assert.equal(nuggetBefore.firstFefoPickingBatch?.batchNumber, "Batch #NG26-09");

    // Add a batch with LATER expiry (2027-10-14, 5 Dus = 100 Pack)
    const laterBatch = addInventoryBatch({
      storeId: DEFAULT_STORE_ID,
      productId: "prod-nugget-500",
      batchNumber: "Batch FN-219",
      qtyBoxes: 5,
      expiryDate: "2027-10-14",
      receivedVia: "VISION_OCR",
      referenceDate: "2026-11-16",
    });
    assert.equal(laterBatch.initialQtyPacks, 100);
    assert.equal(laterBatch.fefoStatus, "SAFE");
    // Must be rank #2 because Batch #NG26-09 expires earlier (2026-12-04)
    assert.equal(laterBatch.fefoQueueRank, 2);
    // Total stock is now 124 packs (> 40 ROP), so isBelowRop becomes false!
    assert.equal(laterBatch.ropState.isBelowRop, false);

    // Now add an even EARLIER batch (Exp 2026-11-28 -> 12 days remaining)
    const earlierBatch = addInventoryBatch({
      storeId: DEFAULT_STORE_ID,
      productId: "prod-nugget-500",
      batchNumber: "Batch #NG-URGENT",
      qtyPacks: 10,
      expiryDate: "2026-11-28",
      referenceDate: "2026-11-16",
    });
    assert.equal(earlierBatch.fefoQueueRank, 1);
    assert.equal(earlierBatch.fefoStatus, "CRITICAL");

    const afterProds = listInventoryProducts(DEFAULT_STORE_ID, "2026-11-16");
    const nuggetAfter = afterProds.find((p) => p.id === "prod-nugget-500")!;
    assert.equal(
      nuggetAfter.firstFefoPickingBatch?.batchNumber,
      "Batch #NG-URGENT"
    );
  });

  await t.test("FR-303 & US-301: Expiry Radar Classification (SAFE, PRIORITY_FEFO <30d, CRITICAL <=18d, EXPIRED <=0d) & Auto-Promo Draft", () => {
    resetTestDatabase(true);

    // US-301 Scenario 1: Batch with 24 days remaining (2026-12-10 from 2026-11-16) -> PRIORITY_FEFO + auto promo draft
    const prioBatch = addInventoryBatch({
      storeId: DEFAULT_STORE_ID,
      productId: "prod-dimsum-500",
      batchNumber: "Batch #DM-PRIO24",
      qtyBoxes: 2,
      expiryDate: "2026-12-10",
      referenceDate: "2026-11-16",
    });
    assert.equal(prioBatch.daysToExpiry, 24);
    assert.equal(prioBatch.fefoStatus, "PRIORITY_FEFO");
    assert.ok(prioBatch.autoCreatedPromoDraftId);

    // Expired batch (2026-11-10 < 2026-11-16) -> EXPIRED & excluded from healthy stock
    const expBatch = addInventoryBatch({
      storeId: DEFAULT_STORE_ID,
      productId: "prod-dimsum-500",
      batchNumber: "Batch #DM-EXP01",
      qtyBoxes: 1,
      expiryDate: "2026-11-10",
      referenceDate: "2026-11-16",
    });
    assert.equal(expBatch.fefoStatus, "EXPIRED");
    assert.equal(expBatch.fefoQueueRank, null); // Blocked from FEFO picking queue!

    // Evaluate store-wide radar when date advances to 2026-11-25
    const radarRes = evaluateStoreFefoRadar({
      storeId: DEFAULT_STORE_ID,
      referenceDate: "2026-11-25",
    });
    assert.ok(radarRes.criticalCount >= 3);
  });

  await t.test("FR-305: Write-Off Expired Batch & Record Loss in Cash Ledger", () => {
    resetTestDatabase(true);
    const db = getDb();

    const expBatch = addInventoryBatch({
      storeId: DEFAULT_STORE_ID,
      productId: "prod-bakso-500",
      batchNumber: "Batch #BK-EXPIRED",
      qtyPacks: 10,
      unitCogsPack: 19500,
      expiryDate: "2026-11-01",
      referenceDate: "2026-11-16",
    });

    // Cashier cannot write off
    assert.throws(
      () =>
        writeOffInventoryBatch({
          storeId: DEFAULT_STORE_ID,
          actorRole: "CASHIER",
          batchId: expBatch.batchId,
          reason: "EXPIRED",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "FORBIDDEN_ROLE");
        return true;
      }
    );

    // Owner writes off expired batch
    const writeOffRes = writeOffInventoryBatch({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      batchId: expBatch.batchId,
      reason: "EXPIRED",
    });
    assert.equal(writeOffRes.writtenOffPacks, 10);
    assert.equal(writeOffRes.remainingPacks, 0);
    assert.equal(writeOffRes.newStatus, "WRITTEN_OFF");
    assert.equal(writeOffRes.lossAmountRp, 195000);

    // Verify ledger entry created
    const ledgerRow = db
      .prepare(
        "SELECT * FROM cash_ledger WHERE store_id = ? AND entry_type = 'EXPIRED_WRITE_OFF_LOSS' ORDER BY created_at DESC LIMIT 1"
      )
      .get(DEFAULT_STORE_ID) as { amount: number; reference_id: string } | undefined;

    assert.ok(ledgerRow);
    assert.equal(ledgerRow.amount, -195000);
    assert.equal(ledgerRow.reference_id, "Batch #BK-EXPIRED");
  });
});

