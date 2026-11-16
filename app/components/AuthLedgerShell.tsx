import React from "react";
import Link from "next/link";

interface AuthLedgerShellProps {
  headerActionHref: "/login" | "/register";
  headerActionLabel: string;
  headerPromptText: string;
  maxWidthClass?: string;
  children: React.ReactNode;
}

export function AuthSessionCheckingScreen({
  message = "Memeriksa sesi autentikasi...",
}: {
  message?: string;
}) {
  return (
    <div className="min-h-screen bg-[#F7F6F2] text-[#181C1B] flex items-center justify-center p-6">
      <div className="text-center space-y-3">
        <div
          aria-hidden="true"
          className="w-9 h-9 rounded bg-[#115E49] text-white font-semibold flex items-center justify-center text-base mx-auto"
        >
          M
        </div>
        <p className="text-sm text-[#555D5B]">{message}</p>
      </div>
    </div>
  );
}

export default function AuthLedgerShell({
  headerActionHref,
  headerActionLabel,
  headerPromptText,
  maxWidthClass = "max-w-[440px]",
  children,
}: AuthLedgerShellProps) {
  return (
    <div className="min-h-screen bg-[#F7F6F2] text-[#181C1B] flex flex-col">
      {/* Top Navigation Header */}
      <header className="border-b border-[#E3E1DA] bg-[#FFFFFF]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link
            href="/login"
            className="inline-flex items-center gap-2.5 min-h-[44px] rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49]"
          >
            <span
              aria-hidden="true"
              className="w-8 h-8 rounded bg-[#115E49] text-white font-semibold flex items-center justify-center text-sm shrink-0"
            >
              M
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight text-[#181C1B]">
                Manajerku
              </span>
              <span className="text-xs text-[#555D5B] hidden sm:inline">
                Micro-ERP Rantai Pasok Frozen Food
              </span>
            </span>
          </Link>

          <nav aria-label="Navigasi akun" className="flex items-center gap-3">
            <span className="text-sm text-[#555D5B] hidden sm:inline">
              {headerPromptText}
            </span>
            <Link
              href={headerActionHref}
              className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg border border-[#D4D1C7] bg-[#FFFFFF] hover:bg-[#F7F6F2] active:bg-[#ECE9E0] text-sm font-medium text-[#181C1B] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49]"
            >
              {headerActionLabel}
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-start sm:items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className={`w-full ${maxWidthClass}`}>{children}</div>
      </main>

      {/* Minimal Footer */}
      <footer className="border-t border-[#E3E1DA] bg-[#FFFFFF]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#555D5B]">
          <span>Manajerku | Sistem Operasional Agen & Grosir Frozen Food</span>
          <span className="font-mono">Tim Orienix, UIN Ar-Raniry Banda Aceh</span>
        </div>
      </footer>
    </div>
  );
}

