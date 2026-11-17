"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import AuthLedgerShell from "../components/AuthLedgerShell";
import { useGooeyToastFlash } from "../components/GooeyToastProvider";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"LOGIN" | "FORGOT_PASSWORD">("LOGIN");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  useGooeyToastFlash(
    feedbackMsg,
    errorMsg,
    () => setFeedbackMsg(null),
    () => setErrorMsg(null)
  );

  // Forgot & Reset Password states
  const [forgotIdentifier, setForgotIdentifier] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/auth/me", { signal: controller.signal })
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data) {
          router.replace("/");
        }
      })
      .catch(() => {
        // Stay on login form if session check fails or aborts
      });
    return () => {
      controller.abort();
    };
  }, [router]);

  useEffect(() => {
    if (mode !== "FORGOT_PASSWORD") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMode("LOGIN");
        setErrorMsg(null);
        setFeedbackMsg(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier,
          password,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setErrorMsg(
          json.error?.message ||
            "Email, nomor WhatsApp, atau password yang Anda masukkan salah."
        );
        setLoading(false);
      } else {
        router.replace("/");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menghubungi server."
      );
      setLoading(false);
    }
  };

  const handleRequestResetToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      const res = await fetch("/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: forgotIdentifier }),
      });
      const json = await res.json();
      if (!json.success) {
        setErrorMsg(json.error?.message || "Gagal membuat token pemulihan.");
      } else {
        setResetToken(json.data.resetToken);
        setFeedbackMsg(
          `Token pemulihan dibuat untuk ${json.data.targetEmailOrPhone}. Masukkan password baru di bawah.`
        );
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menghubungi server."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      const res = await fetch("/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RESET",
          resetToken,
          newPassword,
          newPasswordConfirmation: newPasswordConfirm,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setErrorMsg(json.error?.message || "Gagal memperbarui password.");
      } else {
        setFeedbackMsg(
          "Password berhasil diperbarui. Silakan masuk dengan password baru Anda."
        );
        setIdentifier(forgotIdentifier);
        setPassword("");
        setResetToken("");
        setNewPassword("");
        setNewPasswordConfirm("");
        setMode("LOGIN");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menghubungi server."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLedgerShell
      headerActionHref="/register"
      headerActionLabel="Daftarkan Toko"
      headerPromptText="Belum punya akun toko?"
      maxWidthClass="max-w-[400px]"
      quoteTagline="MANAJERKU COLD-CHAIN"
      heroLines={["Kendalikan", "Stok & Kas", "Lebih Cerdas"]}
      heroSubtitle="Anda dapat mengoptimalkan seluruh rantai dingin toko jika memantau stok FEFO, kasir multi-satuan, dan arus kas kulakan secara disiplin."
    >
      <div className="space-y-7">
        {mode === "LOGIN" ? (
          <>
            {/* Centered Editorial Heading */}
            <div className="text-center space-y-2">
              <h1 className="font-serif text-[32px] sm:text-[36px] font-medium tracking-tight text-[#0F172A] leading-tight">
                Masuk ke Manajerku
              </h1>
              <p className="text-xs sm:text-[13px] text-[#64748B] leading-relaxed">
                Masukkan email atau nomor WhatsApp dan password untuk mengakses
                akun toko Anda
              </p>
            </div>

            <form
              onSubmit={handleLoginSubmit}
              aria-busy={loading}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="login-identifier"
                  className="block text-xs font-semibold text-[#1E293B]"
                >
                  Email atau Nomor WhatsApp
                </label>
                <input
                  id="login-identifier"
                  name="identifier"
                  type="text"
                  autoComplete="username"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Masukkan email atau nomor WhatsApp"
                  className="w-full h-11 px-4 rounded-xl bg-[#F4F6F5] hover:bg-[#EDF1EF] focus:bg-white border border-transparent focus:border-[#0F6352] text-sm text-[#0F172A] placeholder:text-[#94A3B8] transition-all outline-none focus:ring-3 focus:ring-[#0F6352]/12"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="login-password"
                  className="block text-xs font-semibold text-[#1E293B]"
                >
                  Password
                </label>

                <div className="relative flex items-center">
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Masukkan password Anda"
                    className="w-full h-11 pl-4 pr-11 rounded-xl bg-[#F4F6F5] hover:bg-[#EDF1EF] focus:bg-white border border-transparent focus:border-[#0F6352] text-sm text-[#0F172A] placeholder:text-[#94A3B8] transition-all outline-none focus:ring-3 focus:ring-[#0F6352]/12"
                  />
                  <button
                    type="button"
                    aria-pressed={showPassword}
                    aria-label={
                      showPassword
                        ? "Sembunyikan password"
                        : "Tampilkan password"
                    }
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2.5 w-8 h-8 inline-flex items-center justify-center text-[#64748B] hover:text-[#0F172A] rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
                  >
                    {showPassword ? (
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
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <line x1="1" y1="1" x2="23" y2="23" />
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
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>

                {/* Remember Me & Forgot Password Row */}
                <div className="flex items-center justify-between pt-1.5 text-xs">
                  <label className="inline-flex items-center gap-2 text-[#475569] select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-[#CBD5E1] accent-[#0F6352]"
                    />
                    <span>Ingat saya</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      setMode("FORGOT_PASSWORD");
                      setErrorMsg(null);
                      setFeedbackMsg(null);
                    }}
                    className="font-medium text-[#1E293B] hover:text-[#0F6352] transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352] rounded"
                  >
                    Lupa Password?
                  </button>
                </div>
              </div>

              <div className="pt-2 space-y-2.5">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 px-4 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] active:bg-[#083B30] disabled:bg-[#94A3B8] text-white text-sm font-semibold shadow-[0_6px_18px_rgba(15,99,82,0.22)] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
                >
                  {loading ? "Memverifikasi..." : "Masuk ke Dashboard"}
                </button>

                {/* Quick-Fill Demo Accounts matching Secondary Button Layout */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIdentifier("mhukmanfathir@gmail.com");
                      setPassword("Orienix2026!");
                      setErrorMsg(null);
                    }}
                    className="h-10 px-3 rounded-xl border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] active:bg-[#F1F5F9] text-xs font-semibold text-[#1E293B] inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
                  >
                    <span className="w-2 h-2 rounded-full bg-[#0F6352] shrink-0" />
                    <span className="truncate">Pemilik Toko (Owner)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIdentifier("dandy@manajerku.id");
                      setPassword("Kasir2026!");
                      setErrorMsg(null);
                    }}
                    className="h-10 px-3 rounded-xl border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] active:bg-[#F1F5F9] text-xs font-semibold text-[#1E293B] inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
                  >
                    <span className="w-2 h-2 rounded-full bg-[#0D9488] shrink-0" />
                    <span className="truncate">Staf Kasir 01 (Cashier)</span>
                  </button>
                </div>
              </div>
            </form>
          </>
        ) : (
          <div className="space-y-5">
            <div className="text-center space-y-1.5">
              <h1 className="font-serif text-[28px] sm:text-[32px] font-medium tracking-tight text-[#0F172A]">
                Pulihkan Akses Akun
              </h1>
              <p className="text-xs sm:text-[13px] text-[#64748B]">
                Buat token pemulihan untuk mengatur ulang password akun toko Anda
              </p>
            </div>

            <form
              onSubmit={handleRequestResetToken}
              aria-busy={loading}
              className="space-y-3"
            >
              <label
                htmlFor="forgot-identifier"
                className="block text-xs font-semibold text-[#1E293B]"
              >
                Email atau Nomor WhatsApp Terdaftar
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="forgot-identifier"
                  type="text"
                  required
                  value={forgotIdentifier}
                  onChange={(e) => setForgotIdentifier(e.target.value)}
                  placeholder="mhukmanfathir@gmail.com"
                  className="flex-1 h-11 px-4 rounded-xl bg-[#F4F6F5] focus:bg-white border border-transparent focus:border-[#0F6352] text-sm text-[#0F172A] placeholder:text-[#94A3B8] outline-none"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="h-11 px-4 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] disabled:bg-[#94A3B8] text-white text-xs font-semibold transition-colors shrink-0"
                >
                  {loading ? "Memproses..." : "Minta Token"}
                </button>
              </div>
            </form>

            {resetToken && (
              <form
                onSubmit={handleExecuteResetPassword}
                aria-busy={loading}
                className="pt-4 border-t border-[#E2E8F0] space-y-3.5"
              >
                <div className="space-y-1">
                  <label
                    htmlFor="reset-token"
                    className="block text-xs font-semibold text-[#1E293B]"
                  >
                    Token Pemulihan
                  </label>
                  <input
                    id="reset-token"
                    type="text"
                    required
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    className="w-full h-11 px-4 rounded-xl bg-[#F4F6F5] text-sm font-mono text-[#0F172A] outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="reset-new-password"
                    className="block text-xs font-semibold text-[#1E293B]"
                  >
                    Password Baru
                  </label>
                  <div className="relative flex items-center">
                    <input
                      id="reset-new-password"
                      type={showNewPassword ? "text" : "password"}
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimal 8 karakter huruf dan angka"
                      className="w-full h-11 pl-4 pr-11 rounded-xl bg-[#F4F6F5] focus:bg-white border border-transparent focus:border-[#0F6352] text-sm text-[#0F172A] outline-none"
                    />
                    <button
                      type="button"
                      aria-pressed={showNewPassword}
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      className="absolute right-2.5 w-8 h-8 inline-flex items-center justify-center text-[#64748B] hover:text-[#0F172A] rounded-lg"
                    >
                      {showNewPassword ? "Sembunyi" : "Lihat"}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="reset-confirm-password"
                    className="block text-xs font-semibold text-[#1E293B]"
                  >
                    Konfirmasi Password Baru
                  </label>
                  <input
                    id="reset-confirm-password"
                    type={showNewPassword ? "text" : "password"}
                    required
                    value={newPasswordConfirm}
                    onChange={(e) => setNewPasswordConfirm(e.target.value)}
                    placeholder="Ulangi password baru"
                    className="w-full h-11 px-4 rounded-xl bg-[#F4F6F5] focus:bg-white border border-transparent focus:border-[#0F6352] text-sm text-[#0F172A] outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 px-4 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white text-sm font-semibold transition-colors"
                >
                  {loading ? "Menyimpan..." : "Simpan Password Baru"}
                </button>
              </form>
            )}

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setMode("LOGIN");
                  setErrorMsg(null);
                  setFeedbackMsg(null);
                }}
                className="text-xs font-semibold text-[#0F6352] hover:underline"
              >
                ← Kembali ke halaman masuk
              </button>
            </div>
          </div>
        )}
      </div>
    </AuthLedgerShell>
  );
}
