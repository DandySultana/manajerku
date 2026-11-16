"use client";

import React, { useState } from "react";

export interface AuthSessionData {
  sessionId: string;
  userId: string;
  storeId: string;
  fullName: string;
  email: string | null;
  phoneWhatsapp: string;
  role: "OWNER" | "CASHIER" | "ADMIN";
  accountStatus: string;
  store: {
    id: string;
    name: string;
    branchName: string;
    coldChainCode: string;
    lastRecordedTempC: number;
    subscriptionTier: "FREEMIUM_STARTER" | "MANAJERKU_PRO";
  };
}

export default function AuthAccountView({
  currentSession,
  onAuthSuccess,
  onLogoutSuccess,
}: {
  currentSession: AuthSessionData;
  onAuthSuccess: (session: AuthSessionData) => void;
  onLogoutSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [profName, setProfName] = useState(currentSession.fullName);
  const [profEmail, setProfEmail] = useState(currentSession.email || "");
  const [profPhone, setProfPhone] = useState(currentSession.phoneWhatsapp);
  const [currPwd, setCurrPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [newPwdConfirm, setNewPwdConfirm] = useState("");

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      const res = await fetch("/api/v1/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: profName,
          email: profEmail,
          phoneWhatsapp: profPhone,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setErrorMsg(json.error?.message || "Gagal memperbarui profil.");
      } else {
        setFeedbackMsg("Profil akun berhasil diperbarui di database!");
        onAuthSuccess({
          ...currentSession,
          fullName: json.data.fullName,
          email: json.data.email,
          phoneWhatsapp: json.data.phoneWhatsapp,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      const res = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: currPwd,
          newPassword: newPwd,
          newPasswordConfirmation: newPwdConfirm,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setErrorMsg(json.error?.message || "Gagal mengubah password.");
      } else {
        setCurrPwd("");
        setNewPwd("");
        setNewPwdConfirm("");
        setFeedbackMsg(
          "Password berhasil diubah secara kriptografis (scrypt) dan sesi perangkat lain telah dicabut!"
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
      onLogoutSuccess();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase text-emerald-700">
            Manajemen Profil & Keamanan Sesi
          </span>
          <h1 className="text-xl font-bold text-slate-900">
            Pengaturan Akun & Keamanan ({currentSession.fullName})
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Kelola informasi profil pengguna, nomor WhatsApp terotorisasi, dan
            ubah password kriptografis <code>scrypt</code>
          </p>
        </div>

        <button
          onClick={handleLogout}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-xs cursor-pointer"
        >
          Keluar / Logout Sesi
        </button>
      </div>

      {feedbackMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-xl text-xs font-semibold">
          ✓ {feedbackMsg}
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl text-xs font-semibold">
          ⚠️ {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
        <form
          onSubmit={handleUpdateProfile}
          className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3"
        >
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            Edit Profil Pengguna Terautentikasi
          </h2>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Nama Lengkap
            </label>
            <input
              type="text"
              required
              value={profName}
              onChange={(e) => setProfName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Alamat Email
            </label>
            <input
              type="email"
              value={profEmail}
              onChange={(e) => setProfEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Nomor WhatsApp Terdaftar
            </label>
            <input
              type="text"
              required
              value={profPhone}
              onChange={(e) => setProfPhone(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono"
            />
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1 text-[11px]">
            <div>
              Role Sesi Server:{" "}
              <strong className="text-emerald-800">
                {currentSession.role}
              </strong>
            </div>
            <div>
              Toko Aktif: <strong>{currentSession.store.name}</strong> (
              {currentSession.storeId})
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
          >
            Simpan Perubahan Profil
          </button>
        </form>

        <form
          onSubmit={handleChangePassword}
          className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3"
        >
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            Ubah Password Keamanan
          </h2>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Password Saat Ini *
            </label>
            <input
              type="password"
              required
              value={currPwd}
              onChange={(e) => setCurrPwd(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Password Baru (Min. 8 Karakter Huruf & Angka) *
            </label>
            <input
              type="password"
              required
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Konfirmasi Password Baru *
            </label>
            <input
              type="password"
              required
              value={newPwdConfirm}
              onChange={(e) => setNewPwdConfirm(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold cursor-pointer"
          >
            Perbarui Password
          </button>
        </form>
      </div>
    </div>
  );
}
