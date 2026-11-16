"use client";

import React, { useState, useEffect, useCallback } from "react";
import CommandCenterDashboard from "./components/CommandCenterDashboard";
import SmartPosView from "./components/SmartPosView";
import InventoryFefoView from "./components/InventoryFefoView";
import SupplierDiscoveryView from "./components/SupplierDiscoveryView";
import WhatsappAgentOcrView from "./components/WhatsappAgentOcrView";
import ResellerPromoView from "./components/ResellerPromoView";
import FinanceKurView from "./components/FinanceKurView";
import AuthAccountView, {
  type AuthSessionData,
} from "./components/AuthAccountView";
import { AuthSessionCheckingScreen } from "./components/AuthLedgerShell";

export type ActiveTabKey =
  | "dashboard"
  | "pos"
  | "inventory"
  | "suppliers"
  | "whatsapp"
  | "promo"
  | "finance"
  | "auth";

export default function ManajerkuAppShell() {
  const [activeTab, setActiveTab] = useState<ActiveTabKey>("dashboard");
  const [authSession, setAuthSession] = useState<AuthSessionData | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  const checkCurrentSession = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/auth/me");
      const json = await res.json();
      if (json.success && json.data) {
        setAuthSession(json.data);
        setAuthChecking(false);
      } else {
        setAuthSession(null);
        window.location.assign("/login");
      }
    } catch {
      setAuthSession(null);
      window.location.assign("/login");
    }
  }, []);

  useEffect(() => {
    checkCurrentSession();
  }, [checkCurrentSession]);

  const handleLogout = async () => {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    setAuthSession(null);
    window.location.assign("/login");
  };

  if (authChecking || !authSession) {
    return (
      <AuthSessionCheckingScreen message="Memverifikasi sesi autentikasi..." />
    );
  }

  const activeStoreId = authSession.storeId;
  const activeRole = authSession.role;

  const navItems: Array<{
    key: ActiveTabKey;
    label: string;
    shortDesc: string;
    prdBadge: string;
  }> = [
    {
      key: "dashboard",
      label: "Command Center",
      shortDesc: "KPI, Tren 7 Hari & Tabel Sinkronisasi",
      prdBadge: "PRD-01",
    },
    {
      key: "pos",
      label: "Smart POS Kasir",
      shortDesc: "Multi-Satuan (Pack/Dus) & QRIS",
      prdBadge: "PRD-02",
    },
    {
      key: "inventory",
      label: "Stok & Batch FEFO",
      shortDesc: "Antrean Freezer & Radar Expired",
      prdBadge: "PRD-03",
    },
    {
      key: "suppliers",
      label: "Discovery Supplier",
      shortDesc: "Google Places ≤10km & ★≥4.5",
      prdBadge: "PRD-04",
    },
    {
      key: "whatsapp",
      label: "Agen AI WhatsApp",
      shortDesc: "Auto-RFQ 4 Slot, PO PDF & Vision OCR",
      prdBadge: "PRD-05/06",
    },
    {
      key: "promo",
      label: "Promo Reseller FEFO",
      shortDesc: "Broadcast Diskon 1-Klik (<30 Hr)",
      prdBadge: "PRD-07",
    },
    {
      key: "finance",
      label: "Buku Kas & KUR Bank",
      shortDesc: "Kas Kulakan, Listrik & PDF KUR",
      prdBadge: "PRD-08",
    },
    {
      key: "auth",
      label: "Profil & Keamanan",
      shortDesc: "Edit Profil & Ubah Password",
      prdBadge: "PROFIL",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-100">
      {/* Left Sidebar Navigation matching Page 8 Mockup */}
      <aside className="w-full lg:w-64 bg-slate-900 text-white shrink-0 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-800">
        <div>
          {/* Brand Logo */}
          <div className="p-4 flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500 text-slate-950 font-black flex items-center justify-center text-lg shadow-sm">
                M
              </div>
              <div>
                <div className="font-extrabold text-sm tracking-tight text-white">
                  Manajerku
                </div>
                <div className="text-[10px] text-emerald-400 font-semibold">
                  Agentic Micro-ERP • Orienix
                </div>
              </div>
            </div>
          </div>

          {/* Active User & Logout Bar in Sidebar */}
          <div className="px-4 py-3 border-b border-slate-800/80 bg-slate-950/40 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-bold text-white truncate">
                {authSession.fullName}
              </div>
              <div className="text-[10px] text-emerald-400 font-semibold">
                Peran: {authSession.role}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="px-2.5 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/30 text-[11px] font-bold transition cursor-pointer shrink-0"
            >
              Logout
            </button>
          </div>

          {/* Navigation Menu */}
          <nav className="p-3 space-y-1 flex lg:flex-col overflow-x-auto">
            {navItems.map((item) => {
              const isActive = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setActiveTab(item.key)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition flex items-center justify-between gap-2 shrink-0 lg:shrink cursor-pointer ${
                    isActive
                      ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/40"
                      : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
                  }`}
                >
                  <div>
                    <div className="text-xs font-bold">{item.label}</div>
                    <div className="text-[10px] text-slate-400 hidden lg:block">
                      {item.shortDesc}
                    </div>
                  </div>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hidden sm:inline-block">
                    {item.prdBadge}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="hidden lg:block p-4 border-t border-slate-800 text-[11px] text-slate-400 space-y-1">
          <div className="font-semibold text-slate-200">
            Tim Orienix | UIN Ar-Raniry
          </div>
          <div>
            {authSession.store.branchName} • {authSession.store.coldChainCode}
          </div>
          <div className="text-[10px] text-emerald-400">
            ● Database ACID & Auth Session Aktif
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-800">
              {authSession.store.name}
            </span>
            <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
              Store ID: {activeStoreId}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              {authSession.store.coldChainCode} •{" "}
              {authSession.store.lastRecordedTempC}°C
            </span>
            <button
              onClick={() => setActiveTab("auth")}
              className="px-3 py-1 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-semibold cursor-pointer"
            >
              {authSession.fullName} ({authSession.role})
            </button>
          </div>
        </header>

        {/* Active Module View */}
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          {activeTab === "dashboard" && (
            <CommandCenterDashboard
              activeStoreId={activeStoreId}
              activeRole={activeRole}
              onNavigateTab={(t) => setActiveTab(t as ActiveTabKey)}
              onStoreChanged={() => {
                checkCurrentSession();
                setActiveTab("dashboard");
              }}
            />
          )}
          {activeTab === "pos" && (
            <SmartPosView
              activeStoreId={activeStoreId}
              activeRole={activeRole}
              onNavigateTab={(t) => setActiveTab(t as ActiveTabKey)}
            />
          )}
          {activeTab === "inventory" && (
            <InventoryFefoView
              activeStoreId={activeStoreId}
              activeRole={activeRole}
              onNavigateTab={(t) => setActiveTab(t as ActiveTabKey)}
            />
          )}
          {activeTab === "suppliers" && (
            <SupplierDiscoveryView
              activeStoreId={activeStoreId}
              activeRole={activeRole}
              onNavigateTab={(t) => setActiveTab(t as ActiveTabKey)}
            />
          )}
          {activeTab === "whatsapp" && (
            <WhatsappAgentOcrView
              activeStoreId={activeStoreId}
              activeRole={activeRole}
            />
          )}
          {activeTab === "promo" && (
            <ResellerPromoView
              activeStoreId={activeStoreId}
              activeRole={activeRole}
              onNavigateTab={(t) => setActiveTab(t as ActiveTabKey)}
            />
          )}
          {activeTab === "finance" && (
            <FinanceKurView
              activeStoreId={activeStoreId}
              activeRole={activeRole}
            />
          )}
          {activeTab === "auth" && (
            <AuthAccountView
              currentSession={authSession}
              onAuthSuccess={(session) => {
                setAuthSession(session);
              }}
              onLogoutSuccess={() => {
                setAuthSession(null);
                window.location.assign("/login");
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
