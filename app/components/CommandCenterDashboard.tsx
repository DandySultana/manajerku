"use client";

import React, { useState, useEffect, useCallback } from "react";

interface CommandCenterSummary {
  store: {
    id: string;
    name: string;
    branchName: string;
    address: string;
    coldChainCode: string;
    lastRecordedTempC: number;
    coldChainStatus: "STABLE" | "WARNING_HIGH_TEMP";
    coldChainStatusLabel: string;
    dailyFreezerElecCost: number;
    subscriptionTier: "FREEMIUM_STARTER" | "MANAJERKU_PRO";
    activeSkuCount: number;
    maxSkuQuota: number | null;
  };
  viewerRole: "OWNER" | "CASHIER" | "ADMIN";
  permissions: {
    canViewCommandCenterFull: boolean;
    canViewFinancials: boolean;
    canOperatePos: boolean;
    canManageInventory: boolean;
    canApproveRfq: boolean;
    canApprovePo: boolean;
    canSubmitOcrPhoto: boolean;
    canBroadcastPromo: boolean;
    canExportKurPdf: boolean;
    canManageUsers: boolean;
  };
  selectedDate: string;
  kpis: {
    kasSiapKulakan: {
      amountRp: number | null;
      lockedPoCashRp: number | null;
      plafonStatus: string;
      weeklyGrowthPct: string;
    };
    omzetHarian: {
      amountRp: number;
      invoiceCount: number;
      netProfitRp: number | null;
    };
    radarStokFefo: {
      criticalSkuCount: number;
      closestExpiryBatchCount: number;
      closestExpiryDays: number;
    };
    efisiensiPengadaanAi: {
      marginImprovementLabel: string;
      verifiedSupplierCount: number;
    };
  };
  chart7Days: {
    days: Array<{
      date: string;
      dayLabel: string;
      omzetKasirRp: number;
      belanjaKulakanPoRp: number;
    }>;
    coverageRatio: number;
    coverageHealthy: boolean;
    coverageLabel: string;
    dailyFreezerElecCostRp: number;
  };
  aiAndFefoHealth: {
    batchSummary: {
      totalActiveBatches: number;
      safeBatches: number;
      priorityFefoBatches: number;
      criticalBatches: number;
      summaryText: string;
    };
    activities: Array<{
      id: string;
      title: string;
      subtitle: string;
      badgeRight?: string;
      statusLabel: string;
      statusType: "SUCCESS" | "ACTIVE" | "WARNING" | "READY";
    }>;
  };
}

interface UnifiedTxItem {
  id: string;
  recordType: "PO" | "POS";
  referenceCode: string;
  timeLabelWib: string;
  partnerName: string;
  partnerSubLabel: string;
  itemsSummary: string;
  itemsSubLabel: string;
  totalAmountRp: number;
  statusBadge: string;
  statusVariant: "SUCCESS" | "INFO" | "WARNING";
  actionLabel: "Lihat PO" | "Cetak Struk";
  createdAt: string;
}

interface StoreUserItem {
  id: string;
  storeId: string;
  fullName: string;
  phoneWhatsapp: string;
  role: "OWNER" | "CASHIER" | "ADMIN";
  isActive: boolean;
}

export function formatRp(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Tersembunyi (Akses Kasir)";
  return "Rp " + Math.round(value).toLocaleString("id-ID");
}

export default function CommandCenterDashboard({
  activeStoreId,
  activeRole,
  onNavigateTab,
  onStoreChanged,
}: {
  activeStoreId: string;
  activeRole: "OWNER" | "CASHIER" | "ADMIN";
  onNavigateTab: (tab: string) => void;
  onStoreChanged: (newStoreId: string) => void;
}) {
  const [summary, setSummary] = useState<CommandCenterSummary | null>(null);
  const [transactions, setTransactions] = useState<UnifiedTxItem[]>([]);
  const [txFilter, setTxFilter] = useState<"ALL" | "PO" | "POS">("ALL");
  const [txSearch, setTxSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modals for PRD-01 interactions
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [showTempModal, setShowTempModal] = useState(false);
  const [selectedTxModal, setSelectedTxModal] = useState<UnifiedTxItem | null>(
    null
  );

  // Temperature Update Form
  const [tempInput, setTempInput] = useState("-18.4");
  const [tempFeedback, setTempFeedback] = useState<string | null>(null);

  // Access & Whitelist Form
  const [storeUsers, setStoreUsers] = useState<StoreUserItem[]>([]);
  const [newUserName, setNewUserName] = useState("");
  const [newUserPhone, setNewUserPhone] = useState("");
  const [newUserRole, setNewUserRole] = useState<"CASHIER" | "OWNER">("CASHIER");
  const [userActionMsg, setUserActionMsg] = useState<string | null>(null);

  // Onboarding 5-Minute Wizard Form
  const [onboardStoreName, setOnboardStoreName] = useState("");
  const [onboardBranch, setOnboardBranch] = useState("Cabang Utama");
  const [onboardAddress, setOnboardAddress] = useState(
    "Jl. Teuku Umar, Banda Aceh"
  );
  const [onboardOwnerName, setOnboardOwnerName] = useState("");
  const [onboardOwnerPhone, setOnboardOwnerPhone] = useState("");
  const [onboardInitialCash, setOnboardInitialCash] = useState("10000000");
  const [onboardElecCost, setOnboardElecCost] = useState("45000");
  const [onboardCashierName, setOnboardCashierName] = useState("");
  const [onboardCashierPhone, setOnboardCashierPhone] = useState("");
  const [requestedOtp, setRequestedOtp] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState("");
  const [onboardStatusMsg, setOnboardStatusMsg] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async () => {
    try {
      setErrorMsg(null);
      const [sumRes, txRes] = await Promise.all([
        fetch(
          `/api/v1/dashboard/summary?storeId=${encodeURIComponent(
            activeStoreId
          )}&role=${activeRole}`
        ),
        fetch(
          `/api/v1/dashboard/transactions?storeId=${encodeURIComponent(
            activeStoreId
          )}&type=${txFilter}&search=${encodeURIComponent(txSearch)}`
        ),
      ]);

      const sumJson = await sumRes.json();
      const txJson = await txRes.json();

      if (!sumJson.success) {
        throw new Error(sumJson.error?.message || "Gagal memuat ringkasan.");
      }
      setSummary(sumJson.data);
      setTempInput(String(sumJson.data.store.lastRecordedTempC));

      if (txJson.success) {
        setTransactions(txJson.data.items);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Koneksi terputus — mencoba menghubungkan ulang."
      );
    } finally {
      setLoading(false);
    }
  }, [activeStoreId, activeRole, txFilter, txSearch]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const loadStoreUsers = async () => {
    const res = await fetch(
      `/api/v1/users?storeId=${encodeURIComponent(activeStoreId)}`
    );
    const json = await res.json();
    if (json.success) {
      setStoreUsers(json.data);
    }
  };

  const handleUpdateTemp = async (e: React.FormEvent) => {
    e.preventDefault();
    setTempFeedback(null);
    const res = await fetch("/api/v1/stores/cold-chain-temp", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        temperatureC: Number(tempInput),
      }),
    });
    const json = await res.json();
    if (json.success) {
      setTempFeedback(`Berhasil diperbarui: ${json.data.statusLabel}`);
      await fetchDashboardData();
      setTimeout(() => setShowTempModal(false), 900);
    } else {
      setTempFeedback(json.error?.message || "Gagal memperbarui suhu.");
    }
  };

  const handleToggleSubscription = async (
    targetTier: "FREEMIUM_STARTER" | "MANAJERKU_PRO"
  ) => {
    setUserActionMsg(null);
    const res = await fetch("/api/v1/stores/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        actorRole: activeRole,
        targetTier,
      }),
    });
    const json = await res.json();
    if (json.success) {
      setUserActionMsg(
        `Paket toko berhasil diubah ke ${
          targetTier === "MANAJERKU_PRO"
            ? "Manajerku Pro (Rp49.000/bulan)"
            : "Freemium Starter (Rp0/bulan)"
        }`
      );
      await fetchDashboardData();
    } else {
      setUserActionMsg(json.error?.message || "Gagal mengubah paket.");
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserActionMsg(null);
    const res = await fetch("/api/v1/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        actorRole: activeRole,
        fullName: newUserName,
        phoneWhatsapp: newUserPhone,
        role: newUserRole,
      }),
    });
    const json = await res.json();
    if (json.success) {
      setNewUserName("");
      setNewUserPhone("");
      setUserActionMsg(
        `Berhasil menambahkan ${json.data.fullName} (${json.data.phoneWhatsapp}) ke Whitelist WhatsApp!`
      );
      await loadStoreUsers();
    } else {
      setUserActionMsg(json.error?.message || "Gagal menambah pengguna.");
    }
  };

  const handleRequestOtp = async () => {
    setOnboardStatusMsg(null);
    const res = await fetch("/api/v1/onboarding/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneWhatsapp: onboardOwnerPhone }),
    });
    const json = await res.json();
    if (json.success) {
      setRequestedOtp(json.data.otpCode);
      setOtpInput(json.data.otpCode);
      setOnboardStatusMsg(
        `OTP Terkirim ke WhatsApp ${json.data.normalizedPhone}! (Kode Simulasi: ${json.data.otpCode})`
      );
    } else {
      setOnboardStatusMsg(json.error?.message || "Gagal meminta OTP.");
    }
  };

  const handleCompleteOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    setOnboardStatusMsg(null);
    const res = await fetch("/api/v1/onboarding/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeName: onboardStoreName,
        branchName: onboardBranch,
        address: onboardAddress,
        initialKulakanCash: Number(onboardInitialCash),
        dailyFreezerElecCost: Number(onboardElecCost),
        ownerName: onboardOwnerName,
        ownerPhone: onboardOwnerPhone,
        otpCode: otpInput,
        cashierName: onboardCashierName || undefined,
        cashierPhone: onboardCashierPhone || undefined,
      }),
    });
    const json = await res.json();
    if (json.success) {
      setShowOnboardingModal(false);
      onStoreChanged(json.data.storeId);
    } else {
      setOnboardStatusMsg(json.error?.message || "Gagal menyelesaikan onboarding.");
    }
  };

  if (loading && !summary) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="h-12 bg-slate-200 rounded-xl w-1/2" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-28 bg-slate-200 rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 h-72 bg-slate-200 rounded-2xl" />
          <div className="lg:col-span-5 h-72 bg-slate-200 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 font-medium">
          {errorMsg || "Data tidak ditemukan."}
        </p>
        <button
          onClick={fetchDashboardData}
          className="mt-4 px-4 py-2 bg-emerald-700 text-white rounded-lg text-sm font-medium"
        >
          Coba Muat Ulang
        </button>
      </div>
    );
  }

  const maxChartVal = Math.max(
    4000000,
    ...summary.chart7Days.days.map((d) =>
      Math.max(d.omzetKasirRp, d.belanjaKulakanPoRp)
    )
  );

  return (
    <div className="space-y-6">
      {/* Top Sub-Header matching Page 1 & Page 8 Mockups */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Ringkasan Operasional & Rantai Pasok
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                summary.store.subscriptionTier === "MANAJERKU_PRO"
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                  : "bg-amber-100 text-amber-800 border border-amber-300"
              }`}
            >
              {summary.store.subscriptionTier === "MANAJERKU_PRO"
                ? "★ Manajerku Pro (Unlimited SKU & AI)"
                : `Freemium Starter (${summary.store.activeSkuCount}/30 SKU)`}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {summary.store.branchName} • {summary.store.coldChainCode} •{" "}
            <button
              onClick={() => setShowTempModal(true)}
              className={`font-semibold underline decoration-dotted cursor-pointer ${
                summary.store.coldChainStatus === "STABLE"
                  ? "text-emerald-700"
                  : "text-red-600"
              }`}
              title="Klik untuk perbarui log suhu freezer"
            >
              {summary.store.coldChainStatusLabel}
            </button>{" "}
            • Pemantauan kas siap kulakan, stok FEFO freezer & negosiasi supplier
            otomatis
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => {
              loadStoreUsers();
              setShowAccessModal(true);
            }}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition cursor-pointer"
          >
            Role & Paket ({summary.viewerRole})
          </button>

          <button
            onClick={() => setShowOnboardingModal(true)}
            className="px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 transition cursor-pointer"
          >
            + Onboarding Toko Baru (5 Menit)
          </button>

          <div className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700">
            16 Nov 2026
          </div>

          <button
            onClick={() => onNavigateTab("pos")}
            className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold shadow-xs transition cursor-pointer"
          >
            + Transaksi Kasir
          </button>
        </div>
      </div>

      {/* Role Notice Banner if viewing as CASHIER (US-102 Scenario 2) */}
      {summary.viewerRole === "CASHIER" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between text-xs text-amber-900">
          <span>
            <strong>Mode Staf Kasir Aktif:</strong> Sesuai aturan keamanan RBAC
            (`FR-102`), saldo <em>Kas Siap Kulakan</em>, <em>Laba Bersih</em>,
            dan tombol persetujuan PO disembunyikan untuk peran Kasir.
          </span>
          <button
            onClick={() => onNavigateTab("pos")}
            className="px-3 py-1 bg-amber-800 text-white rounded-lg font-semibold cursor-pointer"
          >
            Buka Layar Kasir POS →
          </button>
        </div>
      )}

      {/* 4 KPI Cards Row (Exact Match with Page 1 & Page 8 Mockups) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Kas Siap Kulakan (Green Primary Card) */}
        <div className="rounded-2xl bg-gradient-to-br from-emerald-700 to-teal-800 text-white p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-emerald-100">
              Kas Siap Kulakan
            </span>
            <span className="text-[11px] font-semibold bg-emerald-600/80 px-2 py-0.5 rounded-full border border-emerald-400/30">
              {summary.kpis.kasSiapKulakan.weeklyGrowthPct}
            </span>
          </div>
          <div className="my-2">
            <div className="text-2xl font-extrabold tracking-tight">
              {summary.kpis.kasSiapKulakan.amountRp !== null
                ? formatRp(summary.kpis.kasSiapKulakan.amountRp)
                : "Rp ••••••••"}
            </div>
          </div>
          <div className="text-[11px] text-emerald-100 flex items-center justify-between">
            <span>
              {summary.kpis.kasSiapKulakan.plafonStatus} •{" "}
              {summary.kpis.kasSiapKulakan.weeklyGrowthPct} minggu ini
            </span>
          </div>
        </div>

        {/* KPI 2: Omzet Harian */}
        <div className="rounded-2xl bg-white border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between">
          <div className="text-xs font-medium text-slate-500">Omzet Harian</div>
          <div className="my-2">
            <div className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {formatRp(summary.kpis.omzetHarian.amountRp)}
            </div>
          </div>
          <div className="text-[11px] text-slate-600 font-medium">
            {summary.kpis.omzetHarian.invoiceCount} Nota (Ecer & Dus) •{" "}
            <span className="text-emerald-700 font-semibold">
              {summary.kpis.omzetHarian.netProfitRp !== null
                ? `Laba Rp ${(
                    summary.kpis.omzetHarian.netProfitRp / 1000
                  ).toFixed(0)}rb`
                : "Laba Tersembunyi"}
            </span>
          </div>
        </div>

        {/* KPI 3: Radar Stok & FEFO */}
        <div
          onClick={() => onNavigateTab("inventory")}
          className="rounded-2xl bg-white border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between hover:border-amber-300 transition cursor-pointer"
        >
          <div className="text-xs font-medium text-slate-500">
            Radar Stok & FEFO
          </div>
          <div className="my-2">
            <div className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {summary.kpis.radarStokFefo.criticalSkuCount} SKU Kritis
            </div>
          </div>
          <div className="text-[11px] font-semibold text-amber-700 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
            <span>
              {summary.kpis.radarStokFefo.closestExpiryBatchCount} Batch Exp{" "}
              {summary.kpis.radarStokFefo.closestExpiryDays} Hr
            </span>
          </div>
        </div>

        {/* KPI 4: Efisiensi Pengadaan AI */}
        <div
          onClick={() => onNavigateTab("suppliers")}
          className="rounded-2xl bg-white border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between hover:border-emerald-300 transition cursor-pointer"
        >
          <div className="text-xs font-medium text-slate-500">
            Efisiensi Pengadaan AI
          </div>
          <div className="my-2">
            <div className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {summary.kpis.efisiensiPengadaanAi.marginImprovementLabel}
            </div>
          </div>
          <div className="text-[11px] font-semibold text-emerald-700">
            ✓ {summary.kpis.efisiensiPengadaanAi.verifiedSupplierCount} Supplier
            Terverifikasi
          </div>
        </div>
      </div>

      {/* Middle Section: 7-Day Chart (Left 7 cols) + AI Activity & FEFO Status (Right 5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Panel: Tren Omzet Kasir vs Belanja Kulakan (7 Hari) */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Tren Omzet Kasir vs Belanja Kulakan (7 Hari)
              </h2>
              <p className="text-[11px] text-slate-500">
                Monitoring keseimbangan kas masuk & restock PO otomatis
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-emerald-700 inline-block" />
                Omzet
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-slate-300 inline-block" />
                Kulakan PO
              </span>
            </div>
          </div>

          {/* 7-Day Grouped Bar Chart */}
          <div className="h-48 flex items-end justify-between gap-3 pt-4 px-2 border-b border-slate-100">
            {summary.chart7Days.days.map((d) => {
              const omzetHeightPct = Math.max(
                8,
                Math.round((d.omzetKasirRp / maxChartVal) * 100)
              );
              const poHeightPct = Math.max(
                6,
                Math.round((d.belanjaKulakanPoRp / maxChartVal) * 100)
              );
              const isToday = d.dayLabel === "Min";
              return (
                <div
                  key={d.date}
                  className="flex-1 flex flex-col items-center gap-2 h-full justify-end group"
                >
                  <div className="w-full flex items-end justify-center gap-1.5 h-36">
                    <div
                      style={{ height: `${omzetHeightPct}%` }}
                      title={`Omzet ${d.dayLabel}: ${formatRp(d.omzetKasirRp)}`}
                      className="w-3.5 sm:w-4 bg-emerald-700 group-hover:bg-emerald-600 rounded-t-md transition-all"
                    />
                    <div
                      style={{ height: `${poHeightPct}%` }}
                      title={`Kulakan PO ${d.dayLabel}: ${formatRp(
                        d.belanjaKulakanPoRp
                      )}`}
                      className="w-3.5 sm:w-4 bg-slate-300 group-hover:bg-slate-400 rounded-t-md transition-all"
                    />
                  </div>
                  <span
                    className={`text-[11px] ${
                      isToday
                        ? "font-bold text-slate-900"
                        : "font-medium text-slate-500"
                    }`}
                  >
                    {d.dayLabel}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3.5 py-2.5 rounded-xl border border-slate-200/60 text-xs text-slate-700">
            <span className="font-medium">
              {summary.chart7Days.coverageLabel}
            </span>
            <span className="text-[11px] font-semibold text-slate-500">
              Alokasi Listrik Beku:{" "}
              {formatRp(summary.chart7Days.dailyFreezerElecCostRp)}/hari
            </span>
          </div>
        </div>

        {/* Right Panel: Aktivitas Agen AI & Status FEFO */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-900">
                Aktivitas Agen AI & Status FEFO
              </h2>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                Online 24/7
              </span>
            </div>

            {/* Batch Summary Pill */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 mb-4">
              <div className="text-xs font-bold text-slate-800 text-center">
                {summary.aiAndFefoHealth.batchSummary.summaryText}
              </div>
              <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden flex mt-2">
                <div
                  style={{ width: "87%" }}
                  className="bg-emerald-600 h-full"
                  title="21 Batch Aman"
                />
                <div
                  style={{ width: "5%" }}
                  className="bg-amber-400 h-full"
                  title="1 Batch Prioritas FEFO"
                />
                <div
                  style={{ width: "8%" }}
                  className="bg-red-500 h-full"
                  title="2 Batch Kritis"
                />
              </div>
            </div>

            {/* AI Activities List */}
            <div className="space-y-2.5">
              {summary.aiAndFefoHealth.activities.map((act) => (
                <div
                  key={act.id}
                  onClick={() => {
                    if (act.id === "act-discovery") onNavigateTab("suppliers");
                    if (act.id === "act-rfq" || act.id === "act-ocr")
                      onNavigateTab("whatsapp");
                    if (act.id === "act-promo") onNavigateTab("promo");
                  }}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 hover:border-emerald-200 hover:bg-slate-50/70 transition cursor-pointer"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          act.statusType === "SUCCESS"
                            ? "bg-emerald-600"
                            : act.statusType === "WARNING"
                            ? "bg-amber-500"
                            : "bg-teal-600"
                        }`}
                      />
                      {act.title}
                    </div>
                    <div className="text-[11px] text-slate-500 pl-3">
                      {act.subtitle}
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg shrink-0">
                    {act.badgeRight || act.statusLabel}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Model: Google Gemini 2.5 Flash (JSON & Vision)</span>
            <button
              onClick={() => onNavigateTab("whatsapp")}
              className="text-emerald-700 font-semibold hover:underline cursor-pointer"
            >
              Buka Simulasi WA Agent →
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Unified Sync Table: Sinkronisasi Kasir & Purchase Order (PO) Otomatis Terkini */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Sinkronisasi Kasir & Purchase Order (PO) Otomatis Terkini
            </h2>
            <p className="text-[11px] text-slate-500">
              Penyelarasan pesanan masuk kasir POS dan restock rantai dingin
              otomatis dalam satu basis data atomik
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filter Tabs */}
            <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
              {(
                [
                  ["ALL", "Semua"],
                  ["PO", "PO Otomatis"],
                  ["POS", "Penjualan Kasir"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTxFilter(key)}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                    txFilter === key
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <input
              type="text"
              value={txSearch}
              onChange={(e) => setTxSearch(e.target.value)}
              placeholder="Cari PO / Mitra..."
              className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-emerald-600"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-3">Referensi</th>
                <th className="py-3 px-3">Mitra / Pelanggan</th>
                <th className="py-3 px-3">Rincian Transaksi</th>
                <th className="py-3 px-3">Nominal</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {transactions.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-8 text-center text-slate-400 font-medium"
                  >
                    Tidak ada transaksi yang cocok dengan filter pencarian.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr
                    key={`${tx.recordType}-${tx.id}`}
                    className="hover:bg-slate-50/80 transition"
                  >
                    <td className="py-3.5 px-3">
                      <div className="font-bold text-slate-900">
                        {tx.referenceCode}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {tx.timeLabelWib}
                      </div>
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="font-semibold text-slate-800">
                        {tx.partnerName}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {tx.partnerSubLabel}
                      </div>
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="font-medium text-slate-800">
                        {tx.itemsSummary}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {tx.itemsSubLabel}
                      </div>
                    </td>
                    <td className="py-3.5 px-3 font-bold text-slate-900">
                      {formatRp(tx.totalAmountRp)}
                    </td>
                    <td className="py-3.5 px-3">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                        {tx.statusBadge}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 text-right">
                      <button
                        onClick={() => setSelectedTxModal(tx)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition cursor-pointer"
                      >
                        {tx.actionLabel}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Sync Indicator */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Terakhir disinkronkan: 1 menit yang lalu via Cold-Chain Agent
          </span>
          <span>Mode Gateway: Latensi 24ms • PostgreSQL ACID Sync 100%</span>
        </div>
      </div>

      {/* Modal 1: Lihat PO / Cetak Struk Preview */}
      {selectedTxModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[11px] font-bold uppercase text-emerald-700">
                  {selectedTxModal.recordType === "PO"
                    ? "Dokumen Purchase Order Resmi"
                    : "Struk Transaksi Kasir POS"}
                </span>
                <h3 className="text-lg font-bold text-slate-900">
                  {selectedTxModal.referenceCode}
                </h3>
              </div>
              <button
                onClick={() => setSelectedTxModal(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-xs text-slate-700 border border-slate-200/70">
              <div className="flex justify-between">
                <span className="text-slate-500">Mitra / Pelanggan:</span>
                <span className="font-bold">{selectedTxModal.partnerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Kategori:</span>
                <span>{selectedTxModal.partnerSubLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Rincian Item:</span>
                <span className="font-semibold">
                  {selectedTxModal.itemsSummary}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Keterangan Batch/Layanan:</span>
                <span>{selectedTxModal.itemsSubLabel}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-200 text-sm font-bold text-slate-900">
                <span>Total Nominal:</span>
                <span>{formatRp(selectedTxModal.totalAmountRp)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Status Sinkronisasi:</span>
                <span className="font-semibold text-emerald-700">
                  ✓ {selectedTxModal.statusBadge}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-emerald-700 text-white rounded-xl text-xs font-semibold hover:bg-emerald-800 cursor-pointer"
              >
                {selectedTxModal.actionLabel} (PDF / Termal)
              </button>
              <button
                onClick={() => setSelectedTxModal(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-200 cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Cold-Chain Freezer Temperature Log (FR-108) */}
      {showTempModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleUpdateTemp}
            className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Catat Suhu {summary.store.coldChainCode}
              </h3>
              <button
                type="button"
                onClick={() => setShowTempModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Suhu standar penyimpanan beku adalah ≤ -15.0°C (optimal -18.4°C).
              Jika suhu naik di atas -15.0°C, sistem memicu peringatan rantai
              dingin.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Suhu Chiller / Chest Freezer (°C)
              </label>
              <input
                type="number"
                step="0.1"
                value={tempInput}
                onChange={(e) => setTempInput(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-bold"
              />
            </div>
            {tempFeedback && (
              <div className="text-xs font-semibold text-emerald-700 bg-emerald-50 p-2.5 rounded-lg">
                {tempFeedback}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowTempModal(false)}
                className="px-3 py-2 rounded-xl bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
              >
                Simpan Suhu
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal 3: Role Whitelist & Subscription Tier Manager (FR-102 & FR-107) */}
      {showAccessModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-xl border border-slate-200 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Manajemen Paket SaaS & Whitelist Nomor WhatsApp
                </h3>
                <p className="text-xs text-slate-500">
                  Konfigurasi Paket Langganan (`FR-107`) & Akses Role Nomor
                  Telepon (`FR-102`)
                </p>
              </div>
              <button
                onClick={() => setShowAccessModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Subscription Tier Switcher */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    Paket Aktif:{" "}
                    {summary.store.subscriptionTier === "MANAJERKU_PRO"
                      ? "Manajerku Pro (Rp49.000/bulan)"
                      : "Freemium Starter (Rp0/bulan)"}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Freemium: Maks. 30 SKU Batch FEFO • Pro: Unlimited SKU + AI
                    Discovery, Auto-RFQ WA, Vision OCR, Promo Reseller & PDF KUR
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleToggleSubscription("FREEMIUM_STARTER")}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold border cursor-pointer ${
                    summary.store.subscriptionTier === "FREEMIUM_STARTER"
                      ? "bg-amber-600 text-white border-amber-600"
                      : "bg-white text-slate-700 border-slate-300"
                  }`}
                >
                  Paket Freemium Starter (Rp0)
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleSubscription("MANAJERKU_PRO")}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold border cursor-pointer ${
                    summary.store.subscriptionTier === "MANAJERKU_PRO"
                      ? "bg-emerald-700 text-white border-emerald-700"
                      : "bg-white text-slate-700 border-slate-300"
                  }`}
                >
                  ★ Paket Manajerku Pro (Rp49.000/bln)
                </button>
              </div>
            </div>

            {/* Registered WhatsApp Users Table */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-800">
                Daftar Pengguna & Nomor WhatsApp Terotorisasi
              </h4>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] font-bold text-slate-500">
                    <tr>
                      <th className="py-2 px-3">Nama</th>
                      <th className="py-2 px-3">Nomor WhatsApp</th>
                      <th className="py-2 px-3">Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {storeUsers.map((u) => (
                      <tr key={u.id}>
                        <td className="py-2 px-3 font-medium text-slate-800">
                          {u.fullName}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-600">
                          {u.phoneWhatsapp}
                        </td>
                        <td className="py-2 px-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                            {u.role}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Add New User Form */}
            <form onSubmit={handleAddUser} className="space-y-3 pt-2 border-t border-slate-100">
              <div className="text-xs font-bold text-slate-800">
                Tambah Staf Kasir / Owner ke Whitelist WhatsApp
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="Nama Lengkap"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  required
                />
                <input
                  type="text"
                  placeholder="No. WA (08xx / +628xx)"
                  value={newUserPhone}
                  onChange={(e) => setNewUserPhone(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  required
                />
                <select
                  value={newUserRole}
                  onChange={(e) =>
                    setNewUserRole(e.target.value as "CASHIER" | "OWNER")
                  }
                  className="px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white"
                >
                  <option value="CASHIER">CASHIER (Kasir & OCR)</option>
                  <option value="OWNER">OWNER (Akses Penuh & ACC PO)</option>
                </select>
              </div>
              {userActionMsg && (
                <div className="text-xs font-semibold text-emerald-800 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
                  {userActionMsg}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAccessModal(false)}
                  className="px-3 py-2 rounded-xl bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Tutup
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                >
                  + Tambah ke Whitelist
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 4: Self-Service 5-Minute Onboarding Wizard (FR-101) */}
      {showOnboardingModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleCompleteOnboarding}
            className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[11px] font-bold uppercase text-emerald-700">
                  Onboarding Mandiri 5 Menit (FR-101)
                </span>
                <h3 className="text-base font-bold text-slate-900">
                  Siapkan Toko Frozen Food & Asisten WhatsApp
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowOnboardingModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Toko UMKM *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Mis: Agen Beku Krueng Raya"
                  value={onboardStoreName}
                  onChange={(e) => setOnboardStoreName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Cabang
                </label>
                <input
                  type="text"
                  value={onboardBranch}
                  onChange={(e) => setOnboardBranch(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  Alamat Toko (Acuan Radius ≤ 10 km Google Places API)
                </label>
                <input
                  type="text"
                  value={onboardAddress}
                  onChange={(e) => setOnboardAddress(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Saldo Awal Kas Siap Kulakan (Rp) *
                </label>
                <input
                  type="number"
                  required
                  value={onboardInitialCash}
                  onChange={(e) => setOnboardInitialCash(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Beban Listrik Freezer 24 Jam (Rp/Hari) *
                </label>
                <input
                  type="number"
                  required
                  value={onboardElecCost}
                  onChange={(e) => setOnboardElecCost(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Pemilik Toko (Owner) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Nama Lengkap Owner"
                  value={onboardOwnerName}
                  onChange={(e) => setOnboardOwnerName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nomor WhatsApp Owner *
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    required
                    placeholder="0812xxxxxxxx"
                    value={onboardOwnerPhone}
                    onChange={(e) => setOnboardOwnerPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                  <button
                    type="button"
                    onClick={handleRequestOtp}
                    className="px-2.5 py-2 bg-teal-700 text-white rounded-xl font-semibold shrink-0 cursor-pointer"
                  >
                    Kirim OTP
                  </button>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Kode OTP WhatsApp (6 Digit) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Masukkan 6 digit OTP"
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  No. WA Staf Kasir (Opsional)
                </label>
                <input
                  type="text"
                  placeholder="0852xxxxxxxx"
                  value={onboardCashierPhone}
                  onChange={(e) => {
                    setOnboardCashierPhone(e.target.value);
                    if (!onboardCashierName) setOnboardCashierName("Kasir 01");
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
            </div>

            {onboardStatusMsg && (
              <div className="text-xs font-semibold text-emerald-800 bg-emerald-50 p-3 rounded-xl border border-emerald-200">
                {onboardStatusMsg}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowOnboardingModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={!requestedOtp && !otpInput}
                className="px-4 py-2 rounded-xl bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-semibold cursor-pointer"
              >
                Selesaikan Onboarding & Buka Toko
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

