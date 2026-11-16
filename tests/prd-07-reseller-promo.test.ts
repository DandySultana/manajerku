import test from "node:test";
import assert from "node:assert/strict";
import { resetTestDatabase } from "../lib/db/client.ts";
import { DEFAULT_STORE_ID } from "../lib/db/seed.ts";
import {
  executeFefoResellerPromoBroadcast,
  listDownstreamResellers,
  listFefoPromoCampaigns,
  registerDownstreamReseller,
} from "../lib/services/reseller-promo-broadcast.ts";
import { executePosCheckout } from "../lib/services/smart-pos.ts";
import { ManajerkuAppError } from "../lib/services/platform-core.ts";

test("PRD-07 Suite: Downstream Reseller FEFO Promo Broadcast & End-to-End Clearance", async (t) => {
  await t.test("FR-701: Downstream Reseller Directory Listing & New Reseller Registration", () => {
    resetTestDatabase(true);

    const existing = listDownstreamResellers(DEFAULT_STORE_ID);
    assert.equal(existing.length, 14);
    assert.equal(existing[0].businessName, "Bakso & Sosis Bakar Neusu");

    const added = registerDownstreamReseller({
      storeId: DEFAULT_STORE_ID,
      businessName: "Burger Kampus Darussalam",
      contactName: "Bang Dani",
      phoneWhatsapp: "085277778888",
      culinarySegment: "BURGER",
    });
    assert.equal(added.phoneWhatsapp, "+6285277778888");

    const after = listDownstreamResellers(DEFAULT_STORE_ID);
    assert.equal(after.length, 15);
  });

  await t.test("FR-702, FR-703 & US-701 Scenario 1 & 2: 1-Click Promo Broadcast, POS Discount Sync & Auto-Stop When Batch Sold Out", () => {
    resetTestDatabase(true);

    const drafts = listFefoPromoCampaigns(DEFAULT_STORE_ID, "2026-11-16");
    assert.ok(drafts.length >= 1);
    const sosisPromo = drafts.find((d) => d.id === "promo-fefo-sosis-01")!;
    assert.equal(sosisPromo.status, "DRAFT_READY");
    assert.equal(sosisPromo.discountPct, 20.0);

    // Cashier is forbidden from approving broadcast
    assert.throws(
      () =>
        executeFefoResellerPromoBroadcast({
          storeId: DEFAULT_STORE_ID,
          actorRole: "CASHIER",
          campaignId: sosisPromo.id,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "FORBIDDEN_ROLE");
        assert.equal(err.statusCode, 403);
        return true;
      }
    );

    // Owner executes 1-click broadcast to 14 resellers
    const broadcastRes = executeFefoResellerPromoBroadcast({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      campaignId: sosisPromo.id,
    });
    assert.equal(broadcastRes.status, "ACTIVE_SENT");
    assert.equal(broadcastRes.sentCount, 14);
    assert.equal(broadcastRes.deliveries.length, 14);
    assert.equal(broadcastRes.deliveries[1].rateLimitDelaySec, 3);

    // US-701 Scenario 2: Reseller buys all remaining 25 packs of Sosis (10 in batch-crit-02 + 15 in batch-prio-01) at POS
    const posSale = executePosCheckout({
      storeId: DEFAULT_STORE_ID,
      actorRole: "CASHIER",
      resellerId: "reseller-01",
      paymentMethod: "QRIS",
      items: [
        {
          productId: "prod-sosis-1000",
          soldUnitType: "PACK",
          soldQty: 25,
        },
      ],
    });

    // Verify 20% promo discount was applied automatically at POS!
    // Normal price = 25 * 45,000 = 1,125,000; 20% discount = 225,000; Net = 900,000
    assert.equal(posSale.totalDiscountRp, 225000);
    assert.equal(posSale.totalAmountRp, 900000);

    // Verify campaign status automatically transitioned to COMPLETED_SOLD_OUT!
    const afterCampaigns = listFefoPromoCampaigns(DEFAULT_STORE_ID, "2026-11-16");
    const completedPromo = afterCampaigns.find(
      (c) => c.id === "promo-fefo-sosis-01"
    )!;
    assert.equal(completedPromo.status, "COMPLETED_SOLD_OUT");
  });
});

