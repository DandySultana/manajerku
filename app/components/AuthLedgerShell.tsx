import React from "react";
import Link from "next/link";

interface AuthLedgerShellProps {
  headerActionHref: "/login" | "/register";
  headerActionLabel: string;
  headerPromptText: string;
  maxWidthClass?: string;
  quoteTagline?: string;
  heroLines?: [string, string, string];
  heroSubtitle?: string;
  children: React.ReactNode;
}

export function AuthSessionCheckingScreen({
  message = "Memuat ruang kerja Manajerku...",
}: {
  message?: string;
}) {
  return (
    <div
      className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col md:flex-row"
      role="status"
      aria-busy="true"
      aria-label={message}
    >
      {/* Left Sidebar Rail Skeleton (matches md:w-[72px] collapsed sidebar) */}
      <aside
        aria-hidden="true"
        className="hidden md:flex md:w-[72px] shrink-0 bg-white border-r border-[#E6ECEA] flex-col items-center py-4 gap-4 animate-pulse"
      >
        <div className="w-9 h-9 rounded-xl bg-[#0F6352]/85" />
        <div className="w-8 h-px bg-[#E6ECEA]" />
        <div className="flex flex-col items-center gap-2.5 w-full px-3">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="w-11 h-11 rounded-xl bg-[#F1F5F9]" />
          ))}
        </div>
      </aside>

      {/* Main Content Column Skeleton */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Skeleton (matches h-16 header) */}
        <header className="h-16 bg-white border-b border-[#E6ECEA] px-4 sm:px-6 lg:px-7 flex items-center justify-between gap-4 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="h-5 w-44 rounded-lg bg-[#E2E8F0]" />
            <div className="h-6 w-28 rounded-full bg-[#F1F5F9] hidden sm:block" />
          </div>
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-32 rounded-xl bg-[#F1F5F9] hidden sm:block" />
            <div className="h-9 w-28 rounded-xl bg-[#E2E8F0]" />
          </div>
        </header>

        {/* Active View Structural Skeleton */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-7 max-w-[1320px] w-full mx-auto space-y-6 animate-pulse">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="h-7 w-64 sm:w-80 rounded-lg bg-[#E2E8F0]" />
              <div className="h-4 w-72 sm:w-96 rounded-md bg-[#F1F5F9]" />
            </div>
            <div className="flex items-center gap-2.5">
              <div className="h-10 w-36 rounded-xl bg-[#E2E8F0]" />
              <div className="h-10 w-40 rounded-xl bg-[#D7F0E6]/70" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((idx) => (
              <div
                key={idx}
                className="min-h-[138px] rounded-2xl bg-white border border-[#E5E9EC] p-5 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="h-3.5 w-32 rounded bg-[#E2E8F0]" />
                  <div className="h-5 w-16 rounded-full bg-[#F1F5F9]" />
                </div>
                <div className="my-2">
                  <div className="h-7 w-40 rounded-lg bg-[#CBD5E1]" />
                </div>
                <div className="h-3 w-36 rounded bg-[#F1F5F9]" />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-7 h-72 rounded-2xl bg-white border border-[#E5E9EC] p-5 space-y-4">
              <div className="h-4 w-48 rounded bg-[#E2E8F0]" />
              <div className="h-52 rounded-xl bg-[#F8FAFC] border border-[#F1F5F9]" />
            </div>
            <div className="lg:col-span-5 h-72 rounded-2xl bg-white border border-[#E5E9EC] p-5 space-y-3">
              <div className="h-4 w-44 rounded bg-[#E2E8F0]" />
              <div className="h-14 rounded-xl bg-[#F8FAFC] border border-[#E5E9EC]" />
              <div className="h-14 rounded-xl bg-[#F8FAFC] border border-[#E5E9EC]" />
              <div className="h-14 rounded-xl bg-[#F8FAFC] border border-[#E5E9EC]" />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function AuthLedgerShell({
  headerActionHref,
  headerActionLabel,
  headerPromptText,
  maxWidthClass = "max-w-[400px]",
  quoteTagline = "MANAJERKU COLD-CHAIN",
  heroLines = ["Kendalikan", "Stok & Kas", "Lebih Cerdas"],
  heroSubtitle = "Kelola kasir multi-satuan, antrean rantai dingin FEFO, negosiasi kulakan OpenWA, dan laporan KUR Bank dalam satu kendali.",
  children,
}: AuthLedgerShellProps) {
  return (
    <div className="w-full min-h-screen lg:h-screen lg:overflow-hidden bg-white text-[#0F172A] p-2.5 sm:p-3.5 grid grid-cols-1 lg:grid-cols-12 gap-2.5 lg:gap-4">
      {/* Left Panel: Deep Pine Emerald & Cold-Chain Frost Silk Waves + Editorial Typography */}
      <aside
        aria-label="Filosofi operasional Manajerku"
        className="lg:col-span-6 relative rounded-[20px] sm:rounded-[26px] overflow-hidden bg-[#030D0A] flex flex-col justify-between p-7 sm:p-10 lg:p-11 min-h-[320px] lg:h-full text-white select-none"
      >
          {/* Multi-layered 3D Flowing Silk Ribbon Artwork in Manajerku Pine-Emerald & Frost-Cyan Theme */}
          <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
            {/* Ambient base glows */}
            <div
              className="absolute -top-24 -left-20 w-[440px] h-[440px] rounded-full opacity-75 blur-[70px]"
              style={{
                background:
                  "radial-gradient(circle, #0F6352 0%, #06382C 55%, transparent 100%)",
              }}
            />
            <div
              className="absolute top-[18%] -right-24 w-[480px] h-[420px] rounded-full opacity-80 blur-[65px]"
              style={{
                background:
                  "radial-gradient(circle, #10B981 0%, #0F6352 50%, transparent 100%)",
              }}
            />
            <div
              className="absolute top-[38%] left-[8%] w-[420px] h-[340px] rounded-full opacity-75 blur-[60px]"
              style={{
                background:
                  "radial-gradient(circle, #06B6D4 0%, #0D9488 45%, transparent 100%)",
              }}
            />
            <div
              className="absolute bottom-[-12%] right-[-10%] w-[460px] h-[380px] rounded-full opacity-65 blur-[70px]"
              style={{
                background:
                  "radial-gradient(circle, #047857 0%, #064E3B 55%, transparent 100%)",
              }}
            />

            {/* Flowing 3D Silk Ribbon Waves SVG */}
            <svg
              viewBox="0 0 800 1000"
              preserveAspectRatio="xMidYMid slice"
              className="absolute inset-0 w-full h-full"
            >
              <defs>
                <linearGradient id="mjk-ribbon-1" x1="0%" y1="0%" x2="100%" y2="85%">
                  <stop offset="0%" stopColor="#04241C" />
                  <stop offset="35%" stopColor="#0F6352" />
                  <stop offset="70%" stopColor="#34D399" />
                  <stop offset="100%" stopColor="#A7F3D0" />
                </linearGradient>
                <linearGradient id="mjk-ribbon-2" x1="100%" y1="10%" x2="0%" y2="90%">
                  <stop offset="0%" stopColor="#064E3B" />
                  <stop offset="40%" stopColor="#10B981" />
                  <stop offset="75%" stopColor="#6EE7B7" />
                  <stop offset="100%" stopColor="#083B30" />
                </linearGradient>
                <linearGradient id="mjk-ribbon-3" x1="0%" y1="30%" x2="100%" y2="70%">
                  <stop offset="0%" stopColor="#022C22" />
                  <stop offset="30%" stopColor="#0D9488" />
                  <stop offset="65%" stopColor="#38BDF8" />
                  <stop offset="90%" stopColor="#BAE6FD" />
                  <stop offset="100%" stopColor="#0F6352" />
                </linearGradient>
                <linearGradient id="mjk-ribbon-4" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#02100C" />
                  <stop offset="45%" stopColor="#064E3B" />
                  <stop offset="80%" stopColor="#0F6352" />
                  <stop offset="100%" stopColor="#14B8A6" />
                </linearGradient>
                <linearGradient id="mjk-bottom-fade" x1="0%" y1="55%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#030D0A" stopOpacity="0" />
                  <stop offset="65%" stopColor="#030D0A" stopOpacity="0.72" />
                  <stop offset="100%" stopColor="#030D0A" stopOpacity="0.95" />
                </linearGradient>
              </defs>

              {/* Upper sweeping emerald-mint silk fold */}
              <path
                d="M-120,60 C160,-40 420,180 880,150 L880,440 C480,380 240,220 -120,310 Z"
                fill="url(#mjk-ribbon-1)"
                opacity="0.88"
              />
              {/* Luminous central fold with specular highlight */}
              <path
                d="M-100,190 C190,110 470,310 890,260 L890,530 C490,520 210,340 -100,450 Z"
                fill="url(#mjk-ribbon-2)"
                opacity="0.92"
              />
              {/* Cold-chain frost cyan-teal ribbon wave */}
              <path
                d="M-110,370 C180,290 420,510 880,390 L880,660 C470,710 220,490 -110,610 Z"
                fill="url(#mjk-ribbon-3)"
                opacity="0.86"
              />
              {/* Lower deep forest wave */}
              <path
                d="M-100,560 C210,470 500,660 890,820 L890,1040 L-100,1040 Z"
                fill="url(#mjk-ribbon-4)"
                opacity="0.9"
              />

              {/* Crisp silk contour lines */}
              <path
                d="M-100,190 C190,110 470,310 890,260"
                fill="none"
                stroke="#D1FAE5"
                strokeWidth="2.2"
                strokeOpacity="0.55"
              />
              <path
                d="M-110,370 C180,290 420,510 880,390"
                fill="none"
                stroke="#E0F2FE"
                strokeWidth="2.5"
                strokeOpacity="0.65"
              />
              <path
                d="M-100,480 C210,390 460,590 890,490"
                fill="none"
                stroke="#6EE7B7"
                strokeWidth="1.6"
                strokeOpacity="0.4"
              />
              <path
                d="M-100,560 C210,470 500,660 890,820"
                fill="none"
                stroke="#34D399"
                strokeWidth="1.8"
                strokeOpacity="0.35"
              />

              {/* Bottom editorial vignette so white serif headline is ultra-legible */}
              <rect
                x="0"
                y="0"
                width="800"
                height="1000"
                fill="url(#mjk-bottom-fade)"
              />
            </svg>
          </div>

          {/* Top-Left Quote Tagline + Horizontal Line */}
          <div className="relative z-10 flex items-center gap-4">
            <span className="text-[11px] font-medium tracking-[0.22em] uppercase text-white/90">
              {quoteTagline}
            </span>
            <span className="h-px w-20 sm:w-28 bg-white/45" />
          </div>

          {/* Bottom-Left Editorial Display Headline & Caption */}
          <div className="relative z-10 mt-auto pt-16 space-y-4">
            <div className="font-serif text-[38px] sm:text-[46px] lg:text-[52px] font-medium leading-[1.05] tracking-[-0.02em] text-white">
              {heroLines.map((line, idx) => (
                <div key={idx}>{line}</div>
              ))}
            </div>
            <p className="text-xs sm:text-[13px] text-white/80 leading-relaxed max-w-[360px]">
              {heroSubtitle}
            </p>
          </div>
        </aside>

        {/* Right Panel: Centered Brand Header + Form + Bottom Prompt */}
        <div className="lg:col-span-6 lg:h-full flex flex-col justify-between px-4 py-4 sm:px-10 sm:py-6 lg:px-12 lg:py-7 bg-white overflow-y-auto">
          {/* Top Center Brand Lockup */}
          <header className="flex items-center justify-center shrink-0">
            <Link
              href="/login"
              className="inline-flex items-center gap-2.5 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
            >
              <span
                aria-hidden="true"
                className="w-7 h-7 rounded-lg bg-[#0F6352] text-white font-bold text-xs flex items-center justify-center shadow-xs"
              >
                M
              </span>
              <span className="text-[17px] font-bold tracking-tight text-[#0F172A]">
                Manajerku
              </span>
            </Link>
          </header>

          {/* Main Centered Form Content */}
          <main className="my-auto py-3 w-full">
            <div className={`w-full ${maxWidthClass} mx-auto`}>{children}</div>
          </main>

          {/* Bottom Center Navigation Prompt */}
          <footer className="text-center text-xs sm:text-[13px] text-[#64748B] shrink-0">
            <span>{headerPromptText} </span>
            <Link
              href={headerActionHref}
              className="font-bold text-[#0F172A] hover:text-[#0F6352] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352] rounded"
            >
              {headerActionLabel}
            </Link>
          </footer>
        </div>
    </div>
  );
}
