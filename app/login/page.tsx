"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import AuthLedgerShell, {
  AuthSessionCheckingScreen,
} from "../components/AuthLedgerShell";

export default function LoginPage() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [mode, setMode] = useState<"LOGIN" | "FORGOT_PASSWORD">("LOGIN");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

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
            "Email, nomor WhatsApp, atau password yang Anda masukkan salah.",
        );
        setLoading(false);
      } else {
        router.replace("/");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menghubungi server.",
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
          `Token pemulihan dibuat untuk ${json.data.targetEmailOrPhone}. Masukkan password baru di bawah.`,
        );
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menghubungi server.",
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
          "Password berhasil diperbarui. Silakan masuk dengan password baru Anda.",
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
        err instanceof Error ? err.message : "Gagal menghubungi server.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLedgerShell
      headerActionHref="/register"
      headerActionLabel="Daftar Toko"
      headerPromptText="Belum terdaftar?"
      maxWidthClass="max-w-[440px]"
    >
      <div className="bg-[#FFFFFF] border border-[#E3E1DA] rounded-xl p-6 sm:p-8 space-y-6">
        {mode === "LOGIN" ? (
          <>
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight text-[#181C1B]">
                Masuk ke Manajerku
              </h1>
              <p className="text-sm text-[#555D5B] leading-relaxed">
                Gunakan email atau nomor WhatsApp terdaftar untuk membuka kasir,
                stok FEFO, dan pembukuan toko.
              </p>
            </div>

            {feedbackMsg && (
              <div
                role="status"
                className="p-3.5 rounded-lg bg-[#ECFDF5] border border-[#A7F3D0] text-[#0D4A39] text-sm font-medium"
              >
                {feedbackMsg}
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-sm font-medium"
              >
                {errorMsg}
              </div>
            )}

            <form
              onSubmit={handleLoginSubmit}
              aria-busy={loading}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="login-identifier"
                  className="block text-sm font-medium text-[#181C1B]"
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
                  placeholder="mhukmanfathir@gmail.com atau +6282298606699"
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-[#D4D1C7] bg-[#FFFFFF] text-sm text-[#181C1B] placeholder:text-[#767E7B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49] focus:border-[#115E49]"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="login-password"
                    className="block text-sm font-medium text-[#181C1B]"
                  >
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("FORGOT_PASSWORD");
                      setErrorMsg(null);
                      setFeedbackMsg(null);
                    }}
                    className="min-h-[44px] px-1 inline-flex items-center text-sm font-medium text-[#115E49] hover:text-[#0D4A39] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49] rounded"
                  >
                    Lupa password?
                  </button>
                </div>

                <div className="relative flex items-center">
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Masukkan password akun"
                    className="w-full min-h-[44px] pl-3.5 pr-24 py-2.5 rounded-lg border border-[#D4D1C7] bg-[#FFFFFF] text-sm text-[#181C1B] placeholder:text-[#767E7B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49] focus:border-[#115E49]"
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
                    className="absolute right-1 min-h-[44px] px-2.5 inline-flex items-center justify-center text-xs font-medium text-[#555D5B] hover:text-[#181C1B] rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49]"
                  >
                    {showPassword ? "Sembunyikan" : "Tampilkan"}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-[#115E49] hover:bg-[#0D4A39] active:bg-[#093629] disabled:bg-[#9CA3AF] text-white text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49]"
              >
                {loading ? "Memverifikasi..." : "Masuk ke Dashboard"}
              </button>
            </form>

            {/* Quick-fill seeded test accounts for evaluation */}
            <div className="pt-5 border-t border-[#E3E1DA] space-y-2.5">
              <div className="text-xs font-medium text-[#555D5B]">
                Isi cepat kredensial uji:
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setIdentifier("mhukmanfathir@gmail.com");
                    setPassword("Orienix2026!");
                    setErrorMsg(null);
                  }}
                  className="min-h-[44px] px-3 py-2 rounded-lg border border-[#E3E1DA] bg-[#F7F6F2] hover:bg-[#ECE9E0] active:bg-[#E3DFD3] text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49]"
                >
                  <div className="text-xs font-semibold text-[#181C1B]">
                    Pemilik Toko (Owner)
                  </div>
                  <div className="text-[11px] font-mono text-[#555D5B] truncate">
                    mhukmanfathir@gmail.com
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIdentifier("dandy@manajerku.id");
                    setPassword("Kasir2026!");
                    setErrorMsg(null);
                  }}
                  className="min-h-[44px] px-3 py-2 rounded-lg border border-[#E3E1DA] bg-[#F7F6F2] hover:bg-[#ECE9E0] active:bg-[#E3DFD3] text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49]"
                >
                  <div className="text-xs font-semibold text-[#181C1B]">
                    Staf Kasir 01 (Cashier)
                  </div>
                  <div className="text-[11px] font-mono text-[#555D5B] truncate">
                    dandy@manajerku.id
                  </div>
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-[#E3E1DA] text-sm text-[#555D5B] flex items-center justify-between gap-2">
              <span>Toko baru?</span>
              <Link
                href="/register"
                className="min-h-[44px] inline-flex items-center font-semibold text-[#115E49] hover:text-[#0D4A39] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49] rounded"
              >
                Daftarkan toko baru
              </Link>
            </div>
          </>
        ) : (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#E3E1DA]">
              <div className="space-y-1">
                <h1 className="text-xl font-semibold tracking-tight text-[#181C1B]">
                  Pulihkan akses akun
                </h1>
                <p className="text-sm text-[#555D5B]">
                  Buat token pemulihan untuk mengatur ulang password akun Anda.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMode("LOGIN");
                  setErrorMsg(null);
                  setFeedbackMsg(null);
                }}
                className="min-h-[44px] px-2.5 inline-flex items-center text-sm font-medium text-[#115E49] hover:text-[#0D4A39] underline underline-offset-4 shrink-0 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49]"
              >
                Kembali
              </button>
            </div>

            {feedbackMsg && (
              <div
                role="status"
                className="p-3.5 rounded-lg bg-[#ECFDF5] border border-[#A7F3D0] text-[#0D4A39] text-sm font-medium"
              >
                {feedbackMsg}
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-sm font-medium"
              >
                {errorMsg}
              </div>
            )}

            <form
              onSubmit={handleRequestResetToken}
              aria-busy={loading}
              className="space-y-3"
            >
              <label
                htmlFor="forgot-identifier"
                className="block text-sm font-medium text-[#181C1B]"
              >
                Email atau Nomor WhatsApp Terdaftar
              </label>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  id="forgot-identifier"
                  type="text"
                  required
                  value={forgotIdentifier}
                  onChange={(e) => setForgotIdentifier(e.target.value)}
                  placeholder="mhukmanfathir@gmail.com"
                  className="flex-1 min-h-[44px] px-3.5 py-2.5 rounded-lg border border-[#D4D1C7] bg-[#FFFFFF] text-sm text-[#181C1B] placeholder:text-[#767E7B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49] focus:border-[#115E49]"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="min-h-[44px] px-4 py-2.5 rounded-lg bg-[#181C1B] hover:bg-[#2E3432] active:bg-[#0F1211] disabled:bg-[#9CA3AF] text-white text-sm font-semibold transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49]"
                >
                  {loading ? "Memproses..." : "Minta Token"}
                </button>
              </div>
            </form>

            {resetToken && (
              <form
                onSubmit={handleExecuteResetPassword}
                aria-busy={loading}
                className="pt-5 border-t border-[#E3E1DA] space-y-4"
              >
                <div className="space-y-1.5">
                  <label
                    htmlFor="reset-token"
                    className="block text-sm font-medium text-[#181C1B]"
                  >
                    Token Pemulihan
                  </label>
                  <input
                    id="reset-token"
                    type="text"
                    required
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-[#D4D1C7] bg-[#F7F6F2] text-sm font-mono text-[#181C1B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="reset-new-password"
                    className="block text-sm font-medium text-[#181C1B]"
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
                      className="w-full min-h-[44px] pl-3.5 pr-24 py-2.5 rounded-lg border border-[#D4D1C7] bg-[#FFFFFF] text-sm text-[#181C1B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49]"
                    />
                    <button
                      type="button"
                      aria-pressed={showNewPassword}
                      aria-label={
                        showNewPassword
                          ? "Sembunyikan password baru"
                          : "Tampilkan password baru"
                      }
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      className="absolute right-1 min-h-[44px] px-2.5 inline-flex items-center justify-center text-xs font-medium text-[#555D5B] hover:text-[#181C1B] rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49]"
                    >
                      {showNewPassword ? "Sembunyikan" : "Tampilkan"}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="reset-confirm-password"
                    className="block text-sm font-medium text-[#181C1B]"
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
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-[#D4D1C7] bg-[#FFFFFF] text-sm text-[#181C1B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-[#115E49] hover:bg-[#0D4A39] active:bg-[#093629] disabled:bg-[#9CA3AF] text-white text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49]"
                >
                  {loading ? "Menyimpan..." : "Simpan Password Baru"}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </AuthLedgerShell>
  );
}
