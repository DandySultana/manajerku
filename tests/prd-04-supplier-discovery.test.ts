import test from "node:test";
import assert from "node:assert/strict";
import { resetTestDatabase } from "../lib/db/client.ts";
import { DEFAULT_STORE_ID } from "../lib/db/seed.ts";
import {
  calculateB2BCommissionAmount,
  calculateHaversineDistanceKm,
  listSuppliersDirectory,
  registerVerifiedSupplier,
  runHybridSupplierDiscovery,
} from "../lib/services/supplier-discovery.ts";
import { ManajerkuAppError } from "../lib/services/platform-core.ts";

test("PRD-04 Suite: Hybrid Supplier Discovery & B2B Verified Supplier Directory", async (t) => {
  await t.test("FR-401, FR-402, FR-403 & US-401: Shared Cache Hit Optimization, Geospatial Filtering (<=10km, >=4.5) & Top 3 Ranking", async () => {
    resetTestDatabase(true);

    const discRes = await runHybridSupplierDiscovery({
      storeId: DEFAULT_STORE_ID,
      productId: "prod-nugget-500",
      requestedQtyBoxes: 5,
      maxRadiusKm: 10.0,
      minRating: 4.5,
      createRfqDraft: true,
    });

    // US-401 Scenario 2: Shared Cache Hit (0 external API calls made!)
    assert.equal(discRes.cacheHit, true);
    assert.equal(discRes.apiCallsMade, 0);
    assert.equal(discRes.top3Candidates.length, 3);

    // Top 1 must be CV Beku Jaya Distribusi (★4.8, B2B Verified Partner, Rp 405rb/dus)
    assert.equal(discRes.top3Candidates[0].name, "CV Beku Jaya Distribusi");
    assert.equal(discRes.top3Candidates[0].googleRating, 4.8);
    assert.ok(discRes.top3Candidates[0].distanceKm <= 10.0);

    // Must create RFQ session in AWAITING_OWNER_RFQ_APPROVAL state
    assert.ok(discRes.createdRfqSession);
    assert.equal(
      discRes.createdRfqSession.status,
      "AWAITING_OWNER_RFQ_APPROVAL"
    );
  });

  await t.test("FR-404: Register B2B Verified Supplier, Filter Threshold Validation & Commission Calculation", () => {
    resetTestDatabase(true);

    // Reject supplier with rating < 4.5
    assert.throws(
      () =>
        registerVerifiedSupplier({
          storeId: DEFAULT_STORE_ID,
          actorRole: "OWNER",
          name: "Distributor Rating Rendah",
          phoneWhatsapp: "081233334444",
          address: "Banda Aceh",
          googleRating: 4.1, // < 4.5
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "RATING_BELOW_THRESHOLD");
        return true;
      }
    );

    // Register valid B2B Verified Supplier
    const created = registerVerifiedSupplier({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      name: "PT Samudera Beku Aceh",
      phoneWhatsapp: "081233334444",
      address: "Peunayong, Banda Aceh",
      googleRating: 4.9,
      isVerifiedB2BPartner: true,
      commissionRatePct: 1.5,
    });

    assert.equal(created.phoneWhatsapp, "+6281233334444");
    assert.equal(created.isVerifiedB2BPartner, true);
    assert.equal(created.commissionRatePct, 1.5);

    const dir = listSuppliersDirectory(DEFAULT_STORE_ID);
    assert.equal(dir.suppliers.length, 4);

    // Commission calculation: 1.25% of Rp 2.025.000 = Rp 25.313
    const comm = calculateB2BCommissionAmount(2025000, true, 1.25);
    assert.equal(comm, 25313);

    const dist = calculateHaversineDistanceKm(5.56829, 95.36375, 5.5451, 95.3175);
    assert.ok(dist > 0 && dist <= 10.0);
  });
});

