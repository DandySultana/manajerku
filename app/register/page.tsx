"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import AuthLedgerShell from "../components/AuthLedgerShell";
import { useGooeyToastFlash } from "../components/GooeyToastProvider";

export default function RegisterPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneWhatsapp, setPhoneWhatsapp] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [storeName, setStoreName] = useState("");
  const [branchName, setBranchName] = useState("Cabang Utama");
  const [address, setAddress] = useState("Banda Aceh");
  const [initialKulakanCash, setInitialKulakanCash] = useState("10000000");
  const [dailyFreezerElecCost, setDailyFreezerElecCost] = useState("45000");

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useGooeyToastFlash(null, errorMsg, undefined, () => setErrorMsg(null));

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
        // Stay on register form if unauthenticated
      });
    return () => {
      controller.abort();
    };
  }, [router]);

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (password !== passwordConfirmation) {
      setErrorMsg("Konfirmasi password belum cocok dengan password.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          phoneWhatsapp,
          password,
          passwordConfirmation,
          storeName,
          branchName,
          address,
          initialKulakanCash: Number(initialKulakanCash),
          dailyFreezerElecCost: Number(dailyFreezerElecCost),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setErrorMsg(json.error?.message || "Gagal mendaftarkan akun.");
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

  const inputBaseClass =
    "w-full h-10 px-3.5 rounded-xl bg-[#F4F6F5] hover:bg-[#EDF1EF] focus:bg-white border border-transparent focus:border-[#0F6352] text-xs sm:text-[13px] text-[#0F172A] placeholder:text-[#94A3B8] transition-all outline-none focus:ring-3 focus:ring-[#0F6352]/12";

  return (
    <AuthLedgerShell
      headerActionHref="/login"
      headerActionLabel="Masuk ke Akun"
      headerPromptText="Sudah punya akun toko?"
      maxWidthClass="max-w-[460px]"
      quoteTagline="MANAJERKU ONBOARDING"
      heroLines={["Bangun Sistem", "Rantai Dingin", "Toko Anda"]}
      heroSubtitle="Siapkan buku kas kulakan terpisah, pemantauan suhu freezer harian, dan asisten pengadaan otomatis untuk toko frozen food Anda."
    >
      <div className="space-y-5">
        {/* Centered Editorial Heading */}
        <div className="text-center space-y-1.5">
          <h1 className="font-serif text-[28px] sm:text-[32px] font-medium tracking-tight text-[#0F172A] leading-tight">
            Daftarkan Toko Baru
          </h1>
          <p className="text-xs text-[#64748B] leading-relaxed">
            Lengkapi identitas pemilik dan parameter awal buku kas toko Anda
          </p>
        </div>

        <form
          onSubmit={handleRegisterSubmit}
          aria-busy={loading}
          className="space-y-4"
        >
          {/* Section 1: Owner Identity */}
          <section
            aria-labelledby="section-owner-heading"
            className="space-y-3"
          >
            <div className="flex items-center gap-2">
              <h2
                id="section-owner-heading"
                className="text-[11px] font-bold uppercase tracking-wider text-[#0F6352]"
              >
                1. Identitas Pemilik Toko
              </h2>
              <span className="h-px flex-1 bg-[#E2E8F0]" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1 sm:col-span-2">
                <label
                  htmlFor="register-fullname"
                  className="block text-xs font-semibold text-[#1E293B]"
                >
                  Nama Lengkap Pemilik
                </label>
                <input
                  id="register-fullname"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Contoh: Teuku Rahmat"
                  className={inputBaseClass}
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="register-email"
                  className="block text-xs font-semibold text-[#1E293B]"
                >
                  Alamat Email
                </label>
                <input
                  id="register-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@tokobeku.id"
                  className={inputBaseClass}
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="register-phone"
                  className="block text-xs font-semibold text-[#1E293B]"
                >
                  Nomor WhatsApp Aktif
                </label>
                <input
                  id="register-phone"
                  name="phoneWhatsapp"
                  type="tel"
                  autoComplete="tel"
                  required
                  value={phoneWhatsapp}
                  onChange={(e) => setPhoneWhatsapp(e.target.value)}
                  placeholder="0812xxxxxxxx"
                  className={`${inputBaseClass} font-mono`}
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="register-password"
                  className="block text-xs font-semibold text-[#1E293B]"
                >
                  Password
                </label>
                <div className="relative flex items-center">
                  <input
                    id="register-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 karakter"
                    className={`${inputBaseClass} pr-10`}
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
                    className="absolute right-2 w-7 h-7 inline-flex items-center justify-center text-[#64748B] hover:text-[#0F172A] rounded-lg transition-colors"
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
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="register-password-confirm"
                  className="block text-xs font-semibold text-[#1E293B]"
                >
                  Konfirmasi Password
                </label>
                <input
                  id="register-password-confirm"
                  name="passwordConfirmation"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={passwordConfirmation}
                  onChange={(e) => setPasswordConfirmation(e.target.value)}
                  placeholder="Ulangi password"
                  className={inputBaseClass}
                />
              </div>
            </div>
          </section>

          {/* Section 2: Store Profile & Initial Ledger Parameters */}
          <section
            aria-labelledby="section-store-heading"
            className="space-y-3 pt-1"
          >
            <div className="flex items-center gap-2">
              <h2
                id="section-store-heading"
                className="text-[11px] font-bold uppercase tracking-wider text-[#0F6352]"
              >
                2. Profil Toko &amp; Parameter Buku Kas
              </h2>
              <span className="h-px flex-1 bg-[#E2E8F0]" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1 sm:col-span-2">
                <label
                  htmlFor="register-store-name"
                  className="block text-xs font-semibold text-[#1E293B]"
                >
                  Nama Toko Frozen Food
                </label>
                <input
                  id="register-store-name"
                  name="storeName"
                  type="text"
                  required
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="Contoh: Agen Beku Seulawah"
                  className={inputBaseClass}
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="register-branch-name"
                  className="block text-xs font-semibold text-[#1E293B]"
                >
                  Nama Cabang
                </label>
                <input
                  id="register-branch-name"
                  name="branchName"
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className={inputBaseClass}
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="register-address"
                  className="block text-xs font-semibold text-[#1E293B]"
                >
                  Alamat Toko
                </label>
                <input
                  id="register-address"
                  name="address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className={inputBaseClass}
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="register-kulakan-cash"
                  className="block text-xs font-semibold text-[#1E293B]"
                >
                  Saldo Awal Kas Kulakan (Rp)
                </label>
                <input
                  id="register-kulakan-cash"
                  name="initialKulakanCash"
                  type="number"
                  required
                  min={0}
                  value={initialKulakanCash}
                  onChange={(e) => setInitialKulakanCash(e.target.value)}
                  className={`${inputBaseClass} font-mono tabular-nums font-medium`}
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="register-elec-cost"
                  className="block text-xs font-semibold text-[#1E293B]"
                >
                  Listrik Freezer Harian (Rp)
                </label>
                <input
                  id="register-elec-cost"
                  name="dailyFreezerElecCost"
                  type="number"
                  required
                  min={0}
                  value={dailyFreezerElecCost}
                  onChange={(e) => setDailyFreezerElecCost(e.target.value)}
                  className={`${inputBaseClass} font-mono tabular-nums font-medium`}
                />
              </div>
            </div>
          </section>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 px-4 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] active:bg-[#083B30] disabled:bg-[#94A3B8] text-white text-sm font-semibold shadow-[0_6px_18px_rgba(15,99,82,0.22)] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
            >
              {loading ? "Menyiapkan Toko..." : "Daftarkan Toko & Masuk"}
            </button>
          </div>
        </form>
      </div>
    </AuthLedgerShell>
  );
}
