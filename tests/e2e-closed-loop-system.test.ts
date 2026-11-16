import test from "node:test";
import assert from "node:assert/strict";
import { resetTestDatabase } from "../lib/db/client.ts";
import { DEFAULT_STORE_ID } from "../lib/db/seed.ts";
import { getCommandCenterSummary, getUnifiedTransactions } from "../lib/services/platform-core.ts";
import { executePosCheckout } from "../lib/services/smart-pos.ts";
import {
  approveAndDispatchRfqToSuppliers,
  approveAndIssuePurchaseOrder,
  processSupplierRfqReply,
} from "../lib/services/whatsapp-ai-procurement.ts";
import { processInboundVisionOcr } from "../lib/services/vision-ocr-receiving.ts";
import { executeFefoResellerPromoBroadcast } from "../lib/services/reseller-promo-broadcast.ts";
import {
  exportKurBankVerificationPackage,
  recordDailyFreezerElectricityExpense,
} from "../lib/services/finance-kur.ts";

test("System-Wide E2E Closed-Loop Verification (PRD-01 through PRD-08)", async () => {
  resetTestDatabase(true);

  // 1. Verify initial Command Center state (PRD-01)
  const initialSummary = getCommandCenterSummary({
    storeId: DEFAULT_STORE_ID,
    viewerRole: "OWNER",
  });
  assert.equal(initialSummary.kpis.kasSiapKulakan.amountRp, 14850000);
  assert.equal(
    initialSummary.aiAndFefoHealth.batchSummary.totalActiveBatches,
    24
  );

  // 2. Step 1 & 2 (PRD-02 -> PRD-03 -> PRD-04): Cashier records multi-unit sale of Sosis Sapi Bakar 1kg
  // (Sosis has 25 packs <= 30 ROP and no open RFQ/PO yet -> automatically triggers Hybrid Supplier Discovery & RFQ draft!)
  const checkoutRes = executePosCheckout({
    storeId: DEFAULT_STORE_ID,
    actorRole: "CASHIER",
    resellerId: "reseller-01",
    paymentMethod: "QRIS",
    items: [
      {
        productId: "prod-sosis-1000",
        soldUnitType: "PACK",
        soldQty: 5,
      },
    ],
  });

  assert.equal(checkoutRes.triggeredRfqSessions.length, 1);
  const autoRfqId = checkoutRes.triggeredRfqSessions[0].rfqSessionId;

  // 3. Step 3 (PRD-05): Owner grants 1-click approval to send Auto-RFQ to 3 suppliers
  const dispatchRes = approveAndDispatchRfqToSuppliers({
    storeId: DEFAULT_STORE_ID,
    actorRole: "OWNER",
    rfqSessionId: autoRfqId,
  });
  assert.equal(dispatchRes.status, "NEGOTIATING");

  // Supplier replies with all 4 mandatory variables
  const negoRes = await processSupplierRfqReply({
    storeId: DEFAULT_STORE_ID,
    rfqSessionId: autoRfqId,
    supplierPhone: "+628116800101",
    messageText:
      "Ready 4 dus sosis harga Rp 480rb/dus, MOQ 4 dus, batch exp 20 Nov 2027, diantar mobil freezer",
  });
  assert.equal(negoRes.slotCompletenessStatus, "COMPLETE");
  assert.equal(negoRes.rfqStatus, "AWAITING_OWNER_PO_APPROVAL");

  // 4. Step 4 (PRD-05 -> PRD-08): Owner approves PO #1 in 1 click -> locks cash & issues PO PDF
  const poRes = approveAndIssuePurchaseOrder({
    storeId: DEFAULT_STORE_ID,
    senderPhone: "+6282298606699",
    rfqSessionId: autoRfqId,
    selectedOptionRank: 1,
    deliveryNotes: "Setujui PO #1, kirim sore ini",
  });
  assert.equal(poRes.totalAmountRp, 1920000); // 4 Dus * Rp 480.000
  assert.equal(poRes.status, "APPROVED_WA");

  // 5. Step 5 (PRD-06 -> PRD-03 & PRD-08): Goods arrive, Vision OCR reads cardboard box label & injects into FEFO queue
  const ocrRes = processInboundVisionOcr({
    storeId: DEFAULT_STORE_ID,
    actorRole: "CASHIER",
    captionText: "Sosis baru sampai 4 dus sesuai PO",
    labelTextHint: "Sosis Sapi Bakar 1kg | 4 Dus | Batch SS-901 | Exp 20 Nov 2027",
    referenceDate: "2026-11-16",
  });
  assert.equal(ocrRes.status, "AUTO_COMMITTED");
  assert.equal(ocrRes.createdBatch?.initialQtyPacks, 60); // 4 Dus * 15 Pack/Dus = 60 Pack!
  assert.equal(ocrRes.createdBatch?.ropState.isBelowRop, false); // Stock is now 80 Packs (> 30 ROP)!
  assert.equal(ocrRes.reconciledPoNumber, poRes.poNumber);

  // 6. Step 6 (PRD-07 & PRD-08): Owner broadcasts FEFO promo to 14 resellers, records daily freezer electricity, and exports KUR PDF
  const promoRes = executeFefoResellerPromoBroadcast({
    storeId: DEFAULT_STORE_ID,
    actorRole: "OWNER",
    campaignId: "promo-fefo-sosis-01",
  });
  assert.equal(promoRes.status, "ACTIVE_SENT");
  assert.equal(promoRes.sentCount, 14);

  const elecRes = recordDailyFreezerElectricityExpense({
    storeId: DEFAULT_STORE_ID,
    actorRole: "OWNER",
    dateIso: "2026-11-17",
  });
  assert.equal(elecRes.elecCostRp, 45000);

  const kurPdf = exportKurBankVerificationPackage({
    storeId: DEFAULT_STORE_ID,
    actorRole: "OWNER",
    periodMonths: 3,
  });
  assert.equal(kurPdf.report.verifiedPurchaseOrders.length, 2);

  // Verify Unified Sync Table in Command Center reflects all new POS and PO records
  const syncTable = getUnifiedTransactions({
    storeId: DEFAULT_STORE_ID,
    filterType: "ALL",
  });
  assert.equal(syncTable.totalCount, 4); // 2 POs + 2 POS Invoices
});

