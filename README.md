# Manajerku — Agentic Supply-Chain Micro-ERP untuk UMKM Frozen Food

**Tim Orienix — UIN Ar-Raniry Banda Aceh**  
*(Muhammad Hukman Fathir, Dandy Sultana, Muhammad Nashih, M Nafis Sauqy)*

Manajerku adalah platform operasional cerdas (**Agentic Supply-Chain Micro-ERP**) yang memadukan **Web Dashboard & Smart POS Multi-Satuan** dengan **Asisten AI WhatsApp Dual-Role** di atas satu basis data relasional bertransaksi atomik (ACID).

---

## Fitur Utama Production-Implemented

1. **Autentikasi Nyata, Sesi Server & RBAC (`/api/v1/auth/*`):**
   - Registrasi akun & toko baru, Login dengan Email atau Nomor WhatsApp + Password (terenkripsi `crypto.scryptSync` + salt), Logout (pencabutan sesi di tabel `auth_sessions` & HTTP-only cookie `manajerku_session`), Edit Profil, Ubah Password, Lupa/Reset Password dengan token berbatas waktu, dan perlindungan *Rate-Limiting*.
   - Akun Default Ter-seed:
     - **Owner:** `mhukmanfathir@gmail.com` (atau `+6282298606699`) | Password: `Orienix2026!`
     - **Staf Kasir 01:** `dandy@manajerku.id` (atau `+6282211112222`) | Password: `Kasir2026!`
     - **Admin:** `nashih@manajerku.id` (atau `+6282200009999`) | Password: `Admin2026!`
2. **Command Center Dashboard & Onboarding Mandiri 5 Menit (`PRD-01`):**
   - Agregasi 4 KPI utama (*Kas Siap Kulakan*, *Omzet Harian*, *Radar Stok & FEFO*, *Efisiensi Pengadaan AI*), Grafik Tren Omzet vs Belanja Kulakan 7 Hari, Panel Aktivitas Agen AI, dan Tabel Sinkronisasi Kasir & PO.
3. **Smart POS Multi-Satuan & Konversi Otomatis (`PRD-02`):**
   - Transaksi eceran (`Pack`) dan grosir (`Dus`) secara bersamaan dalam satu nota, konversi dus-ke-bungkus otomatis, pemotongan lintas batch FEFO terdekat, pembayaran Tunai & QRIS, cetak struk `#INV-YYMM-XX`, dan pemicu otomatis *Reorder Point* (`AUTO_ROP`).
4. **Manajemen Inventaris Rantai Dingin & Antrean Batch FEFO (`PRD-03`):**
   - Full CRUD Master SKU multi-satuan, antrean batch FEFO (`expiry_date ASC`), Radar Kesehatan Batch (`SAFE`, `PRIORITY_FEFO` <30 hari, `CRITICAL` <=18 hari, `EXPIRED` <=0 hari), dan *Write-Off* barang kedaluwarsa.
5. **Hybrid Supplier Discovery & Direktori Mitra B2B (`PRD-04`):**
   - Pencarian distributor *frozen food* dengan prioritas *Shared Cache* lokal + Google Places Official API (`Radius <= 10 km`, `Rating >= 4.5`, `WA Aktif`), serta skema komisi *B2B Verified Supplier* (`1,0%–1,5% per PO`).
6. **Agen AI WhatsApp Dual-Role, Multi-Turn Auto-RFQ & PO PDF (`PRD-05`):**
   - Routing otomatis berdasarkan nomor pengirim (`Supplier` vs `Owner/Staf`), izin 1-klik Owner, pemeriksaan 4 variabel wajib (`harga/dus, MOQ, batch exp, mobil freezer`), validasi plafon kas, penerbitan PO PDF (`#PO-YYMM-XX`), penguncian saldo kas (`PO_CASH_LOCK`), dan pembatalan PO (`PO_CASH_RELEASE`).
7. **Penerimaan Barang Masuk via Vision OCR (`PRD-06`):**
   - Pembacaan foto label kardus barang masuk, konversi otomatis dus ke pack (`5 Dus = 100 Pack`), rekonsiliasi PO aktif (`RECEIVED_OCR`), realisasi kas (`PO_SETTLEMENT`), dan injeksi ke antrean FEFO.
8. **Broadcast Promosi Cepat Reseller Hilir (`PRD-07`):**
   - Full CRUD direktori pedagang kuliner mikro (*Reseller Terdaftar*), draf otomatis promo diskon `-20%` saat umur simpan batch `< 30 hari`, dan pengiriman *broadcast* WhatsApp 1-klik.
9. **Buku Kas Terpisah, Beban Listrik Freezer & Laporan Laba-Rugi Standar KUR (`PRD-08`):**
   - Pemisahan otomatis HPP ke *Kas Siap Kulakan* vs *Laba Bersih*, alokasi otomatis beban listrik *freezer* 24 jam (`Rp 45.000/hari`), dan ekspor 1-klik dokumen verifikasi KUR Bank Aceh Syariah ber-hash `SHA-256`.

---

## Cara Menjalankan & Menguji Aplikasi

```bash
# 1. Jalankan seluruh test suite terotomasi (42 tests: Auth, CRUD, RBAC, 8 PRD & E2E)
npm test

# 2. Verifikasi TypeScript
npx tsc --noEmit

# 3. Jalankan server development Next.js
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000) di browser untuk menggunakan aplikasi.

---

## Dokumentasi Referensi
- [Master PRD Manajerku (Orienix)](file:///d:/dandy/programming/hackaton/manajerku/docs/PRD_Manajerku_Orienix.md)
- [Implementation Progress Report](file:///d:/dandy/programming/hackaton/manajerku/docs/IMPLEMENTATION_PROGRESS.md)
- [Productionization Progress & Audit Report](file:///d:/dandy/programming/hackaton/manajerku/docs/PRODUCTIONIZATION_PROGRESS.md)
