"use client";

import React, { useCallback, useEffect, useState } from "react";
import { formatRp } from "./CommandCenterDashboard";

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
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modals
  const [showAddSkuModal, setShowAddSkuModal] = useState(false);
  const [showAddBatchModal, setShowAddBatchModal] = useState(false);

  // Add SKU Form (FR-301)
  const [skuCode, setSkuCode] = useState("");
  const [skuName, setSkuName] = useState("");
  const [skuCategory, setSkuCategory] = useState("Frozen Food");
  const [packsPerBox, setPacksPerBox] = useState("20");
  const [retailPrice, setRetailPrice] = useState("25000");
  const [wholesalePrice, setWholesalePrice] = useState("460000");
  const [ropPacks, setRopPacks] = useState("40");

  // Add Batch Form (FR-302)
  const [batchProdId, setBatchProdId] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [batchBoxes, setBatchBoxes] = useState("5");
  const [batchExpiry, setBatchExpiry] = useState("2027-10-14");

  const loadData = useCallback(async () => {
    try {
      setErrorMsg(null);
      const [prodRes, batchRes] = await Promise.all([
        fetch(
          `/api/v1/inventory/products?storeId=${encodeURIComponent(
            activeStoreId,
          )}`,
        ),
        fetch(
          `/api/v1/inventory/batches?storeId=${encodeURIComponent(
            activeStoreId,
          )}&status=${statusFilter}&productId=${encodeURIComponent(
            selectedProductId,
          )}`,
        ),
      ]);
      const prodJson = await prodRes.json();
      const batchJson = await batchRes.json();

      if (prodJson.success) {
        setProducts(prodJson.data);
        if (!batchProdId && prodJson.data.length > 0) {
          setBatchProdId(prodJson.data[0].id);
        }
      }
      if (batchJson.success) {
        setBatches(batchJson.data);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal memuat data inventaris.",
      );
    } finally {
      setLoading(false);
    }
  }, [activeStoreId, statusFilter, selectedProductId, batchProdId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
        `Radar FEFO Selesai: ${json.data.safeCount} Aman • ${json.data.priorityFefoCount} Prioritas FEFO • ${json.data.criticalCount} Kritis • ${json.data.expiredCount} Expired.`,
      );
      await loadData();
    } else {
      setErrorMsg(json.error?.message || "Gagal menjalankan Radar FEFO.");
    }
  };

  const handleCreateSku = async (e: React.FormEvent) => {
    e.preventDefault();
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
        `Master SKU ${json.data.name} (${json.data.skuCode}) berhasil ditambahkan!`,
      );
      await loadData();
    } else {
      setErrorMsg(json.error?.message || "Gagal menambahkan Master SKU.");
    }
  };

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
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
        `Batch ${json.data.batchNumber} (${json.data.initialQtyPacks} Pack) berhasil masuk ke Antrean FEFO urutan #${json.data.fefoQueueRank}!`,
      );
      await loadData();
    } else {
      setErrorMsg(json.error?.message || "Gagal menambah batch stok.");
    }
  };

  const handleWriteOff = async (batch: BatchItem) => {
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
      setFeedbackMsg(
        `Write-Off Berhasil: ${json.data.writtenOffPacks} Pack ${
          json.data.productName
        } (${json.data.batchNumber}) dimusnahkan. Beban kerugian ${formatRp(
          json.data.lossAmountRp,
        )} tercatat di Buku Kas.`,
      );
      await loadData();
    } else {
      setErrorMsg(json.error?.message || "Gagal melakukan Write-Off.");
    }
  };

  const handleDeactivateSku = async (
    e: React.MouseEvent,
    prod: ProductInventoryItem
  ) => {
    e.stopPropagation();
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
      if (selectedProductId === prod.id) setSelectedProductId("");
      await loadData();
    } else {
      setErrorMsg(json.error?.message || "Gagal menonaktifkan SKU.");
    }
  };

  const safeCount = batches.filter((b) => b.fefoStatus === "SAFE").length;
  const prioCount = batches.filter(
    (b) => b.fefoStatus === "PRIORITY_FEFO",
  ).length;
  const critCount = batches.filter((b) => b.fefoStatus === "CRITICAL").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase text-emerald-700">
            PRD-03 • Cold-Chain Inventory & FEFO Queue Engine
          </span>
          <h1 className="text-xl font-bold text-slate-900">
            Manajemen Inventaris Rantai Dingin & Antrean Batch FEFO
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Pelacakan umur simpan per batch kedatangan (First Expired, First
            Out), konversi otomatis Dus ↔ Pack, dan deteksi ambang batas ROP
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleRunFefoRadar}
            className="px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer"
          >
            ↻ Evaluasi Radar FEFO
          </button>
          <button
            onClick={() => setShowAddBatchModal(true)}
            className="px-3.5 py-2 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 cursor-pointer"
          >
            + Input Batch Baru
          </button>
          <button
            onClick={() => setShowAddSkuModal(true)}
            className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
          >
            + Tambah Master SKU
          </button>
        </div>
      </div>

      {feedbackMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-xl text-xs font-semibold flex items-center justify-between">
          <span>✓ {feedbackMsg}</span>
          <button
            onClick={() => setFeedbackMsg(null)}
            className="text-emerald-700 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl text-xs font-semibold flex items-center justify-between">
          <span>⚠️ {errorMsg}</span>
          <button
            onClick={() => setErrorMsg(null)}
            className="text-red-700 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Master SKU Multi-Satuan Grid */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Katalog Master SKU Multi-Satuan & Status ROP ({products.length}{" "}
              SKU)
            </h2>
            <p className="text-[11px] text-slate-500">
              Klik pada kartu SKU untuk memfilter antrean batch FEFO produk
              tersebut
            </p>
          </div>
          {selectedProductId && (
            <button
              onClick={() => setSelectedProductId("")}
              className="text-xs font-semibold text-emerald-700 underline cursor-pointer"
            >
              Tampilkan Semua SKU
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-xs text-slate-400 py-4">Memuat SKU...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((prod) => {
              const isSelected = selectedProductId === prod.id;
              return (
                <div
                  key={prod.id}
                  onClick={() =>
                    setSelectedProductId(isSelected ? "" : prod.id)
                  }
                  className={`p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between gap-3 ${
                    isSelected
                      ? "border-emerald-600 bg-emerald-50/30 ring-2 ring-emerald-500/20"
                      : prod.isBelowRop
                        ? "border-amber-300 bg-amber-50/20 hover:border-amber-400"
                        : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                        {prod.skuCode}
                      </span>
                      {prod.isBelowRop ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                          ● SKU Kritis (≤ ROP {prod.reorderPointPacks} Pack)
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                          Stok Aman
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-bold text-slate-900 mt-2">
                      {prod.name}
                    </h3>
                    <div className="text-[11px] text-slate-500">
                      Rasio Konversi: 1 {prod.wholesaleUnitName} ={" "}
                      <strong>
                        {prod.packsPerBox} {prod.retailUnitName}
                      </strong>
                    </div>

                    <div className="mt-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                      <div className="text-[10px] uppercase font-bold text-slate-400">
                        Total Stok Sehat Tersedia
                      </div>
                      <div className="text-sm font-extrabold text-slate-900">
                        {prod.formattedStockDualUnit}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex justify-between">
                        <span>
                          Ecer: {formatRp(prod.retailPricePerPack)}/pack
                        </span>
                        <span>
                          Grosir: {formatRp(prod.wholesalePricePerBox)}/dus
                        </span>
                      </div>
                    </div>
                  </div>

                  {prod.firstFefoPickingBatch ? (
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-emerald-800">
                        Ambil FEFO #1:{" "}
                        <strong>
                          {prod.firstFefoPickingBatch.batchNumber}
                        </strong>
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">
                          Exp {prod.firstFefoPickingBatch.daysToExpiry} Hr
                        </span>
                        {activeRole === "OWNER" && (
                          <button
                            type="button"
                            onClick={(e) => handleDeactivateSku(e, prod)}
                            className="text-red-500 hover:underline font-semibold cursor-pointer"
                            title="Nonaktifkan SKU"
                          >
                            Hapus
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-red-600 font-semibold">
                      <span>Stok Batch Sehat Kosong!</span>
                      {activeRole === "OWNER" && (
                        <button
                          type="button"
                          onClick={(e) => handleDeactivateSku(e, prod)}
                          className="text-red-500 hover:underline cursor-pointer"
                        >
                          Hapus SKU
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Antrean Batch FEFO Table */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Antrean Batch Freezer Berbasis FEFO (First Expired, First Out)
            </h2>
            <p className="text-[11px] text-slate-500">
              Diurutkan otomatis dari tanggal kedaluwarsa terdekat (`expiry_date
              ASC`) • {safeCount} Aman • {prioCount} Prioritas FEFO •{" "}
              {critCount} Kritis
            </p>
          </div>

          <div className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1 text-xs font-semibold gap-1">
            {(
              [
                ["ALL", "Semua Batch"],
                ["SAFE", "Aman (≥30 Hr)"],
                ["PRIORITY_FEFO", "Prioritas FEFO (<30 Hr)"],
                ["CRITICAL", "Kritis (≤18 Hr)"],
                ["EXPIRED", "Expired / Diblokir"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`px-2.5 py-1.5 rounded-lg transition cursor-pointer ${
                  statusFilter === key
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-bold text-slate-400 uppercase">
                <th className="py-3 px-3">Urutan FEFO</th>
                <th className="py-3 px-3">Kode Batch & SKU</th>
                <th className="py-3 px-3">Sisa Stok (Dus & Pack)</th>
                <th className="py-3 px-3">HPP / Pack</th>
                <th className="py-3 px-3">Tgl Kedaluwarsa</th>
                <th className="py-3 px-3">Status Kesehatan</th>
                <th className="py-3 px-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {batches.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-8 text-center text-slate-400 font-medium"
                  >
                    Tidak ada batch pada kategori filter ini.
                  </td>
                </tr>
              ) : (
                batches.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-3">
                      {b.fefoQueueRank === 1 ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-700 text-white font-bold text-[11px]">
                          ★ KELUARKAN #1
                        </span>
                      ) : b.fefoQueueRank ? (
                        <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold text-[11px]">
                          Antrean #{b.fefoQueueRank}
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded bg-red-100 text-red-700 font-bold text-[10px]">
                          DIBLOKIR POS
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900">
                        {b.batchNumber}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {b.productName} ({b.receivedVia})
                      </div>
                    </td>
                    <td className="py-3 px-3 font-bold text-slate-800">
                      {b.formattedQty}
                    </td>
                    <td className="py-3 px-3 text-slate-600">
                      {formatRp(b.unitCogsPack)}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-800">
                        {b.expiryDate}
                      </div>
                      <div
                        className={`text-[11px] font-bold ${
                          b.daysToExpiry <= 18
                            ? "text-red-600"
                            : b.daysToExpiry < 30
                              ? "text-amber-600"
                              : "text-emerald-700"
                        }`}
                      >
                        {b.daysToExpiry > 0
                          ? `Sisa ${b.daysToExpiry} Hari`
                          : `Lewat ${Math.abs(b.daysToExpiry)} Hari`}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          b.fefoStatus === "SAFE"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : b.fefoStatus === "PRIORITY_FEFO"
                              ? "bg-amber-50 text-amber-800 border border-amber-300"
                              : "bg-red-50 text-red-700 border border-red-200"
                        }`}
                      >
                        {b.fefoStatus}
                        {b.promoDiscountPct > 0
                          ? ` (-${b.promoDiscountPct}%)`
                          : ""}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right space-x-1.5">
                      {(b.fefoStatus === "PRIORITY_FEFO" ||
                        b.fefoStatus === "CRITICAL") && (
                        <button
                          onClick={() => onNavigateTab("promo")}
                          className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold cursor-pointer"
                        >
                          Broadcast Promo -20%
                        </button>
                      )}
                      <button
                        onClick={() => handleWriteOff(b)}
                        className="px-2.5 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-700 text-[11px] font-semibold cursor-pointer"
                      >
                        Write-Off
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Add Master SKU (FR-301) */}
      {showAddSkuModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateSku}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-bold text-slate-900">
                Tambah Master SKU Multi-Satuan (FR-301)
              </h3>
              <button
                type="button"
                onClick={() => setShowAddSkuModal(false)}
                className="text-slate-400 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Kode SKU *
                </label>
                <input
                  type="text"
                  required
                  placeholder="SKU-KEB-500"
                  value={skuCode}
                  onChange={(e) => setSkuCode(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Kategori
                </label>
                <input
                  type="text"
                  value={skuCategory}
                  onChange={(e) => setSkuCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Produk *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Kulit Kebab Beku 500g"
                  value={skuName}
                  onChange={(e) => setSkuName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Isi Pack per 1 Dus *
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  value={packsPerBox}
                  onChange={(e) => setPacksPerBox(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Batas Minimum ROP (Pack) *
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  value={ropPacks}
                  onChange={(e) => setRopPacks(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Harga Eceran / Pack (Rp) *
                </label>
                <input
                  type="number"
                  required
                  value={retailPrice}
                  onChange={(e) => setRetailPrice(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Harga Grosir / Dus (Rp) *
                </label>
                <input
                  type="number"
                  required
                  value={wholesalePrice}
                  onChange={(e) => setWholesalePrice(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddSkuModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-semibold cursor-pointer"
              >
                Simpan Master SKU
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Add Batch FEFO (FR-302) */}
      {showAddBatchModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateBatch}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-bold text-slate-900">
                Input Batch Baru ke Antrean FEFO (FR-302)
              </h3>
              <button
                type="button"
                onClick={() => setShowAddBatchModal(false)}
                className="text-slate-400 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Pilih Produk (SKU) *
                </label>
                <select
                  value={batchProdId}
                  onChange={(e) => setBatchProdId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (1 Dus = {p.packsPerBox} Pack)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nomor Kode Batch *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Mis: Batch FN-220"
                  value={batchNumber}
                  onChange={(e) => setBatchNumber(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Jumlah Dus Masuk *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={batchBoxes}
                    onChange={(e) => setBatchBoxes(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Tanggal Kedaluwarsa *
                  </label>
                  <input
                    type="date"
                    required
                    value={batchExpiry}
                    onChange={(e) => setBatchExpiry(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddBatchModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-semibold cursor-pointer"
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
