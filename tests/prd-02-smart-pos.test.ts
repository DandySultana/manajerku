import test from "node:test";
import assert from "node:assert/strict";
import { resetTestDatabase, getDb } from "../lib/db/client.ts";
import { DEFAULT_STORE_ID } from "../lib/db/seed.ts";
import {
  addInventoryBatch,
  createMasterProduct,
  listFefoBatches,
} from "../lib/services/fefo-inventory.ts";
import {
  executePosCheckout,
  getPosCatalog,
  getPosReceiptById,
} from "../lib/services/smart-pos.ts";
import { ManajerkuAppError } from "../lib/services/platform-core.ts";

test("PRD-02 Suite: Smart POS Multi-Unit & Atomic FEFO Checkout", async (t) => {
  await t.test("FR-201, FR-202, FR-203 & US-201 Scenario 1: Multi-Batch FEFO Deduction & Box-to-Pack Conversion", () => {
    resetTestDatabase(true);

    // Create a dedicated test SKU (1 Dus = 10 Pack) with Batch A (15 Pack, Exp 2026-12-10) and Batch B (20 Pack, Exp 2027-01-20)
    const testSku = createMasterProduct({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      skuCode: "SKU-TEST-KNT",
      name: "Kentang Test MultiBatch 1kg",
      packsPerBox: 10,
      retailPricePerPack: 35000,
      wholesalePricePerBox: 320000,
      standardCogsPerPack: 24000,
      reorderPointPacks: 20,
    });

    const batchA = addInventoryBatch({
      storeId: DEFAULT_STORE_ID,
      productId: testSku.id,
      batchNumber: "Batch-A-DEC",
      qtyPacks: 15,
      unitCogsPack: 24000,
      expiryDate: "2026-12-20",
      referenceDate: "2026-11-16",
    });

    const batchB = addInventoryBatch({
      storeId: DEFAULT_STORE_ID,
      productId: testSku.id,
      batchNumber: "Batch-B-JAN",
      qtyPacks: 20,
      unitCogsPack: 25000,
      expiryDate: "2027-01-20",
      referenceDate: "2026-11-16",
    });

    // Purchase 2 Dus (20 Pack) by Reseller "Burger Bang Jago" (reseller-01) with QRIS
    const checkoutRes = executePosCheckout({
      storeId: DEFAULT_STORE_ID,
      actorRole: "CASHIER",
      resellerId: "reseller-01",
      paymentMethod: "QRIS",
      items: [
        {
          productId: testSku.id,
          soldUnitType: "BOX",
          soldQty: 2, // 2 Dus = 20 Pack
        },
      ],
    });

    assert.equal(checkoutRes.customerName, "Burger Bang Jago");
    assert.equal(checkoutRes.customerTypeLabel, "Reseller Terdaftar");
    assert.equal(checkoutRes.totalAmountRp, 640000); // 2 * 320,000
    // COGS = (15 * 24,000) + (5 * 25,000) = 360,000 + 125,000 = 485,000
    assert.equal(checkoutRes.totalCogsRp, 485000);
    assert.equal(checkoutRes.grossProfitRp, 155000);

    // Verify Batch A is DEPLETED (15 packs deducted) and Batch B has 15 packs left (5 packs deducted)
    const allocs = checkoutRes.items[0].batchAllocations;
    assert.equal(allocs.length, 2);
    assert.equal(allocs[0].batchId, batchA.batchId);
    assert.equal(allocs[0].packsDeducted, 15);
    assert.equal(allocs[1].batchId, batchB.batchId);
    assert.equal(allocs[1].packsDeducted, 5);

    const remainingBatches = listFefoBatches({
      storeId: DEFAULT_STORE_ID,
      productId: testSku.id,
    });
    assert.equal(remainingBatches.length, 1);
    assert.equal(remainingBatches[0].id, batchB.batchId);
    assert.equal(remainingBatches[0].currentQtyPacks, 15);
  });

  await t.test("US-201 Scenario 2: Block POS Checkout When Stock Only Exists in Expired Batch", () => {
    resetTestDatabase(true);

    const skuExp = createMasterProduct({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      skuCode: "SKU-EXP-ONLY",
      name: "Sosis Kedaluwarsa Test",
      packsPerBox: 10,
      retailPricePerPack: 30000,
      wholesalePricePerBox: 280000,
    });

    // Add 10 packs to a batch that already expired (2026-11-01 < 2026-11-16)
    addInventoryBatch({
      storeId: DEFAULT_STORE_ID,
      productId: skuExp.id,
      batchNumber: "Batch-EXP-X",
      qtyPacks: 10,
      expiryDate: "2026-11-01",
      referenceDate: "2026-11-16",
    });

    assert.throws(
      () =>
        executePosCheckout({
          storeId: DEFAULT_STORE_ID,
          actorRole: "CASHIER",
          paymentMethod: "CASH",
          cashReceived: 50000,
          items: [
            {
              productId: skuExp.id,
              soldUnitType: "PACK",
              soldQty: 1,
            },
          ],
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "EXPIRED_STOCK_BLOCKED");
        assert.match(err.message, /melewati tanggal kedaluwarsa dan diblokir/);
        return true;
      }
    );
  });

  await t.test("FR-204 & US-202 Scenario 1: Automatic ROP Trigger Creates New Auto-RFQ Session When Stock Drops <= ROP", () => {
    resetTestDatabase(true);
    const db = getDb();

    // Create a SKU with ROP = 40 Pack and initial stock = 45 Pack
    const skuRop = createMasterProduct({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      skuCode: "SKU-ROP-TRIG",
      name: "Dimsum Spesial Trigger ROP",
      packsPerBox: 20,
      retailPricePerPack: 28000,
      wholesalePricePerBox: 520000,
      reorderPointPacks: 40,
      defaultReorderBoxes: 5,
    });

    addInventoryBatch({
      storeId: DEFAULT_STORE_ID,
      productId: skuRop.id,
      batchNumber: "Batch-ROP-01",
      qtyPacks: 45,
      expiryDate: "2027-06-01",
      referenceDate: "2026-11-16",
    });

    // Sell 10 Packs -> remaining stock = 35 Packs (<= 40 ROP!)
    const saleRes = executePosCheckout({
      storeId: DEFAULT_STORE_ID,
      actorRole: "CASHIER",
      paymentMethod: "CASH",
      cashReceived: 300000,
      items: [
        {
          productId: skuRop.id,
          soldUnitType: "PACK",
          soldQty: 10,
        },
      ],
    });

    assert.equal(saleRes.changeAmountRp, 20000); // 300,000 - 280,000
    assert.equal(saleRes.triggeredRfqSessions.length, 1);
    assert.equal(saleRes.triggeredRfqSessions[0].productId, skuRop.id);
    assert.equal(saleRes.triggeredRfqSessions[0].healthyStockPacks, 35);

    // Verify RFQ session exists in database with 3 candidate suppliers
    const rfqRow = db
      .prepare("SELECT * FROM rfq_sessions WHERE id = ?")
      .get(saleRes.triggeredRfqSessions[0].rfqSessionId) as
      | { status: string; trigger_source: string; supplier_quotes_json: string }
      | undefined;

    assert.ok(rfqRow);
    assert.equal(rfqRow.status, "AWAITING_OWNER_RFQ_APPROVAL");
    assert.equal(rfqRow.trigger_source, "AUTO_ROP");
    const quotes = JSON.parse(rfqRow.supplier_quotes_json);
    assert.equal(quotes.length, 3);
  });

  await t.test("FR-205: Receipt Retrieval & Catalog Verification", () => {
    resetTestDatabase(true);

    const catalog = getPosCatalog(DEFAULT_STORE_ID);
    assert.ok(catalog.products.length >= 5);
    assert.equal(catalog.resellers.length, 14);

    const receipt = getPosReceiptById("#INV-2611-49");
    assert.equal(receipt.invoiceNumber, "#INV-2611-49");
    assert.equal(receipt.customerName, "Burger Bang Jago");
    assert.equal(receipt.totalAmountRp, 908000);
    assert.equal(receipt.items.length, 3);
  });
});

