import assert from "node:assert/strict";
import test from "node:test";
import { resetTestDatabase } from "../lib/db/client.ts";
import { DEFAULT_STORE_ID } from "../lib/db/seed.ts";
import { ManajerkuAppError } from "../lib/services/platform-core.ts";
import { runHybridSupplierDiscovery } from "../lib/services/supplier-discovery.ts";
import {
  approveAndDispatchRfqToSuppliers,
  approveAndIssuePurchaseOrder,
  identifyWhatsappSender,
  processSupplierRfqReply,
} from "../lib/services/whatsapp-ai-procurement.ts";

test("PRD-05 Suite: Dual-Role WhatsApp AI Agent, Multi-Turn Auto-RFQ & PO Issuance", async (t) => {
  await t.test(
    "FR-501: Dynamic Phone Number Identity Routing (Owner vs Cashier vs Supplier vs Reseller vs Unknown)",
    () => {
      resetTestDatabase(true);

      const ownerId = identifyWhatsappSender("0822-9860-6699");
      assert.equal(ownerId.actorType, "OWNER");

      const cashierId = identifyWhatsappSender("0822-1111-2222");
      assert.equal(cashierId.actorType, "CASHIER");

      const suppId = identifyWhatsappSender("+628116800101");
      assert.equal(suppId.actorType, "SUPPLIER");
      assert.equal(suppId.displayName, "CV Beku Jaya Distribusi");

      const resellerId = identifyWhatsappSender("+6285260001001");
      assert.equal(resellerId.actorType, "RESELLER");
      assert.equal(resellerId.displayName, "Burger Bang Jago");

      const unknownId = identifyWhatsappSender("089912345678");
      assert.equal(unknownId.actorType, "UNKNOWN");
    },
  );

  await t.test(
    "FR-502, FR-503, FR-504, FR-505 & US-501/US-502: End-to-End Multi-Turn 4-Slot Negotiation, Plafon Check & Atomic PO Approval",
    async () => {
      resetTestDatabase(true);

      // 1. Create a new RFQ draft via Hybrid Discovery for Nugget Crispy 500g (5 Dus)
      const disc = await runHybridSupplierDiscovery({
        storeId: DEFAULT_STORE_ID,
        productId: "prod-nugget-500",
        requestedQtyBoxes: 5,
        createRfqDraft: true,
      });
      const rfqId = disc.createdRfqSession!.rfqSessionId;

      // 2. Cashier is forbidden from approving RFQ dispatch (Human-in-the-Loop Gate #1)
      assert.throws(
        () =>
          approveAndDispatchRfqToSuppliers({
            storeId: DEFAULT_STORE_ID,
            actorRole: "CASHIER",
            rfqSessionId: rfqId,
          }),
        (err: unknown) => {
          assert.ok(err instanceof ManajerkuAppError);
          assert.equal(err.code, "FORBIDDEN_RFQ_APPROVAL");
          assert.equal(err.statusCode, 403);
          return true;
        },
      );

      // 3. Owner approves 1-click RFQ dispatch to 3 suppliers
      const dispatchRes = approveAndDispatchRfqToSuppliers({
        storeId: DEFAULT_STORE_ID,
        actorRole: "OWNER",
        rfqSessionId: rfqId,
      });
      assert.equal(dispatchRes.status, "NEGOTIATING");
      assert.equal(dispatchRes.dispatchedCount, 3);
      assert.equal(dispatchRes.dispatchedMessages[1].rateLimitDelaySec, 5);

      // 4. US-501 Scenario 1: Supplier 2 (Grosir Makmur +628116800102) replies with ONLY 2 variables (Price & MOQ)
      const turn1 = await processSupplierRfqReply({
        storeId: DEFAULT_STORE_ID,
        rfqSessionId: rfqId,
        supplierPhone: "+628116800102",
        messageText: "Ada bos, harga Rp 420rb per dus minimal ambil 15 dus ya",
      });
      assert.equal(turn1.slotCompletenessStatus, "NEGOTIATING");
      assert.equal(turn1.updatedSlotState.slot_price_per_box, 420000);
      assert.equal(turn1.updatedSlotState.slot_moq_boxes, 15);
      assert.equal(turn1.updatedSlotState.slot_batch_expiry_date, null);
      assert.equal(turn1.updatedSlotState.slot_freezer_delivery, null);
      assert.match(turn1.agentReplyToSupplier, /tanggal kedaluwarsa/);
      assert.match(turn1.agentReplyToSupplier, /mobil box freezer/);
      assert.equal(turn1.ownerPhone, "+6282298606699");
      assert.ok(turn1.ownerNotificationMessage);
      assert.match(turn1.ownerNotificationMessage, /Respon Supplier/);
      assert.match(turn1.ownerNotificationMessage, /Grosir Makmur/);

      // 5. Turn 2 from Supplier 2 completes the remaining 2 variables!
      const turn2 = await processSupplierRfqReply({
        storeId: DEFAULT_STORE_ID,
        rfqSessionId: rfqId,
        supplierPhone: "+628116800102",
        messageText:
          "Batch exp Agu 2027, pengiriman pakai mobil freezer kok Kak",
      });
      assert.equal(turn2.slotCompletenessStatus, "COMPLETE");
      assert.equal(turn2.updatedSlotState.slot_batch_expiry_date, "2027-08-14");
      assert.equal(turn2.updatedSlotState.slot_freezer_delivery, true);

      // 6. US-501 Scenario 2: Supplier 1 (CV Beku Jaya +628116800101) replies with all 4 variables in 1 turn!
      const supp1Reply = await processSupplierRfqReply({
        storeId: DEFAULT_STORE_ID,
        rfqSessionId: rfqId,
        supplierPhone: "+628116800101",
        messageText:
          "Ready 5 dus harga Rp 405rb/dus, MOQ 5 dus, batch exp 14 Okt 2027, kita antar pakai mobil freezer sore ini",
      });
      assert.equal(supp1Reply.slotCompletenessStatus, "COMPLETE");
      assert.ok(supp1Reply.ownerRecommendationMessage);
      assert.match(
        supp1Reply.ownerRecommendationMessage,
        /1\. CV Beku Jaya(?: Distribusi)? \(★4\.8\): Rp 405rb\/dus/,
      );
      assert.match(
        supp1Reply.ownerRecommendationMessage,
        /✓ PO Rp 2\.025\.000 Aman \(13,6% Kas\)/,
      );

      // 7. US-502 Scenario 2 (Security Negative Case): Cashier phone or Supplier phone cannot approve PO
      assert.throws(
        () =>
          approveAndIssuePurchaseOrder({
            storeId: DEFAULT_STORE_ID,
            senderPhone: "+6282211112222", // Cashier phone!
            rfqSessionId: rfqId,
            selectedOptionRank: 1,
          }),
        (err: unknown) => {
          assert.ok(err instanceof ManajerkuAppError);
          assert.equal(err.code, "FORBIDDEN_PO_APPROVAL");
          assert.equal(err.statusCode, 403);
          return true;
        },
      );

      // 8. US-502 Scenario 1 (Happy Path): Owner approves PO #1 -> PO PDF issued & Rp 2.025.000 locked in Cash Ledger
      const poRes = approveAndIssuePurchaseOrder({
        storeId: DEFAULT_STORE_ID,
        senderPhone: "+6282298606699", // Owner phone!
        rfqSessionId: rfqId,
        selectedOptionRank: 1,
        deliveryNotes: "Setujui PO #1, kirim sore ini",
      });

      assert.equal(poRes.poNumber, "#PO-2611-03");
      assert.equal(poRes.supplierName, "CV Beku Jaya Distribusi");
      assert.equal(poRes.totalAmountRp, 2025000);
      assert.equal(poRes.availableKulakanCashAfterRp, 12825000); // 14,850,000 - 2,025,000
      assert.equal(poRes.b2bCommissionAmountRp, 25313);
    },
  );
});
