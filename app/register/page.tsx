"use client";

import Link from "next/link";
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
        window.location.href = "/";
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menghubungi server.",
      );
      setLoading(false);
    }
  };

  return (
    <AuthLedgerShell
      headerActionHref="/login"
      headerActionLabel="Masuk"
      headerPromptText="Sudah punya akun?"
      maxWidthClass="max-w-[580px]"
    >
      <div className="bg-[#FFFFFF] border border-[#E3E1DA] rounded-xl p-6 sm:p-8 space-y-6">
        <div className="space-y-1.5 pb-5 border-b border-[#E3E1DA]">
          <h1 className="text-2xl font-semibold tracking-tight text-[#181C1B]">
            Daftarkan Toko Baru
          </h1>
          <p className="text-sm text-[#555D5B] leading-relaxed">
            Buat akun pemilik untuk menyiapkan buku kas terpisah (kas siap
            kulakan) dan pencatatan beban listrik freezer harian.
          </p>
        </div>

        <form
          onSubmit={handleRegisterSubmit}
          aria-busy={loading}
          className="space-y-6"
        >
          {/* Section 1: Owner Identity & Credentials */}
          <section
            aria-labelledby="section-owner-heading"
            className="space-y-4"
          >
            <h2
              id="section-owner-heading"
              className="text-sm font-semibold text-[#181C1B]"
            >
              Identitas Pemilik
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <label
                  htmlFor="register-fullname"
                  className="block text-sm font-medium text-[#181C1B]"
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
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-[#D4D1C7] bg-[#FFFFFF] text-sm text-[#181C1B] placeholder:text-[#767E7B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49] focus:border-[#115E49]"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="register-email"
                  className="block text-sm font-medium text-[#181C1B]"
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
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-[#D4D1C7] bg-[#FFFFFF] text-sm text-[#181C1B] placeholder:text-[#767E7B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49] focus:border-[#115E49]"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="register-phone"
                  className="block text-sm font-medium text-[#181C1B]"
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
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-[#D4D1C7] bg-[#FFFFFF] text-sm font-mono text-[#181C1B] placeholder:text-[#767E7B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49] focus:border-[#115E49]"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="register-password"
                  className="block text-sm font-medium text-[#181C1B]"
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
                    placeholder="Minimal 8 karakter"
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
                <p className="text-xs text-[#555D5B]">
                  Gunakan kombinasi huruf dan angka minimal 8 karakter.
                </p>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="register-password-confirm"
                  className="block text-sm font-medium text-[#181C1B]"
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
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-[#D4D1C7] bg-[#FFFFFF] text-sm text-[#181C1B] placeholder:text-[#767E7B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49] focus:border-[#115E49]"
                />
              </div>
            </div>
          </section>

          {/* Section 2: Store & Initial Ledger Parameters */}
          <section
            aria-labelledby="section-store-heading"
            className="pt-5 border-t border-[#E3E1DA] space-y-4"
          >
            <h2
              id="section-store-heading"
              className="text-sm font-semibold text-[#181C1B]"
            >
              Profil Toko & Parameter Awal
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <label
                  htmlFor="register-store-name"
                  className="block text-sm font-medium text-[#181C1B]"
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
                  placeholder="Agen Beku Seulawah"
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-[#D4D1C7] bg-[#FFFFFF] text-sm text-[#181C1B] placeholder:text-[#767E7B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49] focus:border-[#115E49]"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="register-branch-name"
                  className="block text-sm font-medium text-[#181C1B]"
                >
                  Nama Cabang
                </label>
                <input
                  id="register-branch-name"
                  name="branchName"
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-[#D4D1C7] bg-[#FFFFFF] text-sm text-[#181C1B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49] focus:border-[#115E49]"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="register-address"
                  className="block text-sm font-medium text-[#181C1B]"
                >
                  Alamat Toko
                </label>
                <input
                  id="register-address"
                  name="address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-[#D4D1C7] bg-[#FFFFFF] text-sm text-[#181C1B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49] focus:border-[#115E49]"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="register-kulakan-cash"
                  className="block text-sm font-medium text-[#181C1B]"
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
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-[#D4D1C7] bg-[#FFFFFF] text-sm font-mono tabular-nums font-medium text-[#181C1B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49] focus:border-[#115E49]"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="register-elec-cost"
                  className="block text-sm font-medium text-[#181C1B]"
                >
                  Beban Listrik Freezer Harian (Rp)
                </label>
                <input
                  id="register-elec-cost"
                  name="dailyFreezerElecCost"
                  type="number"
                  required
                  min={0}
                  value={dailyFreezerElecCost}
                  onChange={(e) => setDailyFreezerElecCost(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-[#D4D1C7] bg-[#FFFFFF] text-sm font-mono tabular-nums font-medium text-[#181C1B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49] focus:border-[#115E49]"
                />
              </div>
            </div>
          </section>

          <div className="pt-2 space-y-4">
            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-[#115E49] hover:bg-[#0D4A39] active:bg-[#093629] disabled:bg-[#9CA3AF] text-white text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49]"
            >
              {loading ? "Menyiapkan Toko..." : "Daftarkan Toko & Masuk"}
            </button>

            <div className="pt-4 border-t border-[#E3E1DA] text-sm text-[#555D5B] flex items-center justify-between gap-2">
              <span>Sudah terdaftar sebelumnya?</span>
              <Link
                href="/login"
                className="min-h-[44px] inline-flex items-center font-semibold text-[#115E49] hover:text-[#0D4A39] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#115E49] rounded"
              >
                Masuk ke akun
              </Link>
            </div>
          </div>
        </form>
      </div>
    </AuthLedgerShell>
  );
}
