import crypto from "node:crypto";
import { getDb, runAtomicTransaction } from "../db/client.ts";
import { DEFAULT_STORE_ID } from "../db/seed.ts";
import {
  enforceProFeatureAccess,
  ManajerkuAppError,
  normalizePhoneE164,
  type UserRole,
} from "./platform-core.ts";

/**
 * Calculates great-circle distance in kilometers between two GPS coordinates using Haversine formula.
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

/**
 * FR-404: Calculate B2B Verified Supplier Commission (1.0% - 1.5% per PO)
 */
export function calculateB2BCommissionAmount(
  totalPoAmountRp: number,
  isVerifiedB2BPartner: boolean,
  commissionRatePct: number
): number {
  if (!isVerifiedB2BPartner || commissionRatePct <= 0) return 0;
  const clampedRate = Math.min(1.5, Math.max(1.0, commissionRatePct));
  return Math.round(totalPoAmountRp * (clampedRate / 100));
}

export interface DiscoverSuppliersInput {
  storeId?: string;
  productId: string;
  requestedQtyBoxes?: number;
  maxRadiusKm?: number;
  minRating?: number;
  forceRefreshApi?: boolean;
  createRfqDraft?: boolean;
}

/**
 * FR-401, FR-402, FR-403: Hybrid Supplier Discovery (Shared Cache First + Google Places Official API)
 * Filters: Radius <= 10 km, Rating >= 4.5, Active WhatsApp Number
 */
export async function runHybridSupplierDiscovery(input: DiscoverSuppliersInput) {
  const storeId = input.storeId || DEFAULT_STORE_ID;
  const maxRadiusKm = input.maxRadiusKm ?? 10.0;
  const minRating = input.minRating ?? 4.5;

  // Requires Manajerku Pro subscription (BMC Page 5)
  enforceProFeatureAccess(storeId, "AI_DISCOVERY");

  const db = getDb();
  const store = db
    .prepare("SELECT id, latitude, longitude FROM stores WHERE id = ?")
    .get(storeId) as
    | { id: string; latitude: number; longitude: number }
    | undefined;

  if (!store) {
    throw new ManajerkuAppError("STORE_NOT_FOUND", "Toko tidak ditemukan.", 404);
  }

  const product = db
    .prepare("SELECT * FROM products WHERE id = ? AND store_id = ?")
    .get(input.productId, storeId) as
    | {
        id: string;
        sku_code: string;
        name: string;
        default_reorder_boxes: number;
      }
    | undefined;

  if (!product) {
    throw new ManajerkuAppError("PRODUCT_NOT_FOUND", "Produk tidak ditemukan.", 404);
  }

  // Step 1: Query Shared Cache First (FR-401)
  const allCached = db
    .prepare(
      `SELECT * FROM suppliers
       WHERE is_whatsapp_active = 1 AND google_rating >= ?`
    )
    .all(minRating) as Array<{
    id: string;
    google_place_id: string | null;
    name: string;
    phone_whatsapp: string;
    is_whatsapp_active: number;
    address: string;
    latitude: number;
    longitude: number;
    distance_km: number;
    google_rating: number;
    user_ratings_total: number;
    is_verified_b2b_partner: number;
    commission_rate_pct: number;
    cached_catalog_json: string;
  }>;

  const evaluateCandidates = (radiusLimit: number) =>
    allCached
      .map((s) => {
        const dist = calculateHaversineDistanceKm(
          store.latitude,
          store.longitude,
          s.latitude,
          s.longitude
        );
        const catalog = JSON.parse(s.cached_catalog_json || "{}") as Record<
          string,
          { price_per_box?: number; moq_boxes?: number; last_batch_exp?: string }
        >;
        const cachedSkuQuote = catalog[product.sku_code] || null;
        return {
          id: s.id,
          googlePlaceId: s.google_place_id,
          name: s.name,
          phoneWhatsapp: s.phone_whatsapp,
          address: s.address,
          latitude: s.latitude,
          longitude: s.longitude,
          distanceKm: dist,
          googleRating: s.google_rating,
          userRatingsTotal: s.user_ratings_total,
          isVerifiedB2BPartner: Boolean(s.is_verified_b2b_partner),
          commissionRatePct: s.commission_rate_pct,
          cachedPricePerBoxRp: cachedSkuQuote?.price_per_box ?? null,
          cachedMoqBoxes: cachedSkuQuote?.moq_boxes ?? null,
          isExpandedRadius: dist > maxRadiusKm,
        };
      })
      .filter((c) => c.distanceKm <= radiusLimit);

  let matched = evaluateCandidates(maxRadiusKm);
  let cacheHit = matched.length >= 3 && !input.forceRefreshApi;
  let apiCallsMade = 0;

  // Step 2: If Shared Cache Miss (< 3 suppliers) or forceRefreshApi, query Google Places Official API (FR-402)
  if (!cacheHit) {
    apiCallsMade = 1;
    const placesApiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (placesApiKey) {
      try {
        const res = await fetch(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": placesApiKey,
              "X-Goog-FieldMask":
                "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.nationalPhoneNumber,places.internationalPhoneNumber",
            },
            body: JSON.stringify({
              textQuery: `distributor agen grosir frozen food ${product.name}`,
              locationBias: {
                circle: {
                  center: {
                    latitude: store.latitude,
                    longitude: store.longitude,
                  },
                  radius: maxRadiusKm * 1000,
                },
              },
            }),
          }
        );
        if (res.ok) {
          const json = (await res.json()) as {
            places?: Array<{
              id: string;
              displayName?: { text?: string };
              formattedAddress?: string;
              location?: { latitude: number; longitude: number };
              rating?: number;
              userRatingCount?: number;
              internationalPhoneNumber?: string;
              nationalPhoneNumber?: string;
            }>;
          };
          for (const place of json.places || []) {
            if ((place.rating ?? 0) < minRating) continue;
            const rawPhone =
              place.internationalPhoneNumber || place.nationalPhoneNumber || "";
            try {
              const validWa = normalizePhoneE164(rawPhone);
              const lat = place.location?.latitude ?? store.latitude;
              const lng = place.location?.longitude ?? store.longitude;
              const dist = calculateHaversineDistanceKm(
                store.latitude,
                store.longitude,
                lat,
                lng
              );
              db.prepare(`
                INSERT OR IGNORE INTO suppliers (
                  id, store_id, google_place_id, name, phone_whatsapp, is_whatsapp_active,
                  address, latitude, longitude, distance_km, google_rating, user_ratings_total
                ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
              `).run(
                `supp-${crypto.randomUUID().slice(0, 8)}`,
                storeId,
                place.id,
                place.displayName?.text || "Distributor Frozen Food",
                validWa,
                place.formattedAddress || "Banda Aceh",
                lat,
                lng,
                dist,
                place.rating ?? 4.5,
                place.userRatingCount ?? 15
              );
            } catch {
              // Skip landline / non-WhatsApp phone numbers (Gap #1 solution)
            }
          }
        }
      } catch {
        // Fallback to local directory cache if network unavailable
      }
    }

    matched = evaluateCandidates(maxRadiusKm);
    // Secondary radius expansion up to 20 km if fewer than 3 found within 10 km (FR-402 Exception Handling)
    if (matched.length < 3) {
      matched = evaluateCandidates(20.0);
    }
  }

  // Step 3: Rank Candidates & Pick Top 3 (FR-403)
  matched.sort((a, b) => {
    if (a.isVerifiedB2BPartner !== b.isVerifiedB2BPartner) {
      return a.isVerifiedB2BPartner ? -1 : 1;
    }
    if (b.googleRating !== a.googleRating) {
      return b.googleRating - a.googleRating;
    }
    if (a.cachedPricePerBoxRp && b.cachedPricePerBoxRp) {
      return a.cachedPricePerBoxRp - b.cachedPricePerBoxRp;
    }
    return a.distanceKm - b.distanceKm;
  });

  const top3Candidates = matched.slice(0, 3);
  const qtyBoxes = input.requestedQtyBoxes ?? product.default_reorder_boxes;

  let createdRfqSession: {
    rfqSessionId: string;
    rfqCode: string;
    status: string;
  } | null = null;

  if (input.createRfqDraft !== false && top3Candidates.length > 0) {
    createdRfqSession = runAtomicTransaction((txDb) => {
      const rfqId = `rfq-${crypto.randomUUID().slice(0, 8)}`;
      const rfqCode = `RFQ-2611-${Math.floor(10 + Math.random() * 89)}`;
      const quotesPayload = top3Candidates.map((c) => ({
        supplier_id: c.id,
        supplier_name: c.name,
        phone: c.phoneWhatsapp,
        rating: c.googleRating,
        slot_price_per_box: null,
        slot_moq_boxes: null,
        slot_batch_expiry_date: null,
        slot_freezer_delivery: null,
        turn_count: 0,
        status: "PENDING_SEND",
      }));

      txDb
        .prepare(`
        INSERT INTO rfq_sessions (
          id, store_id, rfq_code, product_id, requested_qty_boxes,
          trigger_source, status, supplier_quotes_json
        ) VALUES (?, ?, ?, ?, ?, 'MANUAL', 'AWAITING_OWNER_RFQ_APPROVAL', ?)
      `)
        .run(
          rfqId,
          storeId,
          rfqCode,
          product.id,
          qtyBoxes,
          JSON.stringify(quotesPayload)
        );

      return {
        rfqSessionId: rfqId,
        rfqCode,
        status: "AWAITING_OWNER_RFQ_APPROVAL",
      };
    });
  }

  return {
    storeId,
    productId: product.id,
    productName: product.name,
    requestedQtyBoxes: qtyBoxes,
    filterCriteria: {
      maxRadiusKm,
      minRating,
      whatsappActiveRequired: true,
    },
    cacheHit,
    apiCallsMade,
    top3Candidates,
    createdRfqSession,
  };
}

/**
 * List All Verified Suppliers in Directory + B2B Commission Summary (FR-404)
 */
export function listSuppliersDirectory(storeId = DEFAULT_STORE_ID) {
  const db = getDb();
  const store = db
    .prepare("SELECT latitude, longitude FROM stores WHERE id = ?")
    .get(storeId) as { latitude: number; longitude: number } | undefined;

  const rows = db
    .prepare(
      `SELECT * FROM suppliers
       ORDER BY is_verified_b2b_partner DESC, google_rating DESC, distance_km ASC`
    )
    .all() as Array<{
    id: string;
    google_place_id: string | null;
    name: string;
    phone_whatsapp: string;
    is_whatsapp_active: number;
    address: string;
    latitude: number;
    longitude: number;
    distance_km: number;
    google_rating: number;
    user_ratings_total: number;
    is_verified_b2b_partner: number;
    commission_rate_pct: number;
    cached_catalog_json: string;
    last_synced_at: string;
  }>;

  const commAgg = db
    .prepare(
      `SELECT COALESCE(SUM(b2b_commission_amount), 0) as total_commission,
              COUNT(*) as total_pos
       FROM purchase_orders WHERE store_id = ? AND status != 'CANCELLED'`
    )
    .get(storeId) as { total_commission: number; total_pos: number };

  return {
    suppliers: rows.map((r) => ({
      id: r.id,
      googlePlaceId: r.google_place_id,
      name: r.name,
      phoneWhatsapp: r.phone_whatsapp,
      isWhatsappActive: Boolean(r.is_whatsapp_active),
      address: r.address,
      distanceKm: store
        ? calculateHaversineDistanceKm(
            store.latitude,
            store.longitude,
            r.latitude,
            r.longitude
          )
        : r.distance_km,
      googleRating: r.google_rating,
      userRatingsTotal: r.user_ratings_total,
      isVerifiedB2BPartner: Boolean(r.is_verified_b2b_partner),
      commissionRatePct: r.commission_rate_pct,
      cachedCatalog: JSON.parse(r.cached_catalog_json || "{}"),
      lastSyncedAt: r.last_synced_at,
    })),
    b2bCommissionSummary: {
      totalVerifiedPoCount: commAgg.total_pos,
      totalB2BCommissionEarnedRp: commAgg.total_commission,
    },
  };
}

export function registerVerifiedSupplier(params: {
  storeId?: string;
  actorRole: UserRole;
  name: string;
  phoneWhatsapp: string;
  address: string;
  latitude?: number;
  longitude?: number;
  googleRating: number;
  isVerifiedB2BPartner?: boolean;
  commissionRatePct?: number;
}) {
  const storeId = params.storeId || DEFAULT_STORE_ID;
  if (params.actorRole !== "OWNER" && params.actorRole !== "ADMIN") {
    throw new ManajerkuAppError(
      "FORBIDDEN_ROLE",
      "Hanya Owner atau Platform Admin yang dapat menambah distributor terverifikasi.",
      403
    );
  }

  const normalizedPhone = normalizePhoneE164(params.phoneWhatsapp);
  if (params.googleRating < 4.5 || params.googleRating > 5.0) {
    throw new ManajerkuAppError(
      "RATING_BELOW_THRESHOLD",
      "Sesuai standar kualitas Manajerku (BL-005), distributor wajib memiliki Rating ≥ 4.5.",
      400
    );
  }

  const db = getDb();
  const store = db
    .prepare("SELECT latitude, longitude FROM stores WHERE id = ?")
    .get(storeId) as { latitude: number; longitude: number } | undefined;

  const lat = params.latitude ?? (store ? store.latitude + 0.015 : 5.55);
  const lng = params.longitude ?? (store ? store.longitude + 0.015 : 95.33);
  const distKm = store
    ? calculateHaversineDistanceKm(store.latitude, store.longitude, lat, lng)
    : 2.5;

  const isB2B = Boolean(params.isVerifiedB2BPartner);
  const commRate = isB2B
    ? Math.min(1.5, Math.max(1.0, params.commissionRatePct ?? 1.25))
    : 0.0;

  const id = `supp-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO suppliers (
      id, store_id, google_place_id, name, phone_whatsapp, is_whatsapp_active,
      address, latitude, longitude, distance_km, google_rating, user_ratings_total,
      is_verified_b2b_partner, commission_rate_pct
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 50, ?, ?)
  `).run(
    id,
    storeId,
    `place-${id}`,
    params.name.trim(),
    normalizedPhone,
    params.address.trim(),
    lat,
    lng,
    distKm,
    Number(params.googleRating.toFixed(1)),
    isB2B ? 1 : 0,
    commRate
  );

  return {
    id,
    name: params.name.trim(),
    phoneWhatsapp: normalizedPhone,
    distanceKm: distKm,
    googleRating: Number(params.googleRating.toFixed(1)),
    isVerifiedB2BPartner: isB2B,
    commissionRatePct: commRate,
  };
}

export function updateVerifiedSupplier(params: {
  actorRole: UserRole;
  supplierId: string;
  name?: string;
  phoneWhatsapp?: string;
  address?: string;
  googleRating?: number;
  isVerifiedB2BPartner?: boolean;
  commissionRatePct?: number;
}) {
  if (params.actorRole !== "OWNER" && params.actorRole !== "ADMIN") {
    throw new ManajerkuAppError(
      "FORBIDDEN_ROLE",
      "Hanya Owner atau Platform Admin yang dapat mengubah data distributor.",
      403
    );
  }

  return runAtomicTransaction((db) => {
    const existing = db
      .prepare("SELECT * FROM suppliers WHERE id = ?")
      .get(params.supplierId) as
      | {
          id: string;
          name: string;
          phone_whatsapp: string;
          address: string;
          google_rating: number;
          is_verified_b2b_partner: number;
          commission_rate_pct: number;
        }
      | undefined;

    if (!existing) {
      throw new ManajerkuAppError(
        "SUPPLIER_NOT_FOUND",
        "Distributor tidak ditemukan.",
        404
      );
    }

    const nextName = params.name ? params.name.trim() : existing.name;
    const nextPhone = params.phoneWhatsapp
      ? normalizePhoneE164(params.phoneWhatsapp)
      : existing.phone_whatsapp;
    const nextAddress = params.address ? params.address.trim() : existing.address;
    const nextRating =
      params.googleRating !== undefined
        ? Number(params.googleRating.toFixed(1))
        : existing.google_rating;

    if (nextRating < 4.5 || nextRating > 5.0) {
      throw new ManajerkuAppError(
        "RATING_BELOW_THRESHOLD",
        "Rating distributor wajib berada dalam rentang 4.5 hingga 5.0.",
        400
      );
    }

    const nextIsB2B =
      params.isVerifiedB2BPartner !== undefined
        ? params.isVerifiedB2BPartner
        : Boolean(existing.is_verified_b2b_partner);
    const nextComm = nextIsB2B
      ? Math.min(
          1.5,
          Math.max(1.0, params.commissionRatePct ?? (existing.commission_rate_pct || 1.25))
        )
      : 0.0;

    db.prepare(`
      UPDATE suppliers
      SET name = ?, phone_whatsapp = ?, address = ?, google_rating = ?,
          is_verified_b2b_partner = ?, commission_rate_pct = ?, last_synced_at = datetime('now')
      WHERE id = ?
    `).run(
      nextName,
      nextPhone,
      nextAddress,
      nextRating,
      nextIsB2B ? 1 : 0,
      nextComm,
      existing.id
    );

    return {
      id: existing.id,
      name: nextName,
      phoneWhatsapp: nextPhone,
      address: nextAddress,
      googleRating: nextRating,
      isVerifiedB2BPartner: nextIsB2B,
      commissionRatePct: nextComm,
    };
  });
}

export function deleteVerifiedSupplier(params: {
  actorRole: UserRole;
  supplierId: string;
}) {
  if (params.actorRole !== "OWNER" && params.actorRole !== "ADMIN") {
    throw new ManajerkuAppError(
      "FORBIDDEN_ROLE",
      "Hanya Owner atau Platform Admin yang dapat menghapus distributor dari direktori.",
      403
    );
  }

  const db = getDb();
  const existing = db
    .prepare("SELECT id, name FROM suppliers WHERE id = ?")
    .get(params.supplierId) as { id: string; name: string } | undefined;

  if (!existing) {
    throw new ManajerkuAppError(
      "SUPPLIER_NOT_FOUND",
      "Distributor tidak ditemukan.",
      404
    );
  }

  db.prepare("UPDATE suppliers SET is_whatsapp_active = 0 WHERE id = ?").run(
    existing.id
  );

  return {
    deletedSupplierId: existing.id,
    supplierName: existing.name,
    deactivated: true,
  };
}

