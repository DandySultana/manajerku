"use client";

import React, { useCallback, useEffect, useState } from "react";
import { formatRp } from "./CommandCenterDashboard";
import { useConfirmDialog } from "./ConfirmActionModal";
import { useGooeyToastFlash } from "./GooeyToastProvider";

interface PromoCampaignItem {
  id: string;
  batchId: string;
  batchNumber: string;
  productId: string;
  productName: string;
  skuCode: string;
  title: string;
  discountPct: number;
  normalPricePerPackRp: number;
  promoPricePerPackRp: number;
  normalPricePerBoxRp: number;
  promoPricePerBoxRp: number;
  unitCogsPackRp: number;
  isBelowCogsWarning: boolean;
  currentQtyPacks: number;
  expiryDate: string;
  daysToExpiry: number;
  capitalAtRiskRp: number;
  projectedRecoveryRp: number;
  targetResellerCount: number;
  sentCount: number;
  messageTemplate: string;
  status: string;
  broadcastedAt: string | null;
}

interface ResellerItem {
  id: string;
  businessName: string;
  contactName: string;
  phoneWhatsapp: string;
  culinarySegment: string;
  isPromoSubscribed: boolean;
}

export default function ResellerPromoView({
  activeStoreId,
  activeRole,
  onNavigateTab,
}: {
  activeStoreId: string;
  activeRole: "OWNER" | "CASHIER" | "ADMIN";
  onNavigateTab: (tab: string) => void;
}) {
  const [campaigns, setCampaigns] = useState<PromoCampaignItem[]>([]);
  const [resellers, setResellers] = useState<ResellerItem[]>([]);
  const [resellerSearch, setResellerSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [broadcastingId, setBroadcastingId] = useState<string | null>(null);
  const [submittingReseller, setSubmittingReseller] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const confirmDialog = useConfirmDialog();

  useGooeyToastFlash(
    feedbackMsg,
    errorMsg,
    () => setFeedbackMsg(null),
    () => setErrorMsg(null)
  );

  const [showAddResellerModal, setShowAddResellerModal] = useState(false);

  // Add Reseller Form
  const [bizName, setBizName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phoneWa, setPhoneWa] = useState("");
  const [segment, setSegment] = useState("BURGER");

  const fetchPromoData = useCallback(async () => {
    const [campRes, resRes] = await Promise.all([
      fetch(
        `/api/v1/promos/fefo-drafts?storeId=${encodeURIComponent(
          activeStoreId
        )}`
      ),
      fetch(`/api/v1/resellers?storeId=${encodeURIComponent(activeStoreId)}`),
    ]);
    return Promise.all([campRes.json(), resRes.json()]);
  }, [activeStoreId]);

  const loadData = useCallback(async () => {
    try {
      setErrorMsg(null);
      const [campJson, resJson] = await fetchPromoData();
      if (campJson.success) setCampaigns(campJson.data);
      if (resJson.success) setResellers(resJson.data);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Gagal memuat data promo reseller."
      );
    } finally {
      setLoading(false);
    }
  }, [fetchPromoData]);

  useEffect(() => {
    let cancelled = false;
    fetchPromoData()
      .then(([campJson, resJson]) => {
        if (cancelled) return;
        setErrorMsg(null);
        if (campJson.success) setCampaigns(campJson.data);
        if (resJson.success) setResellers(resJson.data);
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "Gagal memuat data promo reseller."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPromoData]);

  useEffect(() => {
    if (!showAddResellerModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowAddResellerModal(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAddResellerModal]);

  const handleBroadcastOneClick = async (campaignId: string) => {
    const camp = campaigns.find((c) => c.id === campaignId);
    const ok = await confirmDialog({
      title: "Konfirmasi Broadcast Promo & Aktifkan Diskon POS",
      description:
        "Pesan promo akan dikirimkan ke seluruh reseller aktif dan harga diskon FEFO akan langsung diterapkan di kasir POS.",
      detailText: camp
        ? `${camp.productName} (-${camp.discountPct}%) • ${resellers.length} Reseller WA`
        : undefined,
      confirmLabel: "Ya, Kirim Broadcast",
      cancelLabel: "Batal",
      variant: "primary",
    });
    if (!ok) return;
    setBroadcastingId(campaignId);
    setFeedbackMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/v1/promos/fefo-drafts/${campaignId}/broadcast`,
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
      if (!json.success) {
        setErrorMsg(json.error?.message || "Gagal menyiarkan broadcast.");
      } else {
        setFeedbackMsg(
          `Broadcast 1-Klik Berhasil! ${json.data.sentCount} pesan WhatsApp promo ${json.data.productName} (-${json.data.discountPct}%) telah dikirim secara bertahap dan harga diskon di Web POS telah aktif.`
        );
        await loadData();
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menyiarkan broadcast."
      );
    } finally {
      setBroadcastingId(null);
    }
  };

  const handleAddReseller = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await confirmDialog({
      title: "Simpan Mitra Reseller Baru?",
      description:
        "Data mitra reseller akan ditambahkan ke direktori penerima broadcast promo FEFO dan pelanggan grosir.",
      detailText: `${bizName} (${phoneWa}) • Segmen: ${segment}`,
      confirmLabel: "Ya, Simpan Reseller",
      cancelLabel: "Batal",
      variant: "primary",
    });
    if (!ok) return;
    setErrorMsg(null);
    setSubmittingReseller(true);
    try {
      const res = await fetch("/api/v1/resellers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: activeStoreId,
          businessName: bizName,
          contactName,
          phoneWhatsapp: phoneWa,
          culinarySegment: segment,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowAddResellerModal(false);
        setBizName("");
        setContactName("");
        setPhoneWa("");
        setFeedbackMsg(
          `Mitra Reseller ${json.data.businessName} (${json.data.phoneWhatsapp}) berhasil didaftarkan.`
        );
        await loadData();
      } else {
        setErrorMsg(json.error?.message || "Gagal menambah mitra reseller.");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menambah mitra reseller."
      );
    } finally {
      setSubmittingReseller(false);
    }
  };

  const handleToggleResellerSub = async (reseller: ResellerItem) => {
    const ok = await confirmDialog({
      title: "Ubah Status Langganan Broadcast Reseller?",
      description: reseller.isPromoSubscribed
        ? "Mitra reseller ini akan dinonaktifkan sementara (opt-out) dari daftar penerima siaran promo WhatsApp."
        : "Mitra reseller ini akan diaktifkan kembali untuk menerima siaran promo FEFO via WhatsApp.",
      detailText: `${reseller.businessName} (${reseller.phoneWhatsapp})`,
      confirmLabel: "Ya, Ubah Status",
      cancelLabel: "Batal",
      variant: "warning",
    });
    if (!ok) return;
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/v1/resellers/${reseller.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: activeStoreId,
          isPromoSubscribed: !reseller.isPromoSubscribed,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setFeedbackMsg(
          `${reseller.businessName} kini ${
            !reseller.isPromoSubscribed
              ? "aktif menerima broadcast promo"
              : "berhenti menerima broadcast (opt-out)"
          }.`
        );
        await loadData();
      } else {
        setErrorMsg(
          json.error?.message || "Gagal mengubah status langganan."
        );
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Gagal mengubah status langganan."
      );
    }
  };

  const handleDeleteReseller = async (reseller: ResellerItem) => {
    const ok = await confirmDialog({
      title: "Hapus Mitra Reseller dari Direktori?",
      description:
        "Data mitra reseller ini akan dihapus secara permanen dari daftar penerima broadcast promo dan pelanggan grosir.",
      detailText: `${reseller.businessName} (${reseller.phoneWhatsapp})`,
      confirmLabel: "Ya, Hapus Reseller",
      cancelLabel: "Batal",
      variant: "danger",
    });
    if (!ok) return;
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/v1/resellers/${reseller.id}?storeId=${encodeURIComponent(
          activeStoreId
        )}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (json.success) {
        setFeedbackMsg(
          `Mitra reseller ${reseller.businessName} dihapus dari direktori.`
        );
        await loadData();
      } else {
        setErrorMsg(json.error?.message || "Gagal menghapus reseller.");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menghapus reseller."
      );
    }
  };

  const activeSubscribersCount = resellers.filter(
    (r) => r.isPromoSubscribed
  ).length;

  const filteredResellers = resellers.filter((r) => {
    const q = resellerSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      r.businessName.toLowerCase().includes(q) ||
      r.contactName.toLowerCase().includes(q) ||
      r.phoneWhatsapp.toLowerCase().includes(q) ||
      r.culinarySegment.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Page Header directly on canvas */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-[22px] sm:text-[24px] font-bold text-[#0F172A] tracking-tight leading-snug">
            Broadcast Promosi Cepat Reseller Hilir
          </h1>
          <p className="text-[13px] text-[#475569] mt-0.5">
            Siarkan diskon clearance ke mitra kuliner saat sisa umur simpan batch
            kurang dari 30 hari.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddResellerModal(true)}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] active:bg-[#083D32] text-white text-xs font-semibold transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
        >
          + Daftarkan Mitra Reseller Baru
        </button>
      </div>

      {/* Section 1: FEFO Promo Campaigns */}
      <section
        aria-labelledby="promo-campaigns-heading"
        className="space-y-3.5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2
              id="promo-campaigns-heading"
              className="text-sm font-bold text-[#0F172A]"
            >
              Draf &amp; Kampanye Promosi Batch FEFO
            </h2>
            <p className="text-xs text-[#475569] mt-0.5">
              Otomatis disusun dari antrean batch dengan umur simpan di bawah 30
              hari.
            </p>
          </div>
          <span className="text-xs font-medium text-[#475569] tabular-nums">
            {campaigns.length} kampanye | {activeSubscribersCount} penerima aktif
          </span>
        </div>

        {loading ? (
          <div
            className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-pulse"
            role="status"
            aria-busy="true"
            aria-label="Memuat kampanye promo FEFO..."
          >
            {[1, 2].map((n) => (
              <div
                key={n}
                className="rounded-2xl bg-white border border-[#E5E9EC] p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-24 rounded-md bg-[#E2E8F0]" />
                      <div className="h-5 w-28 rounded-md bg-[#F1F5F9]" />
                    </div>
                    <div className="h-5 w-3/4 rounded bg-[#CBD5E1]" />
                    <div className="h-3.5 w-1/2 rounded bg-[#F1F5F9]" />
                  </div>
                  <div className="h-12 w-28 rounded-xl bg-[#F8FAFC] border border-[#E5E9EC]" />
                </div>
                <div className="grid grid-cols-3 gap-3 py-3 px-3.5 rounded-xl bg-[#F8FAFC] border border-[#E5E9EC]">
                  <div className="space-y-1.5">
                    <div className="h-3 w-16 rounded bg-[#E2E8F0]" />
                    <div className="h-4 w-20 rounded bg-[#CBD5E1]" />
                  </div>
                  <div className="space-y-1.5">
                    <div className="h-3 w-20 rounded bg-[#E2E8F0]" />
                    <div className="h-4 w-24 rounded bg-[#CBD5E1]" />
                  </div>
                  <div className="space-y-1.5">
                    <div className="h-3 w-24 rounded bg-[#E2E8F0]" />
                    <div className="h-4 w-24 rounded bg-[#CBD5E1]" />
                  </div>
                </div>
                <div className="h-16 rounded-xl bg-[#F8FAFC] border border-[#E5E9EC]" />
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="h-10 w-36 rounded-xl bg-[#F1F5F9]" />
                  <div className="h-10 w-52 rounded-xl bg-[#D7F0E6]/80" />
                </div>
              </div>
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="bg-white py-10 px-5 text-center rounded-2xl border border-dashed border-[#CBD5E1] space-y-2.5">
            <div className="text-sm font-semibold text-[#0F172A]">
              Belum ada draf promosi FEFO aktif
            </div>
            <p className="text-xs text-[#475569] max-w-md mx-auto leading-relaxed">
              Draf promo akan muncul di sini apabila terdapat batch inventaris
              dengan sisa masa simpan di bawah 30 hari.
            </p>
            <div className="pt-1">
              <button
                type="button"
                onClick={() => onNavigateTab("inventory")}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
              >
                Periksa Stok &amp; Batch FEFO
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {campaigns.map((c) => {
              const isSent = c.status === "ACTIVE_SENT";
              return (
                <article
                  key={c.id}
                  className="bg-white rounded-2xl border border-[#E5E9EC] p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-3.5">
                    {/* Status Row */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-[#FEF3C7] text-[#92400E] text-xs font-semibold tabular-nums">
                        Diskon -{c.discountPct}% | Sisa {c.daysToExpiry} Hari
                      </span>
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold ${
                          isSent
                            ? "bg-[#EBF8F2] text-[#0F6352]"
                            : "bg-[#F1F5F9] text-[#334155]"
                        }`}
                      >
                        {isSent
                          ? `Terkirim ke ${c.sentCount} Reseller`
                          : "Draf Siap Kirim"}
                      </span>
                    </div>

                    {/* Title & Batch Detail */}
                    <div className="space-y-1">
                      <h3 className="text-base font-bold text-[#0F172A] leading-snug">
                        {c.title}
                      </h3>
                      <p className="text-xs text-[#475569]">
                        <span className="font-semibold text-[#0F172A]">
                          {c.productName}
                        </span>{" "}
                        <span className="font-mono text-[#475569]">
                          ({c.batchNumber} | Exp {c.expiryDate} | Sisa{" "}
                          {c.currentQtyPacks} Pack)
                        </span>
                      </p>
                    </div>

                    {/* Price & Capital Metrics */}
                    <div className="grid grid-cols-2 gap-3 py-3 border-y border-[#F1F5F9]">
                      <div>
                        <div className="text-[11px] font-medium text-[#475569]">
                          Harga Promo / Pack
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
                          <span className="text-sm font-bold text-[#0F6352] font-mono tabular-nums">
                            {formatRp(c.promoPricePerPackRp)}
                          </span>
                          <span className="text-xs text-[#64748B] line-through font-mono tabular-nums">
                            {formatRp(c.normalPricePerPackRp)}
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-medium text-[#475569]">
                          Potensi Modal Diselamatkan
                        </div>
                        <div className="text-sm font-bold text-[#0F172A] font-mono tabular-nums mt-0.5">
                          {formatRp(c.projectedRecoveryRp)}
                        </div>
                      </div>
                    </div>

                    {/* Clean readable message preview (no dark terminal box) */}
                    <div className="rounded-xl bg-[#F8FAFC] border border-[#E5E9EC] px-3.5 py-2.5 space-y-1">
                      <div className="text-[11px] font-medium text-[#475569]">
                        Pratinjau Pesan WhatsApp
                      </div>
                      <p className="text-xs text-[#1E293B] leading-relaxed">
                        &ldquo;{c.messageTemplate}&rdquo;
                      </p>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onNavigateTab("pos")}
                      className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] text-xs font-semibold text-[#334155] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
                    >
                      Tebus di Kasir POS
                    </button>
                    <button
                      type="button"
                      disabled={broadcastingId === c.id || resellers.length === 0}
                      onClick={() => handleBroadcastOneClick(c.id)}
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] active:bg-[#083D32] disabled:bg-[#94A3B8] text-white text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
                    >
                      {broadcastingId === c.id
                        ? "Mengirim Broadcast..."
                        : `Kirim Broadcast 1-Klik ke ${resellers.length} Reseller WA`}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 2: Downstream Reseller Directory (Clean Vertical Rows, Zero Horizontal Overflow) */}
      <section
        aria-labelledby="reseller-directory-heading"
        className="bg-white rounded-2xl border border-[#E5E9EC] overflow-hidden"
      >
        <div className="p-5 border-b border-[#E5E9EC] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2
              id="reseller-directory-heading"
              className="text-sm font-bold text-[#0F172A]"
            >
              Direktori Mitra Reseller Hilir ({resellers.length} Terdaftar)
            </h2>
            <p className="text-xs text-[#475569] mt-0.5">
              Kelola daftar pedagang kuliner penerima siaran promo FEFO dan
              pelanggan grosir POS.
            </p>
          </div>

          <div className="w-full sm:w-64">
            <label htmlFor="reseller-search-input" className="sr-only">
              Cari nama usaha, kontak, atau nomor WhatsApp reseller
            </label>
            <input
              id="reseller-search-input"
              type="search"
              value={resellerSearch}
              onChange={(e) => setResellerSearch(e.target.value)}
              placeholder="Cari reseller atau nomor WA..."
              className="w-full min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] focus:bg-white text-xs text-[#0F172A] placeholder:text-[#64748B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
            />
          </div>
        </div>

        {loading ? (
          <div
            className="divide-y divide-[#F1F5F9] animate-pulse"
            role="status"
            aria-busy="true"
            aria-label="Memuat direktori mitra reseller..."
          >
            {[1, 2, 3, 4].map((row) => (
              <div
                key={row}
                className="p-4 sm:px-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
              >
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-44 rounded bg-[#CBD5E1]" />
                    <div className="h-5 w-24 rounded-md bg-[#E2E8F0]" />
                    <div className="h-5 w-24 rounded-md bg-[#F1F5F9]" />
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="h-3 w-32 rounded bg-[#E2E8F0]" />
                    <div className="h-3 w-28 rounded bg-[#F1F5F9]" />
                    <div className="h-3 w-40 rounded bg-[#F1F5F9] hidden sm:block" />
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="h-9 w-36 rounded-xl bg-[#F1F5F9]" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredResellers.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-xs font-semibold text-[#0F172A]">
              {resellers.length === 0
                ? "Belum ada mitra reseller terdaftar"
                : "Tidak ada reseller yang cocok dengan pencarian"}
            </p>
            {resellerSearch && (
              <button
                type="button"
                onClick={() => setResellerSearch("")}
                className="min-h-[40px] px-3 py-1.5 rounded-lg border border-[#CBD5E1] text-xs font-semibold text-[#0F6352]"
              >
                Reset Pencarian
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[#E5E9EC]">
            {filteredResellers.map((r) => (
              <li
                key={r.id}
                className="px-5 py-3.5 hover:bg-[#F8FAFC] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[#0F172A]">
                      {r.businessName}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#F1F5F9] text-[#334155] text-[11px] font-medium">
                      {r.culinarySegment}
                    </span>
                  </div>
                  <div className="text-xs text-[#475569] flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span>Kontak: {r.contactName}</span>
                    <span className="font-mono font-medium text-[#0F6352]">
                      {r.phoneWhatsapp}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleResellerSub(r)}
                    aria-pressed={r.isPromoSubscribed}
                    className={`min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352] ${
                      r.isPromoSubscribed
                        ? "bg-[#EBF8F2] border-[#CCE8DB] text-[#0F6352] hover:bg-[#D7F0E6]"
                        : "bg-[#F8FAFC] border-[#CBD5E1] text-[#475569] hover:bg-[#F1F5F9]"
                    }`}
                  >
                    {r.isPromoSubscribed
                      ? "Aktif Broadcast WA"
                      : "Nonaktif (Opt-out)"}
                  </button>

                  {activeRole === "OWNER" && (
                    <button
                      type="button"
                      onClick={() => handleDeleteReseller(r)}
                      aria-label={`Hapus ${r.businessName}`}
                      className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-lg border border-transparent hover:border-[#FECACA] hover:bg-[#FEF2F2] text-[#B91C1C] text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B91C1C]"
                    >
                      Hapus
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Modal Add Reseller */}
      {showAddResellerModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-reseller-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleAddReseller}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#E2E8F0] space-y-4"
          >
            <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
              <h3
                id="add-reseller-modal-title"
                className="text-base font-bold text-[#0F172A]"
              >
                Daftarkan Mitra Reseller Kuliner
              </h3>
              <button
                type="button"
                aria-label="Tutup modal pendaftaran reseller"
                onClick={() => setShowAddResellerModal(false)}
                className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] rounded-lg text-[#475569] hover:bg-[#F1F5F9] font-bold flex items-center justify-center focus-visible:outline-2 focus-visible:outline-[#0F6352]"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label
                  htmlFor="reseller-biz-name"
                  className="block font-semibold text-[#1E293B]"
                >
                  Nama Usaha Kuliner
                </label>
                <input
                  id="reseller-biz-name"
                  type="text"
                  required
                  placeholder="Burger & Kebab Darussalam"
                  value={bizName}
                  onChange={(e) => setBizName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#CBD5E1] text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="reseller-contact-name"
                  className="block font-semibold text-[#1E293B]"
                >
                  Nama Pemilik
                </label>
                <input
                  id="reseller-contact-name"
                  type="text"
                  required
                  placeholder="Bang Reza"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#CBD5E1] text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="reseller-phone-wa"
                  className="block font-semibold text-[#1E293B]"
                >
                  Nomor WhatsApp Aktif
                </label>
                <input
                  id="reseller-phone-wa"
                  type="tel"
                  required
                  placeholder="08526000xxxx"
                  value={phoneWa}
                  onChange={(e) => setPhoneWa(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#CBD5E1] font-mono text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="reseller-segment"
                  className="block font-semibold text-[#1E293B]"
                >
                  Segmen Kuliner
                </label>
                <select
                  id="reseller-segment"
                  value={segment}
                  onChange={(e) => setSegment(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#CBD5E1] bg-white text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
                >
                  <option value="BURGER">BURGER &amp; KEBAB</option>
                  <option value="SOSIS_BAKAR">SOSIS BAKAR</option>
                  <option value="DIMSUM">DIMSUM</option>
                  <option value="CATERING">KATERING</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddResellerModal(false)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] text-xs font-semibold text-[#334155] focus-visible:outline-2 focus-visible:outline-[#0F6352]"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submittingReseller}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] disabled:bg-[#94A3B8] text-white text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
              >
                {submittingReseller ? "Menyimpan..." : "Simpan Reseller"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
