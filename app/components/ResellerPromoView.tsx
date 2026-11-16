"use client";

import React, { useCallback, useEffect, useState } from "react";
import { formatRp } from "./CommandCenterDashboard";

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
  const [loading, setLoading] = useState(true);
  const [broadcastingId, setBroadcastingId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showAddResellerModal, setShowAddResellerModal] = useState(false);

  // Add Reseller Form
  const [bizName, setBizName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phoneWa, setPhoneWa] = useState("");
  const [segment, setSegment] = useState("BURGER");

  const loadData = useCallback(async () => {
    try {
      setErrorMsg(null);
      const [campRes, resRes] = await Promise.all([
        fetch(
          `/api/v1/promos/fefo-drafts?storeId=${encodeURIComponent(
            activeStoreId,
          )}`,
        ),
        fetch(`/api/v1/resellers?storeId=${encodeURIComponent(activeStoreId)}`),
      ]);
      const campJson = await campRes.json();
      const resJson = await resRes.json();
      if (campJson.success) setCampaigns(campJson.data);
      if (resJson.success) setResellers(resJson.data);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Gagal memuat data promo reseller.",
      );
    } finally {
      setLoading(false);
    }
  }, [activeStoreId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleBroadcastOneClick = async (campaignId: string) => {
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
        },
      );
      const json = await res.json();
      if (!json.success) {
        setErrorMsg(json.error?.message || "Gagal menyiarkan broadcast.");
      } else {
        setFeedbackMsg(
          `Broadcast 1-Klik Berhasil! ${json.data.sentCount} pesan WhatsApp promo ${json.data.productName} (-${json.data.discountPct}%) telah dikirim secara bertahap (rate-limited) ke pedagang reseller dan harga diskon di Web POS telah aktif!`,
        );
        await loadData();
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menyiarkan broadcast.",
      );
    } finally {
      setBroadcastingId(null);
    }
  };

  const handleAddReseller = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
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
        `Mitra Reseller ${json.data.businessName} (${json.data.phoneWhatsapp}) berhasil didaftarkan!`,
      );
      await loadData();
    } else {
      setErrorMsg(json.error?.message || "Gagal menambah mitra reseller.");
    }
  };

  const handleToggleResellerSub = async (reseller: ResellerItem) => {
    setErrorMsg(null);
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
      await loadData();
    } else {
      setErrorMsg(json.error?.message || "Gagal mengubah status langganan.");
    }
  };

  const handleDeleteReseller = async (resellerId: string) => {
    setErrorMsg(null);
    const res = await fetch(
      `/api/v1/resellers/${resellerId}?storeId=${encodeURIComponent(
        activeStoreId,
      )}`,
      { method: "DELETE" },
    );
    const json = await res.json();
    if (json.success) {
      setFeedbackMsg("Mitra reseller berhasil dihapus dari direktori.");
      await loadData();
    } else {
      setErrorMsg(json.error?.message || "Gagal menghapus reseller.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase text-emerald-700">
            PRD-07 • FEFO Clearance & 1-Click Reseller WhatsApp Broadcast
          </span>
          <h1 className="text-xl font-bold text-slate-900">
            Broadcast Promosi Cepat Reseller Hilir (Proteksi Modal FEFO)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Menyiarkan promo diskon cepat ke pedagang kuliner mikro saat masa
            simpan batch tersisa &lt; 30 hari — menekan kerugian barang
            kedaluwarsa hingga 85%
          </p>
        </div>

        <button
          onClick={() => setShowAddResellerModal(true)}
          className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer shrink-0"
        >
          + Daftarkan Mitra Reseller Baru
        </button>
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

      {/* FEFO Promo Campaigns Grid */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            Draf & Kampanye Promosi Cepat Batch FEFO (&lt; 30 Hari Umur Simpan)
          </h2>
          <p className="text-[11px] text-slate-500">
            Disusun otomatis oleh Radar FEFO (`PRD-03`) ketika batch memasuki
            status Prioritas FEFO atau Kritis
          </p>
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-slate-400">
            Memuat draf promosi FEFO...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {campaigns.map((c) => (
              <div
                key={c.id}
                className="p-5 rounded-2xl border border-amber-200 bg-amber-50/20 flex flex-col justify-between gap-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-[11px] border border-amber-300">
                      Diskon Cepat -{c.discountPct}% • Sisa {c.daysToExpiry} Hr
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        c.status === "ACTIVE_SENT"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-200 text-slate-800"
                      }`}
                    >
                      {c.status === "ACTIVE_SENT"
                        ? `✓ Terkirim ke ${c.sentCount} Reseller`
                        : "Draf Siap Kirim"}
                    </span>
                  </div>

                  <h3 className="text-base font-extrabold text-slate-900">
                    {c.title}
                  </h3>
                  <div className="text-xs text-slate-600">
                    Produk: <strong>{c.productName}</strong> ({c.batchNumber} •
                    Exp {c.expiryDate} • Sisa {c.currentQtyPacks} Pack)
                  </div>

                  <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-white border border-slate-200 text-xs">
                    <div>
                      <div className="text-[10px] text-slate-400">
                        Harga Promo / Pack
                      </div>
                      <div className="font-extrabold text-emerald-700">
                        {formatRp(c.promoPricePerPackRp)}{" "}
                        <span className="line-through text-slate-400 font-normal text-[10px]">
                          {formatRp(c.normalPricePerPackRp)}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">
                        Modal Diselamatkan
                      </div>
                      <div className="font-extrabold text-slate-900">
                        {formatRp(c.projectedRecoveryRp)}
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-900 text-slate-200 text-[11px] font-mono">
                    &ldquo;{c.messageTemplate}&rdquo;
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-amber-200/60">
                  <button
                    type="button"
                    onClick={() => onNavigateTab("pos")}
                    className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 cursor-pointer"
                  >
                    Tebus di Kasir POS
                  </button>
                  <button
                    type="button"
                    disabled={broadcastingId === c.id}
                    onClick={() => handleBroadcastOneClick(c.id)}
                    className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-xs cursor-pointer"
                  >
                    {broadcastingId === c.id
                      ? "Mengirim Broadcast..."
                      : `📢 Kirim Broadcast 1-Klik ke ${resellers.length} Reseller WA`}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Downstream Reseller Directory Table (FR-701) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            Direktori Mitra Pedagang Kuliner Mikro / Reseller Hilir (
            {resellers.length} Mitra Terdaftar)
          </h2>
          <p className="text-[11px] text-slate-500">
            Mitra hilir penerima siaran diskon cepat FEFO dan pembeli grosir di
            kasir POS
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] text-slate-400 uppercase">
                <th className="py-2.5 px-3">Nama Usaha Kuliner</th>
                <th className="py-2.5 px-3">Kontak Pemilik</th>
                <th className="py-2.5 px-3">Nomor WhatsApp</th>
                <th className="py-2.5 px-3">Segmen Kuliner</th>
                <th className="py-2.5 px-3">Status Langganan Promo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {resellers.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-3 font-bold text-slate-900">
                    {r.businessName}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600">
                    {r.contactName}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-emerald-700 font-semibold">
                    {r.phoneWhatsapp}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold text-[10px]">
                      {r.culinarySegment}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleResellerSub(r)}
                      className={`font-bold text-[11px] cursor-pointer ${
                        r.isPromoSubscribed
                          ? "text-emerald-700"
                          : "text-slate-400"
                      }`}
                    >
                      {r.isPromoSubscribed
                        ? "✓ Aktif Broadcast WA"
                        : "Nonaktif (Opt-out)"}
                    </button>
                    {activeRole === "OWNER" && (
                      <button
                        type="button"
                        onClick={() => handleDeleteReseller(r.id)}
                        className="text-red-500 hover:underline text-[11px] font-semibold cursor-pointer"
                      >
                        Hapus
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Add Reseller */}
      {showAddResellerModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleAddReseller}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-bold text-slate-900">
                Daftarkan Mitra Reseller Kuliner (FR-701)
              </h3>
              <button
                type="button"
                onClick={() => setShowAddResellerModal(false)}
                className="text-slate-400 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Usaha Kuliner *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Burger & Kebab Darussalam"
                  value={bizName}
                  onChange={(e) => setBizName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Pemilik *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Bang Reza"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
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
                  placeholder="08526000xxxx"
                  value={phoneWa}
                  onChange={(e) => setPhoneWa(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Segmen Kuliner
                </label>
                <select
                  value={segment}
                  onChange={(e) => setSegment(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                >
                  <option value="BURGER">BURGER & KEBAB</option>
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
                className="px-4 py-2 rounded-xl bg-slate-100 font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-semibold cursor-pointer"
              >
                Simpan Reseller
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
