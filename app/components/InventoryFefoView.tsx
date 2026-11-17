"use client";

import React, { useCallback, useEffect, useState } from "react";
import { formatRp } from "./CommandCenterDashboard";
import { useConfirmDialog } from "./ConfirmActionModal";
import { useGooeyToastFlash } from "./GooeyToastProvider";

interface ProductInventoryItem {
  id: string;
  skuCode: string;
  name: string;
  category: string;
  retailUnitName: string;
  wholesaleUnitName: string;
  packsPerBox: number;
  retailPricePerPack: number;
  wholesalePricePerBox: number;
  standardCogsPerPack: number;
  reorderPointPacks: number;
  defaultReorderBoxes: number;
  totalHealthyPacks: number;
  wholeBoxes: number;
  loosePacks: number;
  formattedStockDualUnit: string;
  expiredBlockedPacks: number;
  isBelowRop: boolean;
  activeBatchCount: number;
  firstFefoPickingBatch: {
    batchId: string;
    batchNumber: string;
    qtyPacks: number;
    expiryDate: string;
    daysToExpiry: number;
    fefoStatus: string;
    promoDiscountPct: number;
  } | null;
}

interface BatchItem {
  id: string;
  productId: string;
  productName: string;
  skuCode: string;
  batchNumber: string;
  supplierName: string | null;
  initialQtyPacks: number;
  currentQtyPacks: number;
  wholeBoxes: number;
  loosePacks: number;
  formattedQty: string;
  unitCogsPack: number;
  promoDiscountPct: number;
  expiryDate: string;
  daysToExpiry: number;
  fefoStatus: string;
  fefoQueueRank: number | null;
  isBlockedExpired: boolean;
  receivedVia: "VISION_OCR" | "MANUAL";
}

interface PromoCampaignItem {
  id: string;
  title: string;
  productName: string;
  discountPct: number;
  targetResellerCount: number;
  sentCount: number;
  status: string;
  batchNumber: string;
  daysToExpiry: number;
  remainingPacks: number;
}

type InventoryTabFilter = "ALL" | "CRITICAL" | "EXPIRING" | "SAFE";

function formatShortDateId(isoDate: string): string {
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
  if (parts.length !== 3) return isoDate;
  const day = parts[2];
  const month = months[Number(parts[1]) - 1] || parts[1];
  const year = parts[0];
  return `${day} ${month} ${year}`;
}

function getShortBatchLabel(batchNumber: string): string {
  const stripped = batchNumber.replace(/^Batch\s+/i, "").trim();
  return stripped.startsWith("#") ? stripped : `#${stripped}`;
}

export default function InventoryFefoView({
  activeStoreId,
  activeRole,
  onNavigateTab,
}: {
  activeStoreId: string;
  activeRole: "OWNER" | "CASHIER" | "ADMIN";
  onNavigateTab: (tab: string) => void;
}) {
  const [products, setProducts] = useState<ProductInventoryItem[]>([]);
  const [allBatches, setAllBatches] = useState<BatchItem[]>([]);
  const [promoCampaigns, setPromoCampaigns] = useState<PromoCampaignItem[]>([]);
  const [storeTempLabel, setStoreTempLabel] = useState("");

  const [tabFilter, setTabFilter] = useState<InventoryTabFilter>("ALL");
  const [showAllRows, setShowAllRows] = useState(false);
  const [loading, setLoading] = useState(true);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const confirmDialog = useConfirmDialog();

  useGooeyToastFlash(
    feedbackMsg,
    errorMsg,
    () => setFeedbackMsg(null),
    () => setErrorMsg(null)
  );
  const [broadcasting, setBroadcasting] = useState(false);

  // Modals
  const [showRopManagerModal, setShowRopManagerModal] = useState(false);
  const [showAddSkuModal, setShowAddSkuModal] = useState(false);
  const [showAddBatchModal, setShowAddBatchModal] = useState(false);
  const [selectedBatchModal, setSelectedBatchModal] =
    useState<BatchItem | null>(null);

  // ROP Quick Edit map
  const [ropDrafts, setRopDrafts] = useState<Record<string, string>>({});

  // Add SKU Form
  const [skuCode, setSkuCode] = useState("");
  const [skuName, setSkuName] = useState("");
  const [skuCategory, setSkuCategory] = useState("Frozen Food");
  const [packsPerBox, setPacksPerBox] = useState("20");
  const [retailPrice, setRetailPrice] = useState("25000");
  const [wholesalePrice, setWholesalePrice] = useState("460000");
  const [ropPacks, setRopPacks] = useState("40");

  // Add Batch Form
  const [batchProdId, setBatchProdId] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [batchBoxes, setBatchBoxes] = useState("5");
  const [batchExpiry, setBatchExpiry] = useState("");

  const fetchAllInventoryData = useCallback(async () => {
    const [prodRes, batchRes, promoRes, sumRes] = await Promise.all([
      fetch(
        `/api/v1/inventory/products?storeId=${encodeURIComponent(
          activeStoreId
        )}`
      ),
      fetch(
        `/api/v1/inventory/batches?storeId=${encodeURIComponent(
          activeStoreId
        )}&status=ALL`
      ),
      fetch(
        `/api/v1/promos/fefo-drafts?storeId=${encodeURIComponent(
          activeStoreId
        )}`
      ),
      fetch(
        `/api/v1/dashboard/summary?storeId=${encodeURIComponent(
          activeStoreId
        )}&role=${activeRole}`
      ),
    ]);
    const [prodJson, batchJson, promoJson, sumJson] = await Promise.all([
      prodRes.json(),
      batchRes.json(),
      promoRes.json(),
      sumRes.json(),
    ]);
    return { prodJson, batchJson, promoJson, sumJson };
  }, [activeStoreId, activeRole]);

  const applyInventoryState = useCallback(
    ({
      prodJson,
      batchJson,
      promoJson,
      sumJson,
    }: Awaited<ReturnType<typeof fetchAllInventoryData>>) => {
      if (prodJson.success) {
        setProducts(prodJson.data);
        setRopDrafts((prev) => {
          const next = { ...prev };
          for (const p of prodJson.data as ProductInventoryItem[]) {
            if (next[p.id] === undefined) {
              next[p.id] = String(p.reorderPointPacks);
            }
          }
          return next;
        });
        setBatchProdId((prev) =>
          prodJson.data.some((p: ProductInventoryItem) => p.id === prev)
            ? prev
            : prodJson.data.length > 0
              ? prodJson.data[0].id
              : ""
        );
      }
      if (batchJson.success) {
        setAllBatches(batchJson.data);
      }
      if (promoJson.success) {
        setPromoCampaigns(promoJson.data);
      }
      if (sumJson.success && sumJson.data?.store?.coldChainStatusLabel) {
        setStoreTempLabel(sumJson.data.store.coldChainStatusLabel);
      }
    },
    []
  );

  const loadData = useCallback(async () => {
    try {
      setErrorMsg(null);
      const data = await fetchAllInventoryData();
      applyInventoryState(data);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal memuat data inventaris."
      );
    } finally {
      setLoading(false);
    }
  }, [fetchAllInventoryData, applyInventoryState]);

  useEffect(() => {
    let cancelled = false;
    fetchAllInventoryData()
      .then((data) => {
        if (cancelled) return;
        setErrorMsg(null);
        applyInventoryState(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(
          err instanceof Error ? err.message : "Gagal memuat data inventaris."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchAllInventoryData, applyInventoryState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowRopManagerModal(false);
        setShowAddSkuModal(false);
        setShowAddBatchModal(false);
        setSelectedBatchModal(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleRunFefoRadar = async () => {
    setFeedbackMsg(null);
    setErrorMsg(null);
    const res = await fetch("/api/v1/inventory/batches/evaluate-fefo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: activeStoreId }),
    });
    const json = await res.json();
    if (json.success) {
      setFeedbackMsg(
        `Radar FEFO Selesai: ${json.data.safeCount} Aman • ${json.data.priorityFefoCount} Prioritas FEFO • ${json.data.criticalCount} Kritis • ${json.data.expiredCount} Expired.`
      );
      await loadData();
    } else {
      setErrorMsg(json.error?.message || "Gagal menjalankan Radar FEFO.");
    }
  };

  const handleUpdateRop = async (prod: ProductInventoryItem) => {
    const newRop = Number(ropDrafts[prod.id] ?? prod.reorderPointPacks);
    const ok = await confirmDialog({
      title: "Simpan Perubahan Batas Stok Minimum (ROP)?",
      description:
        "Batas pemicu Auto-RFQ untuk produk ini akan diperbarui di database inventaris.",
      detailText: `${prod.name}: ${prod.reorderPointPacks} ${prod.retailUnitName} -> ${newRop} ${prod.retailUnitName}`,
      confirmLabel: "Ya, Perbarui ROP",
      cancelLabel: "Batal",
      variant: "primary",
    });
    if (!ok) return;
    setFeedbackMsg(null);
    setErrorMsg(null);
    const res = await fetch(`/api/v1/inventory/products/${prod.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        actorRole: activeRole,
        reorderPointPacks: newRop,
      }),
    });
    const json = await res.json();
    if (json.success) {
      setFeedbackMsg(
        `Batas minimum ROP ${prod.name} diperbarui ke ${newRop} ${prod.retailUnitName}.`
      );
      await loadData();
    } else {
      setErrorMsg(json.error?.message || "Gagal memperbarui batas minimum.");
    }
  };

  const handleCreateSku = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await confirmDialog({
      title: "Tambahkan Master SKU Baru?",
      description:
        "Produk baru akan disimpan ke dalam katalog Master SKU dan antrean FEFO toko.",
      detailText: `${skuName} (${skuCode}) • 1 Dus = ${packsPerBox} Pack`,
      confirmLabel: "Ya, Simpan SKU",
      cancelLabel: "Batal",
      variant: "primary",
    });
    if (!ok) return;
    setFeedbackMsg(null);
    setErrorMsg(null);
    const res = await fetch("/api/v1/inventory/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        actorRole: activeRole,
        skuCode,
        name: skuName,
        category: skuCategory,
        packsPerBox: Number(packsPerBox),
        retailPricePerPack: Number(retailPrice),
        wholesalePricePerBox: Number(wholesalePrice),
        reorderPointPacks: Number(ropPacks),
      }),
    });
    const json = await res.json();
    if (json.success) {
      setShowAddSkuModal(false);
      setSkuCode("");
      setSkuName("");
      setFeedbackMsg(
        `Master SKU ${json.data.name} (${json.data.skuCode}) berhasil ditambahkan!`
      );
      await loadData();
    } else {
      setErrorMsg(json.error?.message || "Gagal menambahkan Master SKU.");
    }
  };

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await confirmDialog({
      title: "Simpan Batch Stok Masuk ke Antrean FEFO?",
      description:
        "Batch baru akan diurutkan otomatis berdasarkan tanggal kedaluwarsa (First-Expired, First-Out).",
      detailText: `Batch ${batchNumber} • ${batchBoxes} Dus • Exp: ${batchExpiry}`,
      confirmLabel: "Ya, Masukkan Batch",
      cancelLabel: "Batal",
      variant: "primary",
    });
    if (!ok) return;
    setFeedbackMsg(null);
    setErrorMsg(null);
    const res = await fetch("/api/v1/inventory/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        productId: batchProdId,
        batchNumber,
        qtyBoxes: Number(batchBoxes),
        expiryDate: batchExpiry,
        receivedVia: "MANUAL",
      }),
    });
    const json = await res.json();
    if (json.success) {
      setShowAddBatchModal(false);
      setBatchNumber("");
      setFeedbackMsg(
        `Batch ${json.data.batchNumber} (${json.data.initialQtyPacks} Pack) berhasil masuk ke Antrean FEFO urutan #${json.data.fefoQueueRank}!`
      );
      await loadData();
    } else {
      setErrorMsg(json.error?.message || "Gagal menambah batch stok.");
    }
  };

  const handleWriteOff = async (batch: BatchItem) => {
    const ok = await confirmDialog({
      title: "Konfirmasi Write-Off (Pemusnahan Batch)",
      description:
        "Sisa stok pada batch ini akan dikosongkan dan dicatat sebagai beban kerugian di Buku Kas secara permanen.",
      detailText: `${batch.productName} • Batch ${batch.batchNumber} (${batch.currentQtyPacks} Pack)`,
      confirmLabel: "Ya, Musnahkan Batch",
      cancelLabel: "Batal",
      variant: "danger",
    });
    if (!ok) return;
    setFeedbackMsg(null);
    setErrorMsg(null);
    const res = await fetch("/api/v1/inventory/batches/write-off", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        actorRole: activeRole,
        batchId: batch.id,
        reason: batch.isBlockedExpired ? "EXPIRED" : "COLD_CHAIN_SPOILAGE",
      }),
    });
    const json = await res.json();
    if (json.success) {
      setSelectedBatchModal(null);
      setFeedbackMsg(
        `Write-Off Berhasil: ${json.data.writtenOffPacks} Pack ${
          json.data.productName
        } (${json.data.batchNumber}) dimusnahkan. Beban kerugian ${formatRp(
          json.data.lossAmountRp
        )} tercatat di Buku Kas.`
      );
      await loadData();
    } else {
      setErrorMsg(json.error?.message || "Gagal melakukan Write-Off.");
    }
  };

  const handleDeactivateSku = async (prod: ProductInventoryItem) => {
    const ok = await confirmDialog({
      title: "Hapus / Nonaktifkan Master SKU?",
      description:
        "Produk ini akan dinonaktifkan dari katalog aktif toko. Pastikan Anda telah memeriksa sisa batch terkait.",
      detailText: `${prod.name} (${prod.skuCode})`,
      confirmLabel: "Ya, Hapus SKU",
      cancelLabel: "Batal",
      variant: "danger",
    });
    if (!ok) return;
    setFeedbackMsg(null);
    setErrorMsg(null);
    const res = await fetch(
      `/api/v1/inventory/products/${prod.id}?storeId=${encodeURIComponent(
        activeStoreId
      )}`,
      { method: "DELETE" }
    );
    const json = await res.json();
    if (json.success) {
      setFeedbackMsg(`SKU ${prod.name} berhasil dinonaktifkan.`);
      await loadData();
    } else {
      setErrorMsg(json.error?.message || "Gagal menonaktifkan SKU.");
    }
  };

  const productById = new Map(products.map((p) => [p.id, p]));

  // Derive KPI metrics strictly from live API state
  const activeBatches = allBatches.filter((b) => !b.isBlockedExpired);
  const totalAssetValueRp = activeBatches.reduce(
    (sum, b) => sum + b.currentQtyPacks * b.unitCogsPack,
    0
  );
  const criticalSkus = products.filter((p) => p.isBelowRop);
  const expiringBatches = activeBatches.filter(
    (b) => b.daysToExpiry > 0 && b.daysToExpiry < 30
  );
  const expiringPacksTotal = expiringBatches.reduce(
    (sum, b) => sum + b.currentQtyPacks,
    0
  );
  const expiringCapitalRp = expiringBatches.reduce(
    (sum, b) => sum + b.currentQtyPacks * b.unitCogsPack,
    0
  );
  const totalHealthyPacksAll = activeBatches.reduce(
    (sum, b) => sum + b.currentQtyPacks,
    0
  );
  const freezerCapacityPacks = 900;
  const freezerFillPct =
    totalHealthyPacksAll === 0
      ? 0
      : Math.min(
          100,
          Math.max(1, Math.round((totalHealthyPacksAll / freezerCapacityPacks) * 100))
        );

  // Classify each batch row for filter tabs
  const classifyBatchTab = (b: BatchItem): Exclude<InventoryTabFilter, "ALL"> => {
    const prod = productById.get(b.productId);
    if (b.isBlockedExpired || (prod && prod.isBelowRop)) {
      if (
        b.fefoStatus === "PRIORITY_FEFO" &&
        !(prod && prod.totalHealthyPacks <= 10)
      ) {
        return "EXPIRING";
      }
      return "CRITICAL";
    }
    if (b.daysToExpiry < 30 || b.fefoStatus === "PRIORITY_FEFO") {
      return "EXPIRING";
    }
    return "SAFE";
  };

  const criticalBatchCount = allBatches.filter(
    (b) => classifyBatchTab(b) === "CRITICAL"
  ).length;
  const expiringBatchTabCount = allBatches.filter(
    (b) => classifyBatchTab(b) === "EXPIRING"
  ).length;
  const safeBatchTabCount = allBatches.filter(
    (b) => classifyBatchTab(b) === "SAFE"
  ).length;

  const filteredBatches = allBatches.filter((b) => {
    if (tabFilter === "ALL") return true;
    return classifyBatchTab(b) === tabFilter;
  });

  const visibleBatches = showAllRows
    ? filteredBatches
    : filteredBatches.slice(0, 5);

  const primaryDraftCampaign =
    promoCampaigns.find((c) => c.status === "DRAFT_READY") || promoCampaigns[0];

  const handleSendPromoDraft = async () => {
    if (!primaryDraftCampaign) {
      onNavigateTab("promo");
      return;
    }
    if (primaryDraftCampaign.status !== "DRAFT_READY") {
      onNavigateTab("promo");
      return;
    }
    const ok = await confirmDialog({
      title: "Konfirmasi Siaran Draf Promo FEFO",
      description:
        "Pesan promo akan dikirimkan ke mitra reseller dan harga diskon FEFO akan langsung diaktifkan di kasir POS.",
      detailText: `${primaryDraftCampaign.productName} (-${primaryDraftCampaign.discountPct}%)`,
      confirmLabel: "Ya, Siarkan Promo",
      cancelLabel: "Batal",
      variant: "primary",
    });
    if (!ok) return;
    setBroadcasting(true);
    setFeedbackMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/v1/promos/fefo-drafts/${primaryDraftCampaign.id}/broadcast`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId: activeStoreId,
            actorRole: activeRole,
          }),
        }
      );
      const json = await res.json();
      if (json.success) {
        setFeedbackMsg(
          `Draf promo ${primaryDraftCampaign.productName} berhasil dikirim ke ${json.data.sentCount} WhatsApp Reseller.`
        );
        await loadData();
      } else {
        setErrorMsg(json.error?.message || "Gagal mengirim draf promo.");
      }
    } finally {
      setBroadcasting(false);
    }
  };

  const getSupplierLabelForBatch = (
    b: BatchItem,
    isCriticalRow: boolean
  ): { name: string; missing: boolean } => {
    if (b.supplierName) {
      return { name: b.supplierName, missing: false };
    }
    if (isCriticalRow) {
      return { name: "Belum Ada", missing: true };
    }
    return {
      name: b.receivedVia === "VISION_OCR" ? "Menunggu PO" : "Stok Internal",
      missing: false,
    };
  };

  return (
    <div className="space-y-5">
      {/* Page Title & Top Action Buttons */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-[22px] sm:text-[24px] font-bold text-[#0F172A] tracking-tight leading-snug">
            Manajemen Inventaris Rantai Dingin &amp; Batch FEFO
          </h1>
          <p className="text-[13px] text-[#64748B] mt-0.5">
            Urutan pengeluaran otomatis First Expired First Out untuk mencegah
            kerugian barang kedaluwarsa di freezer
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowRopManagerModal(true)}
            className="min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-xs font-medium text-[#334155] inline-flex items-center gap-2 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4 text-[#64748B]"
            >
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
              <circle cx="9" cy="6" r="2" fill="white" />
              <circle cx="15" cy="12" r="2" fill="white" />
              <circle cx="10" cy="18" r="2" fill="white" />
            </svg>
            <span>Atur Batas Min</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAddBatchModal(true)}
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
            <span>+ Input Batch Masuk</span>
          </button>
        </div>
      </div>

      {/* 4 KPI Cards Row */}
      {loading && allBatches.length === 0 && products.length === 0 ? (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 animate-pulse"
          role="status"
          aria-busy="true"
          aria-label="Memuat metrik inventaris FEFO..."
        >
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="rounded-2xl bg-white border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between min-h-[138px]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="h-3.5 w-36 rounded bg-[#E2E8F0]" />
                <div className="h-3.5 w-3.5 rounded-full bg-[#F1F5F9]" />
              </div>
              <div className="my-2">
                <div className="h-7 w-40 rounded-lg bg-[#CBD5E1]" />
              </div>
              <div className="h-3 w-36 rounded bg-[#F1F5F9]" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* KPI 1: Nilai Aset Stok Freezer */}
          <div className="rounded-2xl bg-gradient-to-br from-[#0F6352] to-[#0B5344] text-white p-5 shadow-sm flex flex-col justify-between min-h-[138px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold tracking-wider uppercase text-emerald-100/90">
                Nilai Aset Stok Freezer
              </span>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4 text-emerald-100/85 shrink-0"
              >
                <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5" />
                <path d="M16 12h4v4h-4a2 2 0 0 1 0-4Z" />
              </svg>
            </div>
            <div className="my-2">
              <div className="text-[24px] sm:text-[26px] font-bold tracking-tight tabular-nums leading-tight">
                {activeRole === "CASHIER"
                  ? "Rp ••••••••"
                  : formatRp(totalAssetValueRp)}
              </div>
            </div>
            <div className="text-[11px] text-emerald-100/85">
              {activeBatches.length} Batch Aktif • FEFO Otomatis
            </div>
          </div>

          {/* KPI 2: Stok Kritis (< Batas Min) */}
          <button
            type="button"
            onClick={() => setTabFilter("CRITICAL")}
            className="rounded-2xl bg-white border border-[#E5E9EC] hover:border-[#CBD5E1] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between min-h-[138px] text-left w-full transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
          >
            <div className="flex items-center justify-between gap-2 w-full">
              <span className="text-xs font-medium text-[#64748B]">
                Stok Kritis (&lt; Batas Min)
              </span>
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            </div>
            <div className="my-2">
              <div className="text-[26px] font-bold text-[#0F172A] tracking-tight tabular-nums leading-tight">
                {criticalSkus.length} SKU
              </div>
            </div>
            <div className="text-[11px] text-[#64748B]">
              Butuh Auto-Scrape Supplier
            </div>
          </button>

          {/* KPI 3: Mendekati Expired (< 30 Hr) */}
          <button
            type="button"
            onClick={() => setTabFilter("EXPIRING")}
            className="rounded-2xl bg-white border border-[#E5E9EC] hover:border-[#CBD5E1] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between min-h-[138px] text-left w-full transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
          >
            <div className="flex items-center justify-between gap-2 w-full">
              <span className="text-xs font-medium text-[#64748B]">
                Mendekati Expired (&lt; 30 Hr)
              </span>
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
            </div>
            <div className="my-2">
              <div className="text-[24px] sm:text-[26px] font-bold text-[#0F172A] tracking-tight tabular-nums leading-tight">
                {expiringBatches.length} Batch ({expiringPacksTotal} Pack)
              </div>
            </div>
            <div className="text-[11px] text-[#64748B]">
              {activeRole === "CASHIER"
                ? "Prioritas Promo FEFO"
                : `Potensi Modal ${formatRp(expiringCapitalRp)}`}
            </div>
          </button>

          {/* KPI 4: Kapasitas Chest Freezer */}
          <div
            title={`Terisi ${totalHealthyPacksAll} Pack dari estimasi kapasitas ${freezerCapacityPacks} Pack`}
            className="rounded-2xl bg-white border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between min-h-[138px]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#64748B]">
                Kapasitas Chest Freezer
              </span>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4 text-[#64748B] shrink-0"
              >
                <rect x="5" y="2" width="14" height="20" rx="2" />
                <path d="M5 10h14" />
                <path d="M9 6v1" />
                <path d="M9 14v2" />
              </svg>
            </div>
            <div className="mt-2">
              <div className="text-[26px] font-bold text-[#0F172A] tracking-tight tabular-nums leading-tight">
                {freezerFillPct}% Terisi
              </div>
              <div className="w-full h-1.5 bg-[#E2E8F0] rounded-full overflow-hidden mt-2">
                <div
                  style={{ width: `${freezerFillPct}%` }}
                  className="h-full bg-[#0F6352] rounded-full"
                />
              </div>
            </div>
            <div className="text-[11px] text-[#64748B] mt-2">
              {storeTempLabel || "Memuat status suhu freezer..."}
            </div>
          </div>
        </div>
      )}

      {/* Main FEFO Batch Queue Table Card */}
      <section
        aria-label="Antrean batch stok FEFO"
        className="bg-white rounded-2xl border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
      >
        {/* Filter Bar Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pb-4">
          <div
            role="tablist"
            aria-label="Filter status batch inventaris"
            className="inline-flex flex-wrap items-center gap-1.5 bg-[#F1F5F9] p-1 rounded-xl text-xs"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tabFilter === "ALL"}
              onClick={() => setTabFilter("ALL")}
              className={`min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352] ${
                tabFilter === "ALL"
                  ? "bg-white text-[#0F172A] font-semibold shadow-2xs"
                  : "text-[#64748B] hover:text-[#0F172A] font-medium"
              }`}
            >
              Semua Batch ({allBatches.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tabFilter === "CRITICAL"}
              onClick={() => setTabFilter("CRITICAL")}
              className={`min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352] ${
                tabFilter === "CRITICAL"
                  ? "bg-white text-[#0F172A] font-semibold shadow-2xs"
                  : "text-[#64748B] hover:text-[#0F172A] font-medium"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span>Stok Kritis ({criticalBatchCount})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tabFilter === "EXPIRING"}
              onClick={() => setTabFilter("EXPIRING")}
              className={`min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352] ${
                tabFilter === "EXPIRING"
                  ? "bg-white text-[#0F172A] font-semibold shadow-2xs"
                  : "text-[#64748B] hover:text-[#0F172A] font-medium"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              <span>Hampir Expired ({expiringBatchTabCount})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tabFilter === "SAFE"}
              onClick={() => setTabFilter("SAFE")}
              className={`min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352] ${
                tabFilter === "SAFE"
                  ? "bg-white text-[#0F172A] font-semibold shadow-2xs"
                  : "text-[#64748B] hover:text-[#0F172A] font-medium"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
              <span>Stok Aman ({safeBatchTabCount})</span>
            </button>
          </div>

          <div className="inline-flex items-center gap-2 text-xs font-medium text-[#334155]">
            <span className="w-2 h-2 rounded-full bg-[#10B981]" />
            <span>Urutan FEFO Aktif</span>
          </div>
        </div>

        {/* Desktop Table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-y border-[#F1F5F9] text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                <th className="py-3 px-3">Produk &amp; Satuan</th>
                <th className="py-3 px-3">Batch &amp; Expired</th>
                <th className="py-3 px-3">Sisa Stok &amp; Status</th>
                <th className="py-3 px-3">Supplier</th>
                <th className="py-3 px-3 text-right">Aksi AI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-xs">
              {loading ? (
                [1, 2, 3, 4, 5].map((n) => (
                  <tr key={n} className="animate-pulse">
                    <td className="py-3.5 px-3 align-middle">
                      <div className="flex items-center gap-3">
                        <span className="w-9 h-9 rounded-xl bg-[#F1F5F9] shrink-0" />
                        <div className="space-y-1.5">
                          <div className="h-3.5 w-36 rounded bg-[#CBD5E1]" />
                          <div className="h-2.5 w-28 rounded bg-[#E2E8F0]" />
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-3 align-middle">
                      <div className="space-y-1.5">
                        <div className="h-5 w-24 rounded-md bg-[#E2E8F0]" />
                        <div className="h-2.5 w-32 rounded bg-[#F1F5F9]" />
                      </div>
                    </td>
                    <td className="py-3.5 px-3 align-middle">
                      <div className="space-y-1.5">
                        <div className="h-3.5 w-28 rounded bg-[#CBD5E1]" />
                        <div className="h-2.5 w-20 rounded bg-[#E2E8F0]" />
                      </div>
                    </td>
                    <td className="py-3.5 px-3 align-middle">
                      <div className="space-y-1.5">
                        <div className="h-3.5 w-32 rounded bg-[#E2E8F0]" />
                        <div className="h-2.5 w-24 rounded bg-[#F1F5F9]" />
                      </div>
                    </td>
                    <td className="py-3.5 px-3 align-middle text-right">
                      <div className="inline-block h-8 w-28 rounded-xl bg-[#F1F5F9]" />
                    </td>
                  </tr>
                ))
              ) : visibleBatches.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-8 text-center text-[#64748B] font-medium space-y-2"
                  >
                    <div>Tidak ada batch pada kategori filter ini.</div>
                    {tabFilter !== "ALL" && (
                      <button
                        type="button"
                        onClick={() => setTabFilter("ALL")}
                        className="px-3 py-1.5 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#0F172A] font-semibold"
                      >
                        Tampilkan Semua Batch
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                visibleBatches.map((b) => {
                  const prod = productById.get(b.productId);
                  const rowKind = classifyBatchTab(b);
                  const isCriticalRow = rowKind === "CRITICAL";
                  const isExpiringRow = rowKind === "EXPIRING";
                  const supplierInfo = getSupplierLabelForBatch(
                    b,
                    isCriticalRow
                  );
                  const minRop = prod?.reorderPointPacks ?? 20;
                  const packsPerBox = prod?.packsPerBox ?? 20;
                  const retailUnit = prod?.retailUnitName ?? "Pack";
                  const wholesaleUnit = prod?.wholesaleUnitName ?? "Dus";

                  return (
                    <tr
                      key={b.id}
                      className="hover:bg-[#F8FAFC]/80 transition-colors"
                    >
                      {/* Produk & Satuan */}
                      <td className="py-3.5 px-3 align-middle">
                        <div className="flex items-center gap-3">
                          <span className="w-9 h-9 rounded-xl bg-[#F8FAFC] border border-[#E5E9EC] text-[#64748B] flex items-center justify-center shrink-0">
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="w-4 h-4"
                            >
                              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                              <path d="m3.3 7 8.7 5 8.7-5" />
                              <path d="M12 22V12" />
                            </svg>
                          </span>
                          <div className="min-w-0">
                            <div className="font-semibold text-[#0F172A] truncate">
                              {b.productName}
                            </div>
                            <div className="font-mono text-[11px] text-[#64748B] mt-0.5">
                              {b.skuCode} • 1 {wholesaleUnit} = {packsPerBox}{" "}
                              {retailUnit}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Batch & Expired */}
                      <td className="py-3.5 px-3 align-middle">
                        <span className="inline-block px-2 py-0.5 rounded-md bg-[#F1F5F9] text-[#334155] font-mono text-[11px] font-medium">
                          {getShortBatchLabel(b.batchNumber)}
                        </span>
                        <div
                          className={`text-[11px] mt-1 flex items-center gap-1 ${
                            b.daysToExpiry < 30
                              ? "text-amber-700 font-medium"
                              : "text-[#64748B]"
                          }`}
                        >
                          {b.daysToExpiry < 30 && (
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="w-3 h-3 shrink-0"
                            >
                              <path d="M5 22h14" />
                              <path d="M5 2h14" />
                              <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
                              <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
                            </svg>
                          )}
                          <span>
                            {formatShortDateId(b.expiryDate)}
                            {b.daysToExpiry < 30
                              ? ` (${b.daysToExpiry} Hr)`
                              : ""}
                          </span>
                        </div>
                      </td>

                      {/* Sisa Stok & Status */}
                      <td className="py-3.5 px-3 align-middle">
                        <div>
                          <strong className="text-[#0F172A]">
                            {b.currentQtyPacks} {retailUnit}
                          </strong>{" "}
                          <span className="font-mono text-[11px] text-[#64748B]">
                            (
                            {isCriticalRow || isExpiringRow
                              ? `Min ${minRop}`
                              : `${b.wholeBoxes} ${wholesaleUnit}`}
                            )
                          </span>
                        </div>
                        <div className="mt-0.5">
                          {isCriticalRow ? (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-red-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                              <span>
                                {b.isBlockedExpired ? "Expired" : "Kritis"}
                              </span>
                            </span>
                          ) : isExpiringRow ? (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              <span>Exp {b.daysToExpiry} Hari</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#0F6352]">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                              <span>Aman</span>
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Supplier */}
                      <td className="py-3.5 px-3 align-middle">
                        {supplierInfo.missing ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="w-3.5 h-3.5 shrink-0"
                            >
                              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                              <path d="M12 9v4" />
                              <path d="M12 17h.01" />
                            </svg>
                            <span>Belum Ada</span>
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-[#334155]">
                            {supplierInfo.name}
                          </span>
                        )}
                      </td>

                      {/* Aksi AI */}
                      <td className="py-3.5 px-3 text-right align-middle">
                        {isCriticalRow ? (
                          <button
                            type="button"
                            onClick={() =>
                              onNavigateTab(`suppliers:${b.productId}`)
                            }
                            className="inline-flex items-center justify-center gap-1.5 min-h-[36px] min-w-[132px] px-3.5 py-1.5 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.9"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="w-3.5 h-3.5"
                            >
                              <path d="M3 9l1-5h16l1 5" />
                              <path d="M5 12v8h14v-8" />
                            </svg>
                            <span>Cari Supplier</span>
                          </button>
                        ) : isExpiringRow ? (
                          <button
                            type="button"
                            onClick={() => onNavigateTab("promo")}
                            className="inline-flex items-center justify-center gap-1.5 min-h-[36px] min-w-[132px] px-3.5 py-1.5 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.9"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="w-3.5 h-3.5"
                            >
                              <path d="m3 11 18-5v12L3 13v-2Z" />
                              <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
                            </svg>
                            <span>
                              Promo WA {b.promoDiscountPct || 20}%
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSelectedBatchModal(b)}
                            className="inline-flex items-center justify-center gap-1.5 min-h-[36px] min-w-[132px] px-3.5 py-1.5 rounded-xl border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-xs font-medium text-[#334155] transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="w-3.5 h-3.5 text-[#64748B]"
                            >
                              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                              <circle cx="12" cy="12" r="2.5" />
                            </svg>
                            <span>Lihat Batch</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Batch Cards (< sm) */}
        <div className="sm:hidden space-y-3">
          {visibleBatches.map((b) => {
            const rowKind = classifyBatchTab(b);
            const isCriticalRow = rowKind === "CRITICAL";
            const isExpiringRow = rowKind === "EXPIRING";
            return (
              <div
                key={`mob-${b.id}`}
                className="rounded-xl border border-[#E5E9EC] p-3.5 space-y-2.5 bg-[#F8FAFC]/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-[#0F172A]">
                      {b.productName}
                    </div>
                    <div className="font-mono text-[11px] text-[#64748B]">
                      {getShortBatchLabel(b.batchNumber)} •{" "}
                      {formatShortDateId(b.expiryDate)}
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                      isCriticalRow
                        ? "bg-red-50 text-red-700"
                        : isExpiringRow
                          ? "bg-amber-50 text-amber-800"
                          : "bg-[#EBF8F2] text-[#0F6352]"
                    }`}
                  >
                    {isCriticalRow
                      ? "Kritis"
                      : isExpiringRow
                        ? `Exp ${b.daysToExpiry} Hr`
                        : "Aman"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[#E5E9EC]">
                  <span className="text-xs font-bold text-[#0F172A]">
                    {b.currentQtyPacks} Pack
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (isCriticalRow)
                        onNavigateTab(`suppliers:${b.productId}`);
                      else if (isExpiringRow) onNavigateTab("promo");
                      else setSelectedBatchModal(b);
                    }}
                    className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0F6352] text-white text-xs font-semibold"
                  >
                    {isCriticalRow
                      ? "Cari Supplier"
                      : isExpiringRow
                        ? `Promo WA ${b.promoDiscountPct || 20}%`
                        : "Lihat Batch"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Table Footer */}
        <div className="mt-3 pt-3 border-t border-[#F1F5F9] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B]">
          <span className="inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#10B981]" />
            <span>Algoritma FEFO sinkron otomatis setiap transaksi POS</span>
          </span>

          <button
            type="button"
            onClick={() => setShowAllRows((prev) => !prev)}
            className="min-h-[44px] sm:min-h-[28px] px-2 font-medium text-[#475569] hover:text-[#0F6352] underline-offset-4 hover:underline"
          >
            {filteredBatches.length > 5
              ? showAllRows
                ? `Tampilkan ringkas (5 dari ${filteredBatches.length})`
                : `Menampilkan ${visibleBatches.length} dari ${filteredBatches.length} item cold-storage`
              : `Menampilkan ${visibleBatches.length} dari ${filteredBatches.length} item cold-storage`}
          </button>
        </div>
      </section>

      {/* Bottom Radar Penyelamatan Modal FEFO Callout Card */}
      <section
        aria-label="Radar penyelamatan modal FEFO"
        className="bg-white rounded-2xl border border-[#E5E9EC] px-5 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
      >
        <div className="flex items-start sm:items-center gap-3.5">
          <span className="w-10 h-10 rounded-xl bg-[#EBF8F2] text-[#0F6352] flex items-center justify-center shrink-0">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </span>
          <p className="text-xs text-[#334155] leading-relaxed">
            <strong className="text-[#0F6352]">
              Radar Penyelamatan Modal FEFO:
            </strong>{" "}
            {primaryDraftCampaign
              ? `Draf promo cuci gudang ${primaryDraftCampaign.productName} (Diskon ${primaryDraftCampaign.discountPct}%) siap dikirim ke ${primaryDraftCampaign.targetResellerCount} WhatsApp Reseller untuk menyelamatkan modal ${formatRp(
                  expiringCapitalRp
                )}.`
              : "Semua stok freezer dalam kondisi aman. Sistem terus memantau umur simpan batch mendekati 30 hari."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#EBF8F2] text-[#0F6352] text-[11px] font-semibold whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
            <span>Zero Waste Aktif</span>
          </span>

          <button
            type="button"
            disabled={broadcasting}
            onClick={handleSendPromoDraft}
            className="min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] disabled:bg-slate-300 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
          >
            <span>
              {broadcasting
                ? "Mengirim..."
                : primaryDraftCampaign?.status === "ACTIVE_SENT"
                  ? "Lihat Draf Promo"
                  : "Kirim Draf"}
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-3.5 h-3.5"
            >
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          </button>
        </div>
      </section>

      {/* Modal 1: Atur Batas Min (ROP) & Master SKU Manager */}
      {showRopManagerModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rop-manager-title"
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-[#E2E8F0] space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
              <div>
                <h3
                  id="rop-manager-title"
                  className="text-base font-bold text-[#0F172A]"
                >
                  Atur Batas Minimum Stok (ROP) &amp; Katalog SKU
                </h3>
                <p className="text-[11px] text-[#64748B] mt-0.5">
                  Atur ambang batas ROP untuk memicu Auto-RFQ, tambah Master SKU
                  baru, atau jalankan evaluasi Radar FEFO.
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup dialog batas minimum"
                onClick={() => setShowRopManagerModal(false)}
                className="min-h-[36px] min-w-[36px] rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleRunFefoRadar}
                className="min-h-[40px] px-3.5 py-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] hover:bg-[#F1F5F9] font-semibold text-[#334155]"
              >
                ↻ Evaluasi Radar FEFO Sekarang
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRopManagerModal(false);
                  setShowAddSkuModal(true);
                }}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white font-semibold"
              >
                + Tambah Master SKU Baru
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto border border-[#E5E9EC] rounded-xl divide-y divide-[#F1F5F9]">
              {products.map((prod) => (
                <div
                  key={prod.id}
                  className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-[#0F172A]">{prod.name}</div>
                    <div className="font-mono text-[11px] text-[#64748B]">
                      {prod.skuCode} • Stok Sehat: {prod.totalHealthyPacks}{" "}
                      {prod.retailUnitName}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label
                      htmlFor={`rop-${prod.id}`}
                      className="text-[11px] text-[#64748B]"
                    >
                      Min ({prod.retailUnitName}):
                    </label>
                    <input
                      id={`rop-${prod.id}`}
                      type="number"
                      min={1}
                      value={ropDrafts[prod.id] ?? String(prod.reorderPointPacks)}
                      onChange={(e) =>
                        setRopDrafts((prev) => ({
                          ...prev,
                          [prod.id]: e.target.value,
                        }))
                      }
                      className="w-20 px-2.5 py-1.5 min-h-[36px] rounded-lg border border-[#CBD5E1] font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => handleUpdateRop(prod)}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#EBF8F2] hover:bg-[#D7F0E6] text-[#0F6352] font-semibold"
                    >
                      Simpan
                    </button>
                    {activeRole === "OWNER" && (
                      <button
                        type="button"
                        onClick={() => handleDeactivateSku(prod)}
                        className="min-h-[36px] px-2.5 py-1.5 rounded-lg text-red-600 hover:bg-red-50 font-semibold"
                      >
                        Hapus
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowRopManagerModal(false)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#334155] font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Detail Batch FEFO & Write-Off */}
      {selectedBatchModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-detail-title"
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#E2E8F0] space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
              <div>
                <span className="text-[11px] font-bold uppercase text-[#0F6352]">
                  Detail Batch Cold-Storage
                </span>
                <h3
                  id="batch-detail-title"
                  className="text-base font-bold text-[#0F172A]"
                >
                  {selectedBatchModal.productName} (
                  {getShortBatchLabel(selectedBatchModal.batchNumber)})
                </h3>
              </div>
              <button
                type="button"
                aria-label="Tutup detail batch"
                onClick={() => setSelectedBatchModal(null)}
                className="min-h-[36px] min-w-[36px] rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="bg-[#F8FAFC] rounded-xl p-4 space-y-2 border border-[#E5E9EC]">
              <div className="flex justify-between">
                <span className="text-[#64748B]">Urutan Keluar FEFO:</span>
                <span className="font-bold text-[#0F6352]">
                  {selectedBatchModal.fefoQueueRank
                    ? `Antrean #${selectedBatchModal.fefoQueueRank}`
                    : "Diblokir POS"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">Sisa Stok:</span>
                <span className="font-bold text-[#0F172A]">
                  {selectedBatchModal.formattedQty}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">Tanggal Kedaluwarsa:</span>
                <span className="font-semibold text-[#0F172A]">
                  {formatShortDateId(selectedBatchModal.expiryDate)} (Sisa{" "}
                  {selectedBatchModal.daysToExpiry} Hari)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">HPP / Pack:</span>
                <span className="font-mono font-bold text-[#0F172A]">
                  {formatRp(selectedBatchModal.unitCogsPack)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">Metode Input:</span>
                <span className="font-mono text-[#334155]">
                  {selectedBatchModal.receivedVia}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => handleWriteOff(selectedBatchModal)}
                className="min-h-[40px] px-3.5 py-2 rounded-xl border border-red-200 hover:bg-red-50 text-red-700 font-semibold"
              >
                Write-Off Batch
              </button>
              <button
                type="button"
                onClick={() => setSelectedBatchModal(null)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Tambah Master SKU */}
      {showAddSkuModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-sku-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleCreateSku}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#E2E8F0] space-y-3 text-xs"
          >
            <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-2">
              <h3
                id="add-sku-modal-title"
                className="text-base font-bold text-[#0F172A]"
              >
                Tambah Master SKU Multi-Satuan
              </h3>
              <button
                type="button"
                aria-label="Tutup dialog tambah SKU"
                onClick={() => setShowAddSkuModal(false)}
                className="min-h-[36px] min-w-[36px] rounded-lg text-[#64748B] hover:text-[#0F172A] font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="sku-code-input"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Kode SKU *
                </label>
                <input
                  id="sku-code-input"
                  type="text"
                  required
                  placeholder="SKU-KEB-500"
                  value={skuCode}
                  onChange={(e) => setSkuCode(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label
                  htmlFor="sku-cat-input"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Kategori
                </label>
                <input
                  id="sku-cat-input"
                  type="text"
                  value={skuCategory}
                  onChange={(e) => setSkuCategory(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                />
              </div>
              <div className="col-span-2">
                <label
                  htmlFor="sku-name-input"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Nama Produk *
                </label>
                <input
                  id="sku-name-input"
                  type="text"
                  required
                  placeholder="Kulit Kebab Beku 500g"
                  value={skuName}
                  onChange={(e) => setSkuName(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label
                  htmlFor="sku-packs-input"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Isi Pack per 1 Dus *
                </label>
                <input
                  id="sku-packs-input"
                  type="number"
                  required
                  min={1}
                  value={packsPerBox}
                  onChange={(e) => setPacksPerBox(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label
                  htmlFor="sku-rop-input"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Batas Minimum ROP (Pack) *
                </label>
                <input
                  id="sku-rop-input"
                  type="number"
                  required
                  min={1}
                  value={ropPacks}
                  onChange={(e) => setRopPacks(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label
                  htmlFor="sku-retail-input"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Harga Eceran / Pack (Rp) *
                </label>
                <input
                  id="sku-retail-input"
                  type="number"
                  required
                  value={retailPrice}
                  onChange={(e) => setRetailPrice(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label
                  htmlFor="sku-wholesale-input"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Harga Grosir / Dus (Rp) *
                </label>
                <input
                  id="sku-wholesale-input"
                  type="number"
                  required
                  value={wholesalePrice}
                  onChange={(e) => setWholesalePrice(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddSkuModal(false)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#F1F5F9] font-semibold"
              >
                Batal
              </button>
              <button
                type="submit"
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white font-semibold"
              >
                Simpan Master SKU
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal 4: Input Batch Baru ke Antrean FEFO */}
      {showAddBatchModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-batch-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleCreateBatch}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#E2E8F0] space-y-3 text-xs"
          >
            <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-2">
              <h3
                id="add-batch-modal-title"
                className="text-base font-bold text-[#0F172A]"
              >
                Input Batch Baru ke Antrean FEFO
              </h3>
              <button
                type="button"
                aria-label="Tutup dialog input batch"
                onClick={() => setShowAddBatchModal(false)}
                className="min-h-[36px] min-w-[36px] rounded-lg text-[#64748B] hover:text-[#0F172A] font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="batch-prod-select"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Pilih Produk (SKU) *
                </label>
                <select
                  id="batch-prod-select"
                  value={batchProdId}
                  onChange={(e) => setBatchProdId(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1] bg-white"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (1 Dus = {p.packsPerBox} Pack)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="batch-number-input"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Nomor Kode Batch *
                </label>
                <input
                  id="batch-number-input"
                  type="text"
                  required
                  placeholder="Mis: Batch FN-220"
                  value={batchNumber}
                  onChange={(e) => setBatchNumber(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="batch-boxes-input"
                    className="block font-semibold text-[#334155] mb-1"
                  >
                    Jumlah Dus Masuk *
                  </label>
                  <input
                    id="batch-boxes-input"
                    type="number"
                    required
                    min={1}
                    value={batchBoxes}
                    onChange={(e) => setBatchBoxes(e.target.value)}
                    className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="batch-expiry-input"
                    className="block font-semibold text-[#334155] mb-1"
                  >
                    Tanggal Kedaluwarsa *
                  </label>
                  <input
                    id="batch-expiry-input"
                    type="date"
                    required
                    value={batchExpiry}
                    onChange={(e) => setBatchExpiry(e.target.value)}
                    className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddBatchModal(false)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#F1F5F9] font-semibold"
              >
                Batal
              </button>
              <button
                type="submit"
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white font-semibold"
              >
                Masukkan ke Antrean FEFO
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
