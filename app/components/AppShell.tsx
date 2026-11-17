"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type AuthSessionData } from "./AuthAccountView";
import { AuthSessionCheckingScreen } from "./AuthLedgerShell";
import { useConfirmDialog } from "./ConfirmActionModal";
import { useGooeyToastFlash } from "./GooeyToastProvider";

export type ActiveTabKey =
  | "dashboard"
  | "pos"
  | "inventory"
  | "suppliers"
  | "whatsapp"
  | "promo"
  | "finance"
  | "auth";

export const TAB_ROUTE_MAP: Record<ActiveTabKey, string> = {
  dashboard: "/",
  pos: "/pos",
  inventory: "/inventaris",
  suppliers: "/supplier",
  whatsapp: "/whatsapp",
  promo: "/promo",
  finance: "/buku-kas",
  auth: "/akun",
};

const ROUTE_PAGE_TITLES: Record<ActiveTabKey, string> = {
  dashboard: "Command Center | Manajerku",
  pos: "Kasir Smart POS Multi-Satuan | Manajerku",
  inventory: "Manajemen Inventaris Rantai Dingin & FEFO | Manajerku",
  suppliers: "AI Procurement & Pencarian Supplier | Manajerku",
  whatsapp: "Agen AI WhatsApp & Vision OCR | Manajerku",
  promo: "Promo Reseller FEFO | Manajerku",
  finance: "Buku Kas Keuangan & Laporan KUR | Manajerku",
  auth: "Profil & Keamanan Akun | Manajerku",
};

export function getTabFromPathname(pathname: string): ActiveTabKey {
  if (pathname === "/" || pathname === "") return "dashboard";
  if (pathname.startsWith("/pos")) return "pos";
  if (pathname.startsWith("/inventaris")) return "inventory";
  if (pathname.startsWith("/supplier")) return "suppliers";
  if (pathname.startsWith("/whatsapp")) return "whatsapp";
  if (pathname.startsWith("/promo")) return "promo";
  if (pathname.startsWith("/buku-kas")) return "finance";
  if (pathname.startsWith("/akun")) return "auth";
  return "dashboard";
}

interface AppShellContextValue {
  authSession: AuthSessionData;
  setAuthSession: React.Dispatch<React.SetStateAction<AuthSessionData | null>>;
  checkCurrentSession: () => Promise<void>;
  onNavigateTab: (tab: string) => void;
  preselectedSupplierProductId: string | null;
  clearPreselectedSupplierProductId: () => void;
  pendingDashboardModal: "ACCESS" | "ONBOARDING" | null;
  clearPendingDashboardModal: () => void;
  dashboardRefreshKey: number;
  clearSessionToLogin: () => void;
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

export function useAppShell(): AppShellContextValue | null {
  return useContext(AppShellContext);
}

function NavIcon({
  iconKey,
  className = "w-5 h-5",
}: {
  iconKey:
    | "dashboard"
    | "pos"
    | "inventory"
    | "suppliers"
    | "whatsapp"
    | "promo"
    | "finance";
  className?: string;
}) {
  switch (iconKey) {
    case "dashboard":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
          <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
          <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
          <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
        </svg>
      );
    case "pos":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <rect x="4" y="3" width="16" height="18" rx="2.5" />
          <path d="M8 7h8" />
          <path d="M8 11.5h2" />
          <path d="M14 11.5h2" />
          <path d="M8 15.5h2" />
          <path d="M14 15.5h2" />
        </svg>
      );
    case "inventory":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <path d="m3.3 7 8.7 5 8.7-5" />
          <path d="M12 22V12" />
        </svg>
      );
    case "suppliers":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <rect x="1.5" y="4" width="13.5" height="12" rx="1.5" />
          <path d="M15 8h4l3 3.5V16h-7V8Z" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18.5" cy="18" r="2" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
          <path d="M8 10h8" />
          <path d="M8 14h5" />
        </svg>
      );
    case "promo":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
          <circle cx="7" cy="7" r="1.5" fill="currentColor" />
        </svg>
      );
    case "finance":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5" />
          <path d="M16 12h4v4h-4a2 2 0 0 1 0-4Z" />
        </svg>
      );
  }
}

function UserCircleIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="9.5" r="2.75" />
      <path d="M7.2 18.2a5.5 5.5 0 0 1 9.6 0" />
    </svg>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const activeTab = getTabFromPathname(pathname);
  const confirmDialog = useConfirmDialog();

  const [authSession, setAuthSession] = useState<AuthSessionData | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [showHeaderTempModal, setShowHeaderTempModal] = useState(false);
  const [tempInput, setTempInput] = useState("-18.4");
  const [tempFeedback, setTempFeedback] = useState<string | null>(null);
  const [tempSaving, setTempSaving] = useState(false);

  useGooeyToastFlash(
    tempFeedback && !tempFeedback.startsWith("Gagal") ? tempFeedback : null,
    tempFeedback && tempFeedback.startsWith("Gagal") ? tempFeedback : null,
    () => setTempFeedback(null),
    () => setTempFeedback(null)
  );

  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const [preselectedSupplierProductId, setPreselectedSupplierProductId] =
    useState<string | null>(null);
  const [pendingDashboardModal, setPendingDashboardModal] = useState<
    "ACCESS" | "ONBOARDING" | null
  >(null);

  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSidebarMouseEnter = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }
    hoverTimerRef.current = setTimeout(() => {
      setSidebarHovered(true);
    }, 45);
  }, []);

  const handleSidebarMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }
    hoverTimerRef.current = setTimeout(() => {
      setSidebarHovered(false);
    }, 75);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  const clearPreselectedSupplierProductId = useCallback(() => {
    setPreselectedSupplierProductId(null);
  }, []);

  const clearPendingDashboardModal = useCallback(() => {
    setPendingDashboardModal(null);
  }, []);

  const checkCurrentSession = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/auth/me");
      const json = await res.json();
      if (json.success && json.data) {
        setAuthSession(json.data);
        setTempInput(String(json.data.store.lastRecordedTempC));
        setAuthChecking(false);
      } else {
        setAuthSession(null);
        router.replace("/login");
      }
    } catch {
      setAuthSession(null);
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    document.title = ROUTE_PAGE_TITLES[activeTab] || "Manajerku";
  }, [activeTab]);

  useEffect(() => {
    Object.values(TAB_ROUTE_MAP).forEach((routeHref) => {
      router.prefetch(routeHref);
    });
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/auth/me")
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success && json.data) {
          setAuthSession(json.data);
          setTempInput(String(json.data.store.lastRecordedTempC));
          setAuthChecking(false);
        } else {
          setAuthSession(null);
          router.replace("/login");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAuthSession(null);
        router.replace("/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAccountMenuOpen(false);
        setShowHeaderTempModal(false);
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(target)
      ) {
        setAccountMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const clearSessionToLogin = useCallback(() => {
    setAuthSession(null);
    router.replace("/login");
  }, [router]);

  const handleLogout = async () => {
    const ok = await confirmDialog({
      title: "Konfirmasi Logout Sesi",
      description:
        "Apakah Anda yakin ingin keluar dari sesi akun Manajerku saat ini?",
      detailText: authSession
        ? `${authSession.fullName} (${authSession.role})`
        : undefined,
      confirmLabel: "Ya, Logout",
      cancelLabel: "Batal",
      variant: "danger",
    });
    if (!ok) return;
    setAccountMenuOpen(false);
    await fetch("/api/v1/auth/logout", { method: "POST" });
    clearSessionToLogin();
  };

  const onNavigateTab = useCallback(
    (tab: string) => {
      if (tab.startsWith("suppliers:")) {
        const pid = tab.slice("suppliers:".length).trim();
        if (pid) {
          setPreselectedSupplierProductId(pid);
        }
        router.push(TAB_ROUTE_MAP.suppliers);
        return;
      }
      const targetRoute =
        TAB_ROUTE_MAP[tab as ActiveTabKey] ??
        (tab.startsWith("/") ? tab : "/");
      router.push(targetRoute);
    },
    [router]
  );

  const handleHeaderTempSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authSession) return;
    const ok = await confirmDialog({
      title: "Simpan Perubahan Suhu Freezer?",
      description:
        "Catatan suhu rantai dingin toko akan diperbarui di database dan memengaruhi status pemantauan stok beku.",
      detailText: `Suhu baru: ${tempInput}°C (${authSession.store.coldChainCode})`,
      confirmLabel: "Ya, Simpan Suhu",
      cancelLabel: "Batal",
      variant: "primary",
    });
    if (!ok) return;
    setTempSaving(true);
    setTempFeedback(null);
    try {
      const res = await fetch("/api/v1/stores/cold-chain-temp", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: authSession.storeId,
          temperatureC: Number(tempInput),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setTempFeedback(`Berhasil diperbarui: ${json.data.statusLabel}`);
        await checkCurrentSession();
        setDashboardRefreshKey((k) => k + 1);
        setTimeout(() => {
          setShowHeaderTempModal(false);
          setTempFeedback(null);
        }, 700);
      } else {
        setTempFeedback(json.error?.message || "Gagal memperbarui suhu.");
      }
    } finally {
      setTempSaving(false);
    }
  };

  const contextValue = useMemo<AppShellContextValue | null>(() => {
    if (!authSession) return null;
    return {
      authSession,
      setAuthSession,
      checkCurrentSession,
      onNavigateTab,
      preselectedSupplierProductId,
      clearPreselectedSupplierProductId,
      pendingDashboardModal,
      clearPendingDashboardModal,
      dashboardRefreshKey,
      clearSessionToLogin,
    };
  }, [
    authSession,
    checkCurrentSession,
    onNavigateTab,
    preselectedSupplierProductId,
    clearPreselectedSupplierProductId,
    pendingDashboardModal,
    clearPendingDashboardModal,
    dashboardRefreshKey,
    clearSessionToLogin,
  ]);

  if (authChecking || !authSession || !contextValue) {
    return (
      <AppShellContext.Provider value={null}>
        <AuthSessionCheckingScreen message="Memverifikasi sesi autentikasi..." />
        {children}
      </AppShellContext.Provider>
    );
  }

  const activeRole = authSession.role;
  const isTempStable = authSession.store.lastRecordedTempC <= -15.0;
  const displayBrandName =
    authSession.store.name === "Manajerku Frozen Food"
      ? "Manajerku"
      : authSession.store.name;

  const isSidebarExpanded = sidebarHovered;

  const sidebarNavItems: Array<{
    key:
      | "dashboard"
      | "pos"
      | "inventory"
      | "suppliers"
      | "whatsapp"
      | "promo"
      | "finance";
    href: string;
    label: string;
    mobileLabel: string;
    showOnMobile: boolean;
    isActive: boolean;
  }> = [
    {
      key: "dashboard",
      href: TAB_ROUTE_MAP.dashboard,
      label: "Command Center",
      mobileLabel: "Ringkasan",
      showOnMobile: true,
      isActive: activeTab === "dashboard",
    },
    {
      key: "pos",
      href: TAB_ROUTE_MAP.pos,
      label: "Smart POS Kasir",
      mobileLabel: "Kasir",
      showOnMobile: true,
      isActive: activeTab === "pos",
    },
    {
      key: "inventory",
      href: TAB_ROUTE_MAP.inventory,
      label: "Inventaris & FEFO",
      mobileLabel: "Stok FEFO",
      showOnMobile: true,
      isActive: activeTab === "inventory",
    },
    {
      key: "suppliers",
      href: TAB_ROUTE_MAP.suppliers,
      label: "Database Supplier",
      mobileLabel: "Supplier",
      showOnMobile: true,
      isActive: activeTab === "suppliers",
    },
    {
      key: "whatsapp",
      href: TAB_ROUTE_MAP.whatsapp,
      label: "Agen AI WhatsApp",
      mobileLabel: "AI WA",
      showOnMobile: false,
      isActive: activeTab === "whatsapp",
    },
    {
      key: "promo",
      href: TAB_ROUTE_MAP.promo,
      label: "Promo Reseller FEFO",
      mobileLabel: "Promo",
      showOnMobile: false,
      isActive: activeTab === "promo",
    },
    {
      key: "finance",
      href: TAB_ROUTE_MAP.finance,
      label: "Buku Kas & KUR",
      mobileLabel: "Keuangan",
      showOnMobile: true,
      isActive: activeTab === "finance",
    },
  ];

  const primaryRailItems = sidebarNavItems.filter((item) => item.showOnMobile);

  const openDashboardModal = (modal: "ACCESS" | "ONBOARDING") => {
    setAccountMenuOpen(false);
    setPendingDashboardModal(modal);
    if (activeTab !== "dashboard") {
      router.push(TAB_ROUTE_MAP.dashboard);
    }
  };

  return (
    <AppShellContext.Provider value={contextValue}>
      <div className="min-h-screen flex print:block print:min-h-0 bg-[#F5F7F8] print:bg-white text-[#0F172A]">
        {/* Desktop Smooth Hover Minimize/Maximize Left Sidebar */}
        <aside
          aria-label="Navigasi utama"
          data-expanded={isSidebarExpanded ? "true" : "false"}
          onMouseEnter={handleSidebarMouseEnter}
          onMouseLeave={handleSidebarMouseLeave}
          className={`print:hidden hidden md:flex sticky top-0 h-screen z-40 bg-white border-r border-[#E6ECEA] shrink-0 flex-col justify-between pt-4 pb-12 px-[14px] overflow-hidden will-change-[width] transition-[width,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            isSidebarExpanded
              ? "w-[236px] shadow-[4px_0_20px_rgba(15,23,42,0.05)]"
              : "w-[72px] shadow-none"
          }`}
        >
          <div className="flex flex-col w-full min-w-0">
            {/* Brand Header */}
            <Link
              href={TAB_ROUTE_MAP.dashboard}
              title="Manajerku Command Center"
              aria-label="Manajerku Command Center"
              className="flex items-center h-11 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
            >
              <span className="w-11 h-11 flex items-center justify-center shrink-0">
                <span className="w-10 h-10 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white font-bold text-[17px] flex items-center justify-center shadow-xs transition-colors">
                  M
                </span>
              </span>
              <span
                className={`ml-1.5 text-[15px] font-bold text-[#0F172A] tracking-tight whitespace-nowrap transition-[opacity,transform] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  isSidebarExpanded
                    ? "opacity-100 translate-x-0"
                    : "opacity-0 -translate-x-1.5 pointer-events-none"
                }`}
              >
                Manajerku
              </span>
            </Link>

            {/* 7 Primary Module Navigation Links with Fixed Icon Column & Smooth Label Fade */}
            <nav
              aria-label="Menu modul utama"
              className="mt-5 flex flex-col gap-1.5 w-full"
            >
              {sidebarNavItems.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={item.isActive ? "page" : undefined}
                  className={`h-11 w-full rounded-xl flex items-center overflow-hidden transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352] ${
                    item.isActive
                      ? "bg-[#D7F0E6] text-[#0F6352] font-semibold"
                      : "text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A] font-medium"
                  }`}
                >
                  <span className="w-11 h-11 flex items-center justify-center shrink-0">
                    <NavIcon iconKey={item.key} className="w-5 h-5 shrink-0" />
                  </span>
                  <span
                    className={`ml-1 pr-3 text-[13px] leading-tight whitespace-nowrap truncate transition-[opacity,transform] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      isSidebarExpanded
                        ? "opacity-100 translate-x-0"
                        : "opacity-0 -translate-x-1.5 pointer-events-none"
                    }`}
                  >
                    {item.label}
                  </span>
                </Link>
              ))}
            </nav>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 print:block">
          {/* Top Bar */}
          <header className="print:hidden h-14 bg-white border-b border-[#E6ECEA] px-4 sm:px-7 flex items-center justify-between gap-3 sticky top-0 z-30">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <Link
                href={TAB_ROUTE_MAP.dashboard}
                aria-label="Beranda Manajerku"
                className="md:hidden w-8 h-8 rounded-lg bg-[#0F6352] text-white font-bold text-sm flex items-center justify-center shrink-0"
              >
                M
              </Link>
              <span className="text-[15px] font-bold text-[#0F172A] tracking-tight truncate">
                {displayBrandName}
              </span>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setTempInput(String(authSession.store.lastRecordedTempC));
                  setTempFeedback(null);
                  setShowHeaderTempModal(true);
                }}
                title="Klik untuk perbarui log suhu freezer"
                className={`min-h-[44px] sm:min-h-[36px] px-3 sm:px-3.5 py-1.5 rounded-full border text-xs font-medium inline-flex items-center gap-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352] ${
                  isTempStable
                    ? "bg-[#F1F5F9] hover:bg-[#E2E8F0] border-[#E2E8F0] text-[#334155]"
                    : "bg-red-50 hover:bg-red-100 border-red-200 text-red-700"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isTempStable ? "bg-[#10B981]" : "bg-red-600"
                  }`}
                />
                <span className="whitespace-nowrap">
                  {isTempStable
                    ? `Suhu Chiller: ${authSession.store.lastRecordedTempC}°C`
                    : `Peringatan Suhu: ${authSession.store.lastRecordedTempC}°C`}
                </span>
              </button>

              <div className="relative" ref={accountMenuRef}>
                <button
                  type="button"
                  onClick={() => setAccountMenuOpen((prev) => !prev)}
                  aria-label="Menu Akun & Pengaturan"
                  aria-expanded={accountMenuOpen}
                  title={`${authSession.fullName} (${authSession.role})`}
                  className="w-11 h-11 sm:w-9 sm:h-9 rounded-full bg-[#0F6352] hover:bg-[#0B4F41] text-white flex items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
                >
                  <UserCircleIcon className="w-5 h-5" />
                </button>

                {accountMenuOpen && (
                  <div
                    role="menu"
                    aria-label="Menu akun pengguna"
                    className="absolute right-0 mt-2 w-64 bg-white rounded-2xl border border-[#E2E8F0] shadow-lg p-2 z-50 text-xs"
                  >
                    <div className="px-3 py-2 border-b border-[#F1F5F9]">
                      <div className="font-bold text-[#0F172A] truncate">
                        {authSession.fullName}
                      </div>
                      <div className="text-[11px] text-[#64748B] mt-0.5">
                        Peran: {authSession.role} •{" "}
                        {authSession.store.coldChainCode}
                      </div>
                    </div>
                    <div className="py-1 space-y-0.5">
                      <Link
                        href={TAB_ROUTE_MAP.auth}
                        role="menuitem"
                        onClick={() => setAccountMenuOpen(false)}
                        className="block w-full text-left px-3 py-2 rounded-xl hover:bg-[#F8FAFC] font-medium text-[#334155]"
                      >
                        Profil &amp; Keamanan
                      </Link>
                      <Link
                        href={TAB_ROUTE_MAP.suppliers}
                        role="menuitem"
                        onClick={() => setAccountMenuOpen(false)}
                        className="block w-full text-left px-3 py-2 rounded-xl hover:bg-[#F8FAFC] font-medium text-[#334155]"
                      >
                        Discovery Supplier
                      </Link>
                      <Link
                        href={TAB_ROUTE_MAP.promo}
                        role="menuitem"
                        onClick={() => setAccountMenuOpen(false)}
                        className="block w-full text-left px-3 py-2 rounded-xl hover:bg-[#F8FAFC] font-medium text-[#334155]"
                      >
                        Promo Reseller FEFO
                      </Link>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openDashboardModal("ACCESS")}
                        className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#F8FAFC] font-medium text-[#334155]"
                      >
                        Role &amp; Paket ({activeRole})
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openDashboardModal("ONBOARDING")}
                        className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#F8FAFC] font-medium text-[#0F6352]"
                      >
                        + Onboarding Toko Baru (5 Menit)
                      </button>
                    </div>
                    <div className="pt-1 border-t border-[#F1F5F9]">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={handleLogout}
                        className="w-full text-left px-3 py-2 rounded-xl hover:bg-red-50 font-semibold text-red-600"
                      >
                        Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Active Route View */}
          <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-7 pb-24 md:pb-8 print:p-0 print:pb-0 max-w-[1320px] print:max-w-full w-full mx-auto">
            {children}
          </main>
        </div>

        {/* Mobile Bottom Navigation Bar (< md) */}
        <nav
          aria-label="Navigasi mobile"
          className="print:hidden md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[#E6ECEA] flex items-center justify-around px-1 py-1.5"
        >
          {primaryRailItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-label={item.label}
              aria-current={item.isActive ? "page" : undefined}
              className={`min-h-[44px] min-w-[44px] px-2 py-1 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
                item.isActive
                  ? "bg-[#D7F0E6] text-[#0F6352]"
                  : "text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              <NavIcon iconKey={item.key} className="w-5 h-5" />
              <span>{item.mobileLabel}</span>
            </Link>
          ))}
          <Link
            href={TAB_ROUTE_MAP.auth}
            aria-label="Akun"
            aria-current={activeTab === "auth" ? "page" : undefined}
            className={`min-h-[44px] min-w-[44px] px-2 py-1 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
              activeTab === "auth"
                ? "bg-[#D7F0E6] text-[#0F6352]"
                : "text-[#64748B] hover:text-[#0F172A]"
            }`}
          >
            <UserCircleIcon className="w-5 h-5" />
            <span>Akun</span>
          </Link>
        </nav>

        {/* Cold-Chain Chiller Temperature Modal triggered from top bar */}
        {showHeaderTempModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="header-temp-modal-title"
            className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
          >
            <form
              onSubmit={handleHeaderTempSubmit}
              className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-[#E2E8F0] space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3
                  id="header-temp-modal-title"
                  className="text-base font-bold text-[#0F172A]"
                >
                  Catat Suhu {authSession.store.coldChainCode}
                </h3>
                <button
                  type="button"
                  aria-label="Tutup dialog suhu"
                  onClick={() => setShowHeaderTempModal(false)}
                  className="min-h-[36px] min-w-[36px] rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] font-bold flex items-center justify-center"
                >
                  ✕
                </button>
              </div>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Suhu standar penyimpanan beku adalah &le; -15.0°C (optimal
                -18.4°C). Jika suhu naik di atas -15.0°C, sistem memicu
                peringatan rantai dingin.
              </p>
              <div>
                <label
                  htmlFor="header-chiller-temp-input"
                  className="block text-xs font-semibold text-[#334155] mb-1.5"
                >
                  Suhu Chiller / Chest Freezer (°C)
                </label>
                <input
                  id="header-chiller-temp-input"
                  type="number"
                  step="0.1"
                  required
                  value={tempInput}
                  onChange={(e) => setTempInput(e.target.value)}
                  className="w-full px-3 py-2 min-h-[42px] rounded-xl border border-[#CBD5E1] text-sm font-bold text-[#0F172A] focus:outline-none focus:border-[#0F6352]"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowHeaderTempModal(false)}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#F1F5F9] hover:bg-[#E2E8F0] text-xs font-semibold text-[#334155]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={tempSaving}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] disabled:bg-slate-300 text-white text-xs font-semibold"
                >
                  {tempSaving ? "Menyimpan..." : "Simpan Suhu"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </AppShellContext.Provider>
  );
}
