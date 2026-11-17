"use client";

import React, { useState, useEffect, useCallback } from "react";
import { formatRp } from "./CommandCenterDashboard";
import { useConfirmDialog } from "./ConfirmActionModal";
import { useGooeyToastFlash } from "./GooeyToastProvider";

interface FinanceChartDay {
  date: string;
  dayLabel: string;
  inflowRp: number;
  outflowRp: number;
  poSpendingRp: number;
  freezerElecRp: number;
  invoiceCount: number;
}

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
      salesDiscountRp?: number;
      cogsRp: number;
      grossProfitRp: number;
      freezerElectricityExpenseRp: number;
      expiredWriteOffLossRp: number;
      netOperatingIncomeRp: number;
      netMarginPct: number;
      invoiceCount: number;
      revenueTrendPct: number | null;
      wasteLossPct: number;
      periodStartDate?: string;
      periodEndDate?: string;
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
  chartDays?: FinanceChartDay[];
  kurReadiness: {
    eligibilityScore: number;
    eligibilityStatus: string;
    hasOperatingActivity?: boolean;
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

function formatAccountingId(amountRp: number): string {
  return Math.round(amountRp).toLocaleString("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatShortChartMillion(amountRp: number): string {
  if (amountRp <= 0) return "";
  if (amountRp >= 1000000) {
    return `${(amountRp / 1000000).toFixed(1).replace(".", ",")}jt`;
  }
  return `${Math.round(amountRp / 1000)}rb`;
}

function formatLedgerTimeTag(isoStr: string): string {
  try {
    const dt = new Date(
      isoStr.includes("T") ? isoStr : `${isoStr.replace(" ", "T")}Z`
    );
    if (Number.isNaN(dt.getTime())) return "-";
    const wib = new Date(dt.getTime() + 7 * 60 * 60 * 1000);
    const nowWib = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const sameDay =
      wib.getUTCFullYear() === nowWib.getUTCFullYear() &&
      wib.getUTCMonth() === nowWib.getUTCMonth() &&
      wib.getUTCDate() === nowWib.getUTCDate();
    if (sameDay) {
      return `${wib.getUTCHours().toString().padStart(2, "0")}:${wib
        .getUTCMinutes()
        .toString()
        .padStart(2, "0")}`;
    }
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
    return `${wib.getUTCDate()} ${months[wib.getUTCMonth()] || ""}`;
  } catch {
    return "-";
  }
}

function getLedgerBadgeAndSign(entry: FinanceSummaryData["ledgerEntries"][0]): {
  badgeLabel: string;
  badgeClass: string;
  signedAmountRp: number;
  isPositive: boolean;
} {
  switch (entry.entryType) {
    case "POS_SALE_REVENUE": {
      const isQris = (entry.notes || "").toUpperCase().includes("QRIS");
      return {
        badgeLabel: isQris ? "QRIS POS" : "Kasir POS",
        badgeClass: "bg-[#D7F0E6] text-[#0F6352]",
        signedAmountRp: Math.abs(entry.amountRp),
        isPositive: true,
      };
    }
    case "PO_CASH_LOCK":
    case "PO_SETTLEMENT":
      return {
        badgeLabel: "Kulakan PO",
        badgeClass: "bg-[#F1F5F9] text-[#475569]",
        signedAmountRp: -Math.abs(entry.amountRp),
        isPositive: false,
      };
    case "PO_CASH_RELEASE":
      return {
        badgeLabel: "Rilis PO",
        badgeClass: "bg-[#EBF8F2] text-[#0F6352]",
        signedAmountRp: Math.abs(entry.amountRp),
        isPositive: true,
      };
    case "FREEZER_ELECTRICITY_EXPENSE":
      return {
        badgeLabel: "Biaya Listrik",
        badgeClass: "bg-amber-50 text-amber-800 border border-amber-200/70",
        signedAmountRp: -Math.abs(entry.amountRp),
        isPositive: false,
      };
    case "EXPIRED_WRITE_OFF_LOSS":
      return {
        badgeLabel: "Write-Off FEFO",
        badgeClass: "bg-red-50 text-red-700",
        signedAmountRp: -Math.abs(entry.amountRp),
        isPositive: false,
      };
    case "OWNER_DRAWING":
      return {
        badgeLabel: "Penarikan Laba",
        badgeClass: "bg-slate-100 text-slate-700",
        signedAmountRp: -Math.abs(entry.amountRp),
        isPositive: false,
      };
    default:
      return {
        badgeLabel: "Modal Kerja",
        badgeClass: "bg-indigo-50 text-indigo-700",
        signedAmountRp: entry.amountRp,
        isPositive: entry.amountRp >= 0,
      };
  }
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
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const confirmDialog = useConfirmDialog();

  useGooeyToastFlash(
    feedbackMsg,
    activeRole === "CASHIER" ? null : errorMsg,
    () => setFeedbackMsg(null),
    () => setErrorMsg(null)
  );
  const [hoveredDayDate, setHoveredDayDate] = useState<string | null>(null);

  // Modals
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseTab, setExpenseTab] = useState<"ELECTRICITY" | "CAPITAL">(
    "ELECTRICITY"
  );
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [kurDocModal, setKurDocModal] = useState<ExportKurDoc | null>(null);

  // Capital adjustment form
  const [adjType, setAdjType] = useState<
    "PROFIT_REINVESTMENT" | "OWNER_DRAWING" | "INITIAL_CAPITAL"
  >("PROFIT_REINVESTMENT");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjNotes, setAdjNotes] = useState("");

  // Freezer electricity form
  const [elecCostInput, setElecCostInput] = useState("");

  const fetchFinanceSummary = useCallback(async () => {
    const res = await fetch(
      `/api/v1/finance/ledger-summary?storeId=${encodeURIComponent(
        activeStoreId
      )}&role=${activeRole}`
    );
    return res.json();
  }, [activeStoreId, activeRole]);

  const applyFinanceSummary = useCallback(
    (json: {
      success: boolean;
      data?: FinanceSummaryData;
      error?: { message?: string };
    }) => {
      if (!json.success || !json.data) {
        setErrorMsg(json.error?.message || "Akses ditolak.");
        setData(null);
      } else {
        setErrorMsg(null);
        setData(json.data);
        setElecCostInput(String(json.data.store.dailyFreezerElecCostRp));
      }
    },
    []
  );

  const loadFinanceData = useCallback(async () => {
    try {
      const json = await fetchFinanceSummary();
      applyFinanceSummary(json);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal memuat buku kas."
      );
    } finally {
      setLoading(false);
    }
  }, [fetchFinanceSummary, applyFinanceSummary]);

  useEffect(() => {
    let cancelled = false;
    fetchFinanceSummary()
      .then((json) => {
        if (cancelled) return;
        applyFinanceSummary(json);
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(
          err instanceof Error ? err.message : "Gagal memuat buku kas."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchFinanceSummary, applyFinanceSummary]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowExpenseModal(false);
        setShowAuditModal(false);
        setKurDocModal(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleCapitalAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await confirmDialog({
      title: "Konfirmasi Pencatatan Mutasi Modal & Prive",
      description:
        "Mutasi ini akan langsung mengubah Saldo Kas Siap Kulakan dan tercatat permanen pada Buku Kas toko.",
      detailText: `Jenis: ${adjType} • Nominal: ${formatRp(Number(adjAmount || 0))}`,
      confirmLabel: "Ya, Catat Mutasi",
      cancelLabel: "Batal",
      variant: adjType === "OWNER_DRAWING" ? "warning" : "primary",
    });
    if (!ok) return;
    setSubmitting(true);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
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
        setShowExpenseModal(false);
        setAdjAmount("");
        setAdjNotes("");
        setFeedbackMsg(
          `Mutasi ${adjType} sebesar ${formatRp(
            json.data.amountRp
          )} dicatat. Saldo Kas Kulakan kini ${formatRp(
            json.data.availableKulakanCashAfterRp
          )}.`
        );
        await loadFinanceData();
      } else {
        setErrorMsg(json.error?.message || "Gagal mencatat mutasi kas.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateFreezerElec = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await confirmDialog({
      title: "Simpan Perubahan Tarif Listrik Freezer?",
      description:
        "Beban listrik harian chest freezer akan diperbarui dan langsung dicatat ke dalam Buku Kas operasional.",
      detailText: `Beban Baru: ${formatRp(Number(elecCostInput || 0))} / hari`,
      confirmLabel: "Ya, Simpan Beban Listrik",
      cancelLabel: "Batal",
      variant: "primary",
    });
    if (!ok) return;
    setSubmitting(true);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
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
        setShowExpenseModal(false);
        setFeedbackMsg(
          `Tarif & Beban Listrik Freezer 24 Jam (${formatRp(
            json.data.elecCostRp
          )}/hari) dicatat (${json.data.referenceCode}).`
        );
        await loadFinanceData();
      } else {
        setErrorMsg(json.error?.message || "Gagal memperbarui beban listrik.");
      }
    } finally {
      setSubmitting(false);
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

  const handleDownloadOfficialReport = () => {
    if (!data) return;
    handleExportKurPdf();
  };

  if (loading) {
    return (
      <div
        className="space-y-5 animate-pulse"
        role="status"
        aria-busy="true"
        aria-label="Memuat buku kas dan laporan KUR..."
      >
        {/* Header Skeleton */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="h-7 bg-[#E2E8F0] rounded-lg w-64 sm:w-80" />
            <div className="h-4 bg-[#F1F5F9] rounded-md w-72 sm:w-96" />
          </div>
          <div className="flex items-center gap-2.5">
            <div className="h-10 bg-white border border-[#E5E9EC] rounded-xl w-36" />
            <div className="h-10 bg-[#D7F0E6]/80 rounded-xl w-44" />
          </div>
        </div>

        {/* 4 Financial KPI Cards Skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="min-h-[138px] rounded-2xl bg-white border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="h-3.5 w-32 rounded bg-[#E2E8F0]" />
                <div className="h-5 w-14 rounded-full bg-[#F1F5F9]" />
              </div>
              <div className="my-2">
                <div className="h-7 w-40 rounded-lg bg-[#CBD5E1]" />
              </div>
              <div className="h-3 w-36 rounded bg-[#F1F5F9]" />
            </div>
          ))}
        </div>

        {/* 12-Column Split: Cashflow Chart + KUR Readiness Card */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <div className="lg:col-span-7 rounded-2xl bg-white border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1.5">
                <div className="h-4 w-48 rounded bg-[#E2E8F0]" />
                <div className="h-3 w-64 rounded bg-[#F1F5F9]" />
              </div>
              <div className="h-8 w-28 rounded-lg bg-[#F1F5F9]" />
            </div>
            <div className="h-64 rounded-xl bg-[#F8FAFC] border border-[#F1F5F9] p-4 flex items-end justify-between gap-3">
              {[52, 68, 44, 80, 72, 90].map((pct, i) => (
                <div
                  key={i}
                  style={{ height: `${pct}%` }}
                  className="flex-1 rounded-t-lg bg-[#E2E8F0]"
                />
              ))}
            </div>
          </div>

          <div className="lg:col-span-5 rounded-2xl bg-white border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
            <div className="space-y-1.5">
              <div className="h-4 w-44 rounded bg-[#E2E8F0]" />
              <div className="h-3 w-56 rounded bg-[#F1F5F9]" />
            </div>
            <div className="h-28 rounded-xl bg-[#F8FAFC] border border-[#E5E9EC] p-4 flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-[#E2E8F0] shrink-0" />
              <div className="space-y-2 flex-1">
                <div className="h-4 w-3/4 rounded bg-[#CBD5E1]" />
                <div className="h-3 w-1/2 rounded bg-[#E2E8F0]" />
              </div>
            </div>
            <div className="space-y-2.5">
              {[1, 2, 3].map((r) => (
                <div
                  key={r}
                  className="h-10 rounded-xl bg-[#F8FAFC] border border-[#F1F5F9] px-3 flex items-center justify-between"
                >
                  <div className="h-3 w-36 rounded bg-[#E2E8F0]" />
                  <div className="h-3 w-20 rounded bg-[#CBD5E1]" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-amber-50 border border-amber-300 rounded-2xl p-6 text-xs text-amber-900 space-y-2">
        <div className="font-bold text-sm">
          Akses Buku Kas &amp; Laporan KUR Dibatasi (RBAC)
        </div>
        <p>{errorMsg}</p>
        <p className="text-[11px] text-amber-700">
          Gunakan akun <strong>Pemilik (Owner)</strong> atau{" "}
          <strong>Admin</strong> untuk melihat Buku Kas Terpisah dan mengekspor
          dokumen pengajuan KUR Bank.
        </p>
      </div>
    );
  }

  const weekly = data.profitAndLoss.weekly;
  const totalHppAndElecRp = weekly.cogsRp + weekly.freezerElectricityExpenseRp;
  const chartDays = data.chartDays || [];
  const peakInflowRp = Math.max(0, ...chartDays.map((d) => d.inflowRp));
  const maxChartValRp = Math.max(
    1000000,
    ...chartDays.map((d) => Math.max(d.inflowRp, d.outflowRp))
  );

  const hasOpActivity =
    data.kurReadiness.hasOperatingActivity ??
    (weekly.revenueRp > 0 || data.kurReadiness.verifiedPoCount > 0);
  const kurScore = data.kurReadiness.eligibilityScore;
  const ringRadius = 22;
  const ringCirc = 2 * Math.PI * ringRadius;
  const ringOffset = ringCirc * (1 - Math.min(100, Math.max(0, kurScore)) / 100);

  return (
    <div className="space-y-5">
      <div className={kurDocModal || showAuditModal ? "print:hidden space-y-5" : "space-y-5"}>
      {/* Page Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-[22px] sm:text-[24px] font-bold text-[#0F172A] tracking-tight leading-snug">
            Buku Kas Keuangan &amp; Laporan Laba-Rugi
          </h1>
          <p className="text-[13px] text-[#64748B] mt-0.5">
            Rekonsiliasi otomatis transaksi POS, HPP kulakan PO, beban listrik
            freezer, &amp; laporan standar KUR Bank.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setExpenseTab("ELECTRICITY");
              setShowExpenseModal(true);
            }}
            className="min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-xs font-semibold text-[#334155] inline-flex items-center gap-2 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
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
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v8" />
              <path d="M8 12h8" />
            </svg>
            <span>+ Catat Biaya</span>
          </button>

          <button
            type="button"
            onClick={handleExportKurPdf}
            className="min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white text-xs font-semibold inline-flex items-center gap-2 shadow-xs transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>Ekspor PDF Siap Bank</span>
          </button>
        </div>
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Card 1: Saldo Kas Aktif (Siap Kulakan) */}
        <button
          type="button"
          onClick={() => {
            setExpenseTab("CAPITAL");
            setShowExpenseModal(true);
          }}
          title={`Terkunci PO: ${formatRp(
            data.balances.lockedPoCashRp
          )} | Laba Bersih Tersedia: ${formatRp(
            data.balances.netProfitBalanceRp
          )}`}
          className="rounded-2xl bg-gradient-to-br from-[#0F766E] via-[#0F5B68] to-[#1E3A8A] text-white p-5 shadow-sm flex flex-col justify-between min-h-[144px] text-left w-full hover:opacity-95 transition-opacity focus-visible:outline-2 focus-visible:outline-[#0F6352]"
        >
          <div className="flex items-center justify-between gap-2 w-full">
            <span className="text-xs font-medium text-teal-50/90">
              Saldo Kas Aktif (Siap Kulakan)
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4 text-teal-100/85 shrink-0"
            >
              <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5" />
              <path d="M16 12h4v4h-4a2 2 0 0 1 0-4Z" />
            </svg>
          </div>
          <div className="my-2">
            <div className="text-[24px] sm:text-[26px] font-bold tracking-tight tabular-nums leading-tight">
              {formatRp(data.balances.availableKulakanCashRp)}
            </div>
          </div>
          <div className="text-[11px] text-teal-50/90 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 shrink-0" />
            <span>
              Terpisah dari Kas Pribadi Owner
              {data.balances.lockedPoCashRp > 0
                ? ` • Kunci PO ${formatRp(data.balances.lockedPoCashRp)}`
                : ""}
            </span>
          </div>
        </button>

        {/* Card 2: Omzet Kotor */}
        <div className="rounded-2xl bg-white border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between min-h-[144px]">
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-medium text-[#64748B]">
              Omzet Kotor (7 Hari)
            </span>
            {weekly.revenueTrendPct !== null ? (
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
                  weekly.revenueTrendPct >= 0
                    ? "bg-[#EBF8F2] text-[#0F6352]"
                    : "bg-amber-50 text-amber-800"
                }`}
              >
                {weekly.revenueTrendPct >= 0 ? "+" : ""}
                {weekly.revenueTrendPct.toString().replace(".", ",")}% vs Awal
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F1F5F9] text-[#475569] whitespace-nowrap">
                {weekly.invoiceCount > 0 ? "Terverifikasi" : "Belum Ada Omzet"}
              </span>
            )}
          </div>
          <div className="my-2">
            <div className="text-[24px] sm:text-[26px] font-bold text-[#0F172A] tracking-tight tabular-nums leading-tight">
              {formatRp(weekly.revenueRp)}
            </div>
          </div>
          <div className="text-[11px] text-[#64748B] flex items-center gap-1.5">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-3.5 h-3.5 text-[#0F6352] shrink-0"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <span>{weekly.invoiceCount} Transaksi POS terverifikasi</span>
          </div>
        </div>

        {/* Card 3: HPP & Listrik Freezer */}
        <div className="rounded-2xl bg-white border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between min-h-[144px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#64748B]">
              HPP &amp; Listrik Freezer
            </span>
            <span className="inline-flex items-center gap-1 text-amber-500 shrink-0">
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
                <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
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
                <path d="M12 2v20" />
                <path d="m17 5-5 4-5-4" />
                <path d="m17 19-5-4-5 4" />
                <path d="M2 12h20" />
              </svg>
            </span>
          </div>
          <div className="my-2">
            <div className="text-[24px] sm:text-[26px] font-bold text-[#0F172A] tracking-tight tabular-nums leading-tight">
              {formatRp(totalHppAndElecRp)}
            </div>
          </div>
          <div className="text-[11px] flex items-center justify-between gap-2">
            <span className="text-[#64748B]">Termasuk Listrik:</span>
            <span className="font-mono font-semibold text-amber-700 tabular-nums">
              {formatRp(weekly.freezerElectricityExpenseRp)}
            </span>
          </div>
        </div>

        {/* Card 4: Laba Bersih Operasional */}
        <div className="rounded-2xl bg-white border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between min-h-[144px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#64748B]">
              Laba Bersih Operasional
            </span>
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
                weekly.netMarginPct >= 15
                  ? "bg-[#0F6352] text-white"
                  : weekly.netOperatingIncomeRp > 0
                    ? "bg-[#D7F0E6] text-[#0F6352]"
                    : weekly.netOperatingIncomeRp < 0
                      ? "bg-red-50 text-red-700"
                      : "bg-[#F1F5F9] text-[#475569]"
              }`}
            >
              {weekly.netMarginPct >= 15
                ? "Sehat"
                : weekly.netOperatingIncomeRp > 0
                  ? "Positif"
                  : weekly.netOperatingIncomeRp < 0
                    ? "Minus"
                    : "Belum Ada"}
            </span>
          </div>
          <div className="my-2">
            <div
              className={`text-[24px] sm:text-[26px] font-bold tracking-tight tabular-nums leading-tight ${
                weekly.netOperatingIncomeRp < 0
                  ? "text-red-600"
                  : "text-[#0F6352]"
              }`}
            >
              {formatRp(weekly.netOperatingIncomeRp)}
            </div>
          </div>
          <div className="text-[11px] flex items-center justify-between gap-2">
            <span
              className={
                weekly.netMarginPct >= 15
                  ? "text-[#0F6352] font-medium"
                  : "text-[#64748B]"
              }
            >
              {weekly.netMarginPct >= 15
                ? "Margin Bersih Sehat:"
                : "Margin Operasional:"}
            </span>
            <span className="font-mono font-bold text-[#0F172A] tabular-nums">
              {weekly.netMarginPct.toString().replace(".", ",")}%
            </span>
          </div>
        </div>
      </div>

      {/* Main Split: Left 7 Cols Chart & Recent Mutations | Right 5 Cols KUR Eligibility Score */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left Panel: Cashflow 7-Day Trend + Latest Mutations */}
        <section
          aria-labelledby="cashflow-heading"
          className="lg:col-span-7 bg-white rounded-2xl border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-5"
        >
          {/* Chart Header */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-4 h-4 text-[#0F6352] shrink-0"
                >
                  <path d="M3 3v18h18" />
                  <rect x="7" y="10" width="3" height="7" rx="1" />
                  <rect x="14" y="6" width="3" height="11" rx="1" />
                </svg>
                <h2
                  id="cashflow-heading"
                  className="text-[15px] font-bold text-[#0F172A]"
                >
                  Tren Kas Masuk POS vs Kulakan (7 Hari)
                </h2>
              </div>

              <div className="flex items-center gap-4 text-xs font-medium text-[#475569]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#0F6352] inline-block" />
                  <span>Kas Masuk</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#E11D48] inline-block" />
                  <span>Pengeluaran</span>
                </span>
              </div>
            </div>

            {/* Chart Plot Box */}
            <div className="bg-[#F8FAFC] border border-[#E5E9EC] rounded-2xl px-3 sm:px-5 pt-6 pb-4">
              {chartDays.length === 0 ? (
                <div className="h-36 flex items-center justify-center text-xs text-[#64748B]">
                  Belum ada rekaman arus kas 7 hari terakhir.
                </div>
              ) : (
                <div className="flex items-end justify-between gap-2 sm:gap-4 h-40">
                  {chartDays.map((d) => {
                    const inPct =
                      d.inflowRp > 0
                        ? Math.min(
                            100,
                            Math.max(
                              8,
                              Math.round((d.inflowRp / maxChartValRp) * 100)
                            )
                          )
                        : 0;
                    const outPct =
                      d.outflowRp > 0
                        ? Math.min(
                            100,
                            Math.max(
                              8,
                              Math.round((d.outflowRp / maxChartValRp) * 100)
                            )
                          )
                        : 0;
                    const isPeak = peakInflowRp > 0 && d.inflowRp === peakInflowRp;
                    const isHovered = hoveredDayDate === d.date;
                    return (
                      <div
                        key={d.date}
                        onMouseEnter={() => setHoveredDayDate(d.date)}
                        onMouseLeave={() => setHoveredDayDate(null)}
                        className="relative flex-1 flex flex-col items-center justify-end h-full gap-2 group"
                      >
                        {isHovered && (
                          <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[#0F172A] text-white text-[10px] font-medium px-2.5 py-1 rounded-lg shadow-md whitespace-nowrap z-20 pointer-events-none">
                            {d.dayLabel}: Masuk {formatRp(d.inflowRp)} | Keluar{" "}
                            {formatRp(d.outflowRp)}
                          </div>
                        )}
                        <span
                          className={`font-mono text-[10px] h-4 leading-4 ${
                            isPeak || isHovered
                              ? "font-bold text-[#0F6352]"
                              : "font-medium text-[#64748B]"
                          }`}
                        >
                          {formatShortChartMillion(d.inflowRp)}
                        </span>
                        <div className="w-full flex items-end justify-center gap-1 h-24">
                          <div
                            style={{ height: `${inPct}%` }}
                            title={`Kas Masuk ${d.dayLabel}: ${formatRp(
                              d.inflowRp
                            )}`}
                            className="w-3 sm:w-3.5 bg-[#0F6352] group-hover:bg-[#0B4F41] rounded-t-[4px] transition-all"
                          />
                          <div
                            style={{ height: `${outPct}%` }}
                            title={`Pengeluaran ${d.dayLabel}: ${formatRp(
                              d.outflowRp
                            )}`}
                            className="w-3 sm:w-3.5 bg-[#E11D48] group-hover:bg-[#BE123C] rounded-t-[4px] transition-all"
                          />
                        </div>
                        <span
                          className={`text-[11px] ${
                            isPeak
                              ? "font-bold text-[#0F6352]"
                              : "font-medium text-[#64748B]"
                          }`}
                        >
                          {d.dayLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Latest Mutations List inside Left Panel */}
          <div className="space-y-3 pt-1 border-t border-[#F1F5F9]">
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <span className="text-[11px] font-bold tracking-wider uppercase text-[#64748B]">
                Mutasi Terbaru Hari Ini
              </span>
              <button
                type="button"
                onClick={() => setShowAuditModal(true)}
                className="min-h-[44px] sm:min-h-[34px] px-1 text-[11px] font-medium text-[#64748B] hover:text-[#0F6352] hover:underline transition-colors"
              >
                Sinkronisasi Kasir POS Aktif • Lihat Semua Jurnal (
                {data.ledgerEntries.length})
              </button>
            </div>

            {data.ledgerEntries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#CBD5E1] px-4 py-5 text-center text-xs text-[#64748B]">
                Belum ada mutasi buku kas tercatat untuk toko ini.
              </div>
            ) : (
              <div className="space-y-2">
                {data.ledgerEntries.slice(0, 3).map((entry) => {
                  const meta = getLedgerBadgeAndSign(entry);
                  return (
                    <div
                      key={entry.id}
                      className="rounded-xl border border-[#F1F5F9] bg-[#F8FAFC]/70 hover:bg-[#F8FAFC] px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono text-[11px] text-[#64748B] w-12 shrink-0">
                          {formatLedgerTimeTag(entry.createdAt)}
                        </span>
                        <span className="font-medium text-[#0F172A] truncate">
                          {entry.notes || entry.referenceId || entry.entryType}
                        </span>
                        <span
                          className={`hidden sm:inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${meta.badgeClass}`}
                        >
                          {meta.badgeLabel}
                        </span>
                      </div>

                      <span
                        className={`font-mono font-bold tabular-nums shrink-0 ${
                          meta.isPositive ? "text-[#0F6352]" : "text-[#E11D48]"
                        }`}
                      >
                        {meta.isPositive ? "+" : "-"}
                        {formatRp(Math.abs(meta.signedAmountRp))}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Right Panel: Skor Kelayakan Finansial & KUR */}
        <section
          aria-labelledby="kur-score-heading"
          className="lg:col-span-5 bg-white rounded-2xl border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-4"
        >
          <div className="space-y-3.5">
            {/* Header */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-4 h-4 text-[#0F6352] shrink-0"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
                <h2
                  id="kur-score-heading"
                  className="text-[15px] font-bold text-[#0F172A]"
                >
                  Skor Kelayakan Finansial
                </h2>
              </div>

              <span
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${
                  !hasOpActivity
                    ? "bg-[#F1F5F9] text-[#475569]"
                    : kurScore >= 80
                      ? "bg-[#D7F0E6] text-[#0F6352]"
                      : "bg-amber-50 text-amber-800"
                }`}
              >
                {!hasOpActivity
                  ? "Tahap Awal"
                  : kurScore >= 80
                    ? "Bankable • Grade A"
                    : "Layak Dasar • Grade B"}
              </span>
            </div>

            {/* Circular Score Highlight Card */}
            <div className="rounded-2xl bg-[#ECFDF5]/80 border border-[#CCE8DB] p-4 flex items-center gap-4">
              <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 56 56"
                  className="w-14 h-14 -rotate-90"
                >
                  <circle
                    cx="28"
                    cy="28"
                    r={ringRadius}
                    fill="white"
                    stroke="#D1FAE5"
                    strokeWidth="4.5"
                  />
                  <circle
                    cx="28"
                    cy="28"
                    r={ringRadius}
                    fill="none"
                    stroke="#0F6352"
                    strokeWidth="4.5"
                    strokeLinecap="round"
                    strokeDasharray={ringCirc}
                    strokeDashoffset={ringOffset}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
                  <span className="text-sm font-extrabold text-[#0F6352] tabular-nums">
                    {kurScore}
                  </span>
                  <span className="text-[9px] font-mono text-[#64748B]">
                    /100
                  </span>
                </div>
              </div>

              <div className="min-w-0">
                <div className="text-xs sm:text-[13px] font-bold text-[#0F172A]">
                  {!hasOpActivity
                    ? "Mulai Transaksi untuk Skor KUR"
                    : kurScore >= 80
                      ? "Sangat Layak Pengajuan Modal KUR"
                      : "Memenuhi Syarat Dasar KUR"}
                </div>
                <p className="text-[11px] text-[#475569] mt-0.5 leading-relaxed">
                  {data.kurReadiness.recommendedWorkingCapitalPlafonRp > 0
                    ? `Estimasi plafon modal kerja hingga ${formatRp(
                        data.kurReadiness.recommendedWorkingCapitalPlafonRp
                      )} dengan bunga bersubsidi.`
                    : "Catat penjualan kasir POS & pengadaan PO untuk menghitung plafon modal kerja KUR otomatis."}
                </p>
              </div>
            </div>

            {/* 3 Verification Checklists */}
            <div className="space-y-2.5">
              {/* Item 1: Net Margin */}
              <div className="rounded-xl bg-[#F8FAFC] border border-[#E5E9EC] px-3.5 py-3 flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#D7F0E6] text-[#0F6352] flex items-center justify-center shrink-0 mt-0.5">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-3 h-3"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <div>
                  <div className="text-xs font-bold text-[#0F172A]">
                    Margin Laba Bersih{" "}
                    {weekly.netMarginPct.toString().replace(".", ",")}%
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">
                    {weekly.revenueRp === 0
                      ? "Belum ada omzet POS tercatat untuk mengukur margin bersih."
                      : weekly.netMarginPct >= 15
                        ? "Jauh di atas ambang minimal kelayakan perbankan (15%)."
                        : "Masih berada di bawah ambang minimal perbankan (15%)."}
                  </div>
                </div>
              </div>

              {/* Item 2: Zero Waste FEFO */}
              <div className="rounded-xl bg-[#F8FAFC] border border-[#E5E9EC] px-3.5 py-3 flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#D7F0E6] text-[#0F6352] flex items-center justify-center shrink-0 mt-0.5">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-3 h-3"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <div>
                  <div className="text-xs font-bold text-[#0F172A]">
                    Zero Waste FEFO Cold-Chain
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">
                    {weekly.cogsRp === 0 && weekly.expiredWriteOffLossRp === 0
                      ? "Belum ada perputaran inventaris FEFO atau kerugian tercatat."
                      : weekly.expiredWriteOffLossRp === 0
                        ? "Tingkat kerugian busuk/expired 0% dari total perputaran inventaris."
                        : `Tingkat kerugian write-off ${weekly.wasteLossPct
                            .toString()
                            .replace(".", ",")}% (${formatRp(
                            weekly.expiredWriteOffLossRp
                          )}).`}
                  </div>
                </div>
              </div>

              {/* Item 3: Audit Trail */}
              <div className="rounded-xl bg-[#F8FAFC] border border-[#E5E9EC] px-3.5 py-3 flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#D7F0E6] text-[#0F6352] flex items-center justify-center shrink-0 mt-0.5">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-3 h-3"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <div>
                  <div className="text-xs font-bold text-[#0F172A]">
                    Audit Trail Mutasi Otomatis
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">
                    {weekly.invoiceCount} nota POS kasir dan{" "}
                    {data.kurReadiness.verifiedPoCount} faktur PO terdata tanpa
                    input manual.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDownloadOfficialReport}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-xs transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
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
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            <span>Unduh Laporan Laba-Rugi Resmi (PDF)</span>
          </button>
        </section>
      </div>
      </div>

      {/* Modal 1: + Catat Biaya & Mutasi Kas */}
      {showExpenseModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="expense-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-[#E2E8F0] space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
              <div>
                <h3
                  id="expense-modal-title"
                  className="text-base font-bold text-[#0F172A]"
                >
                  Catat Biaya Listrik &amp; Mutasi Buku Kas
                </h3>
                <p className="text-[11px] text-[#64748B] mt-0.5">
                  Pencatatan atomik ke jurnal kas &amp; menjaga pemisahan kas
                  kulakan dari dana pribadi.
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup dialog catat biaya"
                onClick={() => setShowExpenseModal(false)}
                className="min-h-[36px] min-w-[36px] rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="inline-flex rounded-xl bg-[#F1F5F9] p-1 w-full">
              <button
                type="button"
                onClick={() => setExpenseTab("ELECTRICITY")}
                className={`flex-1 min-h-[38px] rounded-lg font-semibold transition-colors ${
                  expenseTab === "ELECTRICITY"
                    ? "bg-white text-[#0F172A] shadow-2xs"
                    : "text-[#64748B]"
                }`}
              >
                Listrik Freezer 24 Jam
              </button>
              <button
                type="button"
                onClick={() => setExpenseTab("CAPITAL")}
                className={`flex-1 min-h-[38px] rounded-lg font-semibold transition-colors ${
                  expenseTab === "CAPITAL"
                    ? "bg-white text-[#0F172A] shadow-2xs"
                    : "text-[#64748B]"
                }`}
              >
                Mutasi Modal &amp; Laba
              </button>
            </div>

            {expenseTab === "ELECTRICITY" ? (
              <form onSubmit={handleUpdateFreezerElec} className="space-y-3">
                <div>
                  <label
                    htmlFor="elec-cost-input"
                    className="block font-semibold text-[#334155] mb-1"
                  >
                    Alokasi Tarif Listrik Penyimpanan Dingin / Hari (Rp) *
                  </label>
                  <input
                    id="elec-cost-input"
                    type="number"
                    min={1000}
                    required
                    value={elecCostInput}
                    onChange={(e) => setElecCostInput(e.target.value)}
                    className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1] font-bold"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowExpenseModal(false)}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-[#F1F5F9] font-semibold"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white font-semibold"
                  >
                    {submitting ? "Menyimpan..." : "Simpan & Catat Hari Ini"}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleCapitalAdjustment} className="space-y-3">
                <div>
                  <label
                    htmlFor="adj-type-select"
                    className="block font-semibold text-[#334155] mb-1"
                  >
                    Jenis Mutasi Kas *
                  </label>
                  <select
                    id="adj-type-select"
                    value={adjType}
                    onChange={(e) =>
                      setAdjType(
                        e.target.value as
                          | "PROFIT_REINVESTMENT"
                          | "OWNER_DRAWING"
                          | "INITIAL_CAPITAL"
                      )
                    }
                    className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1] bg-white font-medium"
                  >
                    <option value="PROFIT_REINVESTMENT">
                      Reinvestasi Laba ke Kas Kulakan
                    </option>
                    <option value="OWNER_DRAWING">
                      Tarik Laba Bersih (Pribadi Owner)
                    </option>
                    <option value="INITIAL_CAPITAL">
                      Suntik Modal Kerja Baru
                    </option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="adj-amount-input"
                    className="block font-semibold text-[#334155] mb-1"
                  >
                    Nominal (Rp) *
                  </label>
                  <input
                    id="adj-amount-input"
                    type="number"
                    min={1000}
                    required
                    placeholder="Contoh: 500000"
                    value={adjAmount}
                    onChange={(e) => setAdjAmount(e.target.value)}
                    className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1] font-bold"
                  />
                </div>
                <div>
                  <label
                    htmlFor="adj-notes-input"
                    className="block font-semibold text-[#334155] mb-1"
                  >
                    Catatan Mutasi (Opsional)
                  </label>
                  <input
                    id="adj-notes-input"
                    type="text"
                    placeholder="Contoh: Tambah modal kulakan akhir bulan"
                    value={adjNotes}
                    onChange={(e) => setAdjNotes(e.target.value)}
                    className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowExpenseModal(false)}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-[#F1F5F9] font-semibold"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white font-semibold"
                  >
                    {submitting ? "Memproses..." : "Eksekusi Mutasi Kas Atomik"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal 2: Full P&L Statement + Append-Only Audit Trail Ledger */}
      {showAuditModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4 overflow-y-auto print:static print:inset-auto print:z-auto print:bg-white print:p-0 print:overflow-visible print:block print-modal-backdrop"
        >
          <div className="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-xl border border-[#E2E8F0] space-y-5 text-xs max-h-[90vh] overflow-y-auto print:max-w-full print:w-full print:max-h-none print:overflow-visible print:shadow-none print:border-0 print:rounded-none print:p-0 print:m-0 print-paper-sheet">
            <div className="flex items-start justify-between border-b border-[#F1F5F9] pb-3 gap-3">
              <div>
                <h3
                  id="audit-modal-title"
                  className="text-base font-bold text-[#0F172A]"
                >
                  Laporan Laba-Rugi &amp; Jurnal Buku Kas Atomik (
                  {data.store.name})
                </h3>
                <p className="text-[11px] text-[#64748B] mt-0.5">
                  Rekonsiliasi 7 hari &amp; proyeksi 30 hari beserta seluruh
                  baris mutasi append-only.
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup dialog rincian jurnal"
                onClick={() => setShowAuditModal(false)}
                className="min-h-[36px] min-w-[36px] rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] font-bold flex items-center justify-center print:hidden"
              >
                ✕
              </button>
            </div>

            {/* P&L Table */}
            <div className="overflow-x-auto border border-[#E5E9EC] rounded-xl">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b border-[#E5E9EC] text-[11px] text-[#64748B] uppercase">
                    <th className="py-2.5 px-3 text-left">
                      Komponen Laba-Rugi
                    </th>
                    <th className="py-2.5 px-3 text-right">
                      Realisasi 7 Hari
                    </th>
                    <th className="py-2.5 px-3 text-right">
                      Proyeksi 30 Hari
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  <tr>
                    <td className="py-2.5 px-3 font-semibold text-[#0F172A]">
                      Pendapatan Penjualan Kasir
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold">
                      {formatRp(weekly.revenueRp)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold">
                      {formatRp(data.profitAndLoss.monthlyProjected.revenueRp)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 text-[#475569]">
                      (-) Harga Pokok Penjualan (HPP Batch FEFO)
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-[#475569]">
                      ({formatRp(weekly.cogsRp)})
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-[#475569]">
                      ({formatRp(data.profitAndLoss.monthlyProjected.cogsRp)})
                    </td>
                  </tr>
                  <tr className="bg-[#F8FAFC] font-bold">
                    <td className="py-2.5 px-3 text-[#0F172A]">
                      = Laba Kotor Operasional
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {formatRp(weekly.grossProfitRp)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {formatRp(
                        data.profitAndLoss.monthlyProjected.grossProfitRp
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 text-amber-800">
                      (-) Beban Listrik Freezer 24 Jam
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-amber-800">
                      ({formatRp(weekly.freezerElectricityExpenseRp)})
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-amber-800">
                      (
                      {formatRp(
                        data.profitAndLoss.monthlyProjected
                          .freezerElectricityExpenseRp
                      )}
                      )
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 text-red-700">
                      (-) Kerugian Write-Off Barang Kedaluwarsa
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-red-700">
                      ({formatRp(weekly.expiredWriteOffLossRp)})
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-red-700">
                      (
                      {formatRp(
                        data.profitAndLoss.monthlyProjected
                          .expiredWriteOffLossRp
                      )}
                      )
                    </td>
                  </tr>
                  <tr className="bg-[#EBF8F2] font-bold text-[#0F6352]">
                    <td className="py-3 px-3">= Laba Bersih Operasional</td>
                    <td className="py-3 px-3 text-right font-mono">
                      {formatRp(weekly.netOperatingIncomeRp)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono">
                      {formatRp(
                        data.profitAndLoss.monthlyProjected.netOperatingIncomeRp
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Full Append-Only Cash Ledger */}
            <div>
              <h4 className="font-bold text-[#0F172A] mb-2">
                Seluruh Riwayat Jurnal Kas Atomik ({data.ledgerEntries.length}{" "}
                baris)
              </h4>
              <div className="overflow-x-auto border border-[#E5E9EC] rounded-xl max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#F8FAFC] sticky top-0">
                    <tr className="border-b border-[#E5E9EC] text-[11px] text-[#64748B] uppercase">
                      <th className="py-2 px-3">Referensi</th>
                      <th className="py-2 px-3">Jenis</th>
                      <th className="py-2 px-3 text-right">Nominal</th>
                      <th className="py-2 px-3 text-right">Kas Kulakan</th>
                      <th className="py-2 px-3">Keterangan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {data.ledgerEntries.map((entry) => {
                      const meta = getLedgerBadgeAndSign(entry);
                      return (
                        <tr key={`full-${entry.id}`}>
                          <td className="py-2 px-3 font-mono font-semibold text-[#0F172A]">
                            {entry.referenceId || "-"}
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${meta.badgeClass}`}
                            >
                              {meta.badgeLabel}
                            </span>
                          </td>
                          <td
                            className={`py-2 px-3 text-right font-mono font-bold ${
                              meta.isPositive
                                ? "text-[#0F6352]"
                                : "text-[#E11D48]"
                            }`}
                          >
                            {meta.isPositive ? "+" : "-"}
                            {formatRp(Math.abs(meta.signedAmountRp))}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-semibold text-[#0F172A]">
                            {formatRp(entry.availableKulakanCashAfterRp)}
                          </td>
                          <td className="py-2 px-3 text-[#64748B]">
                            {entry.notes || "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-2 print:hidden">
              <button
                type="button"
                onClick={() => window.print()}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white font-semibold"
              >
                Cetak / Simpan PDF
              </button>
              <button
                type="button"
                onClick={() => setShowAuditModal(false)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#F1F5F9] font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Exported KUR Verification Package PDF Preview (Official Formal Laporan Laba Rugi Format) */}
      {kurDocModal &&
        (() => {
          const rWeekly = kurDocModal.report.profitAndLoss.weekly;
          const salesDiscRp = rWeekly.salesDiscountRp ?? 0;
          const grossSalesBeforeDiscRp = rWeekly.revenueRp + salesDiscRp;
          const opExpTotalRp =
            rWeekly.freezerElectricityExpenseRp + rWeekly.expiredWriteOffLossRp;
          const fallbackToday = kurDocModal.generatedAtIso.slice(0, 10);
          const periodStart = rWeekly.periodStartDate || fallbackToday;
          const periodEnd = rWeekly.periodEndDate || fallbackToday;

          return (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="kur-pdf-title"
              className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-3 sm:p-5 print:static print:inset-auto print:z-auto print:bg-white print:p-0 print:overflow-visible print:block print-modal-backdrop"
            >
              <style>{`@media print { @page { size: A4 portrait; margin: 16mm 14mm; } html, body { background: #ffffff !important; color: #111111 !important; } }`}</style>
              <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-[#E2E8F0] flex flex-col max-h-[92vh] overflow-hidden print:max-w-full print:w-full print:max-h-none print:overflow-visible print:shadow-none print:border-0 print:rounded-none print:block print-paper-sheet">
                {/* Screen-only Sticky Top Toolbar */}
                <div className="px-5 sm:px-7 py-3.5 border-b border-[#E5E9EC] bg-white flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 shrink-0 print:hidden">
                  <div className="min-w-0">
                    <div
                      title={kurDocModal.bankStandardLabel}
                      className="text-[11px] font-semibold text-[#0F6352] truncate"
                    >
                      Standar KUR Bank Aceh Syariah &amp; Penyalur KUR •{" "}
                      <span className="font-mono">{kurDocModal.documentNumber}</span>
                    </div>
                    <h2
                      id="kur-pdf-title"
                      className="text-[15px] font-bold text-[#0F172A] truncate mt-0.5"
                    >
                      Pratinjau Cetak Laporan Laba Rugi
                    </h2>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="min-h-[38px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white font-semibold text-xs whitespace-nowrap transition-colors"
                    >
                      Cetak / Simpan PDF
                    </button>
                    <button
                      type="button"
                      aria-label="Tutup pratinjau dokumen KUR"
                      onClick={() => setKurDocModal(null)}
                      className="min-h-[38px] px-4 py-2 rounded-xl bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#334155] font-semibold text-xs whitespace-nowrap transition-colors"
                    >
                      Tutup
                    </button>
                  </div>
                </div>

                {/* Scrollable Preview Canvas framing A4 Paper Sheet */}
                <div className="flex-1 overflow-y-auto bg-[#F4F6F8] p-3 sm:p-6 print:overflow-visible print:bg-white print:p-0">
                  {/* Printable Accounting Sheet matching ui_app/laporan_kur.png */}
                  <article
                    id="kur-printable-report"
                    style={{ fontFamily: "'Times New Roman', Georgia, serif" }}
                    className="bg-white text-[#111111] max-w-[740px] mx-auto rounded-lg border border-[#E2E8F0] shadow-xs px-5 py-6 sm:px-11 sm:py-8 print:max-w-full print:rounded-none print:border-0 print:shadow-none print:px-0 print:py-0"
                  >
                    {/* Centered Report Header */}
                    <div className="text-center space-y-0.5 leading-snug">
                      <h3 className="text-[15px] font-bold tracking-normal text-[#111111]">
                        Laporan Laba Rugi
                      </h3>
                      <div className="text-[14px] font-bold text-[#111111]">
                        {kurDocModal.report.store.name}
                      </div>
                      <div className="text-[13px] font-bold text-[#111111]">
                        Periode Laporan : {periodStart} Sampai {periodEnd}
                      </div>
                    </div>

                    {/* Column Header Divider */}
                    <div className="mt-5 pb-1.5 border-b-[1.5px] border-[#111111] font-bold text-[13px]">
                      Tipe Akun
                    </div>

                    {/* Pendapatan Section */}
                    <div className="mt-4 text-[13px]">
                      <div className="font-bold">Pendapatan</div>

                      <div className="pl-6 sm:pl-8 mt-2.5 flex items-baseline justify-between gap-4 font-bold">
                        <span>Pendapatan</span>
                        <span className="tabular-nums">
                          {formatAccountingId(rWeekly.revenueRp)}
                        </span>
                      </div>

                      <div className="pl-11 sm:pl-16 mt-2 space-y-1.5 text-[12.5px] font-bold">
                        <div className="flex items-baseline justify-between gap-4">
                          <span>Penjualan Umum - 4101</span>
                          <span className="tabular-nums">
                            {formatAccountingId(grossSalesBeforeDiscRp)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-4">
                          <span>Pendapatan Jasa - 4102</span>
                          <span className="tabular-nums">
                            {formatAccountingId(0)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-4">
                          <span>Penjualan Produk - 4103</span>
                          <span className="tabular-nums">
                            {formatAccountingId(0)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-4">
                          <span>Pendapatan Pengiriman - 4110</span>
                          <span className="tabular-nums">
                            {formatAccountingId(0)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-4">
                          <span>Diskon Penjualan - 4201</span>
                          <span className="tabular-nums">
                            {salesDiscRp > 0
                              ? `-${formatAccountingId(salesDiscRp)}`
                              : formatAccountingId(0)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-4">
                          <span>Retur Penjualan - 4301</span>
                          <span className="tabular-nums">
                            {formatAccountingId(0)}
                          </span>
                        </div>
                      </div>

                      <div className="pl-6 sm:pl-8 mt-3 flex items-baseline justify-between gap-4 font-bold">
                        <span>Total Pendapatan</span>
                        <span className="tabular-nums">
                          {formatAccountingId(rWeekly.revenueRp)}
                        </span>
                      </div>
                    </div>

                    {/* Beban Pokok Section */}
                    <div className="mt-5 text-[13px]">
                      <div className="font-bold">Beban Pokok</div>

                      <div className="pl-6 sm:pl-8 mt-2.5 flex items-baseline justify-between gap-4 font-bold">
                        <span>Harga Pokok Penjualan</span>
                        <span className="tabular-nums">
                          {formatAccountingId(rWeekly.cogsRp)}
                        </span>
                      </div>

                      <div className="pl-11 sm:pl-16 mt-2 space-y-1.5 text-[12.5px] font-bold">
                        <div className="flex items-baseline justify-between gap-4">
                          <span>Harga Pokok Penjualan - 5101</span>
                          <span className="tabular-nums">
                            {formatAccountingId(rWeekly.cogsRp)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-4">
                          <span>Beban Pengiriman - 5102</span>
                          <span className="tabular-nums">
                            {formatAccountingId(0)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-4">
                          <span>Beban Pembelian - 5103</span>
                          <span className="tabular-nums">
                            {formatAccountingId(0)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-4">
                          <span>Diskon Pembelian - 5201</span>
                          <span className="tabular-nums">
                            {formatAccountingId(0)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-4">
                          <span>Retur Pembelian - 5301</span>
                          <span className="tabular-nums">
                            {formatAccountingId(0)}
                          </span>
                        </div>
                      </div>

                      <div className="pl-6 sm:pl-8 mt-3 flex items-baseline justify-between gap-4 font-bold">
                        <span>Total Beban Pokok</span>
                        <span className="tabular-nums">
                          {formatAccountingId(rWeekly.cogsRp)}
                        </span>
                      </div>
                    </div>

                    {/* Laba Kotor */}
                    <div className="pl-6 sm:pl-8 mt-5 flex items-baseline justify-between gap-4 font-bold text-[13px]">
                      <span>Laba Kotor</span>
                      <span className="tabular-nums">
                        {formatAccountingId(rWeekly.grossProfitRp)}
                      </span>
                    </div>

                    {/* Beban Operasional & Laba Bersih Operasional */}
                    <div className="mt-5 text-[13px]">
                      <div className="font-bold">Beban Operasional</div>

                      <div className="pl-6 sm:pl-8 mt-2.5 flex items-baseline justify-between gap-4 font-bold">
                        <span>Beban Penyimpanan Dingin &amp; Operasional</span>
                        <span className="tabular-nums">
                          {formatAccountingId(opExpTotalRp)}
                        </span>
                      </div>

                      <div className="pl-11 sm:pl-16 mt-2 space-y-1.5 text-[12.5px] font-bold">
                        <div className="flex items-baseline justify-between gap-4">
                          <span>Beban Listrik Freezer 24 Jam - 6101</span>
                          <span className="tabular-nums">
                            {formatAccountingId(rWeekly.freezerElectricityExpenseRp)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-4">
                          <span>Beban Kerugian Write-Off Expired - 6201</span>
                          <span className="tabular-nums">
                            {formatAccountingId(rWeekly.expiredWriteOffLossRp)}
                          </span>
                        </div>
                      </div>

                      <div className="pl-6 sm:pl-8 mt-3 flex items-baseline justify-between gap-4 font-bold">
                        <span>Total Beban Operasional</span>
                        <span className="tabular-nums">
                          {formatAccountingId(opExpTotalRp)}
                        </span>
                      </div>
                    </div>

                    {/* Laba Bersih Operasional */}
                    <div className="ml-6 sm:ml-8 mt-4 pt-2 border-t-[1.5px] border-[#111111] flex items-baseline justify-between gap-4 font-bold text-[13.5px]">
                      <span>Laba Bersih Operasional</span>
                      <span className="tabular-nums">
                        {formatAccountingId(rWeekly.netOperatingIncomeRp)}
                      </span>
                    </div>

                  {/* Formal KUR Verification & PO Appendix */}
                  <div className="mt-8 pt-4 border-t border-[#94A3B8] space-y-3 text-[11px] print:break-inside-avoid">
                    <div className="font-bold text-[12px]">
                      Lampiran Verifikasi Kelayakan KUR Bank ({kurDocModal.documentNumber})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 print:grid-cols-3 gap-2 border border-[#CBD5E1] p-2.5">
                      <div>
                        <div>Kas Siap Kulakan Terverifikasi:</div>
                        <div className="font-bold">
                          {formatRp(
                            kurDocModal.report.balances.availableKulakanCashRp
                          )}
                        </div>
                      </div>
                      <div>
                        <div>Proyeksi Laba Bersih 30 Hari:</div>
                        <div className="font-bold">
                          {formatRp(
                            kurDocModal.report.profitAndLoss.monthlyProjected
                              .netOperatingIncomeRp
                          )}
                        </div>
                      </div>
                      <div>
                        <div>Skor Kelayakan KUR:</div>
                        <div className="font-bold">
                          {kurDocModal.report.kurReadiness.eligibilityScore}/100 (
                          {kurDocModal.report.kurReadiness.eligibilityStatus})
                        </div>
                      </div>
                    </div>

                    {kurDocModal.report.verifiedPurchaseOrders.length > 0 && (
                      <div className="border border-[#CBD5E1]">
                        <table className="w-full text-left text-[11px] border-collapse">
                          <thead>
                            <tr className="border-b border-[#CBD5E1] font-bold">
                              <th className="py-1.5 px-2.5">No. PO</th>
                              <th className="py-1.5 px-2.5">Distributor</th>
                              <th className="py-1.5 px-2.5">Item &amp; Kuantitas</th>
                              <th className="py-1.5 px-2.5 text-right">
                                Nominal
                              </th>
                              <th className="py-1.5 px-2.5">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E2E8F0]">
                            {kurDocModal.report.verifiedPurchaseOrders.map((po) => (
                              <tr key={po.poNumber}>
                                <td className="py-1.5 px-2.5 font-bold">
                                  {po.poNumber}
                                </td>
                                <td className="py-1.5 px-2.5">
                                  {po.supplierName}
                                </td>
                                <td className="py-1.5 px-2.5">
                                  {po.orderQtyBoxes} Dus {po.productName}
                                </td>
                                <td className="py-1.5 px-2.5 text-right font-bold tabular-nums">
                                  {formatAccountingId(po.totalAmountRp)}
                                </td>
                                <td className="py-1.5 px-2.5">{po.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="text-[10px] text-[#475569] flex flex-wrap justify-between gap-2 pt-1">
                      <span>
                        Cabang: {kurDocModal.report.store.branchName} • Hash
                        Integritas: {kurDocModal.integrityHash}
                      </span>
                      <span>
                        Dicetak otomatis oleh Sistem Akuntansi Manajerku
                      </span>
                    </div>
                  </div>
                </article>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
