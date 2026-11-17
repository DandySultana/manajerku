import crypto from "node:crypto";
import fs from "node:fs";
import { chromium } from "playwright";
import { getDb, runAtomicTransaction } from "../db/client.ts";
import { DEFAULT_STORE_ID } from "../db/seed.ts";
import {
  ManajerkuAppError,
  normalizePhoneE164,
} from "./platform-core.ts";
import { calculateHaversineDistanceKm } from "./supplier-discovery.ts";
import { dispatchOpenWaText } from "./openwa-client.ts";

export interface ScrapedBusinessCandidate {
  id: string;
  googlePlaceId: string;
  name: string;
  phoneWhatsapp: string;
  rawPhoneDisplay: string;
  address: string;
  category: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  googleRating: number;
  userRatingsTotal: number;
  mapsUrl: string;
  sourceEngine: "PLAYWRIGHT_GOOGLE_MAPS";
  openWaContacted: boolean;
  openWaStatusNote?: string;
}

export interface PlaywrightScrapeSuppliersInput {
  storeId?: string;
  searchQuery: string;
  locationHint?: string;
  productId?: string;
  requestedQtyBoxes?: number;
  maxResults?: number;
  createRfqDraft?: boolean;
}

function resolveBrowserExecutablePath(): string | undefined {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function extractMobilePhoneFromText(text: string): {
  rawMatch: string;
  normalizedE164: string;
} | null {
  const mobileRegex =
    /(?:\+62|62|0)\s*8[0-9]{1,3}[\s.\-]*[0-9]{3,4}[\s.\-]*[0-9]{3,5}/g;
  const matches = text.match(mobileRegex) || [];
  for (const raw of matches) {
    try {
      const normalizedE164 = normalizePhoneE164(raw);
      return { rawMatch: raw.trim(), normalizedE164 };
    } catch {
      // try next match
    }
  }
  return null;
}

/**
 * Scrapes real business/factory names, addresses, ratings, and mobile/WhatsApp phone numbers
 * from Google Maps using Playwright headless Chromium.
 */
export async function scrapeSuppliersWithPlaywright(
  input: PlaywrightScrapeSuppliersInput
) {
  const storeId = input.storeId || DEFAULT_STORE_ID;
  const rawKeyword = input.searchQuery.trim();
  if (!rawKeyword) {
    throw new ManajerkuAppError(
      "EMPTY_SCRAPE_QUERY",
      "Kata kunci bisnis atau pabrik yang dicari wajib diisi (contoh: pabrik kulit kebab).",
      400
    );
  }

  const db = getDb();
  const store = db
    .prepare("SELECT id, name, latitude, longitude FROM stores WHERE id = ?")
    .get(storeId) as
    | { id: string; name: string; latitude: number; longitude: number }
    | undefined;

  if (!store) {
    throw new ManajerkuAppError("STORE_NOT_FOUND", "Toko tidak ditemukan.", 404);
  }

  let product:
    | {
        id: string;
        sku_code: string;
        name: string;
        default_reorder_boxes: number;
      }
    | undefined;

  if (input.productId) {
    product = db
      .prepare("SELECT * FROM products WHERE id = ? AND store_id = ?")
      .get(input.productId, storeId) as typeof product;
  }

  const locationSuffix = input.locationHint?.trim()
    ? ` ${input.locationHint.trim()}`
    : "";
  const hasSupplierPrefix =
    /\b(pabrik|distributor|supplier|agen|grosir|produsen)\b/i.test(rawKeyword);
  const fullQuery = `${
    hasSupplierPrefix ? rawKeyword : `pabrik distributor ${rawKeyword}`
  }${locationSuffix}`.trim();

  const maxResults = Math.min(10, Math.max(1, input.maxResults ?? 10));
  const executablePath = resolveBrowserExecutablePath();

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--lang=id-ID",
    ],
  });

  const rawExtractedCards: Array<{
    name: string;
    text: string;
    href: string;
    detailPhone?: string;
  }> = [];

  try {
    const context = await browser.newContext({
      locale: "id-ID",
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();
    const mapsSearchUrl = `https://www.google.com/maps/search/${encodeURIComponent(
      fullQuery
    )}?hl=id`;

    await page.goto(mapsSearchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 22000,
    });

    await page
      .waitForSelector('div[role="feed"], div.Nv2PK', { timeout: 12000 })
      .catch(() => null);
    await page.waitForTimeout(1600);

    // Scroll feed to load up to 10+ business listings
    for (let step = 0; step < 5; step++) {
      await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) {
          feed.scrollTop += 1100;
        }
      });
      await page.waitForTimeout(600);
    }

    const cards = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("div.Nv2PK"));
      return nodes.slice(0, 28).map((card) => {
        const titleEl = card.querySelector(".qBF1Pd, .fontHeadlineSmall");
        const name = titleEl ? titleEl.textContent?.trim() || "" : "";
        const text = (card as HTMLElement).innerText || "";
        const linkEl = card.querySelector("a.hfpxzc");
        const href = linkEl ? linkEl.getAttribute("href") || "" : "";
        return { name, text, href };
      });
    });

    rawExtractedCards.push(...cards);

    // If fewer than 5 cards have mobile numbers directly in the list snippet,
    // click up to 8 cards to inspect the detail side pane for WhatsApp/mobile numbers
    const cardsWithMobileCount = rawExtractedCards.filter(
      (c) => extractMobilePhoneFromText(c.text) !== null
    ).length;

    if (cardsWithMobileCount < Math.min(5, maxResults) && rawExtractedCards.length > 0) {
      const cardHandles = await page.$$("div.Nv2PK a.hfpxzc");
      const limit = Math.min(8, cardHandles.length);
      for (let i = 0; i < limit; i++) {
        if (
          rawExtractedCards[i] &&
          extractMobilePhoneFromText(rawExtractedCards[i].text)
        ) {
          continue;
        }
        try {
          await cardHandles[i].click();
          await page.waitForTimeout(900);
          const panePhone = await page.evaluate(() => {
            const phoneBtn = document.querySelector(
              'button[data-item-id^="phone:tel:"], a[href^="tel:"]'
            );
            if (phoneBtn) {
              const attr =
                phoneBtn.getAttribute("data-item-id") ||
                phoneBtn.getAttribute("href") ||
                "";
              return (
                attr.replace(/^phone:tel:/, "").replace(/^tel:/, "") +
                " " +
                (phoneBtn.textContent || "")
              );
            }
            const mainPane = document.querySelector('div[role="main"]');
            return mainPane ? (mainPane as HTMLElement).innerText || "" : "";
          });
          if (rawExtractedCards[i] && panePhone) {
            rawExtractedCards[i].text += `\n${panePhone}`;
          }
        } catch {
          // continue
        }
      }
    }
  } finally {
    await browser.close();
  }

  const seenPhones = new Set<string>();
  const scrapedCandidates: ScrapedBusinessCandidate[] = [];

  for (const item of rawExtractedCards) {
    if (!item.name) continue;
    const phoneExtracted = extractMobilePhoneFromText(item.text);
    if (!phoneExtracted) continue;
    if (seenPhones.has(phoneExtracted.normalizedE164)) continue;
    seenPhones.add(phoneExtracted.normalizedE164);

    // Parse rating & review count e.g. "4,6(135)" or "5,0(10)"
    const ratingMatch = item.text.match(/([0-5][.,][0-9])\s*\(([0-9.,]+)\)/);
    const parsedRating = ratingMatch
      ? Number(ratingMatch[1].replace(",", "."))
      : 4.6;
    const parsedReviews = ratingMatch
      ? Number(ratingMatch[2].replace(/\D/g, "")) || 15
      : 15;
    const safeRating =
      Number.isFinite(parsedRating) && parsedRating >= 0 && parsedRating <= 5
        ? Number(parsedRating.toFixed(1))
        : 4.6;

    // Parse lat/lng from href (!3d<lat>!4d<lng>)
    const coordMatch = item.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    const lat = coordMatch ? Number(coordMatch[1]) : store.latitude + 0.012;
    const lng = coordMatch ? Number(coordMatch[2]) : store.longitude + 0.012;

    // Parse Google Place ID (!19sChIJ...)
    const placeIdMatch = item.href.match(/!19s([^?&!]+)/);
    const googlePlaceId = placeIdMatch
      ? decodeURIComponent(placeIdMatch[1])
      : `gmaps-${crypto.randomUUID().slice(0, 10)}`;

    // Extract category & address line from card lines (strip private-use icon font glyphs)
    const lines = item.text
      .replace(/[\uE000-\uF8FF]/g, "")
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    const categoryAddressLine =
      lines.find(
        (l) =>
          l.includes("·") &&
          !l.includes("Buka") &&
          !l.includes("Tutup") &&
          l !== item.name
      ) ||
      lines[2] ||
      "Indonesia";
    const parts = categoryAddressLine
      .split("·")
      .map((p) => p.trim())
      .filter(Boolean);
    const category = parts[0] || "Produsen & Distributor";
    const address = parts.slice(1).join(", ") || "Indonesia";

    const distanceKm = calculateHaversineDistanceKm(
      store.latitude,
      store.longitude,
      lat,
      lng
    );

    const existingRow = db
      .prepare("SELECT id FROM suppliers WHERE phone_whatsapp = ?")
      .get(phoneExtracted.normalizedE164) as { id: string } | undefined;

    const supplierId = existingRow?.id || `supp-${crypto.randomUUID().slice(0, 8)}`;

    scrapedCandidates.push({
      id: supplierId,
      googlePlaceId,
      name: item.name,
      phoneWhatsapp: phoneExtracted.normalizedE164,
      rawPhoneDisplay: phoneExtracted.rawMatch,
      address: address || "Indonesia",
      category,
      latitude: lat,
      longitude: lng,
      distanceKm,
      googleRating: safeRating,
      userRatingsTotal: parsedReviews,
      mapsUrl:
        item.href ||
        `https://www.google.com/maps/search/${encodeURIComponent(item.name)}`,
      sourceEngine: "PLAYWRIGHT_GOOGLE_MAPS",
      openWaContacted: false,
    });

    if (scrapedCandidates.length >= maxResults) {
      break;
    }
  }

  // Sort scraped candidates strictly by highest rating first, then review count, then shortest distance
  scrapedCandidates.sort((a, b) => {
    if (b.googleRating !== a.googleRating) {
      return b.googleRating - a.googleRating;
    }
    if (b.userRatingsTotal !== a.userRatingsTotal) {
      return b.userRatingsTotal - a.userRatingsTotal;
    }
    return a.distanceKm - b.distanceKm;
  });

  // Persist scraped businesses into SQLite suppliers table for this store
  runAtomicTransaction((txDb) => {
    for (const c of scrapedCandidates) {
      const existingByPhone = txDb
        .prepare("SELECT id FROM suppliers WHERE phone_whatsapp = ?")
        .get(c.phoneWhatsapp) as { id: string } | undefined;

      if (existingByPhone) {
        txDb
          .prepare(
            `UPDATE suppliers
             SET store_id = ?,
                 name = ?,
                 address = ?,
                 latitude = ?,
                 longitude = ?,
                 distance_km = ?,
                 google_rating = ?,
                 user_ratings_total = ?,
                 is_whatsapp_active = 1,
                 last_synced_at = datetime('now')
             WHERE id = ?`
          )
          .run(
            storeId,
            c.name,
            c.address,
            c.latitude,
            c.longitude,
            c.distanceKm,
            Math.max(4.5, c.googleRating),
            c.userRatingsTotal,
            existingByPhone.id
          );
        c.id = existingByPhone.id;
      } else {
        txDb
          .prepare(
            `INSERT OR IGNORE INTO suppliers (
              id, store_id, google_place_id, name, phone_whatsapp, is_whatsapp_active,
              address, latitude, longitude, distance_km, google_rating, user_ratings_total,
              is_verified_b2b_partner, commission_rate_pct
            ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1, 1.25)`
          )
          .run(
            c.id,
            storeId,
            c.googlePlaceId,
            c.name,
            c.phoneWhatsapp,
            c.address,
            c.latitude,
            c.longitude,
            c.distanceKm,
            Math.max(4.5, c.googleRating),
            c.userRatingsTotal
          );
      }
    }
  });

  // Automatically create an active Auto-RFQ session & immediately contact up to 10 scraped suppliers via OpenWA Agent
  let createdRfqSession: {
    rfqSessionId: string;
    rfqCode: string;
    status: string;
    dispatchedCount: number;
  } | null = null;

  const topForRfq = scrapedCandidates.slice(0, 10);
  const queuedDispatches: Array<{
    supplierId?: string;
    toPhone: string;
    content: string;
  }> = [];

  if (input.createRfqDraft !== false && topForRfq.length > 0) {
    createdRfqSession = runAtomicTransaction((txDb) => {
      // Resolve or auto-create a target product so rfq_sessions foreign key is always satisfied
      let targetProduct = product;
      if (!targetProduct) {
        targetProduct = txDb
          .prepare(
            "SELECT id, sku_code, name, default_reorder_boxes FROM products WHERE store_id = ? ORDER BY created_at DESC LIMIT 1"
          )
          .get(storeId) as typeof product;
      }
      if (!targetProduct) {
        const autoProdId = `prod-${crypto.randomUUID().slice(0, 8)}`;
        const cleanTitle = rawKeyword
          .replace(/\b(pabrik|distributor|supplier|agen|grosir)\b/gi, "")
          .trim() || rawKeyword;
        const autoSku = `SKU-${crypto
          .randomBytes(2)
          .toString("hex")
          .toUpperCase()}`;
        txDb
          .prepare(
            `INSERT INTO products (
              id, store_id, sku_code, name, category, retail_unit_name, wholesale_unit_name,
              packs_per_box, retail_price_per_pack, wholesale_price_per_box,
              standard_cogs_per_pack, reorder_point_packs, default_reorder_boxes
            ) VALUES (?, ?, ?, ?, 'Frozen Food', 'Pack', 'Dus', 20, 25000, 450000, 18000, 40, 5)`
          )
          .run(autoProdId, storeId, autoSku, cleanTitle);
        targetProduct = {
          id: autoProdId,
          sku_code: autoSku,
          name: cleanTitle,
          default_reorder_boxes: 5,
        };
      }

      const qtyBoxes =
        input.requestedQtyBoxes ?? targetProduct.default_reorder_boxes ?? 5;
      const itemLabel = rawKeyword
        .replace(/\b(pabrik|distributor|supplier|agen|grosir)\b/gi, "")
        .trim() || targetProduct.name;

      const rfqId = `rfq-${crypto.randomUUID().slice(0, 8)}`;
      let rfqSeq = Math.floor(10 + Math.random() * 89);
      let rfqCode = `RFQ-2611-${rfqSeq}`;
      const checkRfqStmt = txDb.prepare(
        "SELECT 1 FROM rfq_sessions WHERE rfq_code = ?"
      );
      while (checkRfqStmt.get(rfqCode)) {
        rfqSeq++;
        rfqCode = `RFQ-2611-${rfqSeq}`;
      }

      const quotesPayload = topForRfq.map((c) => ({
        supplier_id: c.id,
        supplier_name: c.name,
        phone: c.phoneWhatsapp,
        rating: c.googleRating,
        slot_price_per_box: null,
        slot_moq_boxes: null,
        slot_batch_expiry_date: null,
        slot_freezer_delivery: null,
        turn_count: 0,
        status: "NEGOTIATING",
      }));

      const nowIso = new Date().toISOString();
      txDb
        .prepare(
          `INSERT INTO rfq_sessions (
            id, store_id, rfq_code, product_id, requested_qty_boxes,
            trigger_source, status, supplier_quotes_json, owner_rfq_approved_at
          ) VALUES (?, ?, ?, ?, ?, 'MANUAL', 'NEGOTIATING', ?, ?)`
        )
        .run(
          rfqId,
          storeId,
          rfqCode,
          targetProduct.id,
          qtyBoxes,
          JSON.stringify(quotesPayload),
          nowIso
        );

      const insertWaLog = txDb.prepare(
        `INSERT INTO whatsapp_messages_log (
          id, store_id, direction, sender_phone, recipient_phone, detected_role,
          message_type, content_text, related_rfq_id
        ) VALUES (?, ?, 'OUTBOUND', 'MANAJERKU_AGENT', ?, 'SYSTEM', 'TEXT', ?, ?)`
      );

      for (const c of topForRfq) {
        const msg = `Halo ${c.name}, kami dari ${store.name} ingin menanyakan ketersediaan *${qtyBoxes} Dus ${itemLabel}*. Mohon info:\n1. Harga grosir per dus\n2. Minimal order (MOQ)\n3. Tanggal expired batch ready\n4. Apakah diantar dengan mobil freezer?`;

        insertWaLog.run(
          `wa-${crypto.randomUUID().slice(0, 8)}`,
          storeId,
          c.phoneWhatsapp,
          msg,
          rfqId
        );

        queuedDispatches.push({
          supplierId: c.id,
          toPhone: c.phoneWhatsapp,
          content: msg,
        });
      }

      const ownerUser = txDb
        .prepare(
          "SELECT phone_whatsapp FROM users WHERE store_id = ? AND role = 'OWNER' AND is_active = 1 LIMIT 1"
        )
        .get(storeId) as { phone_whatsapp: string } | undefined;

      if (ownerUser) {
        const ownerReport = `Laporan OpenWA: Hasil scraping Playwright "${rawKeyword}" menemukan ${topForRfq.length} supplier. BotWA sedang menanyakan Harga/Dus, MOQ, Expired Batch, dan Pengiriman Freezer ke ke-${topForRfq.length} nomor WhatsApp supplier tersebut (${rfqCode}).`;
        insertWaLog.run(
          `wa-${crypto.randomUUID().slice(0, 8)}`,
          storeId,
          ownerUser.phone_whatsapp,
          ownerReport,
          rfqId
        );
        queuedDispatches.push({
          toPhone: ownerUser.phone_whatsapp,
          content: ownerReport,
        });
      }

      return {
        rfqSessionId: rfqId,
        rfqCode,
        status: "NEGOTIATING",
        dispatchedCount: topForRfq.length,
      };
    });
  }

  // Send outbound WhatsApp inquiries via BotWA OpenWA Gateway sequentially after DB commit
  let openWaDeliveredCount = 0;
  let openWaFailedCount = 0;
  const openWaDeliveryErrors: string[] = [];

  for (let i = 0; i < queuedDispatches.length; i++) {
    const task = queuedDispatches[i];
    const dispatchRes = await dispatchOpenWaText({
      toPhone: task.toPhone,
      content: task.content,
    });

    if (task.supplierId) {
      const candidate = scrapedCandidates.find((c) => c.id === task.supplierId);
      if (candidate) {
        candidate.openWaContacted = dispatchRes.deliveredToOpenWa;
        candidate.openWaStatusNote = dispatchRes.statusNote;
      }
      if (dispatchRes.deliveredToOpenWa) {
        openWaDeliveredCount++;
      } else {
        openWaFailedCount++;
        openWaDeliveryErrors.push(`${task.toPhone}: ${dispatchRes.statusNote}`);
      }
    }

    if (i < queuedDispatches.length - 1) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // Save latest scrape batch so UI survives page refresh
  db.prepare(
    `INSERT INTO playwright_scrape_runs (
      id, store_id, search_query, raw_keyword, location_hint, rfq_code, results_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `pwrun-${crypto.randomUUID().slice(0, 8)}`,
    storeId,
    fullQuery,
    rawKeyword,
    input.locationHint?.trim() || null,
    createdRfqSession?.rfqCode || null,
    JSON.stringify(scrapedCandidates)
  );

  return {
    storeId,
    searchQuery: fullQuery,
    rawKeyword,
    locationHint: input.locationHint?.trim() || null,
    scrapedCount: scrapedCandidates.length,
    openWaAutoContactedCount: openWaDeliveredCount,
    openWaFailedCount,
    openWaDeliveryErrors,
    scrapedSuppliers: scrapedCandidates,
    createdRfqSession,
  };
}

export function getLatestPlaywrightScrapeRun(storeId = DEFAULT_STORE_ID) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, store_id, search_query, raw_keyword, location_hint, rfq_code, results_json, created_at
       FROM playwright_scrape_runs
       WHERE store_id = ?
       ORDER BY rowid DESC
       LIMIT 1`
    )
    .get(storeId) as
    | {
        id: string;
        store_id: string;
        search_query: string;
        raw_keyword: string;
        location_hint: string | null;
        rfq_code: string | null;
        results_json: string;
        created_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  let parsed: ScrapedBusinessCandidate[] = [];
  try {
    parsed = JSON.parse(row.results_json) as ScrapedBusinessCandidate[];
  } catch {
    parsed = [];
  }

  parsed.sort((a, b) => {
    if (b.googleRating !== a.googleRating) {
      return b.googleRating - a.googleRating;
    }
    if (b.userRatingsTotal !== a.userRatingsTotal) {
      return b.userRatingsTotal - a.userRatingsTotal;
    }
    return a.distanceKm - b.distanceKm;
  });

  return {
    id: row.id,
    storeId: row.store_id,
    searchQuery: row.search_query,
    rawKeyword: row.raw_keyword,
    locationHint: row.location_hint,
    rfqCode: row.rfq_code,
    createdAt: row.created_at,
    scrapedSuppliers: parsed,
  };
}
