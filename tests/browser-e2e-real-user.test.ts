import test from "node:test";
import assert from "node:assert/strict";
import { RealChromeBrowser } from "./cdp-browser-harness.ts";

const APP_URL = "http://127.0.0.1:3000";

test("Real Chrome Browser End-to-End User Workflow Suite (UC-01 through UC-12)", async (t) => {
  // Pre-warm Next.js Turbopack routes so on-demand dev compilation finishes before browser assertions
  await Promise.allSettled([
    fetch(`${APP_URL}/api/v1/auth/me`),
    fetch(`${APP_URL}/api/v1/dashboard/summary`),
    fetch(`${APP_URL}/api/v1/dashboard/transactions`),
    fetch(`${APP_URL}/api/v1/inventory/products`),
    fetch(`${APP_URL}/api/v1/inventory/batches`),
    fetch(`${APP_URL}/api/v1/pos/catalog`),
    fetch(`${APP_URL}/api/v1/suppliers`),
    fetch(`${APP_URL}/api/v1/webhooks/whatsapp`),
    fetch(`${APP_URL}/api/v1/promos/fefo-drafts`),
    fetch(`${APP_URL}/api/v1/resellers`),
    fetch(`${APP_URL}/api/v1/finance/ledger-summary`),
  ]);

  const browser = new RealChromeBrowser();
  await browser.launch(9233);

  t.after(async () => {
    await browser.close();
  });

  await t.test("UC-01: Unauthenticated Redirect to /login, Minimalist Auth & Registration Flow (/login & /register), Responsive Desktop/Mobile Audit", async () => {
    await browser.clearCookies();
    await browser.goto(APP_URL);

    // Unauthenticated access to "/" must redirect to "/login"
    await browser.waitForText("Masuk ke Manajerku");
    const currentUrl = await browser.evaluate<string>("window.location.pathname");
    assert.equal(currentUrl, "/login");

    // Verify 0 horizontal overflow & >= 44px interactive touch targets on desktop & mobile
    const desktopOverflow = await browser.evaluate<boolean>(
      "document.documentElement.scrollWidth <= window.innerWidth"
    );
    assert.equal(desktopOverflow, true, "Login page must have zero horizontal overflow on desktop");
    await browser.takeScreenshot("01-login-desktop.png");

    // Verify interactive Show/Hide password toggle & Forgot Password + Escape key
    await browser.fillInputByLabel("Password", "SecretCheck1");
    await browser.clickButtonByText("Tampilkan", true);
    const pwTypeShown = await browser.evaluate<string>(
      "document.getElementById('login-password')?.getAttribute('type') || ''"
    );
    assert.equal(pwTypeShown, "text");
    await browser.clickButtonByText("Sembunyikan", true);

    await browser.clickButtonByText("Lupa password?", true);
    await browser.waitForText("Pulihkan akses akun");
    await browser.evaluate(
      "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"
    );
    await browser.waitForText("Masuk ke Manajerku");

    // Mobile responsive check (390x844) on /login
    await browser.setViewport(390, 844, true);
    await browser.waitForDomIdle(350);
    const loginMobileMetrics = await browser.evaluate<{
      noOverflow: boolean;
      minButtonHeight: number;
    }>(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button, header a, main a'));
        const heights = btns.map((b) => Math.round(b.getBoundingClientRect().height)).filter((h) => h > 0);
        return {
          noOverflow: document.documentElement.scrollWidth <= window.innerWidth,
          minButtonHeight: heights.length ? Math.min(...heights) : 0,
        };
      })()
    `);
    assert.equal(loginMobileMetrics.noOverflow, true, "Login mobile must not overflow horizontally");
    assert.ok(loginMobileMetrics.minButtonHeight >= 44, `Expected interactive tap targets >= 44px, got ${loginMobileMetrics.minButtonHeight}`);
    await browser.takeScreenshot("01b-login-mobile.png");

    // Navigate to /register and verify minimalist UI + mobile responsiveness + real registration redirect
    await browser.setViewport(1440, 900, false);
    await browser.clickButtonByText("Daftar Toko", true);
    await browser.waitForText("Daftarkan Toko Baru");
    await browser.takeScreenshot("02-register-desktop.png");

    await browser.setViewport(390, 844, true);
    await browser.waitForDomIdle(300);
    const regMobileOverflow = await browser.evaluate<boolean>(
      "document.documentElement.scrollWidth <= window.innerWidth"
    );
    assert.equal(regMobileOverflow, true, "Register mobile must not overflow horizontally");
    await browser.takeScreenshot("02b-register-mobile.png");

    // Register a real new store owner via /register -> redirects to "/"
    await browser.setViewport(1440, 900, false);
    const uniqueSuffix = Date.now().toString().slice(-5);
    await browser.fillInputByLabel("Nama Lengkap Pemilik", "Teuku Uji Antislop");
    await browser.fillInputByLabel("Alamat Email", `uji-${uniqueSuffix}@orienix.id`);
    await browser.fillInputByLabel("Nomor WhatsApp Aktif", `081277${uniqueSuffix}`);
    await browser.fillInputByLabel("Password", "OrienixPass2026");
    await browser.fillInputByLabel("Konfirmasi Password", "OrienixPass2026");
    await browser.fillInputByLabel("Nama Toko Frozen Food", `Toko Uji ${uniqueSuffix}`);
    await browser.clickButtonByText("Daftarkan Toko & Masuk", true);

    await browser.waitForText(`Toko Uji ${uniqueSuffix}`);
    const registeredDashboardText = await browser.waitForText(
      "Ringkasan Operasional & Rantai Pasok"
    );
    assert.match(registeredDashboardText, /Ringkasan Operasional & Rantai Pasok/);

    // Logout from newly registered store -> redirects back to /login
    await browser.clickButtonByText("Logout", true);
    await browser.waitForText("Masuk ke Manajerku");

    // Negative Login Check on /login
    await browser.fillInputByLabel("Email atau Nomor WhatsApp", "mhukmanfathir@gmail.com");
    await browser.fillInputByLabel("Password", "WrongPassword123!");
    await browser.clickButtonByText("Masuk ke Dashboard", true);
    await browser.waitForText("Email/Nomor WhatsApp atau Password yang Anda masukkan salah");

    // Quick-fill Owner credentials & Login -> redirects to Command Center Dashboard
    await browser.clickButtonByText("Pemilik Toko (Owner)");
    await browser.clickButtonByText("Masuk ke Dashboard", true);
    const bodyText = await browser.waitForText(
      "Ringkasan Operasional & Rantai Pasok"
    );

    assert.match(bodyText, /Kas Siap Kulakan/);
    assert.match(bodyText, /Omzet Harian/);
    assert.match(bodyText, /Radar Stok & FEFO/);
    assert.match(bodyText, /Efisiensi Pengadaan AI/);
    await browser.takeScreenshot("03-command-center-desktop.png");

    // Verify Mobile Viewport (390x844) on Dashboard
    await browser.setViewport(390, 844, true);
    await browser.waitForDomIdle(400);
    await browser.takeScreenshot("03b-command-center-mobile.png");

    await browser.setViewport(1440, 900, false);
    await browser.waitForDomIdle(300);
  });

  await t.test("UC-02: Command Center Unified Sync Table Filters, Search & Receipt Modal", async () => {
    // Filter by PO Otomatis
    const clickedPo = await browser.clickButtonByText("PO Otomatis", true);
    assert.equal(clickedPo, true);
    const poTableText = await browser.waitForText("#PO-2611-02");
    assert.match(poTableText, /CV Beku Jaya/);

    // Filter by Penjualan Kasir
    const clickedPos = await browser.clickButtonByText("Penjualan Kasir", true);
    assert.equal(clickedPos, true);
    const posTableText = await browser.waitForText("#INV-2611-49");
    assert.match(posTableText, /Burger Bang Jago/);

    // Filter back to Semua & test search input
    await browser.clickButtonByText("Semua", true);
    await browser.fillInputByPlaceholder("Cari PO / Mitra", "Burger Bang Jago");
    const searchedText = await browser.waitForText("#INV-2611-49");
    assert.match(searchedText, /Burger Bang Jago/);

    // Open Cetak Struk modal
    const clickedReceipt = await browser.clickButtonByText("Cetak Struk");
    assert.equal(clickedReceipt, true);
    await browser.waitForText("Struk Transaksi Kasir POS");
    await browser.takeScreenshot("03-sync-table-receipt-modal.png");

    // Close modal & clear search
    await browser.clickButtonByText("Tutup", true);
    await browser.fillInputByPlaceholder("Cari PO / Mitra", "");
  });

  await t.test("UC-03: Cold-Chain Temperature Update Modal & Persistence Across Browser Reload", async () => {
    const clickedTemp = await browser.clickButtonByText("Suhu Stabil");
    assert.equal(clickedTemp, true);
    await browser.waitForText("Catat Suhu Cold-Chain ID-01");

    await browser.fillInputByLabel("Suhu Chiller / Chest Freezer", "-12.5");
    await browser.clickButtonByText("Simpan Suhu", true);
    await browser.waitForText("Peringatan Suhu -12.5°C");

    // Reload browser page & verify persistence from SQLite database
    await browser.reload();
    await browser.waitForText("Peringatan Suhu -12.5°C");

    // Restore optimal temperature -18.4°C
    await browser.clickButtonByText("Peringatan Suhu -12.5°C");
    await browser.waitForText("Catat Suhu Cold-Chain ID-01");
    await browser.fillInputByLabel("Suhu Chiller / Chest Freezer", "-18.4");
    await browser.clickButtonByText("Simpan Suhu", true);
    await browser.waitForText("Suhu Stabil -18.4°C");
    await browser.waitForDomIdle(950);
  });

  await t.test("UC-04: Authenticated Profile Management & Session Persistence Across Browser Reload", async () => {
    await browser.clickButtonByText("Profil & Keamanan");
    await browser.waitForText("Edit Profil Pengguna Terautentikasi");
    await browser.takeScreenshot("04-authenticated-owner-profile.png");

    // Edit Profile & verify persistence after reload
    await browser.fillInputByLabel("Nama Lengkap", "Muhammad Hukman Fathir (Owner Orienix)");
    await browser.clickButtonByText("Simpan Perubahan Profil");
    await browser.waitForText("Profil akun berhasil diperbarui di database!");

    await browser.reload();
    await browser.waitForText("Muhammad Hukman Fathir (Owner Orienix)");
  });

  await t.test("UC-05: Role-Based Access Control (RBAC) — Logout to /login, Login as Cashier, Verify Restrictions, Re-login Owner", async () => {
    // Logout from Owner session -> must redirect to /login
    await browser.clickButtonByText("Logout", true);
    await browser.waitForText("Masuk ke Manajerku");

    // Login as Staf Kasir 01 via /login
    await browser.clickButtonByText("Staf Kasir 01 (Cashier)");
    await browser.clickButtonByText("Masuk ke Dashboard", true);
    await browser.waitForText("(CASHIER)");

    // Navigate to Command Center & verify RBAC masking banner
    await browser.clickButtonByText("Command Center");
    const ccCashierText = await browser.waitForText("Mode Staf Kasir Aktif");
    assert.match(ccCashierText, /Rp ••••••••/);
    assert.match(ccCashierText, /Laba Tersembunyi/);

    // Navigate to Buku Kas & KUR Bank -> verify restricted access screen
    await browser.clickButtonByText("Buku Kas & KUR Bank");
    await browser.waitForText("Akses Buku Kas & Laporan KUR Dibatasi");
    await browser.takeScreenshot("05-cashier-rbac-restriction.png");

    // Logout & log back in as Owner via /login
    await browser.clickButtonByText("Logout", true);
    await browser.waitForText("Masuk ke Manajerku");
    await browser.clickButtonByText("Pemilik Toko (Owner)");
    await browser.clickButtonByText("Masuk ke Dashboard", true);
    await browser.waitForText("(OWNER)");
  });

  await t.test("UC-06: Inventory & FEFO Queue — Negative Price Validation, Create Master SKU, Add Batch & Run FEFO Radar", async () => {
    await browser.clickButtonByText("Stok & Batch FEFO");
    await browser.waitForText("Manajemen Inventaris Rantai Dingin & Antrean Batch FEFO");

    // Open Add Master SKU modal & test negative price validation (wholesale > retail * packs)
    await browser.clickButtonByText("+ Tambah Master SKU");
    await browser.waitForText("Tambah Master SKU Multi-Satuan");
    const uniqueSku = `SKU-E2E-${Date.now().toString().slice(-4)}`;
    await browser.fillInputByPlaceholder("SKU-KEB-500", uniqueSku);
    await browser.fillInputByPlaceholder("Kulit Kebab Beku 500g", "Patty Burger Sapi E2E 500g");
    await browser.fillInputByLabel("Isi Pack per 1 Dus", "20");
    await browser.fillInputByLabel("Harga Eceran / Pack", "22000");
    await browser.fillInputByLabel("Harga Grosir / Dus", "550000"); // Invalid: > 440,000
    await browser.clickButtonByText("Simpan Master SKU");
    await browser.waitForText("tidak boleh melebihi total harga eceran");

    // Fix wholesale price to valid 395,000 & submit
    await browser.fillInputByLabel("Harga Grosir / Dus", "395000");
    await browser.clickButtonByText("Simpan Master SKU");
    await browser.waitForText("berhasil ditambahkan!");

    // Add a new batch via UI modal
    await browser.clickButtonByText("+ Input Batch Baru");
    await browser.waitForText("Input Batch Baru ke Antrean FEFO");
    await browser.fillInputByPlaceholder("Mis: Batch FN-220", `Batch-E2E-${Date.now().toString().slice(-3)}`);
    await browser.clickButtonByText("Masukkan ke Antrean FEFO");
    await browser.waitForText("berhasil masuk ke Antrean FEFO");

    // Run FEFO Expiry Radar
    await browser.clickButtonByText("↻ Evaluasi Radar FEFO");
    await browser.waitForText("Radar FEFO Selesai:");
    await browser.takeScreenshot("06-inventory-fefo-queue.png");
  });

  await t.test("UC-07: Smart POS Multi-Unit Checkout — Add Pack & Box Simultaneously, Complete Checkout & Verify Receipt", async () => {
    await browser.clickButtonByText("Smart POS Kasir");
    await browser.waitForText("Kasir Smart POS Multi-Satuan");

    // Add +1 Pack (Ecer) and +1 Dus (Grosir) to cart
    const addedPack = await browser.clickButtonByText("+1 Pack (Ecer)");
    assert.equal(addedPack, true);
    const addedBox = await browser.clickButtonByText("+1 Dus (");
    assert.equal(addedBox, true);

    await browser.waitForText("Konversi FEFO:");

    // Complete atomic checkout
    const clickedPay = await browser.clickButtonByText("Selesaikan Transaksi & Potong Batch FEFO");
    assert.equal(clickedPay, true);

    const receiptText = await browser.waitForText("Transaksi POS & Antrean FEFO Sinkron 100%");
    assert.match(receiptText, /#INV-2611-/);
    assert.match(receiptText, /HPP Dikembalikan ke Kas Siap Kulakan/);
    await browser.takeScreenshot("07-smart-pos-checkout-receipt.png");

    await browser.clickButtonByText("Selesai", true);
  });

  await t.test("UC-08: Hybrid Supplier Discovery — Run Discovery, Verify Shared Cache Hit & Register New B2B Supplier", async () => {
    await browser.clickButtonByText("Discovery Supplier");
    await browser.waitForText("Pencarian Pemasok Resmi & Direktori B2B Terverifikasi");

    await browser.clickButtonByText("Jalankan Hybrid Supplier Discovery");
    const discText = await browser.waitForText("SHARED CACHE HIT");
    assert.match(discText, /CV Beku Jaya Distribusi/);

    // Register a new verified supplier via modal
    await browser.clickButtonByText("+ Tambah Mitra B2B Verified Supplier");
    await browser.waitForText("Tambah Distributor ke Shared Cache");
    const randPhone = `081168${Math.floor(10000 + Math.random() * 89999)}`;
    await browser.fillInputByPlaceholder("PT Samudera Beku Nusantara", "PT Banda Aceh Cold Logistics");
    await browser.fillInputByPlaceholder("08116800xxx", randPhone);
    await browser.clickButtonByText("Simpan Distributor");
    await browser.waitForText("PT Banda Aceh Cold Logistics");
    await browser.takeScreenshot("08-supplier-discovery.png");
  });

  await t.test("UC-09: WhatsApp AI Dual-Role Agent — 1-Click RFQ Approval, Multi-Turn 4-Slot Check, PO Approval & Vision OCR", async () => {
    await browser.clickButtonByText("Agen AI WhatsApp");
    await browser.waitForText("Asisten AI WhatsApp Dual-Role");

    // 1. Owner approves 1-click RFQ dispatch to 3 suppliers
    const hasApproveRfqBtn = await browser.clickButtonByText("Izin 1-Klik Owner: Kirim RFQ ke 3 Supplier");
    if (hasApproveRfqBtn) {
      await browser.waitForText("Izin 1-Klik Owner diterima!");
    }

    // 2. Simulate incomplete supplier reply (2 variables) -> verify polite follow-up
    await browser.clickButtonByText("Contoh Belum Lengkap (2 Variabel)");
    await browser.clickButtonByText("Kirim Balasan Supplier ke Webhook");
    await browser.waitForText("tanggal kedaluwarsa");

    // 3. Simulate complete supplier reply (4 variables) -> verify COMPLETE status
    await browser.clickButtonByText("Contoh Lengkap (4 Variabel)");
    await browser.clickButtonByText("Kirim Balasan Supplier ke Webhook");
    await browser.waitForText("(Status: COMPLETE)");

    // 4. Owner approves 1-click PO issuance & cash locking
    const clickedPoAcc = await browser.clickButtonByText("ACC 1-Klik Owner: Terbitkan PO PDF & Kunci Kas");
    assert.equal(clickedPoAcc, true);
    await browser.waitForText("diterbitkan! Saldo Kas Kulakan sebesar");

    // 5. Submit Vision OCR cardboard box label photo
    await browser.clickButtonByText("Kirim Foto Kardus ke Vision OCR & Masukkan ke Antrean FEFO");
    await browser.waitForText("Vision OCR Selesai!");
    await browser.takeScreenshot("09-whatsapp-agent-and-vision-ocr.png");
  });

  await t.test("UC-10: Downstream Reseller FEFO Promo — 1-Click Broadcast & New Reseller Registration", async () => {
    await browser.clickButtonByText("Promo Reseller FEFO");
    await browser.waitForText("Broadcast Promosi Cepat Reseller Hilir");

    await browser.clickButtonByText("Kirim Broadcast 1-Klik ke");
    await browser.waitForText("Broadcast 1-Klik Berhasil!");

    // Register a new downstream reseller via modal
    await browser.clickButtonByText("+ Daftarkan Mitra Reseller Baru");
    await browser.waitForText("Daftarkan Mitra Reseller Kuliner");
    const randResPhone = `085260${Math.floor(10000 + Math.random() * 89999)}`;
    await browser.fillInputByPlaceholder("Burger & Kebab Darussalam", "Dimsum & Burger Krueng Aceh");
    await browser.fillInputByPlaceholder("Bang Reza", "Teuku Salman");
    await browser.fillInputByPlaceholder("08526000xxxx", randResPhone);
    await browser.clickButtonByText("Simpan Reseller");
    await browser.waitForText("Dimsum & Burger Krueng Aceh");
    await browser.takeScreenshot("10-reseller-promo-broadcast.png");
  });

  await t.test("UC-11: Financial Ledger & KUR Bank Readiness — Negative Drawing Guard, Profit Reinvestment & 1-Click KUR PDF Export", async () => {
    await browser.clickButtonByText("Buku Kas & KUR Bank");
    await browser.waitForText("Buku Kas Terpisah, Listrik Freezer & Laporan Laba-Rugi Standar KUR");

    // 1. Negative test: try personal drawing exceeding net profit -> verify working capital protection!
    await browser.selectOptionByLabelOrIndex(0, "OWNER_DRAWING");
    await browser.evaluate(`
      (() => {
        const forms = Array.from(document.querySelectorAll('form'));
        const capForm = forms[1];
        const numInput = capForm ? capForm.querySelector('input[type="number"]') : null;
        if (numInput) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(numInput, '95000000');
          numInput.dispatchEvent(new Event('input', { bubbles: true }));
          numInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await browser.clickButtonByText("Eksekusi Mutasi Kas Atomik");
    await browser.waitForText("ditolak karena melebihi saldo Laba Bersih tersedia");

    // 2. Positive test: Reinvest Rp 250.000 of Net Profit into Kas Siap Kulakan
    await browser.selectOptionByLabelOrIndex(0, "PROFIT_REINVESTMENT");
    await browser.evaluate(`
      (() => {
        const forms = Array.from(document.querySelectorAll('form'));
        const capForm = forms[1];
        const numInput = capForm ? capForm.querySelector('input[type="number"]') : null;
        if (numInput) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(numInput, '250000');
          numInput.dispatchEvent(new Event('input', { bubbles: true }));
          numInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await browser.clickButtonByText("Eksekusi Mutasi Kas Atomik");
    await browser.waitForText("Mutasi PROFIT_REINVESTMENT sebesar Rp 250.000 berhasil dicatat secara atomik!");

    // 3. Export 1-Click Standardized KUR Bank Aceh Syariah Verification Package
    await browser.clickButtonByText("Ekspor PDF Standar Pengajuan KUR Bank (1-Klik)");
    const kurModalText = await browser.waitForText("Dokumen Verifikasi Laba-Rugi & Rekam Jejak PO");
    assert.match(kurModalText, /SHA256:/);
    await browser.takeScreenshot("11-finance-kur-export-modal.png");

    await browser.clickButtonByText("Tutup", true);
  });

  await t.test("UC-12: Verify Zero Uncaught Browser Exceptions Across Entire Real User Session", async () => {
    assert.equal(
      browser.pageExceptions.length,
      0,
      `Expected 0 uncaught page exceptions, found: ${browser.pageExceptions.join("; ")}`
    );
  });
});
