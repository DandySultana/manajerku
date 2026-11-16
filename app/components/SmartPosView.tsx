"use client";

import React, { useState, useEffect, useCallback } from "react";
import { formatRp } from "./CommandCenterDashboard";

interface PosCatalogProduct {
  id: string;
  skuCode: string;
  name: string;
  category: string;
  retailUnitName: string;
  wholesaleUnitName: string;
  packsPerBox: number;
  retailPricePerPack: number;
  wholesalePricePerBox: number;
  totalHealthyPacks: number;
  wholeBoxes: number;
  loosePacks: number;
  formattedStockDualUnit: string;
  expiredBlockedPacks: number;
  isBelowRop: boolean;
  firstFefoPickingBatch: {
    batchId: string;
    batchNumber: string;
    qtyPacks: number;
    expiryDate: string;
    daysToExpiry: number;
    fefoStatus: string;
    promoDiscountPct: number;
  } | null;
}

interface ResellerOption {
  id: string;
  businessName: string;
  contactName: string;
  phoneWhatsapp: string;
  culinarySegment: string;
}

interface CartLine {
  key: string;
  productId: string;
  productName: string;
  soldUnitType: "PACK" | "BOX";
  unitLabel: string;
  packsPerBox: number;
  soldQty: number;
  unitPrice: number;
  promoDiscountPct: number;
  pickingBatchLabel: string;
}

interface CheckoutReceiptData {
  transactionId: string;
  invoiceNumber: string;
  customerName: string;
  customerTypeLabel: string;
  paymentMethod: "CASH" | "QRIS";
  itemsSummaryText: string;
  totalAmountRp: number;
  totalDiscountRp: number;
  totalCogsRp: number;
  grossProfitRp: number;
  cashReceivedRp: number;
  changeAmountRp: number;
  availableKulakanCashAfterRp: number;
  items: Array<{
    id: string;
    productName: string;
    soldUnitType: "PACK" | "BOX";
    soldQty: number;
    deductedPacksQty: number;
    unitSellingPrice: number;
    discountAmount: number;
    subtotalAmount: number;
    batchAllocations: Array<{
      batchNumber: string;
      expiryDate: string;
      packsDeducted: number;
    }>;
  }>;
  triggeredRfqSessions: Array<{
    rfqSessionId: string;
    rfqCode: string;
    productName: string;
    healthyStockPacks: number;
    reorderPointPacks: number;
  }>;
}

export default function SmartPosView({
  activeStoreId,
  activeRole,
  onNavigateTab,
}: {
  activeStoreId: string;
  activeRole: "OWNER" | "CASHIER" | "ADMIN";
  onNavigateTab: (tab: string) => void;
}) {
  const [products, setProducts] = useState<PosCatalogProduct[]>([]);
  const [resellers, setResellers] = useState<ResellerOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedResellerId, setSelectedResellerId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"QRIS" | "CASH">("QRIS");
  const [cashReceivedInput, setCashReceivedInput] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [receiptModal, setReceiptModal] = useState<CheckoutReceiptData | null>(
    null
  );

  const loadCatalog = useCallback(async () => {
    try {
      setErrorMsg(null);
      const res = await fetch(
        `/api/v1/pos/catalog?storeId=${encodeURIComponent(activeStoreId)}`
      );
      const json = await res.json();
      if (json.success) {
        setProducts(json.data.products);
        setResellers(json.data.resellers);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal memuat katalog POS."
      );
    } finally {
      setLoading(false);
    }
  }, [activeStoreId]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const getProductPacksInCart = (productId: string) => {
    return cart
      .filter((c) => c.productId === productId)
      .reduce(
        (sum, c) =>
          sum +
          (c.soldUnitType === "BOX" ? c.soldQty * c.packsPerBox : c.soldQty),
        0
      );
  };

  const handleAddToCart = (
    prod: PosCatalogProduct,
    unitType: "PACK" | "BOX"
  ) => {
    setErrorMsg(null);
    const additionalPacks = unitType === "BOX" ? prod.packsPerBox : 1;
    const currentPacksInCart = getProductPacksInCart(prod.id);

    if (currentPacksInCart + additionalPacks > prod.totalHealthyPacks) {
      if (prod.expiredBlockedPacks > 0 && prod.totalHealthyPacks === 0) {
        setErrorMsg(
          `Stok sehat ${prod.name} habis! Terdapat ${prod.expiredBlockedPacks} Pack pada batch kedaluwarsa yang diblokir otomatis oleh proteksi FEFO.`
        );
      } else {
        setErrorMsg(
          `Stok sehat ${prod.name} tidak mencukupi untuk menambah 1 ${
            unitType === "BOX" ? prod.wholesaleUnitName : prod.retailUnitName
          }. Sisa stok sehat: ${prod.totalHealthyPacks} Pack.`
        );
      }
      return;
    }

    const lineKey = `${prod.id}-${unitType}`;
    const unitPrice =
      unitType === "BOX"
        ? prod.wholesalePricePerBox
        : prod.retailPricePerPack;
    const promoPct = prod.firstFefoPickingBatch?.promoDiscountPct || 0;
    const pickingLabel = prod.firstFefoPickingBatch
      ? `${prod.firstFefoPickingBatch.batchNumber} (Exp ${prod.firstFefoPickingBatch.daysToExpiry} Hr)`
      : "Antrean FEFO";

    setCart((prev) => {
      const existing = prev.find((item) => item.key === lineKey);
      if (existing) {
        return prev.map((item) =>
          item.key === lineKey ? { ...item, soldQty: item.soldQty + 1 } : item
        );
      }
      return [
        ...prev,
        {
          key: lineKey,
          productId: prod.id,
          productName: prod.name,
          soldUnitType: unitType,
          unitLabel:
            unitType === "BOX" ? prod.wholesaleUnitName : prod.retailUnitName,
          packsPerBox: prod.packsPerBox,
          soldQty: 1,
          unitPrice,
          promoDiscountPct: promoPct,
          pickingBatchLabel: pickingLabel,
        },
      ];
    });
  };

  const handleUpdateQty = (lineKey: string, delta: number) => {
    setErrorMsg(null);
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.key !== lineKey) return item;
          const nextQty = item.soldQty + delta;
          if (nextQty <= 0) return null;
          const prod = products.find((p) => p.id === item.productId);
          if (prod && delta > 0) {
            const addPacks =
              item.soldUnitType === "BOX" ? item.packsPerBox : 1;
            if (
              getProductPacksInCart(prod.id) + addPacks >
              prod.totalHealthyPacks
            ) {
              setErrorMsg(
                `Stok sehat ${prod.name} maksimum ${prod.totalHealthyPacks} Pack.`
              );
              return item;
            }
          }
          return { ...item, soldQty: nextQty };
        })
        .filter((x): x is CartLine => x !== null)
    );
  };

  const cartSubtotal = cart.reduce((sum, item) => {
    const gross = item.unitPrice * item.soldQty;
    const disc =
      item.promoDiscountPct > 0
        ? Math.round(gross * (item.promoDiscountPct / 100))
        : 0;
    return sum + (gross - disc);
  }, 0);

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/v1/pos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: activeStoreId,
          actorRole: activeRole,
          cashierLabel: "Kasir 01",
          resellerId: selectedResellerId || null,
          serviceType: "TAKEAWAY_PICKUP",
          paymentMethod,
          cashReceived:
            paymentMethod === "CASH" && cashReceivedInput
              ? Number(cashReceivedInput)
              : cartSubtotal,
          items: cart.map((c) => ({
            productId: c.productId,
            soldUnitType: c.soldUnitType,
            soldQty: c.soldQty,
          })),
        }),
      });

      const json = await res.json();
      if (!json.success) {
        setErrorMsg(json.error?.message || "Transaksi gagal.");
      } else {
        setReceiptModal(json.data);
        setCart([]);
        setCashReceivedInput("");
        await loadCatalog();
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal memproses transaksi."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.skuCode.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase text-emerald-700">
            PRD-02 • Multi-Unit Smart POS & Atomic FEFO Checkout
          </span>
          <h1 className="text-xl font-bold text-slate-900">
            Kasir Smart POS Multi-Satuan (Eceran Pack & Grosir Dus)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Konversi otomatis Dus ke Bungkus, pemotongan antrean batch FEFO
            terdekat, dan pemisahan otomatis HPP ke Kas Siap Kulakan
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama produk / kode SKU..."
            className="px-3.5 py-2 text-xs rounded-xl border border-slate-300 w-64"
          />
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl text-xs font-semibold flex items-center justify-between">
          <span>⚠️ {errorMsg}</span>
          <button
            onClick={() => setErrorMsg(null)}
            className="text-red-700 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main POS Grid: Catalog (Left 7 cols) + Checkout Cart (Right 5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Product Cards */}
        <div className="lg:col-span-7 space-y-4">
          {loading ? (
            <div className="p-8 bg-white rounded-2xl text-center text-xs text-slate-400">
              Memuat katalog produk POS...
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filteredProducts.map((prod) => {
                const packsInCart = getProductPacksInCart(prod.id);
                const remainingPacks = prod.totalHealthyPacks - packsInCart;
                const canAddPack = remainingPacks >= 1;
                const canAddBox = remainingPacks >= prod.packsPerBox;

                return (
                  <div
                    key={prod.id}
                    className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                          {prod.skuCode}
                        </span>
                        {prod.firstFefoPickingBatch?.promoDiscountPct ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                            ★ Promo FEFO -
                            {prod.firstFefoPickingBatch.promoDiscountPct}%
                          </span>
                        ) : prod.isBelowRop ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                            Stok ≤ ROP
                          </span>
                        ) : null}
                      </div>

                      <h3 className="text-sm font-bold text-slate-900 mt-2">
                        {prod.name}
                      </h3>
                      <div className="text-[11px] text-slate-500">
                        Sisa Sehat:{" "}
                        <strong className="text-slate-800">
                          {Math.floor(remainingPacks / prod.packsPerBox)}{" "}
                          {prod.wholesaleUnitName} +{" "}
                          {remainingPacks % prod.packsPerBox}{" "}
                          {prod.retailUnitName} ({remainingPacks} Pack)
                        </strong>
                      </div>

                      {prod.firstFefoPickingBatch && (
                        <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200/80 text-[11px] text-emerald-900 font-medium">
                          Ambil Freezer:{" "}
                          <strong>
                            {prod.firstFefoPickingBatch.batchNumber}
                          </strong>{" "}
                          (Exp {prod.firstFefoPickingBatch.daysToExpiry} Hr)
                        </div>
                      )}
                    </div>

                    {/* Dual Unit Action Buttons */}
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        disabled={!canAddPack}
                        onClick={() => handleAddToCart(prod, "PACK")}
                        className="py-2 px-2.5 rounded-xl border border-slate-300 hover:border-emerald-600 hover:bg-emerald-50/50 disabled:opacity-40 disabled:pointer-events-none text-left transition cursor-pointer"
                      >
                        <div className="text-[10px] font-bold text-slate-500">
                          +1 {prod.retailUnitName} (Ecer)
                        </div>
                        <div className="text-xs font-extrabold text-slate-900">
                          {formatRp(prod.retailPricePerPack)}
                        </div>
                      </button>

                      <button
                        type="button"
                        disabled={!canAddBox}
                        onClick={() => handleAddToCart(prod, "BOX")}
                        className="py-2 px-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-left transition cursor-pointer"
                      >
                        <div className="text-[10px] font-bold opacity-90">
                          +1 {prod.wholesaleUnitName} ({prod.packsPerBox} Pack)
                        </div>
                        <div className="text-xs font-extrabold">
                          {formatRp(prod.wholesalePricePerBox)}
                        </div>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Multi-Unit Shopping Cart & Checkout */}
        <div className="lg:col-span-5">
          <form
            onSubmit={handleCheckout}
            className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4 sticky top-6"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Nota Keranjang Multi-Satuan
                </h2>
                <p className="text-[11px] text-slate-500">
                  Kasir 01 • Takeaway Pickup
                </p>
              </div>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="text-xs font-semibold text-red-600 hover:underline cursor-pointer"
                >
                  Kosongkan
                </button>
              )}
            </div>

            {/* Reseller / Customer Selector (FR-202) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Pilih Pelanggan / Mitra Reseller Terdaftar
              </label>
              <select
                value={selectedResellerId}
                onChange={(e) => setSelectedResellerId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white font-medium"
              >
                <option value="">Pelanggan Umum (Walk-in Eceran)</option>
                {resellers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.businessName} — Reseller Terdaftar ({r.culinarySegment})
                  </option>
                ))}
              </select>
            </div>

            {/* Cart Items */}
            <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
              {cart.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
                  Keranjang masih kosong. Klik tombol{" "}
                  <strong>+1 Pack (Ecer)</strong> atau{" "}
                  <strong>+1 Dus (Grosir)</strong> pada katalog produk.
                </div>
              ) : (
                cart.map((item) => {
                  const totalPacks =
                    item.soldUnitType === "BOX"
                      ? item.soldQty * item.packsPerBox
                      : item.soldQty;
                  const gross = item.unitPrice * item.soldQty;
                  const disc =
                    item.promoDiscountPct > 0
                      ? Math.round(gross * (item.promoDiscountPct / 100))
                      : 0;
                  const netLine = gross - disc;

                  return (
                    <div
                      key={item.key}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                          <span>{item.productName}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              item.soldUnitType === "BOX"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-slate-200 text-slate-700"
                            }`}
                          >
                            {item.unitLabel}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Konversi FEFO: <strong>{totalPacks} Pack</strong> •
                          Ambil: {item.pickingBatchLabel}
                        </div>
                        <div className="font-bold text-emerald-800">
                          {formatRp(netLine)}
                          {disc > 0 && (
                            <span className="ml-1.5 text-[10px] text-amber-700">
                              (Hemat Promo FEFO {formatRp(disc)})
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleUpdateQty(item.key, -1)}
                          className="w-7 h-7 rounded-lg bg-white border border-slate-300 font-bold text-slate-700 cursor-pointer"
                        >
                          -
                        </button>
                        <span className="w-6 text-center font-bold">
                          {item.soldQty}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdateQty(item.key, 1)}
                          className="w-7 h-7 rounded-lg bg-white border border-slate-300 font-bold text-slate-700 cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Payment Method Selector */}
            <div className="pt-3 border-t border-slate-100 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("QRIS")}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition cursor-pointer ${
                    paymentMethod === "QRIS"
                      ? "bg-emerald-700 text-white border-emerald-700"
                      : "bg-slate-50 text-slate-700 border-slate-200"
                  }`}
                >
                  • QRIS Lunas
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("CASH")}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition cursor-pointer ${
                    paymentMethod === "CASH"
                      ? "bg-emerald-700 text-white border-emerald-700"
                      : "bg-slate-50 text-slate-700 border-slate-200"
                  }`}
                >
                  • Tunai (Cash)
                </button>
              </div>

              {paymentMethod === "CASH" && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Nominal Uang Tunai Diterima (Rp)
                  </label>
                  <input
                    type="number"
                    placeholder={String(cartSubtotal)}
                    value={cashReceivedInput}
                    onChange={(e) => setCashReceivedInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  />
                </div>
              )}

              <div className="flex items-center justify-between text-base font-extrabold text-slate-900 pt-1">
                <span>Total Tagihan:</span>
                <span>{formatRp(cartSubtotal)}</span>
              </div>

              <button
                type="submit"
                disabled={cart.length === 0 || submitting}
                className="w-full py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white text-xs font-bold shadow-sm transition cursor-pointer"
              >
                {submitting
                  ? "Memproses Transaksi Atomik..."
                  : `Selesaikan Transaksi & Potong Batch FEFO (${formatRp(
                      cartSubtotal
                    )})`}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Receipt & FEFO Allocation Modal (FR-205) */}
      {receiptModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4 text-xs">
            <div className="text-center border-b border-dashed border-slate-200 pb-3">
              <div className="text-[11px] font-bold text-emerald-700 uppercase">
                ✓ Transaksi POS & Antrean FEFO Sinkron 100%
              </div>
              <h3 className="text-lg font-extrabold text-slate-900 mt-0.5">
                {receiptModal.invoiceNumber}
              </h3>
              <p className="text-[11px] text-slate-500">
                {receiptModal.customerName} ({receiptModal.customerTypeLabel}) •{" "}
                {receiptModal.paymentMethod === "QRIS"
                  ? "QRIS Lunas"
                  : "Tunai Lunas"}
              </p>
            </div>

            {/* Line Items & Batch Allocations */}
            <div className="space-y-2.5">
              {receiptModal.items.map((item) => (
                <div
                  key={item.id}
                  className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1"
                >
                  <div className="flex justify-between font-bold text-slate-900">
                    <span>
                      {item.soldQty} {item.soldUnitType} {item.productName} (
                      {item.deductedPacksQty} Pack)
                    </span>
                    <span>{formatRp(item.subtotalAmount)}</span>
                  </div>
                  <div className="text-[11px] text-emerald-800 font-medium">
                    Diputuskan dari Batch FEFO:{" "}
                    {item.batchAllocations
                      .map(
                        (b) =>
                          `${b.batchNumber} (${b.packsDeducted} Pack, Exp ${b.expiryDate})`
                      )
                      .join(", ")}
                  </div>
                </div>
              ))}
            </div>

            {/* Financial Split Summary */}
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-600">Total Pembayaran:</span>
                <span className="font-bold text-slate-900">
                  {formatRp(receiptModal.totalAmountRp)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">
                  HPP Dikembalikan ke Kas Siap Kulakan:
                </span>
                <span className="font-bold text-emerald-800">
                  +{formatRp(receiptModal.totalCogsRp)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Laba Kotor Transaksi:</span>
                <span className="font-bold text-emerald-700">
                  +{formatRp(receiptModal.grossProfitRp)}
                </span>
              </div>
            </div>

            {/* Auto-Triggered ROP Alert if any */}
            {receiptModal.triggeredRfqSessions.length > 0 && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-1.5 text-[11px] text-amber-900">
                <div className="font-bold">
                  ⚡ Pemicu Pengadaan Proaktif (ROP) Aktif!
                </div>
                {receiptModal.triggeredRfqSessions.map((rfq) => (
                  <div key={rfq.rfqSessionId}>
                    Stok <strong>{rfq.productName}</strong> kini tersisa{" "}
                    {rfq.healthyStockPacks} Pack (≤ ROP {rfq.reorderPointPacks}{" "}
                    Pack). Sesi <strong>{rfq.rfqCode}</strong> telah disiapkan
                    dengan 3 kandidat distributor untuk persetujuan 1-klik
                    Owner!
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setReceiptModal(null);
                    onNavigateTab("whatsapp");
                  }}
                  className="mt-1 px-3 py-1.5 bg-amber-800 text-white rounded-lg font-bold cursor-pointer"
                >
                  Lihat Permohonan Izin Auto-RFQ →
                </button>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-semibold cursor-pointer"
              >
                Cetak Struk Termal
              </button>
              <button
                type="button"
                onClick={() => setReceiptModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-semibold cursor-pointer"
              >
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

