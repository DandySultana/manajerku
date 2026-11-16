"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";

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
      closestExpiryDays: number | null;
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

export interface CommandCenterHandle {
  openAccessModal: () => void;
  openOnboardingModal: () => void;
}

export function formatRp(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Tersembunyi (Akses Kasir)";
  return "Rp " + Math.round(value).toLocaleString("id-ID");
}

function formatDateBadgeId(isoDate: string): string {
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
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const year = parts[0];
  const monthIdx = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  const monthLabel = months[monthIdx] || parts[1];
  return `${day} ${monthLabel} ${year}`;
}

function getCurrentWibTimeLabel(): string {
  const now = new Date();
  const wibMs = now.getTime() + 7 * 60 * 60 * 1000;
  const wib = new Date(wibMs);
  const hh = wib.getUTCHours().toString().padStart(2, "0");
  const mm = wib.getUTCMinutes().toString().padStart(2, "0");
  return `${hh}:${mm} WIB`;
}

const CommandCenterDashboard = forwardRef<
  CommandCenterHandle,
  {
    activeStoreId: string;
    activeRole: "OWNER" | "CASHIER" | "ADMIN";
    onNavigateTab: (tab: string) => void;
    onStoreChanged: (newStoreId: string) => void;
    refreshSignal?: number;
  }
>(function CommandCenterDashboard(
  {
    activeStoreId,
    activeRole,
    onNavigateTab,
    onStoreChanged,
    refreshSignal = 0,
  },
  ref
) {
  const [summary, setSummary] = useState<CommandCenterSummary | null>(null);
  const [transactions, setTransactions] = useState<UnifiedTxItem[]>([]);
  const [txMeta, setTxMeta] = useState({
    lastSyncedLabel: "Terakhir disinkronkan: baru saja via Cold-Chain Agent",
    gatewayLatencyMs: 24,
  });
  const [selectedDate, setSelectedDate] = useState("2026-11-16");
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const [lastUpdatedWib, setLastUpdatedWib] = useState("14:02 WIB");
  const [hoveredDayDate, setHoveredDayDate] = useState<string | null>(null);

  const [txFilter, setTxFilter] = useState<"ALL" | "PO" | "POS">("ALL");
  const [txSearch, setTxSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modals
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [selectedTxModal, setSelectedTxModal] = useState<UnifiedTxItem | null>(
    null
  );

  // Access & Whitelist Form
  const [storeUsers, setStoreUsers] = useState<StoreUserItem[]>([]);
  const [newUserName, setNewUserName] = useState("");
  const [newUserPhone, setNewUserPhone] = useState("");
  const [newUserRole, setNewUserRole] = useState<"CASHIER" | "OWNER">(
    "CASHIER"
  );
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

  const dateMenuRef = useRef<HTMLDivElement | null>(null);

  const requestDashboardData = useCallback(async () => {
    const [sumRes, txRes] = await Promise.all([
      fetch(
        `/api/v1/dashboard/summary?storeId=${encodeURIComponent(
          activeStoreId
        )}&role=${activeRole}&date=${encodeURIComponent(selectedDate)}`
      ),
      fetch(
        `/api/v1/dashboard/transactions?storeId=${encodeURIComponent(
          activeStoreId
        )}&type=${txFilter}&search=${encodeURIComponent(txSearch)}`
      ),
    ]);
    const [sumJson, txJson] = await Promise.all([sumRes.json(), txRes.json()]);
    if (!sumJson.success) {
      throw new Error(sumJson.error?.message || "Gagal memuat ringkasan.");
    }
    return { sumJson, txJson };
  }, [activeStoreId, activeRole, selectedDate, txFilter, txSearch]);

  const fetchDashboardData = useCallback(async () => {
    try {
      setErrorMsg(null);
      const { sumJson, txJson } = await requestDashboardData();
      setSummary(sumJson.data);
      setLastUpdatedWib(getCurrentWibTimeLabel());
      if (txJson.success) {
        setTransactions(txJson.data.items);
        setTxMeta({
          lastSyncedLabel:
            txJson.data.lastSyncedLabel ||
            "Terakhir disinkronkan: baru saja via Cold-Chain Agent",
          gatewayLatencyMs: txJson.data.gatewayLatencyMs ?? 24,
        });
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Koneksi terputus. Mencoba menghubungkan ulang."
      );
    } finally {
      setLoading(false);
    }
  }, [requestDashboardData]);

  useEffect(() => {
    let cancelled = false;
    requestDashboardData()
      .then(({ sumJson, txJson }) => {
        if (cancelled) return;
        setErrorMsg(null);
        setSummary(sumJson.data);
        setLastUpdatedWib(getCurrentWibTimeLabel());
        if (txJson.success) {
          setTransactions(txJson.data.items);
          setTxMeta({
            lastSyncedLabel:
              txJson.data.lastSyncedLabel ||
              "Terakhir disinkronkan: baru saja via Cold-Chain Agent",
            gatewayLatencyMs: txJson.data.gatewayLatencyMs ?? 24,
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "Koneksi terputus. Mencoba menghubungkan ulang."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestDashboardData, refreshSignal]);

  const loadStoreUsers = useCallback(async () => {
    const res = await fetch(
      `/api/v1/users?storeId=${encodeURIComponent(activeStoreId)}`
    );
    const json = await res.json();
    if (json.success) {
      setStoreUsers(json.data);
    }
  }, [activeStoreId]);

  useImperativeHandle(
    ref,
    () => ({
      openAccessModal: () => {
        void loadStoreUsers();
        setShowAccessModal(true);
      },
      openOnboardingModal: () => {
        setShowOnboardingModal(true);
      },
    }),
    [loadStoreUsers]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDateMenuOpen(false);
        setSelectedTxModal(null);
        setShowAccessModal(false);
        setShowOnboardingModal(false);
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dateMenuRef.current &&
        !dateMenuRef.current.contains(e.target as Node)
      ) {
        setDateMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

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
      setOnboardStatusMsg(
        json.error?.message || "Gagal menyelesaikan onboarding."
      );
    }
  };

  if (loading && !summary) {
    return (
      <div className="space-y-6 animate-pulse" aria-busy="true">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="h-7 bg-slate-200 rounded-lg w-72" />
            <div className="h-4 bg-slate-200 rounded-lg w-96" />
          </div>
          <div className="h-10 bg-slate-200 rounded-xl w-56" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-36 bg-slate-200 rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 h-80 bg-slate-200 rounded-2xl" />
          <div className="lg:col-span-5 h-80 bg-slate-200 rounded-2xl" />
        </div>
        <div className="h-64 bg-slate-200 rounded-2xl" />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="bg-white rounded-2xl border border-[#E5E9EC] p-8 text-center space-y-3">
        <p className="text-red-600 font-semibold text-sm">
          {errorMsg || "Data ringkasan operasional tidak ditemukan."}
        </p>
        <button
          type="button"
          onClick={fetchDashboardData}
          className="min-h-[40px] px-4 py-2 bg-[#0F6352] hover:bg-[#0B4F41] text-white rounded-xl text-xs font-semibold"
        >
          Coba Muat Ulang
        </button>
      </div>
    );
  }

  const rawMaxChart = Math.max(
    4000000,
    ...summary.chart7Days.days.map((d) =>
      Math.max(d.omzetKasirRp, d.belanjaKulakanPoRp)
    )
  );
  const maxStepMillions = Math.ceil(rawMaxChart / 1000000);
  const maxChartScaleRp = maxStepMillions * 1000000;
  const yTicksMillions = [
    maxStepMillions,
    Math.round(maxStepMillions * 0.75),
    Math.round(maxStepMillions * 0.5),
    Math.round(maxStepMillions * 0.25),
    0,
  ];

  const batchSummary = summary.aiAndFefoHealth.batchSummary;
  const totalBatchesSafeDenom = Math.max(1, batchSummary.totalActiveBatches);
  const safePct = Math.round(
    (batchSummary.safeBatches / totalBatchesSafeDenom) * 100
  );
  const prioPct = Math.max(
    batchSummary.priorityFefoBatches > 0 ? 3 : 0,
    Math.round(
      (batchSummary.priorityFefoBatches / totalBatchesSafeDenom) * 100
    )
  );
  const critPct = Math.max(
    batchSummary.criticalBatches > 0 ? 4 : 0,
    100 - safePct - prioPct
  );

  // Map the 3 core AI & FEFO activity cards from live DB data
  const rawActs = summary.aiAndFefoHealth.activities;
  const discAct = rawActs.find((a) => a.id === "act-discovery");
  const rfqAct = rawActs.find((a) => a.id === "act-rfq");
  const promoAct = rawActs.find((a) => a.id === "act-promo");

  const aiFeedCards = [
    {
      id: "act-discovery",
      tab: "suppliers",
      title: "Targeted Scraping Supplier",
      subtitle: `${summary.kpis.efisiensiPengadaanAi.verifiedSupplierCount} distributor rating >= 4.5 ditemukan`,
      badge: discAct?.statusLabel || "Belum Ada",
      isActiveBadge: false,
    },
    {
      id: "act-rfq",
      tab: "whatsapp",
      title: rfqAct?.title || "Belum Ada Auto-RFQ Aktif",
      subtitle: (
        rfqAct?.subtitle ||
        "Menunggu SKU menyentuh batas minimum stok (ROP)"
      ).replace(/(\d+)rb\/dus/, "$1.000/dus"),
      badge: rfqAct?.statusLabel || "Standby",
      isActiveBadge: rfqAct?.statusType === "ACTIVE",
    },
    {
      id: "act-promo",
      tab: "promo",
      title: promoAct?.title || "Belum Ada Draf Promo FEFO",
      subtitle: (
        promoAct?.subtitle || "0 batch mendekati kedaluwarsa"
      ).replace("Pedagang Reseller", "WhatsApp Reseller"),
      badge: promoAct?.statusLabel || "Aman",
      isActiveBadge: false,
    },
  ];

  const availableSnapshotDates = summary.chart7Days.days
    .map((d) => ({ date: d.date, dayLabel: d.dayLabel }))
    .reverse();

  return (
    <div className="space-y-5">
      {/* Page Title & Primary Action Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-[22px] sm:text-[24px] font-bold text-[#0F172A] tracking-tight leading-snug">
            Ringkasan Operasional &amp; Rantai Pasok
          </h1>
          <p className="text-[13px] text-[#64748B] mt-0.5">
            Pantauan kas siap kulakan, stok FEFO freezer &amp; negosiasi supplier
            otomatis
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Date Selector Dropdown */}
          <div className="relative" ref={dateMenuRef}>
            <button
              type="button"
              onClick={() => setDateMenuOpen((prev) => !prev)}
              aria-expanded={dateMenuOpen}
              aria-label="Pilih tanggal laporan operasional"
              className="min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-xs font-medium text-[#334155] inline-flex items-center gap-2 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
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
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4" />
                <path d="M8 2v4" />
                <path d="M3 10h18" />
              </svg>
              <span className="tabular-nums">
                {formatDateBadgeId(selectedDate)}
              </span>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-3.5 h-3.5 text-[#64748B]"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {dateMenuOpen && (
              <div
                role="listbox"
                aria-label="Tanggal operasional"
                className="absolute right-0 mt-1.5 w-48 bg-white rounded-xl border border-[#E2E8F0] shadow-lg p-1.5 z-40 text-xs"
              >
                {availableSnapshotDates.map((item) => {
                  const isSelected = item.date === selectedDate;
                  return (
                    <button
                      key={item.date}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setSelectedDate(item.date);
                        setDateMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between transition-colors ${
                        isSelected
                          ? "bg-[#D7F0E6] text-[#0F6352] font-semibold"
                          : "text-[#334155] hover:bg-[#F8FAFC]"
                      }`}
                    >
                      <span>{formatDateBadgeId(item.date)}</span>
                      <span className="text-[11px] text-[#64748B]">
                        {item.dayLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab("pos")}
            className="min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white text-xs font-semibold inline-flex items-center gap-2 shadow-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
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
              <circle cx="9" cy="20" r="1.5" />
              <circle cx="17" cy="20" r="1.5" />
              <path d="M3 4h2l2.4 10.4a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 1.9-1.4L21 8H7" />
              <path d="M12 4v4" />
              <path d="M10 6h4" />
            </svg>
            <span>+ Transaksi Kasir</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-2.5 text-xs font-medium flex items-center justify-between gap-2"
        >
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={fetchDashboardData}
            className="px-3 py-1 rounded-lg bg-red-600 text-white font-semibold"
          >
            Muat Ulang
          </button>
        </div>
      )}

      {/* Role Notice Banner if viewing as CASHIER */}
      {summary.viewerRole === "CASHIER" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900">
          <span>
            <strong>Mode Staf Kasir Aktif:</strong> Sesuai aturan keamanan RBAC,
            saldo <em>Kas Siap Kulakan</em>, <em>Laba Bersih</em>, dan tombol
            persetujuan PO disembunyikan untuk peran Kasir.
          </span>
          <button
            type="button"
            onClick={() => onNavigateTab("pos")}
            className="min-h-[36px] px-3 py-1.5 bg-amber-800 hover:bg-amber-900 text-white rounded-lg font-semibold"
          >
            Buka Layar Kasir POS
          </button>
        </div>
      )}

      {/* 4 KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* KPI 1: Kas Siap Kulakan (Primary Dark Teal Card) */}
        <button
          type="button"
          onClick={() => onNavigateTab("finance")}
          className="rounded-2xl bg-gradient-to-br from-[#0F6352] to-[#0B5344] text-white p-5 shadow-sm flex flex-col justify-between min-h-[144px] text-left w-full hover:brightness-105 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
        >
          <div className="flex items-center justify-between gap-2 w-full">
            <span className="text-xs font-medium text-emerald-100/90">
              Kas Siap Kulakan
            </span>
            <span className="text-[11px] font-semibold bg-white/15 text-white px-2.5 py-0.5 rounded-full tabular-nums">
              {summary.kpis.kasSiapKulakan.weeklyGrowthPct}
            </span>
          </div>

          <div className="my-2">
            <div className="text-[26px] font-bold tracking-tight text-white tabular-nums leading-tight">
              {summary.kpis.kasSiapKulakan.amountRp !== null
                ? formatRp(summary.kpis.kasSiapKulakan.amountRp)
                : "Rp ••••••••"}
            </div>
          </div>

          <div className="text-[11px] text-emerald-100/85 flex items-center justify-between gap-2 w-full">
            <span>
              {summary.kpis.kasSiapKulakan.plafonStatus} •{" "}
              {summary.kpis.kasSiapKulakan.weeklyGrowthPct} minggu ini
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
              <path d="M3 21h18" />
              <path d="M3 10h18" />
              <path d="M5 6l7-3 7 3" />
              <path d="M4 10v11" />
              <path d="M20 10v11" />
              <path d="M8 14v3" />
              <path d="M12 14v3" />
              <path d="M16 14v3" />
            </svg>
          </div>
        </button>

        {/* KPI 2: Omzet Harian */}
        <button
          type="button"
          onClick={() => onNavigateTab("pos")}
          className="rounded-2xl bg-white border border-[#E5E9EC] hover:border-[#CBD5E1] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between min-h-[144px] text-left w-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
        >
          <div className="flex items-center justify-between gap-2 w-full">
            <span className="text-xs font-medium text-[#64748B]">
              Omzet Harian
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-[17px] h-[17px] text-[#64748B] shrink-0"
            >
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <circle cx="12" cy="12" r="2.5" />
              <path d="M6 12h.01" />
              <path d="M18 12h.01" />
            </svg>
          </div>

          <div className="my-2">
            <div className="text-[26px] font-bold text-[#0F172A] tracking-tight tabular-nums leading-tight">
              {formatRp(summary.kpis.omzetHarian.amountRp)}
            </div>
          </div>

          <div className="text-[11px] text-[#64748B] flex items-center justify-between gap-2 w-full">
            <span>
              {summary.kpis.omzetHarian.invoiceCount} Nota (Ecer &amp; Dus) •{" "}
              {summary.kpis.omzetHarian.netProfitRp !== null
                ? `Laba Rp ${Math.round(
                    summary.kpis.omzetHarian.netProfitRp / 1000
                  )}rb`
                : "Laba Tersembunyi"}
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4 text-[#0F6352] shrink-0"
            >
              <path d="m22 7-8.5 8.5-5-5L2 17" />
              <path d="M16 7h6v6" />
            </svg>
          </div>
        </button>

        {/* KPI 3: Radar Stok & Batch FEFO */}
        <button
          type="button"
          onClick={() => onNavigateTab("inventory")}
          className="rounded-2xl bg-white border border-[#E5E9EC] hover:border-[#CBD5E1] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between min-h-[144px] text-left w-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
        >
          <div className="flex items-center justify-between gap-2 w-full">
            <span className="text-xs font-medium text-[#64748B]">
              Radar Stok &amp; Batch FEFO
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
              <rect x="3" y="4" width="18" height="4" rx="1" />
              <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
              <path d="M10 12h4" />
            </svg>
          </div>

          <div className="my-2">
            <div className="text-[26px] font-bold text-[#0F172A] tracking-tight tabular-nums leading-tight">
              {summary.kpis.radarStokFefo.criticalSkuCount} SKU Kritis
            </div>
          </div>

          <div className="text-[11px] text-[#64748B] flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#0F6352] shrink-0" />
            <span>
              {summary.kpis.radarStokFefo.closestExpiryBatchCount > 0 &&
              summary.kpis.radarStokFefo.closestExpiryDays !== null
                ? `${summary.kpis.radarStokFefo.closestExpiryBatchCount} Batch Hampir Expired (${summary.kpis.radarStokFefo.closestExpiryDays} Hr)`
                : "0 Batch Hampir Expired"}
            </span>
          </div>
        </button>

        {/* KPI 4: Efisiensi Pengadaan AI */}
        <button
          type="button"
          onClick={() => onNavigateTab("suppliers")}
          className="rounded-2xl bg-white border border-[#E5E9EC] hover:border-[#CBD5E1] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between min-h-[144px] text-left w-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
        >
          <div className="flex items-center justify-between gap-2 w-full">
            <span className="text-xs font-medium text-[#64748B]">
              Efisiensi Pengadaan AI
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-[17px] h-[17px] text-[#0F6352] shrink-0"
            >
              <path d="m11 3 1.5 4.2L17 9l-4.5 1.8L11 15l-1.5-4.2L5 9l4.5-1.8L11 3Z" />
              <path d="m18.5 14 .9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z" />
            </svg>
          </div>

          <div className="my-2">
            <div className="text-[26px] font-bold text-[#0F172A] tracking-tight tabular-nums leading-tight">
              {summary.kpis.efisiensiPengadaanAi.marginImprovementLabel}
            </div>
          </div>

          <div className="text-[11px] text-[#64748B] flex items-center justify-between gap-2 w-full">
            <span>
              {summary.kpis.efisiensiPengadaanAi.verifiedSupplierCount}{" "}
              Distributor Lokal Terverifikasi
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
              <path d="M12 2l2.4 2.4 3.4-.3 1 3.3 3 1.7-1 3.3 1 3.3-3 1.7-1 3.3-3.4-.3L12 22l-2.4-2.4-3.4.3-1-3.3-3-1.7 1-3.3-1-3.3 3-1.7 1-3.3 3.4.3L12 2Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
        </button>
      </div>

      {/* Middle Section: 7-Day Chart (7 cols) + AI Agent & FEFO Health (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Panel: Tren Omzet Kasir vs Belanja Kulakan (7 Hari) */}
        <section
          aria-labelledby="chart-7d-heading"
          className="lg:col-span-7 bg-white rounded-2xl border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between"
        >
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
            <div>
              <h2
                id="chart-7d-heading"
                className="text-[15px] font-bold text-[#0F172A]"
              >
                Tren Omzet Kasir vs Belanja Kulakan (7 Hari)
              </h2>
              <p className="text-xs text-[#64748B] mt-0.5">
                Monitoring likuiditas rantai dingin harian
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium text-[#475569] shrink-0">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-[3px] bg-[#0F6352] inline-block" />
                Omzet Kasir
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-[3px] bg-[#CBD5E1] inline-block" />
                Belanja Kulakan PO
              </span>
            </div>
          </div>

          {/* Y-Axis + Grouped Bar Chart */}
          <div className="relative flex gap-3 items-stretch pt-2">
            {/* Y-Axis Labels */}
            <div
              aria-hidden="true"
              className="flex flex-col justify-between h-48 text-right pr-1 font-mono text-[11px] text-[#94A3B8] select-none shrink-0"
            >
              {yTicksMillions.map((m, idx) => (
                <span key={idx} className="leading-none">
                  {m === 0 ? "0" : `${m} Jt`}
                </span>
              ))}
            </div>

            {/* Plot Area */}
            <div className="flex-1 flex flex-col">
              <div className="relative h-48">
                {/* Horizontal Dashed Gridlines */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 flex flex-col justify-between pointer-events-none"
                >
                  {yTicksMillions.map((_, idx) => (
                    <div
                      key={idx}
                      className={`w-full ${
                        idx === yTicksMillions.length - 1
                          ? "border-b border-[#E2E8F0]"
                          : "border-b border-dashed border-[#E2E8F0]/90"
                      }`}
                    />
                  ))}
                </div>

                {/* 7 Day Bar Groups */}
                <div className="relative z-10 h-full flex items-end justify-between gap-2 sm:gap-4 px-2 sm:px-4">
                  {summary.chart7Days.days.map((d) => {
                    const omzetPct =
                      d.omzetKasirRp > 0
                        ? Math.min(
                            100,
                            Math.max(
                              4,
                              Math.round((d.omzetKasirRp / maxChartScaleRp) * 100)
                            )
                          )
                        : 0;
                    const poPct =
                      d.belanjaKulakanPoRp > 0
                        ? Math.min(
                            100,
                            Math.max(
                              4,
                              Math.round(
                                (d.belanjaKulakanPoRp / maxChartScaleRp) * 100
                              )
                            )
                          )
                        : 0;
                    const isHovered = hoveredDayDate === d.date;
                    return (
                      <div
                        key={d.date}
                        onMouseEnter={() => setHoveredDayDate(d.date)}
                        onMouseLeave={() => setHoveredDayDate(null)}
                        className="relative flex-1 flex items-end justify-center gap-1 sm:gap-1.5 h-full group"
                      >
                        {isHovered && (
                          <div className="absolute -top-9 left-1/2 -translate-x-1/2 bg-[#0F172A] text-white text-[10px] font-medium px-2.5 py-1 rounded-lg shadow-md whitespace-nowrap z-20 pointer-events-none">
                            {d.dayLabel}: Omzet {formatRp(d.omzetKasirRp)} | PO{" "}
                            {formatRp(d.belanjaKulakanPoRp)}
                          </div>
                        )}
                        <div
                          style={{ height: `${omzetPct}%` }}
                          title={`Omzet ${d.dayLabel}: ${formatRp(
                            d.omzetKasirRp
                          )}`}
                          className="w-3.5 sm:w-[18px] bg-[#0F6352] group-hover:bg-[#0B4F41] rounded-t-[5px] transition-all"
                        />
                        <div
                          style={{ height: `${poPct}%` }}
                          title={`Kulakan PO ${d.dayLabel}: ${formatRp(
                            d.belanjaKulakanPoRp
                          )}`}
                          className="w-3.5 sm:w-[18px] bg-[#CBD5E1] group-hover:bg-[#94A3B8] rounded-t-[5px] transition-all"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* X-Axis Day Labels */}
              <div className="flex items-center justify-between gap-2 sm:gap-4 px-2 sm:px-4 pt-2.5">
                {summary.chart7Days.days.map((d) => (
                  <div
                    key={d.date}
                    className={`flex-1 text-center text-[11px] ${
                      d.date === selectedDate
                        ? "font-bold text-[#0F172A]"
                        : "font-medium text-[#64748B]"
                    }`}
                  >
                    {d.dayLabel}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom Cash Ratio Footer */}
          <div className="mt-4 bg-[#F8FAFC] border border-[#E5E9EC] rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-2 font-medium text-[#334155]">
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
              <span>
                {summary.chart7Days.coverageRatio > 0
                  ? `Rasio Kas Kulakan ${
                      summary.chart7Days.coverageHealthy ? "Sehat" : "Ketat"
                    } (${summary.chart7Days.coverageRatio
                      .toString()
                      .replace(".", ",")}x lipat terhadap PO berjalan)`
                  : summary.chart7Days.coverageLabel}
              </span>
            </span>
            <span className="font-mono text-[11px] text-[#64748B]">
              Update Realtime {lastUpdatedWib}
            </span>
          </div>
        </section>

        {/* Right Panel: Aktivitas Agen AI & Kesehatan FEFO */}
        <section
          aria-labelledby="ai-fefo-heading"
          className="lg:col-span-5 bg-white rounded-2xl border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-[18px] h-[18px] text-[#0F6352] shrink-0"
                >
                  <path d="M12 3v3" />
                  <circle cx="12" cy="2.5" r="1" />
                  <rect x="4" y="6" width="16" height="12" rx="3" />
                  <circle cx="9.5" cy="11.5" r="1" fill="currentColor" />
                  <circle cx="14.5" cy="11.5" r="1" fill="currentColor" />
                  <path d="M9 15h6" />
                </svg>
                <h2
                  id="ai-fefo-heading"
                  className="text-[15px] font-bold text-[#0F172A] truncate"
                >
                  Aktivitas Agen AI &amp; Kesehatan FEFO
                </h2>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#0F6352] bg-[#F1F5F9] px-2.5 py-1 rounded-full shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                Online 24/7
              </span>
            </div>

            {/* Batch Health Bar Subcard */}
            <div className="bg-[#F8FAFC] border border-[#E5E9EC] rounded-xl p-4 mt-4">
              <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                <span className="font-semibold text-[#1E293B]">
                  Kesehatan Stok Freezer ({batchSummary.totalActiveBatches}{" "}
                  Batch)
                </span>
                <span className="text-[11px] text-[#64748B]">
                  {batchSummary.safeBatches} Aman •{" "}
                  {batchSummary.priorityFefoBatches} Prioritas •{" "}
                  {batchSummary.criticalBatches} Kritis
                </span>
              </div>
              <div
                aria-label={`${batchSummary.safeBatches} batch aman, ${batchSummary.priorityFefoBatches} batch prioritas, ${batchSummary.criticalBatches} batch kritis`}
                className="w-full h-1.5 bg-[#E2E8F0] rounded-full overflow-hidden flex mt-2.5 gap-[2px]"
              >
                <div
                  style={{ width: `${safePct}%` }}
                  className="bg-[#0F6352] h-full rounded-l-full"
                  title={`${batchSummary.safeBatches} Batch Aman`}
                />
                <div
                  style={{ width: `${prioPct}%` }}
                  className="bg-[#64748B] h-full"
                  title={`${batchSummary.priorityFefoBatches} Batch Prioritas FEFO`}
                />
                <div
                  style={{ width: `${critPct}%` }}
                  className="bg-[#CBD5E1] h-full rounded-r-full"
                  title={`${batchSummary.criticalBatches} Batch Kritis`}
                />
              </div>
            </div>

            {/* 3 Activity Cards */}
            <div className="space-y-3 mt-4">
              {aiFeedCards.map((act) => (
                <button
                  key={act.id}
                  type="button"
                  onClick={() => onNavigateTab(act.tab)}
                  className="w-full text-left flex items-center justify-between gap-3 px-3.5 py-3.5 rounded-xl border border-[#E5E9EC] bg-white hover:border-[#0F6352]/40 hover:bg-[#F8FAFC] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#0F172A] flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#0F6352] shrink-0" />
                      <span className="truncate">{act.title}</span>
                    </div>
                    <div className="text-[11px] text-[#64748B] pl-3.5 mt-0.5 truncate">
                      {act.subtitle}
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-md shrink-0 ${
                      act.isActiveBadge
                        ? "bg-[#D7F0E6] text-[#0F6352]"
                        : "bg-[#F1F5F9] text-[#475569]"
                    }`}
                  >
                    {act.badge}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Bottom Section: Sinkronisasi Kasir & Purchase Order (PO) Otomatis Terkini */}
      <section
        aria-labelledby="sync-table-heading"
        className="bg-white rounded-2xl border border-[#E5E9EC] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
      >
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-4">
          <div>
            <h2
              id="sync-table-heading"
              className="text-[15px] font-bold text-[#0F172A]"
            >
              Sinkronisasi Kasir &amp; Purchase Order (PO) Otomatis Terkini
            </h2>
            <p className="text-xs text-[#64748B] mt-0.5">
              Penyelarasan pesanan masuk kasir POS dan restock rantai dingin
              otomatis
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Segmented Filter Tabs */}
            <div
              role="tablist"
              aria-label="Filter jenis transaksi"
              className="inline-flex rounded-xl bg-[#F1F5F9] p-1 text-xs"
            >
              {(
                [
                  ["ALL", "Semua"],
                  ["PO", "PO Otomatis"],
                  ["POS", "Penjualan Kasir"],
                ] as const
              ).map(([key, label]) => {
                const active = txFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTxFilter(key)}
                    className={`min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352] ${
                      active
                        ? "bg-white text-[#0F172A] font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
                        : "text-[#64748B] hover:text-[#0F172A] font-medium"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Search Input */}
            <div className="relative flex-1 sm:flex-initial min-w-[200px]">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                aria-label="Cari PO atau Mitra"
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                placeholder="Cari PO / Mitra..."
                className="w-full pl-8 pr-3 py-1.5 min-h-[38px] text-xs rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[#0F172A] placeholder:text-[#94A3B8] focus:bg-white focus:outline-none focus:border-[#0F6352]"
              />
            </div>
          </div>
        </div>

        {/* Desktop Table (sm and up) */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-y border-[#F1F5F9] text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                <th className="py-3 px-3">Referensi</th>
                <th className="py-3 px-3">Mitra / Pelanggan</th>
                <th className="py-3 px-3">Rincian Barang</th>
                <th className="py-3 px-3">Total &amp; Status</th>
                <th className="py-3 px-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-xs">
              {transactions.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-8 text-center text-[#64748B] font-medium"
                  >
                    <div>
                      Tidak ada transaksi yang cocok dengan filter pencarian.
                    </div>
                    {(txFilter !== "ALL" || txSearch) && (
                      <button
                        type="button"
                        onClick={() => {
                          setTxFilter("ALL");
                          setTxSearch("");
                        }}
                        className="mt-2 px-3 py-1.5 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#0F172A] font-semibold"
                      >
                        Reset Filter
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr
                    key={`${tx.recordType}-${tx.id}`}
                    className="hover:bg-[#F8FAFC]/80 transition-colors"
                  >
                    <td className="py-3.5 px-3 align-middle">
                      <div className="font-mono font-bold text-[#0F172A]">
                        {tx.referenceCode}
                      </div>
                      <div className="font-mono text-[11px] text-[#64748B] mt-0.5">
                        {tx.timeLabelWib}
                      </div>
                    </td>

                    <td className="py-3.5 px-3 align-middle">
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-lg bg-[#F8FAFC] border border-[#E5E9EC] text-[#64748B] flex items-center justify-center shrink-0">
                          {tx.recordType === "PO" ? (
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
                              <path d="M10 17h4V5H2v12h3" />
                              <path d="M14 8h4l3 4v5h-3" />
                              <circle cx="7.5" cy="17.5" r="2" />
                              <circle cx="16.5" cy="17.5" r="2" />
                            </svg>
                          ) : (
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
                              <path d="M3 9l1-5h16l1 5" />
                              <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
                              <path d="M5 12v8h14v-8" />
                            </svg>
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold text-[#0F172A]">
                            {tx.partnerName}
                          </div>
                          <div className="text-[11px] text-[#64748B]">
                            {tx.partnerSubLabel}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-3 align-middle">
                      <div className="font-medium text-[#0F172A]">
                        {tx.itemsSummary}
                      </div>
                      <div className="text-[11px] text-[#64748B] mt-0.5">
                        {tx.itemsSubLabel}
                      </div>
                    </td>

                    <td className="py-3.5 px-3 align-middle">
                      <div className="font-mono font-bold text-[#0F172A] tabular-nums">
                        {formatRp(tx.totalAmountRp)}
                      </div>
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium mt-1 border ${
                          tx.statusVariant === "WARNING"
                            ? "bg-amber-50 text-amber-800 border-amber-200"
                            : "bg-[#EBF8F2] text-[#0F6352] border-[#CCE8DB]"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            tx.statusVariant === "WARNING"
                              ? "bg-amber-500"
                              : "bg-[#10B981]"
                          }`}
                        />
                        {tx.statusBadge}
                      </span>
                    </td>

                    <td className="py-3.5 px-3 text-right align-middle">
                      <button
                        type="button"
                        onClick={() => setSelectedTxModal(tx)}
                        className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-xl border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-xs font-medium text-[#334155] transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
                      >
                        {tx.actionLabel === "Lihat PO" ? (
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
                        ) : (
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
                            <path d="M4 3h16v18l-2.5-1.5L15 21l-3-1.5L9 21l-2.5-1.5L4 21V3Z" />
                            <path d="M8 8h8" />
                            <path d="M8 12h8" />
                            <path d="M8 16h5" />
                          </svg>
                        )}
                        <span>{tx.actionLabel}</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Stacked Cards (< sm) */}
        <div className="sm:hidden space-y-3">
          {transactions.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#64748B]">
              Tidak ada transaksi yang cocok dengan filter pencarian.
            </div>
          ) : (
            transactions.map((tx) => (
              <div
                key={`mobile-${tx.recordType}-${tx.id}`}
                className="rounded-xl border border-[#E5E9EC] p-3.5 space-y-2.5 bg-[#F8FAFC]/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono font-bold text-xs text-[#0F172A]">
                      {tx.referenceCode}
                    </div>
                    <div className="font-mono text-[11px] text-[#64748B]">
                      {tx.timeLabelWib}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                      tx.statusVariant === "WARNING"
                        ? "bg-amber-50 text-amber-800 border-amber-200"
                        : "bg-[#EBF8F2] text-[#0F6352] border-[#CCE8DB]"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        tx.statusVariant === "WARNING"
                          ? "bg-amber-500"
                          : "bg-[#10B981]"
                      }`}
                    />
                    {tx.statusBadge}
                  </span>
                </div>

                <div>
                  <div className="text-xs font-semibold text-[#0F172A]">
                    {tx.partnerName}
                  </div>
                  <div className="text-[11px] text-[#64748B]">
                    {tx.itemsSummary}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#E5E9EC]">
                  <span className="font-mono font-bold text-xs text-[#0F172A] tabular-nums">
                    {formatRp(tx.totalAmountRp)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedTxModal(tx)}
                    className="min-h-[44px] px-3 py-1.5 rounded-xl border border-[#E2E8F0] bg-white text-xs font-medium text-[#334155]"
                  >
                    {tx.actionLabel}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Sync Indicator */}
        <div className="mt-4 pt-3 border-t border-[#F1F5F9] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B]">
          <span className="inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#10B981] shrink-0" />
            <span>{txMeta.lastSyncedLabel}</span>
          </span>
          <span className="font-mono">
            Node Gateway: Latensi {txMeta.gatewayLatencyMs}ms
          </span>
        </div>
      </section>

      {/* Modal 1: Lihat PO / Cetak Struk Preview */}
      {selectedTxModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tx-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#E2E8F0] space-y-4">
            <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
              <div>
                <span className="text-[11px] font-bold uppercase text-[#0F6352]">
                  {selectedTxModal.recordType === "PO"
                    ? "Dokumen Purchase Order Resmi"
                    : "Struk Transaksi Kasir POS"}
                </span>
                <h3
                  id="tx-modal-title"
                  className="text-lg font-bold text-[#0F172A]"
                >
                  {selectedTxModal.referenceCode}
                </h3>
              </div>
              <button
                type="button"
                aria-label="Tutup pratinjau transaksi"
                onClick={() => setSelectedTxModal(null)}
                className="min-h-[36px] min-w-[36px] rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] text-sm font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="bg-[#F8FAFC] rounded-xl p-4 space-y-2 text-xs text-[#334155] border border-[#E5E9EC]">
              <div className="flex justify-between gap-2">
                <span className="text-[#64748B]">Mitra / Pelanggan:</span>
                <span className="font-bold text-right">
                  {selectedTxModal.partnerName}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#64748B]">Kategori:</span>
                <span className="text-right">
                  {selectedTxModal.partnerSubLabel}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#64748B]">Rincian Item:</span>
                <span className="font-semibold text-right">
                  {selectedTxModal.itemsSummary}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#64748B]">Keterangan:</span>
                <span className="text-right">
                  {selectedTxModal.itemsSubLabel}
                </span>
              </div>
              <div className="flex justify-between gap-2 pt-2 border-t border-[#E2E8F0] text-sm font-bold text-[#0F172A]">
                <span>Total Nominal:</span>
                <span className="font-mono">
                  {formatRp(selectedTxModal.totalAmountRp)}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#64748B]">Status Sinkronisasi:</span>
                <span className="font-semibold text-[#0F6352]">
                  {selectedTxModal.statusBadge}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="min-h-[40px] px-4 py-2 bg-[#0F6352] hover:bg-[#0B4F41] text-white rounded-xl text-xs font-semibold"
              >
                {selectedTxModal.actionLabel} (PDF / Termal)
              </button>
              <button
                type="button"
                onClick={() => setSelectedTxModal(null)}
                className="min-h-[40px] px-4 py-2 bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#334155] rounded-xl text-xs font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Role Whitelist & Subscription Tier Manager */}
      {showAccessModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="access-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-xl border border-[#E2E8F0] space-y-5">
            <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
              <div>
                <h3
                  id="access-modal-title"
                  className="text-base font-bold text-[#0F172A]"
                >
                  Manajemen Paket SaaS &amp; Whitelist Nomor WhatsApp
                </h3>
                <p className="text-xs text-[#64748B]">
                  Konfigurasi Paket Langganan &amp; Akses Role Nomor Telepon
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup dialog akses dan paket"
                onClick={() => setShowAccessModal(false)}
                className="min-h-[36px] min-w-[36px] rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="bg-[#F8FAFC] p-4 rounded-xl border border-[#E5E9EC] space-y-3">
              <div>
                <div className="text-xs font-bold text-[#0F172A]">
                  Paket Aktif:{" "}
                  {summary.store.subscriptionTier === "MANAJERKU_PRO"
                    ? "Manajerku Pro (Rp49.000/bulan)"
                    : "Freemium Starter (Rp0/bulan)"}
                </div>
                <div className="text-[11px] text-[#64748B] mt-0.5">
                  Akses Terbuka Aktif: Seluruh fitur AI Discovery, Auto-RFQ WA,
                  Vision OCR, Promo Reseller, Ekspor PDF KUR, dan SKU tanpa
                  batas dibuka sementara untuk pengujian semua paket.
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => handleToggleSubscription("FREEMIUM_STARTER")}
                  className={`flex-1 min-h-[40px] py-2 px-3 rounded-xl text-xs font-semibold border ${
                    summary.store.subscriptionTier === "FREEMIUM_STARTER"
                      ? "bg-amber-600 text-white border-amber-600"
                      : "bg-white text-[#334155] border-[#CBD5E1]"
                  }`}
                >
                  Paket Freemium Starter (Rp0)
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleSubscription("MANAJERKU_PRO")}
                  className={`flex-1 min-h-[40px] py-2 px-3 rounded-xl text-xs font-semibold border ${
                    summary.store.subscriptionTier === "MANAJERKU_PRO"
                      ? "bg-[#0F6352] text-white border-[#0F6352]"
                      : "bg-white text-[#334155] border-[#CBD5E1]"
                  }`}
                >
                  Paket Manajerku Pro (Rp49.000/bln)
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-[#1E293B]">
                Daftar Pengguna &amp; Nomor WhatsApp Terotorisasi
              </h4>
              <div className="border border-[#E5E9EC] rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F8FAFC] text-[11px] font-bold text-[#64748B]">
                    <tr>
                      <th className="py-2 px-3">Nama</th>
                      <th className="py-2 px-3">Nomor WhatsApp</th>
                      <th className="py-2 px-3">Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {storeUsers.map((u) => (
                      <tr key={u.id}>
                        <td className="py-2 px-3 font-medium text-[#0F172A]">
                          {u.fullName}
                        </td>
                        <td className="py-2 px-3 font-mono text-[#475569]">
                          {u.phoneWhatsapp}
                        </td>
                        <td className="py-2 px-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F1F5F9] text-[#334155]">
                            {u.role}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <form
              onSubmit={handleAddUser}
              className="space-y-3 pt-2 border-t border-[#F1F5F9]"
            >
              <div className="text-xs font-bold text-[#1E293B]">
                Tambah Staf Kasir / Owner ke Whitelist WhatsApp
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  aria-label="Nama Lengkap Staf"
                  placeholder="Nama Lengkap"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1] text-xs"
                  required
                />
                <input
                  type="text"
                  aria-label="Nomor WhatsApp Staf"
                  placeholder="No. WA (08xx / +628xx)"
                  value={newUserPhone}
                  onChange={(e) => setNewUserPhone(e.target.value)}
                  className="px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1] text-xs"
                  required
                />
                <select
                  aria-label="Role Staf"
                  value={newUserRole}
                  onChange={(e) =>
                    setNewUserRole(e.target.value as "CASHIER" | "OWNER")
                  }
                  className="px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1] text-xs bg-white"
                >
                  <option value="CASHIER">CASHIER (Kasir &amp; OCR)</option>
                  <option value="OWNER">OWNER (Akses Penuh &amp; ACC PO)</option>
                </select>
              </div>
              {userActionMsg && (
                <div className="text-xs font-semibold text-[#0F6352] bg-[#EBF8F2] p-2.5 rounded-xl border border-[#CCE8DB]">
                  {userActionMsg}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAccessModal(false)}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#F1F5F9] text-xs font-semibold text-[#334155]"
                >
                  Tutup
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white text-xs font-semibold"
                >
                  + Tambah ke Whitelist
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Self-Service 5-Minute Onboarding Wizard */}
      {showOnboardingModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4 overflow-y-auto"
        >
          <form
            onSubmit={handleCompleteOnboarding}
            className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-[#E2E8F0] space-y-4"
          >
            <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
              <div>
                <span className="text-[11px] font-bold uppercase text-[#0F6352]">
                  Onboarding Mandiri 5 Menit
                </span>
                <h3
                  id="onboarding-modal-title"
                  className="text-base font-bold text-[#0F172A]"
                >
                  Siapkan Toko Frozen Food &amp; Asisten WhatsApp
                </h3>
              </div>
              <button
                type="button"
                aria-label="Tutup dialog onboarding"
                onClick={() => setShowOnboardingModal(false)}
                className="min-h-[36px] min-w-[36px] rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label
                  htmlFor="onboard-store-name"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Nama Toko UMKM *
                </label>
                <input
                  id="onboard-store-name"
                  type="text"
                  required
                  placeholder="Mis: Agen Beku Krueng Raya"
                  value={onboardStoreName}
                  onChange={(e) => setOnboardStoreName(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label
                  htmlFor="onboard-branch-name"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Nama Cabang
                </label>
                <input
                  id="onboard-branch-name"
                  type="text"
                  value={onboardBranch}
                  onChange={(e) => setOnboardBranch(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor="onboard-address"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Alamat Toko (Acuan Radius &le; 10 km Google Places API)
                </label>
                <input
                  id="onboard-address"
                  type="text"
                  value={onboardAddress}
                  onChange={(e) => setOnboardAddress(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label
                  htmlFor="onboard-initial-cash"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Saldo Awal Kas Siap Kulakan (Rp) *
                </label>
                <input
                  id="onboard-initial-cash"
                  type="number"
                  required
                  value={onboardInitialCash}
                  onChange={(e) => setOnboardInitialCash(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label
                  htmlFor="onboard-elec-cost"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Beban Listrik Freezer 24 Jam (Rp/Hari) *
                </label>
                <input
                  id="onboard-elec-cost"
                  type="number"
                  required
                  value={onboardElecCost}
                  onChange={(e) => setOnboardElecCost(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label
                  htmlFor="onboard-owner-name"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Nama Pemilik Toko (Owner) *
                </label>
                <input
                  id="onboard-owner-name"
                  type="text"
                  required
                  placeholder="Nama Lengkap Owner"
                  value={onboardOwnerName}
                  onChange={(e) => setOnboardOwnerName(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label
                  htmlFor="onboard-owner-phone"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Nomor WhatsApp Owner *
                </label>
                <div className="flex gap-1.5">
                  <input
                    id="onboard-owner-phone"
                    type="text"
                    required
                    placeholder="0812xxxxxxxx"
                    value={onboardOwnerPhone}
                    onChange={(e) => setOnboardOwnerPhone(e.target.value)}
                    className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                  />
                  <button
                    type="button"
                    onClick={handleRequestOtp}
                    className="px-2.5 py-2 min-h-[40px] bg-[#0F6352] hover:bg-[#0B4F41] text-white rounded-xl font-semibold shrink-0"
                  >
                    Kirim OTP
                  </button>
                </div>
              </div>
              <div>
                <label
                  htmlFor="onboard-otp-code"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  Kode OTP WhatsApp (6 Digit) *
                </label>
                <input
                  id="onboard-otp-code"
                  type="text"
                  required
                  placeholder="Masukkan 6 digit OTP"
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1] font-mono"
                />
              </div>
              <div>
                <label
                  htmlFor="onboard-cashier-phone"
                  className="block font-semibold text-[#334155] mb-1"
                >
                  No. WA Staf Kasir (Opsional)
                </label>
                <input
                  id="onboard-cashier-phone"
                  type="text"
                  placeholder="0852xxxxxxxx"
                  value={onboardCashierPhone}
                  onChange={(e) => {
                    setOnboardCashierPhone(e.target.value);
                    if (!onboardCashierName) setOnboardCashierName("Kasir 01");
                  }}
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1]"
                />
              </div>
            </div>

            {onboardStatusMsg && (
              <div className="text-xs font-semibold text-[#0F6352] bg-[#EBF8F2] p-3 rounded-xl border border-[#CCE8DB]">
                {onboardStatusMsg}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowOnboardingModal(false)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#F1F5F9] text-xs font-semibold text-[#334155]"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={!requestedOtp && !otpInput}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] disabled:bg-slate-300 text-white text-xs font-semibold"
              >
                Selesaikan Onboarding &amp; Buka Toko
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
});

export default CommandCenterDashboard;
