"use client";

import React, { useState, useEffect, useCallback } from "react";
import { formatRp } from "./CommandCenterDashboard";
import { useGooeyToastFlash } from "./GooeyToastProvider";

interface SupplierDirItem {
  id: string;
  googlePlaceId: string | null;
  name: string;
  phoneWhatsapp: string;
  isWhatsappActive: boolean;
  address: string;
  distanceKm: number;
  googleRating: number;
  userRatingsTotal: number;
  isVerifiedB2BPartner: boolean;
  commissionRatePct: number;
  cachedCatalog: Record<
    string,
    {
      price_per_box?: number;
      moq_boxes?: number;
      freezer_delivery?: boolean;
      last_batch_exp?: string;
    }
  >;
}

interface ProductSimple {
  id: string;
  skuCode: string;
  name: string;
  wholesalePricePerBox: number;
  defaultReorderBoxes: number;
  isBelowRop: boolean;
}

interface SupplierQuoteItem {
  supplier_id: string;
  supplier_name: string;
  phone: string;
  rating: number;
  slot_price_per_box: number | null;
  slot_moq_boxes: number | null;
  slot_batch_expiry_date: string | null;
  slot_freezer_delivery: boolean | null;
  turn_count: number;
  status: string;
}

interface RfqSessionItem {
  id: string;
  rfqCode: string;
  productId: string;
  productName: string;
  skuCode: string;
  requestedQtyBoxes: number;
  triggerSource: string;
  status: string;
  quotes: SupplierQuoteItem[];
  bestPricePerBoxRp: number | null;
  estimatedPoTotalRp: number | null;
  cashUsagePct: number | null;
}

interface PurchaseOrderItem {
  id: string;
  poNumber: string;
  supplierName: string;
  supplierPhone: string;
  productName: string;
  orderQtyBoxes: number;
  orderQtyPacks: number;
  agreedPricePerBoxRp: number;
  totalAmountRp: number;
  cashUsagePct: number;
  promisedBatchExpiry: string;
  deliveryNotes: string | null;
  status: string;
  pdfDocumentUrl: string;
  b2bCommissionAmountRp: number;
}

interface WaMsgItem {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  senderPhone: string;
  recipientPhone: string;
  detectedRole: string;
  messageType: string;
  contentText: string;
  mediaUrl: string | null;
  createdAt: string;
}

interface PoPdfDetail {
  id: string;
  po_number: string;
  supplier_name: string;
  supplier_phone: string;
  supplier_address: string;
  product_name: string;
  sku_code: string;
  order_qty_boxes: number;
  order_qty_packs: number;
  agreed_price_per_box: number;
  total_amount: number;
  promised_batch_expiry: string;
  status: string;
  b2b_commission_amount: number;
}

interface PlaywrightScrapedItem {
  id: string;
  name: string;
  phoneWhatsapp: string;
  rawPhoneDisplay: string;
  address: string;
  category: string;
  googleRating: number;
  userRatingsTotal: number;
  distanceKm: number;
  mapsUrl: string;
}

function formatMonthYearId(isoDate: string | null | undefined): string {
  if (!isoDate) return "-";
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "Mei",
    "Jun",
    "Jul",
    "Agu",
    "Sep",
    "Okt",
    "Nov",
    "Des",
  ];
  const parts = isoDate.slice(0, 10).split("-");
  if (parts.length < 2) return isoDate;
  const year = parts[0];
  const month = months[Number(parts[1]) - 1] || parts[1];
  return `${month} ${year}`;
}

function formatDayMonthYearId(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  const parts = isoDate.slice(0, 10).split("-");
  if (parts.length !== 3) return isoDate;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "Mei",
    "Jun",
    "Jul",
    "Agu",
    "Sep",
    "Okt",
    "Nov",
    "Des",
  ];
  const month = months[Number(parts[1]) - 1] || parts[1];
  return `${Number(parts[2])} ${month} ${parts[0]}`;
}

function formatTimeWib(isoStr: string): string {
  try {
    const dt = new Date(
      isoStr.includes("T") ? isoStr : `${isoStr.replace(" ", "T")}Z`
    );
    if (Number.isNaN(dt.getTime())) return "-";
    const wib = new Date(dt.getTime() + 7 * 60 * 60 * 1000);
    return `${wib.getUTCHours().toString().padStart(2, "0")}:${wib
      .getUTCMinutes()
      .toString()
      .padStart(2, "0")} WIB`;
  } catch {
    return "-";
  }
}

function formatRelativeTimeId(isoStr: string | null | undefined): string | null {
  if (!isoStr) return null;
  const dt = new Date(
    isoStr.includes("T") ? isoStr : `${isoStr.replace(" ", "T")}Z`
  );
  if (Number.isNaN(dt.getTime())) return null;
  const diffSec = Math.max(0, Math.round((Date.now() - dt.getTime()) / 1000));
  if (diffSec < 60) return "Baru saja";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} mnt lalu`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours} jam lalu`;
  return formatTimeWib(isoStr);
}

function shortenSupplierName(name: string): string {
  return name.replace(/\s+Distribusi$/i, "").trim();
}

export default function SupplierDiscoveryView({
  activeStoreId,
  activeRole,
  onNavigateTab,
  initialTargetProductId,
  onClearInitialTargetProduct,
}: {
  activeStoreId: string;
  activeRole: "OWNER" | "CASHIER" | "ADMIN";
  onNavigateTab: (tab: string) => void;
  initialTargetProductId?: string | null;
  onClearInitialTargetProduct?: () => void;
}) {
  const [suppliers, setSuppliers] = useState<SupplierDirItem[]>([]);
  const [products, setProducts] = useState<ProductSimple[]>([]);
  const [rfqSessions, setRfqSessions] = useState<RfqSessionItem[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderItem[]>([]);
  const [messages, setMessages] = useState<WaMsgItem[]>([]);
  const [availableCashRp, setAvailableCashRp] = useState<number | null>(null);

  const [selectedProdId, setSelectedProdId] = useState<string>("");
  const [qtyBoxes, setQtyBoxes] = useState<string>("5");

  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useGooeyToastFlash(
    feedbackMsg,
    errorMsg,
    () => setFeedbackMsg(null),
    () => setErrorMsg(null)
  );

  // Modals
  const [showScrapingModal, setShowScrapingModal] = useState(false);
  const [scrapingTab, setScrapingTab] = useState<"DISCOVER" | "ADD_SUPPLIER">(
    "DISCOVER"
  );
  const [showChatModal, setShowChatModal] = useState(false);
  const [simSupplierPhone, setSimSupplierPhone] = useState("");
  const [simSupplierText, setSimSupplierText] = useState("");
  const [poDetailModal, setPoDetailModal] = useState<PoPdfDetail | null>(null);

  // Add Supplier Form
  const [suppName, setSuppName] = useState("");
  const [suppPhone, setSuppPhone] = useState("");
  const [suppAddr, setSuppAddr] = useState("");
  const [suppRating, setSuppRating] = useState("4.8");
  const [suppIsB2B, setSuppIsB2B] = useState(true);
  const [suppCommRate, setSuppCommRate] = useState("1.25");

  // Playwright Live Scraper State
  const [playwrightKeyword, setPlaywrightKeyword] = useState("kulit kebab");
  const [playwrightLocation, setPlaywrightLocation] = useState("");
  const [playwrightBusy, setPlaywrightBusy] = useState(false);
  const [playwrightResults, setPlaywrightResults] = useState<
    PlaywrightScrapedItem[]
  >([]);
  const [lastScrapeMeta, setLastScrapeMeta] = useState<{
    searchQuery: string;
    rfqCode: string | null;
    createdAt: string | null;
  } | null>(null);

  const fetchAllData = useCallback(async () => {
    const [suppRes, prodRes, waRes, sumRes, scrapeRes] = await Promise.all([
      fetch(`/api/v1/suppliers?storeId=${encodeURIComponent(activeStoreId)}`),
      fetch(
        `/api/v1/inventory/products?storeId=${encodeURIComponent(
          activeStoreId
        )}`
      ),
      fetch(
        `/api/v1/webhooks/whatsapp?storeId=${encodeURIComponent(activeStoreId)}`
      ),
      fetch(
        `/api/v1/dashboard/summary?storeId=${encodeURIComponent(
          activeStoreId
        )}&role=${activeRole}`
      ),
      fetch(
        `/api/v1/suppliers/scrape?storeId=${encodeURIComponent(activeStoreId)}`
      ),
    ]);
    return Promise.all([
      suppRes.json(),
      prodRes.json(),
      waRes.json(),
      sumRes.json(),
      scrapeRes.json(),
    ]);
  }, [activeStoreId, activeRole]);

  const applyAllData = useCallback(
    ([suppJson, prodJson, waJson, sumJson, scrapeJson]: Awaited<
      ReturnType<typeof fetchAllData>
    >) => {
      if (suppJson.success && suppJson.data?.suppliers) {
        const list = suppJson.data.suppliers as SupplierDirItem[];
        setSuppliers(list);
        setSimSupplierPhone((prev) =>
          list.some((s) => s.phoneWhatsapp === prev)
            ? prev
            : list[0]?.phoneWhatsapp || ""
        );
      } else {
        setSuppliers([]);
      }
      if (prodJson.success && Array.isArray(prodJson.data)) {
        const list = prodJson.data as ProductSimple[];
        setProducts(list);
        const preferred =
          (initialTargetProductId
            ? list.find((p) => p.id === initialTargetProductId)
            : null) || null;
        setSelectedProdId((prev) =>
          preferred
            ? preferred.id
            : list.some((p) => p.id === prev)
              ? prev
              : list.length > 0
                ? list[0].id
                : ""
        );
        if (preferred) {
          setQtyBoxes(String(preferred.defaultReorderBoxes || 5));
          setShowScrapingModal(true);
          onClearInitialTargetProduct?.();
        }
      } else {
        setProducts([]);
        setSelectedProdId("");
      }
      if (waJson.success) {
        setRfqSessions(waJson.data.rfqSessions || []);
        setPurchaseOrders(waJson.data.purchaseOrders || []);
        setMessages(waJson.data.whatsappMessages || []);
      }
      if (sumJson.success && sumJson.data?.kpis?.kasSiapKulakan) {
        setAvailableCashRp(sumJson.data.kpis.kasSiapKulakan.amountRp);
      }
      if (scrapeJson?.success && scrapeJson.data?.scrapedSuppliers) {
        setPlaywrightResults(
          scrapeJson.data.scrapedSuppliers as PlaywrightScrapedItem[]
        );
        setLastScrapeMeta({
          searchQuery: scrapeJson.data.searchQuery,
          rfqCode: scrapeJson.data.rfqCode || null,
          createdAt: scrapeJson.data.createdAt || null,
        });
        if (scrapeJson.data.rawKeyword) {
          setPlaywrightKeyword(scrapeJson.data.rawKeyword);
        }
        if (scrapeJson.data.locationHint) {
          setPlaywrightLocation(scrapeJson.data.locationHint);
        }
      }
    },
    [initialTargetProductId, onClearInitialTargetProduct]
  );

  const loadDirectory = useCallback(async () => {
    try {
      setErrorMsg(null);
      const results = await fetchAllData();
      applyAllData(results);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal memuat data pengadaan AI."
      );
    } finally {
      setLoading(false);
    }
  }, [fetchAllData, applyAllData]);

  useEffect(() => {
    let cancelled = false;
    fetchAllData()
      .then((results) => {
        if (cancelled) return;
        setErrorMsg(null);
        applyAllData(results);
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "Gagal memuat data pengadaan AI."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchAllData, applyAllData]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowScrapingModal(false);
        setShowChatModal(false);
        setPoDetailModal(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleRunPlaywrightScrape = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!playwrightKeyword.trim()) return;
    setPlaywrightBusy(true);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      const res = await fetch("/api/v1/suppliers/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: activeStoreId,
          searchQuery: playwrightKeyword.trim(),
          locationHint: playwrightLocation.trim() || undefined,
          productId: selectedProdId || undefined,
          requestedQtyBoxes: Number(qtyBoxes) || 5,
          maxResults: 10,
          createRfqDraft: true,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setErrorMsg(
          json.error?.message || "Gagal menjalankan scraping Playwright."
        );
      } else {
        const list = (json.data.scrapedSuppliers ||
          []) as PlaywrightScrapedItem[];
        setPlaywrightResults(list);
        setLastScrapeMeta({
          searchQuery: json.data.searchQuery || playwrightKeyword.trim(),
          rfqCode: json.data.createdRfqSession?.rfqCode || null,
          createdAt: new Date().toISOString(),
        });
        setShowScrapingModal(false);
        const rfqCodeLabel = json.data.createdRfqSession?.rfqCode
          ? ` (${json.data.createdRfqSession.rfqCode})`
          : "";
        setFeedbackMsg(
          `Playwright Scraping selesai untuk "${json.data.searchQuery}": menemukan ${list.length} supplier dan Agen OpenWA telah otomatis menghubungi ke-${list.length} nomor WhatsApp supplier tersebut${rfqCodeLabel}.`
        );
        await loadDirectory();
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Gagal menjalankan scraping Playwright."
      );
    } finally {
      setPlaywrightBusy(false);
    }
  };

  const handleRunDiscovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProdId) return;
    setDiscovering(true);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      const res = await fetch("/api/v1/suppliers/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: activeStoreId,
          productId: selectedProdId,
          requestedQtyBoxes: Number(qtyBoxes),
          maxRadiusKm: 10.0,
          minRating: 4.5,
          createRfqDraft: true,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setErrorMsg(json.error?.message || "Gagal menjalankan discovery.");
      } else {
        setShowScrapingModal(false);
        setFeedbackMsg(
          `Scraping selesai (${
            json.data.cacheHit ? "Shared Cache Hit" : "Google Places Sync"
          }): ${json.data.top3Candidates.length} kandidat ditemukan untuk ${
            json.data.requestedQtyBoxes
          } Dus ${json.data.productName}.`
        );
        await loadDirectory();
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menjalankan discovery."
      );
    } finally {
      setDiscovering(false);
    }
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFeedbackMsg(null);
    const res = await fetch("/api/v1/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        actorRole: activeRole,
        name: suppName,
        phoneWhatsapp: suppPhone,
        address: suppAddr,
        googleRating: Number(suppRating),
        isVerifiedB2BPartner: suppIsB2B,
        commissionRatePct: Number(suppCommRate),
      }),
    });
    const json = await res.json();
    if (json.success) {
      setShowScrapingModal(false);
      setSuppName("");
      setSuppPhone("");
      setFeedbackMsg(`Mitra ${json.data.name} berhasil ditambahkan ke direktori.`);
      await loadDirectory();
    } else {
      setErrorMsg(json.error?.message || "Gagal mendaftarkan distributor.");
    }
  };

  const handleApproveAction = async (rfq: RfqSessionItem) => {
    setActionBusy(true);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      const endpoint =
        rfq.status === "AWAITING_OWNER_RFQ_APPROVAL"
          ? `/api/v1/procurement/rfq/${rfq.id}/approve-send`
          : `/api/v1/procurement/rfq/${rfq.id}/approve-po`;
      const payload =
        rfq.status === "AWAITING_OWNER_RFQ_APPROVAL"
          ? { storeId: activeStoreId, actorRole: activeRole }
          : {
              storeId: activeStoreId,
              actorRole: activeRole,
              selectedOptionRank: 1,
              deliveryNotes: "Setujui PO #1, kirim sore ini",
            };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) {
        setErrorMsg(json.error?.message || "Gagal memproses persetujuan.");
      } else {
        setFeedbackMsg(
          rfq.status === "AWAITING_OWNER_RFQ_APPROVAL"
            ? `Auto-RFQ dikirim ke ${json.data.dispatchedCount} kandidat distributor via WhatsApp.`
            : `Purchase Order ${json.data.poNumber} diterbitkan dan saldo kas ${formatRp(
                json.data.totalAmountRp
              )} telah dikunci.`
        );
        await loadDirectory();
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleSimulateReply = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      const res = await fetch("/api/v1/webhooks/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: activeStoreId,
          rfqSessionId: activeRfq?.id,
          fromPhone: simSupplierPhone,
          messageText: simSupplierText,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowChatModal(false);
        setFeedbackMsg(
          `Ekstraksi AI selesai (Status: ${json.data.slotCompletenessStatus}). Balasan ke supplier: "${json.data.agentReplyToSupplier}"`
        );
        await loadDirectory();
      } else {
        setErrorMsg(json.error?.message || "Gagal memproses pesan.");
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleOpenPoDoc = async (poId: string) => {
    setErrorMsg(null);
    const res = await fetch(`/api/v1/procurement/po/${poId}/pdf`);
    const json = await res.json();
    if (json.success) {
      setPoDetailModal(json.data);
    } else {
      setErrorMsg(json.error?.message || "Dokumen PO tidak ditemukan.");
    }
  };

  const handleCancelPo = async (poId: string) => {
    setErrorMsg(null);
    setFeedbackMsg(null);
    const res = await fetch(`/api/v1/procurement/po/${poId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        actorRole: activeRole,
        reason: "Dibatalkan melalui AI Procurement",
      }),
    });
    const json = await res.json();
    if (json.success) {
      setPoDetailModal(null);
      setFeedbackMsg(
        `PO dibatalkan dan saldo kas ${formatRp(
          json.data.releasedCashRp
        )} dikembalikan ke Kas Siap Kulakan.`
      );
      await loadDirectory();
    } else {
      setErrorMsg(json.error?.message || "Gagal membatalkan PO.");
    }
  };

  const selectedProdObj =
    products.find((p) => p.id === selectedProdId) || products[0] || null;
  const activeRfq =
    rfqSessions.find((r) => r.status !== "CANCELLED") || rfqSessions[0] || null;
  const pendingRfq = rfqSessions.find(
    (r) =>
      r.status === "AWAITING_OWNER_PO_APPROVAL" ||
      r.status === "AWAITING_OWNER_RFQ_APPROVAL"
  );
  const targetProdName =
    activeRfq?.productName || selectedProdObj?.name || null;
  const targetQtyBoxes =
    activeRfq?.requestedQtyBoxes ?? selectedProdObj?.defaultReorderBoxes ?? null;
  const targetSkuCode =
    activeRfq?.skuCode || selectedProdObj?.skuCode || null;

  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  // Build top 3 candidate cards strictly from real DB records (quotes + directory)
  const rawMergedCandidates: Array<{
    id: string;
    name: string;
    phoneWhatsapp: string;
    distanceKm: number | null;
    googleRating: number;
    userRatingsTotal: number | null;
    isWhatsappActive: boolean;
    isVerifiedB2BPartner: boolean;
    quote: SupplierQuoteItem | null;
    catEntry: SupplierDirItem["cachedCatalog"][string] | null;
  }> = [];

  if (activeRfq?.quotes && activeRfq.quotes.length > 0) {
    for (const q of activeRfq.quotes) {
      const matched = supplierById.get(q.supplier_id);
      const catEntry =
        targetSkuCode && matched?.cachedCatalog
          ? matched.cachedCatalog[targetSkuCode] || null
          : null;
      rawMergedCandidates.push({
        id: q.supplier_id,
        name: matched?.name || q.supplier_name,
        phoneWhatsapp: matched?.phoneWhatsapp || q.phone,
        distanceKm: matched?.distanceKm ?? null,
        googleRating: matched?.googleRating ?? q.rating,
        userRatingsTotal: matched?.userRatingsTotal ?? null,
        isWhatsappActive: matched?.isWhatsappActive ?? true,
        isVerifiedB2BPartner: matched?.isVerifiedB2BPartner ?? false,
        quote: q,
        catEntry,
      });
    }
  }

  for (const supp of suppliers) {
    if (rawMergedCandidates.some((c) => c.id === supp.id)) continue;
    const catEntry =
      targetSkuCode && supp.cachedCatalog
        ? supp.cachedCatalog[targetSkuCode] || null
        : null;
    rawMergedCandidates.push({
      id: supp.id,
      name: supp.name,
      phoneWhatsapp: supp.phoneWhatsapp,
      distanceKm: supp.distanceKm,
      googleRating: supp.googleRating,
      userRatingsTotal: supp.userRatingsTotal,
      isWhatsappActive: supp.isWhatsappActive,
      isVerifiedB2BPartner: supp.isVerifiedB2BPartner,
      quote: null,
      catEntry,
    });
  }

  // Sort all candidate suppliers by highest rating first (then review count, then distance)
  rawMergedCandidates.sort((a, b) => {
    if (b.googleRating !== a.googleRating) {
      return b.googleRating - a.googleRating;
    }
    const revA = a.userRatingsTotal ?? 0;
    const revB = b.userRatingsTotal ?? 0;
    if (revB !== revA) {
      return revB - revA;
    }
    return (a.distanceKm ?? 999) - (b.distanceKm ?? 999);
  });

  const top3Candidates = rawMergedCandidates.slice(0, 3).map((entry, idx) => {
    const pricePerBox =
      entry.quote?.slot_price_per_box ?? entry.catEntry?.price_per_box ?? null;
    const moqBoxes =
      entry.quote?.slot_moq_boxes ?? entry.catEntry?.moq_boxes ?? null;
    const batchExp =
      entry.quote?.slot_batch_expiry_date ??
      entry.catEntry?.last_batch_exp ??
      null;
    const hasFreezer =
      entry.quote?.slot_freezer_delivery ??
      entry.catEntry?.freezer_delivery ??
      null;
    const armadaLabel =
      hasFreezer === true
        ? idx === 0
          ? "Box Freezer (-18°C)"
          : "Box Berpendingin"
        : hasFreezer === false
          ? "Kurir Instan Standar"
          : "-";

    return {
      rank: idx + 1,
      id: entry.id,
      name: entry.name,
      phoneWhatsapp: entry.phoneWhatsapp,
      distanceKm: entry.distanceKm,
      googleRating: entry.googleRating,
      userRatingsTotal: entry.userRatingsTotal,
      isWhatsappActive: entry.isWhatsappActive,
      isVerifiedB2BPartner: entry.isVerifiedB2BPartner,
      pricePerBox,
      moqBoxes,
      batchExpLabel: formatMonthYearId(batchExp),
      batchExpFullLabel: formatDayMonthYearId(batchExp),
      armadaLabel,
      quoteStatus: entry.quote?.status ?? null,
    };
  });

  const bestCandidate = top3Candidates[0] || null;
  const bestPrice =
    activeRfq?.bestPricePerBoxRp ?? bestCandidate?.pricePerBox ?? null;
  const bestMoq = bestCandidate?.moqBoxes ?? null;
  const bestExpFull = bestCandidate?.batchExpFullLabel ?? null;

  const estimatedPoRp =
    pendingRfq?.estimatedPoTotalRp ??
    activeRfq?.estimatedPoTotalRp ??
    (bestPrice !== null && targetQtyBoxes !== null
      ? bestPrice * targetQtyBoxes
      : null);

  const cashPct =
    estimatedPoRp !== null && availableCashRp && availableCashRp > 0
      ? Number(((estimatedPoRp / availableCashRp) * 100).toFixed(1))
      : activeRfq?.cashUsagePct ?? null;

  // Build WhatsApp negotiation chat log strictly from real database records
  const relevantChatMsgs = messages.filter(
    (m) => m.messageType === "TEXT" && !m.contentText.includes("Vision OCR")
  );
  const latestChatMsg =
    relevantChatMsgs.length > 0
      ? relevantChatMsgs[relevantChatMsgs.length - 1]
      : null;
  const latestMsgRelTime = formatRelativeTimeId(latestChatMsg?.createdAt);
  const supplierByPhone = new Map(
    suppliers.map((s) => [s.phoneWhatsapp, s.name])
  );
  const topSupplierName = bestCandidate
    ? shortenSupplierName(bestCandidate.name)
    : null;
  const chatHeaderSupplier =
    (latestChatMsg?.senderPhone && supplierByPhone.get(latestChatMsg.senderPhone)) ||
    (latestChatMsg?.recipientPhone &&
      supplierByPhone.get(latestChatMsg.recipientPhone)) ||
    topSupplierName;

  const chatDisplayBubbles = relevantChatMsgs.slice(-2).map((m) => {
    const isBot = m.direction === "OUTBOUND" || m.detectedRole === "SYSTEM";
    const matchedSupp = supplierByPhone.get(m.senderPhone);
    return {
      id: m.id,
      isBot,
      senderLabel: isBot
        ? "AI Procurement Bot"
        : m.detectedRole === "SUPPLIER"
          ? `Admin ${shortenSupplierName(matchedSupp || chatHeaderSupplier || "Distributor")}`
          : `Owner (${m.senderPhone})`,
      timeLabel: formatTimeWib(m.createdAt),
      text: m.contentText,
    };
  });

  return (
    <div className="space-y-5">
      {/* Page Title & Action Row */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-[22px] sm:text-[24px] font-bold text-[#0F172A] tracking-tight leading-snug">
            AI Procurement &amp; Pencarian Supplier Otomatis
          </h1>
          <p className="text-[13px] text-[#64748B] mt-0.5">
            Targeted scraping distributor frozen food terdekat (Rating &ge;
            4.5) &amp; negosiasi harga otomatis via WhatsApp
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <span className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white border border-[#E2E8F0] text-xs font-medium text-[#334155] inline-flex items-center gap-2 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                targetProdName ? "bg-[#10B981]" : "bg-[#94A3B8]"
              }`}
            />
            <span>
              {targetProdName
                ? `Target: ${targetProdName}${
                    targetQtyBoxes !== null ? ` (${targetQtyBoxes} Dus)` : ""
                  }`
                : "Belum ada Target SKU"}
            </span>
          </span>

          <button
            type="button"
            onClick={() => {
              setScrapingTab("DISCOVER");
              setShowScrapingModal(true);
            }}
            className="min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white text-xs font-semibold inline-flex items-center gap-2 shadow-xs transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v8" />
              <path d="M8 12h8" />
            </svg>
            <span>+ Scraping Baru</span>
          </button>
        </div>
      </div>

      {/* Playwright Real-Time Business & Factory Phone Number Scraper Card */}
      <section className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-[0_1px_3px_rgba(15,23,42,0.03)] space-y-4 text-xs">
        <form
          onSubmit={handleRunPlaywrightScrape}
          className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
        >
          <div className="sm:col-span-5">
            <label
              htmlFor="pw-scrape-keyword"
              className="block font-semibold text-[#334155] mb-1"
            >
              Kata Kunci Bisnis / Pabrik yang Dicari *
            </label>
            <input
              id="pw-scrape-keyword"
              type="text"
              required
              placeholder="Contoh: kulit kebab, pabrik distributor kulit kebab..."
              value={playwrightKeyword}
              onChange={(e) => setPlaywrightKeyword(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-[#CBD5E1] bg-white text-[#0F172A] font-medium focus:outline-2 focus:outline-[#0F6352]"
            />
          </div>

          <div className="sm:col-span-4">
            <label
              htmlFor="pw-scrape-location"
              className="block font-semibold text-[#334155] mb-1"
            >
              Filter Wilayah / Kota (Opsional)
            </label>
            <input
              id="pw-scrape-location"
              type="text"
              placeholder="Kosongkan (Seluruh Indonesia) atau ketik kota..."
              value={playwrightLocation}
              onChange={(e) => setPlaywrightLocation(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-[#CBD5E1] bg-white text-[#0F172A] focus:outline-2 focus:outline-[#0F6352]"
            />
          </div>

          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={playwrightBusy || !playwrightKeyword.trim()}
              className="w-full h-10 px-4 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] disabled:bg-slate-300 text-white font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <span>
                {playwrightBusy
                  ? "Scraping via Playwright..."
                  : "Scraping No. HP (Playwright)"}
              </span>
            </button>
          </div>
        </form>

        {playwrightResults.length > 0 && (
          <div className="pt-3 border-t border-[#F1F5F9] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-bold text-[#0F172A]">
                  Daftar Pabrik &amp; Supplier Hasil Scraping ({playwrightResults.length} Bisnis)
                </h3>
                {lastScrapeMeta?.searchQuery && (
                  <span className="px-2.5 py-0.5 rounded-full bg-[#F1F5F9] text-[#475569] text-[11px] font-medium">
                    Kata kunci: {lastScrapeMeta.searchQuery}
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[#E2E8F0] bg-white divide-y divide-[#E5E9EC] overflow-hidden">
              {playwrightResults.map((item, idx) => (
                <div
                  key={item.id}
                  className="p-4 hover:bg-[#F8FAFC] transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3.5"
                >
                  {/* Left: Rank + Factory Name + Rating + Address */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold tabular-nums shrink-0 ${
                          idx < 3
                            ? "bg-[#0F6352] text-white"
                            : "bg-[#F1F5F9] text-[#475569]"
                        }`}
                      >
                        #{idx + 1}
                      </span>
                      <span className="text-sm font-bold text-[#0F172A]">
                        {item.name}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200/80 text-[11px] font-semibold text-amber-800 shrink-0">
                        <span aria-hidden="true">★</span>
                        <span>
                          {item.googleRating.toFixed(1)} ({item.userRatingsTotal} ulasan)
                        </span>
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-[#F1F5F9] text-[#475569] text-[11px] font-medium shrink-0">
                        {item.distanceKm.toFixed(1).replace(".", ",")} km
                      </span>
                    </div>

                    <div className="text-xs text-[#475569] leading-relaxed">
                      <span className="font-semibold text-[#334155]">
                        {item.category}
                      </span>
                      {item.address ? ` • ${item.address}` : ""}
                    </div>
                  </div>

                  {/* Right: WhatsApp Number + Status + Quick Actions */}
                  <div className="flex flex-wrap items-center justify-between md:justify-end gap-2.5 shrink-0">
                    <div className="flex flex-col md:items-end">
                      <span className="font-mono text-xs font-bold text-[#0F6352]">
                        {item.phoneWhatsapp}
                      </span>
                      <span className="text-[11px] text-[#64748B]">
                        Dihubungi Agen OpenWA
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <a
                        href={`https://wa.me/${item.phoneWhatsapp.replace(
                          /\D/g,
                          ""
                        )}?text=${encodeURIComponent(
                          `Halo ${item.name}, kami ingin menanyakan harga grosir ${playwrightKeyword}.`
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white text-xs font-semibold inline-flex items-center justify-center transition-colors"
                      >
                        Chat WA
                      </a>
                      <a
                        href={item.mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white hover:bg-[#F1F5F9] border border-[#CBD5E1] text-[#334155] text-xs font-semibold inline-flex items-center justify-center transition-colors"
                      >
                        Maps
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Top 3 Supplier Candidate Cards */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-pulse">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-64 rounded-2xl bg-white border border-[#E5E9EC]"
            />
          ))}
        </div>
      ) : top3Candidates.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-[#CBD5E1] p-6 text-center space-y-2.5">
          <p className="text-sm font-bold text-[#0F172A]">
            Belum ada kandidat distributor untuk toko ini
          </p>
          <p className="text-xs text-[#64748B] max-w-xl mx-auto">
            Tambahkan Mitra B2B terverifikasi atau jalankan Hybrid Discovery
            untuk mencari distributor terdekat (Rating &ge; 4,5) dari database
            Google Places &amp; Shared Cache.
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={() => {
                setScrapingTab(products.length > 0 ? "DISCOVER" : "ADD_SUPPLIER");
                setShowScrapingModal(true);
              }}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white text-xs font-semibold"
            >
              {products.length > 0
                ? "+ Jalankan Scraping Supplier"
                : "+ Tambah Mitra B2B"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {top3Candidates.map((item) => {
            const isTopPick = item.rank === 1;
            const hasPrice = item.pricePerBox !== null;
            const totalForQty =
              hasPrice && targetQtyBoxes !== null
                ? (item.pricePerBox as number) * targetQtyBoxes
                : null;
            const moqExceedsTarget =
              item.moqBoxes !== null &&
              targetQtyBoxes !== null &&
              item.moqBoxes > targetQtyBoxes;
            const priceDiff =
              hasPrice && bestPrice !== null
                ? (item.pricePerBox as number) - bestPrice
                : null;
            const withinCash =
              totalForQty === null ||
              availableCashRp === null ||
              totalForQty <= availableCashRp;

            return (
              <article
                key={item.id}
                className={`bg-white rounded-2xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-4 ${
                  isTopPick
                    ? "border-2 border-[#0F6352]"
                    : "border border-[#E5E9EC]"
                }`}
              >
                <div className="space-y-3.5">
                  {/* Top Badge + Rating */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                        isTopPick
                          ? "bg-[#0F6352] text-white"
                          : "bg-[#F1F5F9] text-[#475569]"
                      }`}
                    >
                      {isTopPick ? "Pilihan AI #1" : `Kandidat #${item.rank}`}
                    </span>
                    <span className="text-xs font-semibold text-[#334155] inline-flex items-center gap-1">
                      <span className="text-amber-500" aria-hidden="true">
                        ★
                      </span>
                      <span>
                        {item.googleRating.toFixed(1)}
                        {item.userRatingsTotal !== null
                          ? ` (${item.userRatingsTotal})`
                          : ""}
                      </span>
                    </span>
                  </div>

                  {/* Supplier Name + Distance + Chat Button */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="text-[15px] font-bold text-[#0F172A] truncate">
                        {item.name}
                      </h2>
                      <p className="text-xs text-[#64748B] mt-0.5">
                        {item.distanceKm !== null
                          ? `Jarak ${item.distanceKm.toFixed(1).replace(".", ",")} km`
                          : "Kandidat RFQ"}
                        {" • "}
                        {item.isWhatsappActive
                          ? "WA Bisnis Aktif"
                          : "WA Nonaktif"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSimSupplierPhone(item.phoneWhatsapp);
                        setShowChatModal(true);
                      }}
                      aria-label={`Simulasi chat WhatsApp dengan ${item.name}`}
                      title="Buka simulasi chat WhatsApp supplier"
                      className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] rounded-xl text-[#64748B] hover:text-[#0F6352] hover:bg-[#F1F5F9] flex items-center justify-center shrink-0 transition-colors"
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="w-4 h-4"
                      >
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        <path d="M8 9h8" />
                        <path d="M8 13h5" />
                      </svg>
                    </button>
                  </div>

                  {/* 4-Variable Slot Grid */}
                  <div className="bg-[#F8FAFC] border border-[#E5E9EC] rounded-xl p-3.5 grid grid-cols-2 gap-x-4 gap-y-3">
                    <div>
                      <div className="text-[11px] text-[#64748B]">
                        Harga / Dus
                      </div>
                      <div className="font-mono text-xs font-bold text-[#0F172A] mt-0.5 tabular-nums">
                        {hasPrice
                          ? formatRp(item.pricePerBox)
                          : item.quoteStatus === "NEGOTIATING"
                            ? "Menunggu Balasan WA"
                            : "Menunggu RFQ"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#64748B]">
                        Min. Order (MOQ)
                      </div>
                      <div className="font-mono text-xs font-bold text-[#0F172A] mt-0.5">
                        {item.moqBoxes !== null ? `${item.moqBoxes} Dus` : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#64748B]">
                        Batch Expired
                      </div>
                      <div className="font-mono text-xs font-bold text-[#0F172A] mt-0.5">
                        {item.batchExpLabel}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#64748B]">
                        Armada Kirim
                      </div>
                      <div className="text-xs font-bold text-[#0F172A] mt-0.5 truncate">
                        {item.armadaLabel}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom Feasibility Pill */}
                {!hasPrice || totalForQty === null ? (
                  <div
                    className={`rounded-xl px-3 py-2 text-center text-[11px] font-semibold ${
                      item.quoteStatus === "NEGOTIATING"
                        ? "bg-[#EBF8F2] border border-[#CCE8DB] text-[#0F6352]"
                        : "bg-[#F8FAFC] border border-[#E5E9EC] text-[#64748B] font-medium"
                    }`}
                  >
                    {item.quoteStatus === "NEGOTIATING"
                      ? "✓ Dihubungi Agen OpenWA • Menunggu Balasan WA"
                      : item.isVerifiedB2BPartner
                        ? "Mitra B2B Terverifikasi • Siap Kirim RFQ"
                        : "Kandidat Aktif • Menunggu Penawaran"}
                  </div>
                ) : isTopPick ? (
                  <div
                    className={`rounded-xl px-3 py-2 text-center text-[11px] font-semibold ${
                      withinCash
                        ? "bg-[#EBF8F2] border border-[#CCE8DB] text-[#0F6352]"
                        : "bg-amber-50 border border-amber-200 text-amber-800"
                    }`}
                  >
                    {withinCash
                      ? `✓ Sesuai Plafon Kas • Total ${formatRp(totalForQty)}`
                      : `! Melebihi Saldo Kas • Total ${formatRp(totalForQty)}`}
                  </div>
                ) : (
                  <div className="rounded-xl bg-[#F8FAFC] border border-[#E5E9EC] text-[#64748B] px-3 py-2 text-center text-[11px] font-medium">
                    {moqExceedsTarget && item.moqBoxes !== null
                      ? `• Melebihi Plafon MOQ (Min. Order ${formatRp(
                          item.moqBoxes * (item.pricePerBox as number)
                        )})`
                      : priceDiff !== null && priceDiff > 0
                        ? `• Selisih +${formatRp(
                            priceDiff
                          )}/dus dari Pilihan AI #1`
                        : `• Estimasi Total ${formatRp(totalForQty)}`}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Bottom Split: Left WhatsApp Negotiation Log (6 cols) + Right Cash Validation & PO Approval (6 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left Panel: Log Negosiasi Auto-RFQ WhatsApp */}
        <section
          aria-labelledby="wa-nego-heading"
          className="lg:col-span-6 bg-white rounded-2xl border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h2
              id="wa-nego-heading"
              className="text-[15px] font-bold text-[#0F172A]"
            >
              Log Negosiasi Auto-RFQ WhatsApp
            </h2>
            <button
              type="button"
              onClick={() => setShowChatModal(true)}
              className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-full bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#475569] text-[11px] font-medium transition-colors"
            >
              {latestChatMsg && chatHeaderSupplier
                ? `${shortenSupplierName(chatHeaderSupplier)}${
                    latestMsgRelTime ? ` • ${latestMsgRelTime}` : ""
                  }`
                : "Belum ada aktivitas"}
            </button>
          </div>

          {/* Chat Bubbles */}
          <div
            className={`bg-[#F8FAFC] border border-[#E5E9EC] rounded-xl p-4 space-y-3.5 min-h-[196px] max-h-[260px] overflow-y-auto flex flex-col ${
              chatDisplayBubbles.length === 0
                ? "justify-center"
                : "justify-start"
            }`}
          >
            {chatDisplayBubbles.length === 0 ? (
              <div className="text-center text-xs text-[#64748B] py-8 px-4 space-y-1.5">
                <p className="font-semibold text-[#334155]">
                  Belum ada riwayat negosiasi WhatsApp untuk toko ini.
                </p>
                <p>
                  Jalankan <strong>+ Scraping Baru</strong> dan kirim RFQ ke
                  kandidat supplier atau buka{" "}
                  <strong>Simulasi WA &amp; OCR</strong>.
                </p>
              </div>
            ) : (
              chatDisplayBubbles.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.isBot ? "items-end" : "items-start"
                  }`}
                >
                  <span className="font-mono text-[11px] text-[#64748B] mb-1">
                    {msg.senderLabel} • {msg.timeLabel}
                  </span>
                  <div
                    className={`max-w-[90%] rounded-2xl px-4 py-3 text-xs leading-relaxed whitespace-pre-line ${
                      msg.isBot
                        ? "bg-[#DFF5EC] border border-[#C2EBDC] text-[#0F172A] rounded-tr-xs"
                        : "bg-white border border-[#E2E8F0] text-[#334155] rounded-tl-xs shadow-2xs"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Extracted Variables Chips + Full Workbench Link */}
          <div className="bg-[#F8FAFC] border border-[#E5E9EC] rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium text-[#64748B]">
                Hasil Ekstraksi:
              </span>
              {bestPrice === null && bestMoq === null && !bestExpFull ? (
                <span className="text-[11px] text-[#64748B]">
                  Menunggu balasan penawaran supplier
                </span>
              ) : (
                <>
                  {bestPrice !== null && (
                    <span className="px-2.5 py-1 rounded-lg bg-white border border-[#E2E8F0] font-mono text-[11px] font-semibold text-[#0F172A]">
                      {formatRp(bestPrice)}/dus
                    </span>
                  )}
                  {bestMoq !== null && (
                    <span className="px-2.5 py-1 rounded-lg bg-white border border-[#E2E8F0] font-mono text-[11px] font-semibold text-[#0F172A]">
                      MOQ {bestMoq} Dus
                    </span>
                  )}
                  {bestExpFull && (
                    <span className="px-2.5 py-1 rounded-lg bg-white border border-[#E2E8F0] font-mono text-[11px] font-semibold text-[#0F172A]">
                      Exp {bestExpFull}
                    </span>
                  )}
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => onNavigateTab("whatsapp")}
              className="min-h-[44px] sm:min-h-[34px] px-2 text-[11px] font-semibold text-[#0F6352] hover:underline"
            >
              Simulasi WA &amp; OCR
            </button>
          </div>
        </section>

        {/* Right Panel: Validasi Kas & Persetujuan PO */}
        <section
          aria-labelledby="po-approval-heading"
          className="lg:col-span-6 bg-white rounded-2xl border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-4"
        >
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <h2
                id="po-approval-heading"
                className="text-[15px] font-bold text-[#0F172A]"
              >
                Validasi Kas &amp; Persetujuan PO
              </h2>
            </div>

            {/* Cash Plafon Validation Box */}
            <div className="bg-[#F8FAFC] border border-[#E5E9EC] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-[#0F172A] tabular-nums">
                  Kas Siap Kulakan:{" "}
                  {activeRole === "CASHIER"
                    ? "Rp ••••••••"
                    : availableCashRp !== null
                      ? formatRp(availableCashRp)
                      : "Memuat..."}
                </div>
                <div className="text-xs text-[#64748B] mt-0.5 tabular-nums">
                  {estimatedPoRp !== null
                    ? `Estimasi PO Baru: ${formatRp(estimatedPoRp)}`
                    : "Estimasi PO Baru: Belum ada penawaran aktif"}
                </div>
              </div>
              {cashPct !== null ? (
                <span
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${
                    cashPct <= 50
                      ? "bg-[#D7F0E6] text-[#0F6352]"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {cashPct <= 50 ? "✓ Plafon Aman" : "! Rasio Tinggi"} (
                  {cashPct.toString().replace(".", ",")}%)
                </span>
              ) : (
                <span className="px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap bg-[#EBF8F2] text-[#0F6352]">
                  {availableCashRp !== null && availableCashRp > 0
                    ? "Kas Kulakan Siap"
                    : "Menunggu Saldo"}
                </span>
              )}
            </div>

            {/* Pending RFQ Approval + Issued Purchase Orders */}
            <div className="space-y-2.5">
              {pendingRfq && (
                <div className="rounded-xl border border-[#E5E9EC] px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#0F172A] truncate">
                      {shortenSupplierName(
                        pendingRfq.quotes?.[0]?.supplier_name ||
                          topSupplierName ||
                          "Kandidat Distributor"
                      )}{" "}
                      • {pendingRfq.requestedQtyBoxes} Dus{" "}
                      {pendingRfq.productName}
                    </div>
                    <div className="font-mono text-[11px] text-[#64748B] mt-0.5">
                      {pendingRfq.rfqCode} •{" "}
                      {pendingRfq.estimatedPoTotalRp
                        ? formatRp(pendingRfq.estimatedPoTotalRp)
                        : bestPrice !== null
                          ? formatRp(pendingRfq.requestedQtyBoxes * bestPrice)
                          : "Menunggu harga"}{" "}
                      • Menunggu Persetujuan
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => handleApproveAction(pendingRfq)}
                    className="min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] disabled:bg-slate-300 text-white text-xs font-semibold shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
                  >
                    {pendingRfq.status === "AWAITING_OWNER_RFQ_APPROVAL"
                      ? "Kirim RFQ (1-Klik)"
                      : "Setujui & Kirim PO"}
                  </button>
                </div>
              )}

              {purchaseOrders.slice(0, pendingRfq ? 1 : 2).map((po) => {
                const isReceived = po.status === "RECEIVED_OCR";
                const isCancelled = po.status === "CANCELLED";
                return (
                  <div
                    key={po.id}
                    className="rounded-xl border border-[#E5E9EC] px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#0F172A] truncate">
                        {shortenSupplierName(po.supplierName)} •{" "}
                        {po.orderQtyBoxes} Dus {po.productName}
                      </div>
                      <div className="font-mono text-[11px] text-[#64748B] mt-0.5">
                        {po.poNumber} • {formatRp(po.totalAmountRp)} •{" "}
                        {isReceived
                          ? "Selesai Masuk Stok"
                          : isCancelled
                            ? "Dibatalkan"
                            : "Disetujui WA"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenPoDoc(po.id)}
                      className="min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-xl border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-xs font-medium text-[#334155] shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
                    >
                      Lihat Dokumen PO
                    </button>
                  </div>
                );
              })}

              {!pendingRfq && purchaseOrders.length === 0 && (
                <div className="rounded-xl border border-dashed border-[#CBD5E1] px-4 py-5 text-center text-xs text-[#64748B]">
                  Belum ada pengajuan PO aktif. Klik{" "}
                  <strong>+ Scraping Baru</strong> untuk memulai negosiasi.
                </div>
              )}
            </div>
          </div>

          <div className="pt-2.5 border-t border-[#F1F5F9] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B]">
            <span>SLA Pembayaran Tempo: NET 7 Hari • Audit Trail Mutasi Aktif</span>
            <span className="font-mono">{suppliers.length} Mitra B2B</span>
          </div>
        </section>
      </div>

      {/* Modal 1: + Scraping Baru (Hybrid Discovery & Tambah Verified Supplier) */}
      {showScrapingModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="scraping-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-[#E2E8F0] space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
              <div>
                <h3
                  id="scraping-modal-title"
                  className="text-base font-bold text-[#0F172A]"
                >
                  Pencarian Supplier Baru &amp; Direktori B2B
                </h3>
                <p className="text-[11px] text-[#64748B] mt-0.5">
                  Radius &le; 10 km • Rating &ge; 4,5 • Shared Cache &amp; Google
                  Places API
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup dialog scraping supplier"
                onClick={() => setShowScrapingModal(false)}
                className="min-h-[36px] min-w-[36px] rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="inline-flex rounded-xl bg-[#F1F5F9] p-1 w-full">
              <button
                type="button"
                onClick={() => setScrapingTab("DISCOVER")}
                className={`flex-1 min-h-[38px] rounded-lg font-semibold transition-colors ${
                  scrapingTab === "DISCOVER"
                    ? "bg-white text-[#0F172A] shadow-2xs"
                    : "text-[#64748B]"
                }`}
              >
                Jalankan Scraping RFQ
              </button>
              <button
                type="button"
                onClick={() => setScrapingTab("ADD_SUPPLIER")}
                className={`flex-1 min-h-[38px] rounded-lg font-semibold transition-colors ${
                  scrapingTab === "ADD_SUPPLIER"
                    ? "bg-white text-[#0F172A] shadow-2xs"
                    : "text-[#64748B]"
                }`}
              >
                + Tambah Mitra B2B
              </button>
            </div>

            {scrapingTab === "DISCOVER" ? (
              <form onSubmit={handleRunDiscovery} className="space-y-3">
                {products.length === 0 ? (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-900 space-y-2">
                    <p className="font-semibold">
                      Belum ada produk (Master SKU) di toko ini.
                    </p>
                    <p className="text-[11px]">
                      Tambahkan Master SKU di menu{" "}
                      <strong>Inventaris FEFO</strong> terlebih dahulu atau
                      daftarkan mitra B2B secara manual pada tab{" "}
                      <strong>+ Tambah Mitra B2B</strong>.
                    </p>
                  </div>
                ) : (
                  <>
                    <div>
                      <label
                        htmlFor="disc-sku-select"
                        className="block font-semibold text-[#334155] mb-1"
                      >
                        Pilih Produk yang Dibutuhkan *
                      </label>
                      <select
                        id="disc-sku-select"
                        value={selectedProdId}
                        onChange={(e) => setSelectedProdId(e.target.value)}
                        className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1] bg-white font-medium"
                      >
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.skuCode})
                            {p.isBelowRop ? " (Stok Kritis)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="disc-qty-input"
                        className="block font-semibold text-[#334155] mb-1"
                      >
                        Target Pesanan (Dus) *
                      </label>
                      <input
                        id="disc-qty-input"
                        type="number"
                        min={1}
                        required
                        value={qtyBoxes}
                        onChange={(e) => setQtyBoxes(e.target.value)}
                        className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1] font-bold"
                      />
                    </div>
                  </>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowScrapingModal(false)}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-[#F1F5F9] font-semibold"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={discovering || products.length === 0}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] disabled:bg-slate-300 text-white font-semibold"
                  >
                    {discovering
                      ? "Menjalankan Scraping..."
                      : "Jalankan Hybrid Discovery"}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleAddSupplier} className="space-y-3">
                <div>
                  <label
                    htmlFor="add-supp-name"
                    className="block font-semibold text-[#334155] mb-1"
                  >
                    Nama Distributor *
                  </label>
                  <input
                    id="add-supp-name"
                    type="text"
                    required
                    placeholder="Contoh: PT Samudera Beku Nusantara"
                    value={suppName}
                    onChange={(e) => setSuppName(e.target.value)}
                    className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="add-supp-phone"
                      className="block font-semibold text-[#334155] mb-1"
                    >
                      Nomor WhatsApp *
                    </label>
                    <input
                      id="add-supp-phone"
                      type="text"
                      required
                      placeholder="08116800xxx"
                      value={suppPhone}
                      onChange={(e) => setSuppPhone(e.target.value)}
                      className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="add-supp-rating"
                      className="block font-semibold text-[#334155] mb-1"
                    >
                      Rating Google (&ge; 4.5) *
                    </label>
                    <input
                      id="add-supp-rating"
                      type="number"
                      step="0.1"
                      min="4.5"
                      max="5.0"
                      required
                      value={suppRating}
                      onChange={(e) => setSuppRating(e.target.value)}
                      className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="add-supp-addr"
                    className="block font-semibold text-[#334155] mb-1"
                  >
                    Alamat Distributor
                  </label>
                  <input
                    id="add-supp-addr"
                    type="text"
                    required
                    placeholder="Contoh: Jl. Teuku Umar No. 88, Banda Aceh"
                    value={suppAddr}
                    onChange={(e) => setSuppAddr(e.target.value)}
                    className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 items-center">
                  <label className="inline-flex items-center gap-2 font-semibold text-[#334155]">
                    <input
                      type="checkbox"
                      checked={suppIsB2B}
                      onChange={(e) => setSuppIsB2B(e.target.checked)}
                    />
                    Mitra B2B Terverifikasi
                  </label>
                  <div>
                    <label
                      htmlFor="add-supp-comm"
                      className="block font-semibold text-[#334155] mb-1"
                    >
                      Komisi B2B (%)
                    </label>
                    <input
                      id="add-supp-comm"
                      type="number"
                      step="0.25"
                      value={suppCommRate}
                      onChange={(e) => setSuppCommRate(e.target.value)}
                      className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowScrapingModal(false)}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-[#F1F5F9] font-semibold"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white font-semibold"
                  >
                    Simpan Distributor
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal 2: Simulasi Balasan Chat Supplier */}
      {showChatModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-sim-title"
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleSimulateReply}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#E2E8F0] space-y-3 text-xs"
          >
            <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-2">
              <h3
                id="chat-sim-title"
                className="text-base font-bold text-[#0F172A]"
              >
                Simulasi Balasan Chat Supplier (Webhook WA)
              </h3>
              <button
                type="button"
                aria-label="Tutup dialog simulasi chat"
                onClick={() => setShowChatModal(false)}
                className="min-h-[36px] min-w-[36px] rounded-lg text-[#64748B] font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>
            <div>
              <label
                htmlFor="sim-supp-select"
                className="block font-semibold text-[#334155] mb-1"
              >
                Pengirim (Kandidat Distributor)
              </label>
              <select
                id="sim-supp-select"
                value={simSupplierPhone}
                onChange={(e) => setSimSupplierPhone(e.target.value)}
                disabled={suppliers.length === 0}
                className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1] bg-white disabled:bg-slate-100"
              >
                {suppliers.length === 0 ? (
                  <option value="">Belum ada distributor terdaftar</option>
                ) : (
                  suppliers.map((s) => (
                    <option key={s.id} value={s.phoneWhatsapp}>
                      {s.name} ({s.phoneWhatsapp})
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label
                htmlFor="sim-supp-msg"
                className="block font-semibold text-[#334155] mb-1"
              >
                Isi Balasan WhatsApp
              </label>
              <textarea
                id="sim-supp-msg"
                rows={3}
                required
                placeholder="Contoh: Ready 5 dus harga Rp 405rb/dus, MOQ 5 dus, batch exp 14 Okt 2027, diantar mobil freezer"
                value={simSupplierText}
                onChange={(e) => setSimSupplierText(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#CBD5E1]"
              />
            </div>
            <div className="flex flex-wrap justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowChatModal(false);
                  onNavigateTab("whatsapp");
                }}
                className="min-h-[40px] px-3 py-2 rounded-xl border border-[#E2E8F0] text-[#0F6352] font-semibold"
              >
                Buka Agen WA &amp; OCR Penuh
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowChatModal(false)}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#F1F5F9] font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={actionBusy}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white font-semibold"
                >
                  {actionBusy ? "Memproses..." : "Kirim & Ekstrak AI"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Modal 3: Lihat Dokumen PO */}
      {poDetailModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="po-doc-title"
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#E2E8F0] space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
              <div>
                <span className="text-[11px] font-bold uppercase text-[#0F6352]">
                  Dokumen Purchase Order Resmi
                </span>
                <h3
                  id="po-doc-title"
                  className="text-lg font-bold text-[#0F172A] font-mono"
                >
                  {poDetailModal.po_number}
                </h3>
              </div>
              <button
                type="button"
                aria-label="Tutup dokumen PO"
                onClick={() => setPoDetailModal(null)}
                className="min-h-[36px] min-w-[36px] rounded-lg text-[#64748B] font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="bg-[#F8FAFC] rounded-xl p-4 space-y-2 border border-[#E5E9EC]">
              <div className="flex justify-between gap-2">
                <span className="text-[#64748B]">Distributor:</span>
                <span className="font-bold text-[#0F172A] text-right">
                  {poDetailModal.supplier_name}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#64748B]">Produk &amp; Qty:</span>
                <span className="font-semibold text-right">
                  {poDetailModal.order_qty_boxes} Dus (
                  {poDetailModal.order_qty_packs} Pack){" "}
                  {poDetailModal.product_name}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#64748B]">Janji Batch Exp:</span>
                <span className="font-mono">
                  {formatDayMonthYearId(poDetailModal.promised_batch_expiry)}
                </span>
              </div>
              <div className="flex justify-between gap-2 pt-2 border-t border-[#E2E8F0] text-sm font-bold text-[#0F172A]">
                <span>Total PO:</span>
                <span className="font-mono">
                  {formatRp(poDetailModal.total_amount)}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#64748B]">Status:</span>
                <span className="font-semibold text-[#0F6352]">
                  {poDetailModal.status}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              {activeRole === "OWNER" &&
                (poDetailModal.status === "APPROVED_WA" ||
                  poDetailModal.status === "PDF_SENT") && (
                  <button
                    type="button"
                    onClick={() => handleCancelPo(poDetailModal.id)}
                    className="min-h-[40px] px-3.5 py-2 rounded-xl border border-red-200 hover:bg-red-50 text-red-700 font-semibold"
                  >
                    Batalkan PO
                  </button>
                )}
              <button
                type="button"
                onClick={() => window.print()}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white font-semibold"
              >
                Cetak PDF PO
              </button>
              <button
                type="button"
                onClick={() => setPoDetailModal(null)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#F1F5F9] font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
