"use client";

import React, { useState, useEffect, useCallback } from "react";
import { formatRp } from "./CommandCenterDashboard";

interface FinanceSummaryData {
  store: {
    id: string;
    name: string;
    branchName: string;
    address: string;
    coldChainCode: string;
    dailyFreezerElecCostRp: number;
    subscriptionTier: "FREEMIUM_STARTER" | "MANAJERKU_PRO";
  };
  balances: {
    availableKulakanCashRp: number;
    lockedPoCashRp: number;
    netProfitBalanceRp: number;
    coverageRatio: number;
    coverageStatusLabel: string;
  };
  profitAndLoss: {
    weekly: {
      revenueRp: number;
      cogsRp: number;
      grossProfitRp: number;
      freezerElectricityExpenseRp: number;
      expiredWriteOffLossRp: number;
      netOperatingIncomeRp: number;
      invoiceCount: number;
    };
    monthlyProjected: {
      revenueRp: number;
      cogsRp: number;
      grossProfitRp: number;
      freezerElectricityExpenseRp: number;
      expiredWriteOffLossRp: number;
      netOperatingIncomeRp: number;
      netMarginPct: number;
    };
  };
  kurReadiness: {
    eligibilityScore: number;
    eligibilityStatus: string;
    targetPartnerBanks: string[];
    maxMonthlyInstallmentCapacityRp: number;
    recommendedWorkingCapitalPlafonRp: number;
    verifiedPoCount: number;
  };
  verifiedPurchaseOrders: Array<{
    poNumber: string;
    supplierName: string;
    productName: string;
    orderQtyBoxes: number;
    agreedPricePerBoxRp: number;
    totalAmountRp: number;
    status: string;
    approvedAt: string;
  }>;
  ledgerEntries: Array<{
    id: string;
    entryType: string;
    referenceType: string;
    referenceId: string | null;
    amountRp: number;
    cogsComponentRp: number;
    profitComponentRp: number;
    availableKulakanCashAfterRp: number;
    lockedPoCashAfterRp: number;
    netProfitBalanceAfterRp: number;
    notes: string | null;
    createdAt: string;
  }>;
}

interface ExportKurDoc {
  documentNumber: string;
  generatedAtIso: string;
  periodMonths: number;
  integrityHash: string;
  bankStandardLabel: string;
  report: FinanceSummaryData;
}

export default function FinanceKurView({
  activeStoreId,
  activeRole,
}: {
  activeStoreId: string;
  activeRole: "OWNER" | "CASHIER" | "ADMIN";
}) {
  const [data, setData] = useState<FinanceSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Capital adjustment form
  const [adjType, setAdjType] = useState<
    "PROFIT_REINVESTMENT" | "OWNER_DRAWING" | "INITIAL_CAPITAL"
  >("PROFIT_REINVESTMENT");
  const [adjAmount, setAdjAmount] = useState("500000");
  const [adjNotes, setAdjNotes] = useState("");

  // Freezer electricity form
  const [elecCostInput, setElecCostInput] = useState("45000");

  // KUR PDF Modal
  const [kurDocModal, setKurDocModal] = useState<ExportKurDoc | null>(null);

  const loadFinanceData = useCallback(async () => {
    try {
      setErrorMsg(null);
      const res = await fetch(
        `/api/v1/finance/ledger-summary?storeId=${encodeURIComponent(
          activeStoreId
        )}&role=${activeRole}`
      );
      const json = await res.json();
      if (!json.success) {
        setErrorMsg(json.error?.message || "Akses ditolak.");
        setData(null);
      } else {
        setData(json.data);
        setElecCostInput(String(json.data.store.dailyFreezerElecCostRp));
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal memuat buku kas."
      );
    } finally {
      setLoading(false);
    }
  }, [activeStoreId, activeRole]);

  useEffect(() => {
    loadFinanceData();
  }, [loadFinanceData]);

  const handleCapitalAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFeedbackMsg(null);
    const res = await fetch("/api/v1/finance/capital-adjustment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        actorRole: activeRole,
        adjustmentType: adjType,
        amountRp: Number(adjAmount),
        notes: adjNotes || undefined,
      }),
    });
    const json = await res.json();
    if (json.success) {
      setFeedbackMsg(
        `Mutasi ${adjType} sebesar ${formatRp(
          json.data.amountRp
        )} berhasil dicatat secara atomik! Saldo Kas Kulakan kini ${formatRp(
          json.data.availableKulakanCashAfterRp
        )}.`
      );
      setAdjNotes("");
      await loadFinanceData();
    } else {
      setErrorMsg(json.error?.message || "Gagal mencatat mutasi kas.");
    }
  };

  const handleUpdateFreezerElec = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFeedbackMsg(null);
    const res = await fetch("/api/v1/finance/freezer-electricity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        actorRole: activeRole,
        dateIso: new Date().toISOString().slice(0, 10),
        overrideDailyCostRp: Number(elecCostInput),
      }),
    });
    const json = await res.json();
    if (json.success) {
      setFeedbackMsg(
        `Tarif & Alokasi Beban Listrik Penyimpanan Dingin 24 Jam (${formatRp(
          json.data.elecCostRp
        )}/hari) tersimpan (${json.data.referenceCode}).`
      );
      await loadFinanceData();
    } else {
      setErrorMsg(json.error?.message || "Gagal memperbarui beban listrik.");
    }
  };

  const handleExportKurPdf = async () => {
    setErrorMsg(null);
    setFeedbackMsg(null);
    const res = await fetch("/api/v1/finance/export-kur-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        actorRole: activeRole,
        periodMonths: 3,
      }),
    });
    const json = await res.json();
    if (json.success) {
      setKurDocModal(json.data);
    } else {
      setErrorMsg(json.error?.message || "Gagal mengekspor PDF KUR.");
    }
  };

  if (loading) {
    return (
      <div className="p-8 bg-white rounded-2xl text-center text-xs text-slate-400">
        Memuat Buku Kas & Laporan Laba-Rugi KUR...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-amber-50 border border-amber-300 rounded-2xl p-6 text-xs text-amber-900 space-y-2">
        <div className="font-bold text-sm">
          🔒 Akses Buku Kas & Laporan KUR Dibatasi (RBAC FR-102 & FR-805)
        </div>
        <p>{errorMsg}</p>
        <p className="text-[11px] text-amber-700">
          Gunakan pengalih peran di sidebar kiri ke{" "}
          <strong>Pemilik (Owner)</strong> untuk melihat Buku Kas Terpisah dan
          mengekspor dokumen pengajuan KUR Bank Aceh Syariah.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase text-emerald-700">
            PRD-08 • Separated Cash Ledger, Freezer Electricity & KUR Readiness
          </span>
          <h1 className="text-xl font-bold text-slate-900">
            Buku Kas Terpisah, Listrik Freezer & Laporan Laba-Rugi Standar KUR
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Pemisahan otomatis modal kerja kulakan dari keuangan pribadi,
            penguncian kas PO, beban listrik penyimpanan dingin 24 jam, dan
            verifikasi KUR 1-klik
          </p>
        </div>

        <button
          onClick={handleExportKurPdf}
          className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-xs transition cursor-pointer shrink-0"
        >
          ⬇ Ekspor PDF Standar Pengajuan KUR Bank (1-Klik)
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

      {/* 3 Separated Cash Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-700 to-teal-800 text-white p-5 shadow-xs">
          <div className="text-xs text-emerald-100 font-medium">
            1. Saldo Kas Siap Kulakan (Bebas)
          </div>
          <div className="text-2xl font-extrabold my-2">
            {formatRp(data.balances.availableKulakanCashRp)}
          </div>
          <div className="text-[11px] text-emerald-100">
            {data.balances.coverageStatusLabel} • Terlindungi dari penarikan
            pribadi
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
          <div className="text-xs text-slate-500 font-medium">
            2. Alokasi Kas Terkunci pada PO Aktif
          </div>
          <div className="text-2xl font-extrabold text-slate-900 my-2">
            {formatRp(data.balances.lockedPoCashRp)}
          </div>
          <div className="text-[11px] text-amber-700 font-semibold">
            🔒 Dikunci untuk PO berjalan hingga barang tiba via Vision OCR
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs">
          <div className="text-xs text-slate-500 font-medium">
            3. Akumulasi Laba Bersih (Setelah Listrik Freezer)
          </div>
          <div className="text-2xl font-extrabold text-emerald-700 my-2">
            {formatRp(data.balances.netProfitBalanceRp)}
          </div>
          <div className="text-[11px] text-slate-500">
            Dapat di-reinvestasikan ke Kas Kulakan atau ditarik pemilik
          </div>
        </div>
      </div>

      {/* P&L Statement + KUR Readiness Score */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Cols: Standardized Profit & Loss Statement */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Laporan Laba-Rugi Terstandarisasi (Standar KUR & Bank Daerah)
              </h2>
              <p className="text-[11px] text-slate-500">
                Rekonsiliasi otomatis dari transaksi POS, HPP Batch FEFO, dan
                beban listrik penyimpanan dingin 24 jam
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 font-bold text-[11px] border border-emerald-200">
              Net Margin: {data.profitAndLoss.monthlyProjected.netMarginPct}%
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-400 uppercase">
                  <th className="py-2.5 text-left">Komponen Laba-Rugi</th>
                  <th className="py-2.5 text-right">Realisasi 7 Hari</th>
                  <th className="py-2.5 text-right">Proyeksi Bulanan (30 Hr)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-2.5 font-semibold text-slate-800">
                    Pendapatan Penjualan Kasir (Eceran Pack & Grosir Dus)
                  </td>
                  <td className="py-2.5 text-right font-bold text-slate-900">
                    {formatRp(data.profitAndLoss.weekly.revenueRp)}
                  </td>
                  <td className="py-2.5 text-right font-bold text-slate-900">
                    {formatRp(data.profitAndLoss.monthlyProjected.revenueRp)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 text-slate-600">
                    (-) Harga Pokok Penjualan (HPP Batch FEFO Terpotong)
                  </td>
                  <td className="py-2.5 text-right text-slate-600">
                    ({formatRp(data.profitAndLoss.weekly.cogsRp)})
                  </td>
                  <td className="py-2.5 text-right text-slate-600">
                    ({formatRp(data.profitAndLoss.monthlyProjected.cogsRp)})
                  </td>
                </tr>
                <tr className="bg-slate-50 font-bold">
                  <td className="py-2.5 px-2 text-slate-900">
                    = Laba Kotor Operasional (Gross Profit)
                  </td>
                  <td className="py-2.5 text-right text-slate-900">
                    {formatRp(data.profitAndLoss.weekly.grossProfitRp)}
                  </td>
                  <td className="py-2.5 text-right text-slate-900">
                    {formatRp(data.profitAndLoss.monthlyProjected.grossProfitRp)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 text-amber-800 font-medium">
                    (-) Beban Listrik Penyimpanan Dingin 24 Jam (
                    {data.store.coldChainCode})
                  </td>
                  <td className="py-2.5 text-right text-amber-800">
                    (
                    {formatRp(
                      data.profitAndLoss.weekly.freezerElectricityExpenseRp
                    )}
                    )
                  </td>
                  <td className="py-2.5 text-right text-amber-800">
                    (
                    {formatRp(
                      data.profitAndLoss.monthlyProjected
                        .freezerElectricityExpenseRp
                    )}
                    )
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 text-red-700">
                    (-) Kerugian Write-Off Barang Kedaluwarsa (Target &lt; 2%)
                  </td>
                  <td className="py-2.5 text-right text-red-700">
                    ({formatRp(data.profitAndLoss.weekly.expiredWriteOffLossRp)})
                  </td>
                  <td className="py-2.5 text-right text-red-700">
                    (
                    {formatRp(
                      data.profitAndLoss.monthlyProjected.expiredWriteOffLossRp
                    )}
                    )
                  </td>
                </tr>
                <tr className="bg-emerald-50/80 font-extrabold text-sm text-emerald-950">
                  <td className="py-3 px-2 rounded-l-xl">
                    = Laba Bersih Usaha (Net Operating Income)
                  </td>
                  <td className="py-3 text-right">
                    {formatRp(data.profitAndLoss.weekly.netOperatingIncomeRp)}
                  </td>
                  <td className="py-3 px-2 text-right rounded-r-xl">
                    {formatRp(
                      data.profitAndLoss.monthlyProjected.netOperatingIncomeRp
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Right 5 Cols: KUR Bank Readiness & Controls */}
        <div className="lg:col-span-5 space-y-4">
          {/* KUR Eligibility Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase text-emerald-700">
                  Bankability & Credit Scoring (FR-804)
                </div>
                <h3 className="text-sm font-bold text-slate-900">
                  Skor Kelayakan KUR & Bank Aceh Syariah
                </h3>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-700 text-white font-black text-lg flex items-center justify-center">
                {data.kurReadiness.eligibilityScore}
              </div>
            </div>

            <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-900">
              ✓ {data.kurReadiness.eligibilityStatus}
            </div>

            <div className="space-y-1.5 text-xs text-slate-600">
              <div className="flex justify-between">
                <span>Kapasitas Angsuran Maksimum/Bulan:</span>
                <strong className="text-slate-900">
                  {formatRp(data.kurReadiness.maxMonthlyInstallmentCapacityRp)}
                </strong>
              </div>
              <div className="flex justify-between">
                <span>Rekomendasi Plafon Modal Kerja (24 Bln):</span>
                <strong className="text-emerald-700">
                  {formatRp(
                    data.kurReadiness.recommendedWorkingCapitalPlafonRp
                  )}
                </strong>
              </div>
              <div className="flex justify-between">
                <span>Dokumen PO Terverifikasi:</span>
                <strong className="text-slate-900">
                  {data.kurReadiness.verifiedPoCount} Dokumen PO
                </strong>
              </div>
            </div>
          </div>

          {/* Freezer Electricity & Capital Reinvestment Forms */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4 text-xs">
            <form onSubmit={handleUpdateFreezerElec} className="space-y-2">
              <label className="block font-bold text-slate-800">
                Konfigurasi Alokasi Listrik Freezer 24 Jam (FR-803)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={elecCostInput}
                  onChange={(e) => setElecCostInput(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-300 font-bold"
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 rounded-xl bg-slate-900 text-white font-semibold cursor-pointer"
                >
                  Simpan & Catat Hari Ini
                </button>
              </div>
            </form>

            <form
              onSubmit={handleCapitalAdjustment}
              className="pt-3 border-t border-slate-100 space-y-2"
            >
              <label className="block font-bold text-slate-800">
                Reinvestasi Laba / Penarikan Laba Pemilik (FR-801)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={adjType}
                  onChange={(e) =>
                    setAdjType(
                      e.target.value as
                        | "PROFIT_REINVESTMENT"
                        | "OWNER_DRAWING"
                        | "INITIAL_CAPITAL"
                    )
                  }
                  className="px-2.5 py-2 rounded-xl border border-slate-300 bg-white font-medium"
                >
                  <option value="PROFIT_REINVESTMENT">
                    Reinvestasi Laba → Kas Kulakan
                  </option>
                  <option value="OWNER_DRAWING">
                    Tarik Laba Bersih (Pribadi)
                  </option>
                  <option value="INITIAL_CAPITAL">
                    Suntik Modal Kerja Baru
                  </option>
                </select>
                <input
                  type="number"
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-300 font-bold"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 rounded-xl bg-emerald-700 text-white font-semibold cursor-pointer"
              >
                Eksekusi Mutasi Kas Atomik
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Immutable Cash Ledger Table */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            Jurnal Buku Kas Atomik (Append-Only Audit Trail)
          </h2>
          <p className="text-[11px] text-slate-500">
            Setiap baris mutasi bersifat permanen untuk menjamin integritas
            verifikasi perbankan
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] text-slate-400 uppercase">
                <th className="py-2.5 px-3">Referensi</th>
                <th className="py-2.5 px-3">Jenis Mutasi</th>
                <th className="py-2.5 px-3">Nominal</th>
                <th className="py-2.5 px-3">Kas Siap Kulakan</th>
                <th className="py-2.5 px-3">Kas Terkunci PO</th>
                <th className="py-2.5 px-3">Saldo Laba Bersih</th>
                <th className="py-2.5 px-3">Keterangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.ledgerEntries.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-3 font-mono font-bold text-slate-800">
                    {entry.referenceId || "-"}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold text-[10px]">
                      {entry.entryType}
                    </span>
                  </td>
                  <td
                    className={`py-2.5 px-3 font-bold ${
                      entry.amountRp >= 0 ? "text-emerald-700" : "text-red-600"
                    }`}
                  >
                    {entry.amountRp >= 0 ? "+" : ""}
                    {formatRp(entry.amountRp)}
                  </td>
                  <td className="py-2.5 px-3 font-bold text-slate-900">
                    {formatRp(entry.availableKulakanCashAfterRp)}
                  </td>
                  <td className="py-2.5 px-3 text-amber-800 font-semibold">
                    {formatRp(entry.lockedPoCashAfterRp)}
                  </td>
                  <td className="py-2.5 px-3 text-emerald-800 font-semibold">
                    {formatRp(entry.netProfitBalanceAfterRp)}
                  </td>
                  <td className="py-2.5 px-3 text-slate-500">{entry.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Exported KUR Verification Package PDF Preview (FR-805) */}
      {kurDocModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-slate-200 space-y-4 text-xs">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div>
                <div className="text-[10px] font-bold uppercase text-emerald-700">
                  {kurDocModal.bankStandardLabel}
                </div>
                <h3 className="text-base font-extrabold text-slate-900">
                  Dokumen Verifikasi Laba-Rugi & Rekam Jejak PO (
                  {kurDocModal.documentNumber})
                </h3>
                <p className="text-[11px] text-slate-500">
                  Toko: {kurDocModal.report.store.name} (
                  {kurDocModal.report.store.branchName}) • Hash Integritas:{" "}
                  <span className="font-mono font-bold text-slate-700">
                    {kurDocModal.integrityHash}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setKurDocModal(null)}
                className="text-slate-400 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <div>
                <div className="text-[10px] text-slate-500">
                  Kas Siap Kulakan Terverifikasi
                </div>
                <div className="text-sm font-extrabold text-slate-900">
                  {formatRp(kurDocModal.report.balances.availableKulakanCashRp)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">
                  Laba Bersih Bulanan (Setelah Listrik)
                </div>
                <div className="text-sm font-extrabold text-emerald-700">
                  {formatRp(
                    kurDocModal.report.profitAndLoss.monthlyProjected
                      .netOperatingIncomeRp
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">
                  Skor Kelayakan Kredit KUR
                </div>
                <div className="text-sm font-extrabold text-emerald-800">
                  {kurDocModal.report.kurReadiness.eligibilityScore}/100 (LAYAK)
                </div>
              </div>
            </div>

            <div>
              <div className="font-bold text-slate-800 mb-1.5">
                Lampiran Rekam Jejak Purchase Order (PO) Terverifikasi:
              </div>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-50 font-bold text-slate-500">
                    <tr>
                      <th className="py-2 px-3">No. PO</th>
                      <th className="py-2 px-3">Distributor</th>
                      <th className="py-2 px-3">Item & Kuantitas</th>
                      <th className="py-2 px-3">Nominal</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {kurDocModal.report.verifiedPurchaseOrders.map((po) => (
                      <tr key={po.poNumber}>
                        <td className="py-2 px-3 font-bold">{po.poNumber}</td>
                        <td className="py-2 px-3">{po.supplierName}</td>
                        <td className="py-2 px-3">
                          {po.orderQtyBoxes} Dus {po.productName}
                        </td>
                        <td className="py-2 px-3 font-bold">
                          {formatRp(po.totalAmountRp)}
                        </td>
                        <td className="py-2 px-3 text-emerald-700 font-bold">
                          {po.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => window.print()}
                className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-semibold cursor-pointer"
              >
                Cetak / Simpan PDF Pengajuan KUR
              </button>
              <button
                onClick={() => setKurDocModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-semibold cursor-pointer"
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

