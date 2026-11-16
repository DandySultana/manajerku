import test from "node:test";
import assert from "node:assert/strict";
import { resetTestDatabase, getDb } from "../lib/db/client.ts";
import { DEFAULT_STORE_ID } from "../lib/db/seed.ts";
import { processInboundVisionOcr } from "../lib/services/vision-ocr-receiving.ts";

test("PRD-06 Suite: Multimodal Vision OCR Inbound Box Receiving & PO Settlement", async (t) => {
  await t.test("FR-601, FR-602, FR-603 & US-601 Scenario 1: Happy Path Vision OCR Converts 5 Boxes to 100 Packs, Inserts FEFO Batch & Settles PO", () => {
    resetTestDatabase(true);
    const db = getDb();

    const ocrRes = processInboundVisionOcr({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      imageUrl: "Foto_Label_Kardus_BekuJaya.jpg",
      captionText: "Barang baru sampai, tolong input ke stok FEFO ya",
      labelTextHint: "Nugget Crispy 500g | 5 Dus | Batch FN-219 | Exp 14 Okt 2027",
      referenceDate: "2026-11-16",
    });

    assert.equal(ocrRes.status, "AUTO_COMMITTED");
    assert.equal(
      ocrRes.whatsappReplyMessage,
      "✅ Vision OCR Selesai! 5 Dus (100 Pack) Nugget Crispy Batch FN-219 (Exp 14 Okt 2027) otomatis masuk antrean FEFO!"
    );
    assert.ok(ocrRes.createdBatch);
    assert.equal(ocrRes.createdBatch.initialQtyPacks, 100);
    assert.equal(ocrRes.createdBatch.expiryDate, "2027-10-14");
    assert.equal(ocrRes.createdBatch.ropState.isBelowRop, false);
    assert.equal(ocrRes.reconciledPoNumber, "#PO-2611-02");

    // Verify #PO-2611-02 is now RECEIVED_OCR and locked PO cash is settled to 0
    const poRow = db
      .prepare("SELECT status FROM purchase_orders WHERE po_number = '#PO-2611-02'")
      .get() as { status: string };
    assert.equal(poRow.status, "RECEIVED_OCR");

    const latestLedger = db
      .prepare(
        "SELECT entry_type, locked_po_cash_after FROM cash_ledger WHERE store_id = ? ORDER BY rowid DESC LIMIT 1"
      )
      .get(DEFAULT_STORE_ID) as { entry_type: string; locked_po_cash_after: number };
    assert.equal(latestLedger.entry_type, "PO_SETTLEMENT");
    assert.equal(latestLedger.locked_po_cash_after, 0);
  });

  await t.test("FR-602 Exception Handling: Blurry Photo (<0.85 Confidence) & Expired Inbound Box Rejection", () => {
    resetTestDatabase(true);

    // 1. Blurry photo (simulatedConfidence = 0.60) must NOT auto-commit
    const blurryRes = processInboundVisionOcr({
      storeId: DEFAULT_STORE_ID,
      actorRole: "CASHIER",
      labelTextHint: "Nugget Crispy 500g Batch FN-219",
      simulatedConfidence: 0.6,
      referenceDate: "2026-11-16",
    });
    assert.equal(blurryRes.status, "NEEDS_CONFIRMATION");
    assert.equal(blurryRes.createdBatch, null);

    // 2. Expired box label (Exp 10 Nov 2026 < 16 Nov 2026) must be REJECTED_EXPIRED
    const expiredRes = processInboundVisionOcr({
      storeId: DEFAULT_STORE_ID,
      actorRole: "CASHIER",
      labelTextHint: "Sosis Sapi Bakar 1kg | 3 Dus | Batch SS-OLD | Exp 2026-11-10",
      referenceDate: "2026-11-16",
    });
    assert.equal(expiredRes.status, "REJECTED_EXPIRED");
    assert.equal(expiredRes.createdBatch, null);
    assert.match(expiredRes.whatsappReplyMessage, /PERINGATAN.*sudah lewat/);
  });

  await t.test("US-601 Scenario 2 & Month-Year Edge Case: Partial Delivery Confirmation & Conservative Day-01 Expiry", () => {
    resetTestDatabase(true);

    // #PO-2611-02 ordered 5 Dus, but caption says 4 Dus arrived -> prompts confirmation first
    const partialPrompt = processInboundVisionOcr({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      captionText: "Barang baru sampai 4 dus dulu ya",
      labelTextHint: "Nugget Crispy 500g | Batch FN-220 | EXP OKT 2027",
      confirmPartialReceipt: false,
      referenceDate: "2026-11-16",
    });
    assert.equal(partialPrompt.status, "NEEDS_CONFIRMATION");
    assert.match(partialPrompt.whatsappReplyMessage, /selisih jumlah dus/);

    // Now confirm partial receipt -> commits 4 Dus (80 Pack) and parses "EXP OKT 2027" conservatively as "2027-10-01"
    const partialCommit = processInboundVisionOcr({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      captionText: "Barang baru sampai 4 dus dulu ya",
      labelTextHint: "Nugget Crispy 500g | Batch FN-220 | EXP OKT 2027",
      confirmPartialReceipt: true,
      referenceDate: "2026-11-16",
    });
    assert.equal(partialCommit.status, "AUTO_COMMITTED");
    assert.equal(partialCommit.createdBatch?.initialQtyPacks, 80);
    assert.equal(partialCommit.createdBatch?.expiryDate, "2027-10-01");
  });
});

