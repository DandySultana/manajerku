"use client";

import React, { useState, useEffect, useCallback } from "react";
import { formatRp } from "./CommandCenterDashboard";

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
  defaultReorderBoxes: number;
  isBelowRop: boolean;
}

interface DiscoveryResultData {
  productName: string;
  requestedQtyBoxes: number;
  cacheHit: boolean;
  apiCallsMade: number;
  top3Candidates: Array<{
    id: string;
    name: string;
    phoneWhatsapp: string;
    distanceKm: number;
    googleRating: number;
    isVerifiedB2BPartner: boolean;
    cachedPricePerBoxRp: number | null;
  }>;
  createdRfqSession: {
    rfqSessionId: string;
    rfqCode: string;
    status: string;
  } | null;
}

export default function SupplierDiscoveryView({
  activeStoreId,
  activeRole,
  onNavigateTab,
}: {
  activeStoreId: string;
  activeRole: "OWNER" | "CASHIER" | "ADMIN";
  onNavigateTab: (tab: string) => void;
}) {
  const [suppliers, setSuppliers] = useState<SupplierDirItem[]>([]);
  const [products, setProducts] = useState<ProductSimple[]>([]);
  const [selectedProdId, setSelectedProdId] = useState<string>("");
  const [qtyBoxes, setQtyBoxes] = useState<string>("5");
  const [commissionSummary, setCommissionSummary] = useState<{
    totalVerifiedPoCount: number;
    totalB2BCommissionEarnedRp: number;
  }>({ totalVerifiedPoCount: 0, totalB2BCommissionEarnedRp: 0 });
  const [discoveryRes, setDiscoveryRes] = useState<DiscoveryResultData | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Add Supplier Form
  const [suppName, setSuppName] = useState("");
  const [suppPhone, setSuppPhone] = useState("");
  const [suppAddr, setSuppAddr] = useState("Banda Aceh");
  const [suppRating, setSuppRating] = useState("4.8");
  const [suppIsB2B, setSuppIsB2B] = useState(true);
  const [suppCommRate, setSuppCommRate] = useState("1.25");

  const loadDirectory = useCallback(async () => {
    try {
      setErrorMsg(null);
      const [suppRes, prodRes] = await Promise.all([
        fetch(
          `/api/v1/suppliers?storeId=${encodeURIComponent(activeStoreId)}`
        ),
        fetch(
          `/api/v1/inventory/products?storeId=${encodeURIComponent(
            activeStoreId
          )}`
        ),
      ]);
      const suppJson = await suppRes.json();
      const prodJson = await prodRes.json();

      if (suppJson.success) {
        setSuppliers(suppJson.data.suppliers);
        setCommissionSummary(suppJson.data.b2bCommissionSummary);
      }
      if (prodJson.success) {
        setProducts(prodJson.data);
        if (!selectedProdId && prodJson.data.length > 0) {
          setSelectedProdId(prodJson.data[0].id);
        }
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal memuat direktori pemasok."
      );
    } finally {
      setLoading(false);
    }
  }, [activeStoreId, selectedProdId]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  const handleRunDiscovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProdId) return;
    setDiscovering(true);
    setErrorMsg(null);
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
        setDiscoveryRes(json.data);
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
      setShowAddModal(false);
      setSuppName("");
      setSuppPhone("");
      await loadDirectory();
    } else {
      setErrorMsg(json.error?.message || "Gagal mendaftarkan distributor.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase text-emerald-700">
            PRD-04 • Hybrid Supplier Discovery (Google Places Official API +
            Shared Cache)
          </span>
          <h1 className="text-xl font-bold text-slate-900">
            Pencarian Pemasok Resmi & Direktori B2B Terverifikasi
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Filter otomatis: Radius ≤ 10 km dari lokasi toko, Rating Google
            Places ≥ 4,5, dan Nomor WhatsApp Aktif • Hemat kuota via Shared
            Cache
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer shrink-0"
        >
          + Tambah Mitra B2B Verified Supplier
        </button>
      </div>

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

      {/* Discovery Search Engine & B2B Commission Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form
          onSubmit={handleRunDiscovery}
          className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Mesin Hybrid Supplier Discovery (FR-401 & FR-402)
              </h2>
              <p className="text-[11px] text-slate-500">
                Memangkas waktu riset pemasok baru sebesar 90% (dari 3–5 jam
                menjadi &lt; 10 menit)
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 font-bold text-[11px] border border-emerald-200">
              Filter: ≤ 10 km • ★ ≥ 4.5 • WA Aktif
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">
                Pilih SKU Produk yang Akan Dicari Pemasoknya
              </label>
              <select
                value={selectedProdId}
                onChange={(e) => setSelectedProdId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white font-semibold"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.skuCode}){" "}
                    {p.isBelowRop ? "— ⚠️ STOK KRITIS ≤ ROP" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Rencana Pesan (Dus)
              </label>
              <input
                type="number"
                min={1}
                value={qtyBoxes}
                onChange={(e) => setQtyBoxes(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 font-bold"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={discovering}
            className="w-full py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-xs transition cursor-pointer"
          >
            {discovering
              ? "Menelusuri Shared Cache & Google Places API..."
              : "🔍 Jalankan Hybrid Supplier Discovery & Siapkan Top 3 Kandidat RFQ"}
          </button>

          {discoveryRes && (
            <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-bold text-emerald-950">
                  ✓ Discovery Selesai untuk {discoveryRes.requestedQtyBoxes} Dus{" "}
                  {discoveryRes.productName}!
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-700 text-white text-[10px] font-bold">
                  {discoveryRes.cacheHit
                    ? "⚡ SHARED CACHE HIT (0 API Token Digunakan)"
                    : "🌐 GOOGLE PLACES API SYNC"}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {discoveryRes.top3Candidates.map((c, idx) => (
                  <div
                    key={c.id}
                    className="p-2.5 rounded-lg bg-white border border-emerald-200"
                  >
                    <div className="font-bold text-slate-900">
                      #{idx + 1} {c.name}
                    </div>
                    <div className="text-[11px] text-slate-600">
                      ★ {c.googleRating} • {c.distanceKm} km
                    </div>
                    <div className="text-[11px] font-mono text-emerald-700 font-semibold">
                      {c.phoneWhatsapp}
                    </div>
                  </div>
                ))}
              </div>

              {discoveryRes.createdRfqSession && (
                <div className="flex items-center justify-between pt-2 border-t border-emerald-200/70">
                  <span className="text-[11px] text-emerald-900 font-medium">
                    Draf Sesi <strong>{discoveryRes.createdRfqSession.rfqCode}</strong>{" "}
                    telah siap untuk Izin 1-Klik Owner (Human-in-the-Loop).
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigateTab("whatsapp")}
                    className="px-3 py-1.5 rounded-lg bg-emerald-800 text-white font-bold text-[11px] cursor-pointer"
                  >
                    Lanjut ke Auto-RFQ WhatsApp →
                  </button>
                </div>
              )}
            </div>
          )}
        </form>

        {/* Right 4 Cols: B2B Verified Supplier Monetization Card (FR-404) */}
        <div className="lg:col-span-4 bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div className="space-y-2">
            <span className="text-[10px] font-bold uppercase text-emerald-400">
              Revenue Stream #3 (BMC Hal. 5 • FR-404)
            </span>
            <h3 className="text-base font-bold">
              Kemitraan B2B Verified Supplier
            </h3>
            <p className="text-xs text-slate-300">
              Distributor grosir mitra memperoleh pesanan Purchase Order (PO)
              yang terverifikasi kasnya tanpa biaya sales lapangan, dengan bagi
              hasil komisi <strong>1,0% – 1,5% per PO</strong>.
            </p>
          </div>

          <div className="my-4 p-4 rounded-xl bg-slate-800/90 border border-slate-700 space-y-2">
            <div className="text-[11px] text-slate-400">
              Akumulasi Komisi B2B Platform
            </div>
            <div className="text-2xl font-extrabold text-emerald-400">
              {formatRp(commissionSummary.totalB2BCommissionEarnedRp)}
            </div>
            <div className="text-[11px] text-slate-300">
              Dari {commissionSummary.totalVerifiedPoCount} Purchase Order
              Terbit
            </div>
          </div>

          <div className="text-[11px] text-slate-400">
            ✓ Prioritas urutan #1 pada rekomendasi AI Auto-RFQ
          </div>
        </div>
      </div>

      {/* Directory Grid */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            Direktori Distributor & Shared Cache Lokal ({suppliers.length}{" "}
            Distributor Terverifikasi)
          </h2>
          <p className="text-[11px] text-slate-500">
            Seluruh nomor telah terverifikasi memiliki WhatsApp aktif dan Rating
            Google Places ≥ 4,5
          </p>
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-slate-400">
            Memuat direktori distributor...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {suppliers.map((s) => (
              <div
                key={s.id}
                className="p-4 rounded-2xl border border-slate-200 flex flex-col justify-between gap-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-bold">
                      ★ {s.googleRating} ({s.userRatingsTotal} ulasan)
                    </span>
                    {s.isVerifiedB2BPartner && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                        ✓ B2B Verified ({s.commissionRatePct}%)
                      </span>
                    )}
                  </div>

                  <h3 className="text-sm font-bold text-slate-900">{s.name}</h3>
                  <p className="text-[11px] text-slate-500">{s.address}</p>
                  <div className="text-xs font-semibold text-slate-700 flex items-center justify-between pt-1">
                    <span>📍 Jarak: {s.distanceKm} km</span>
                    <span className="font-mono text-emerald-700">
                      {s.phoneWhatsapp}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-600">
                  {s.cachedCatalog["SKU-NUG-500"] ? (
                    <div>
                      Cache Harga Nugget:{" "}
                      <strong>
                        {formatRp(
                          s.cachedCatalog["SKU-NUG-500"].price_per_box
                        )}
                        /dus
                      </strong>{" "}
                      (MOQ {s.cachedCatalog["SKU-NUG-500"].moq_boxes} dus)
                    </div>
                  ) : (
                    <div>Siap dihubungi via Auto-RFQ WhatsApp</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Register Verified Supplier */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleAddSupplier}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-bold text-slate-900">
                Tambah Distributor ke Shared Cache (FR-404)
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Perusahaan Distributor *
                </label>
                <input
                  type="text"
                  required
                  placeholder="PT Samudera Beku Nusantara"
                  value={suppName}
                  onChange={(e) => setSuppName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nomor WhatsApp Aktif *
                </label>
                <input
                  type="text"
                  required
                  placeholder="08116800xxx"
                  value={suppPhone}
                  onChange={(e) => setSuppPhone(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Alamat Lengkap *
                </label>
                <input
                  type="text"
                  required
                  value={suppAddr}
                  onChange={(e) => setSuppAddr(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Rating Google (≥ 4.5) *
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min={4.5}
                    max={5.0}
                    required
                    value={suppRating}
                    onChange={(e) => setSuppRating(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Komisi B2B (% per PO)
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min={1.0}
                    max={1.5}
                    value={suppCommRate}
                    onChange={(e) => setSuppCommRate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={suppIsB2B}
                  onChange={(e) => setSuppIsB2B(e.target.checked)}
                />
                Tandai sebagai Mitra B2B Verified Supplier (Komisi 1%–1,5%)
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-semibold cursor-pointer"
              >
                Simpan Distributor
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

