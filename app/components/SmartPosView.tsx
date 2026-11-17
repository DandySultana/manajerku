"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { formatRp } from "./CommandCenterDashboard";
import { useGooeyToastFlash } from "./GooeyToastProvider";

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
  standardCogsPerPack: number;
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
  standardCogsPerPack: number;
  promoDiscountPct: number;
  pickingBatchLabel: string;
  shortBatchCode: string;
  isBelowRop: boolean;
}

interface CheckoutReceiptData {
  transactionId: string;
  invoiceNumber: string;
  storeName?: string;
  storeBranchName?: string;
  storeAddress?: string;
  storePhone?: string;
  cashierName?: string;
  createdAtIso?: string;
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

type StockStatusFilter = "ALL" | "CRITICAL" | "FEFO" | "SAFE";
type PayUiOption = "QRIS" | "CASH" | "TRANSFER";

function formatShortPriceRb(amountRp: number): string {
  if (amountRp >= 1000 && amountRp % 1000 === 0) {
    return `Rp ${amountRp / 1000}rb`;
  }
  return formatRp(amountRp);
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "PU";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function getShortBatchCode(batchNumber: string | undefined): string {
  if (!batchNumber) return "FEFO";
  return batchNumber.replace(/^Batch\s+/i, "").trim();
}

function getProductCodeMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
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
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<StockStatusFilter>("ALL");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [fastMode, setFastMode] = useState(false);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedResellerId, setSelectedResellerId] = useState<string>("");
  const [resellerPickerOpen, setResellerPickerOpen] = useState(false);
  const [payUiOption, setPayUiOption] = useState<PayUiOption>("QRIS");
  const [cashReceivedInput, setCashReceivedInput] = useState<string>("");
  const [qrisImageUrl, setQrisImageUrl] = useState<string | null>(null);
  const [qrisUploading, setQrisUploading] = useState(false);
  const [qrisUploadError, setQrisUploadError] = useState<string | null>(null);
  const [showQrisModal, setShowQrisModal] = useState(false);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useGooeyToastFlash(null, errorMsg, undefined, () => setErrorMsg(null));
  useGooeyToastFlash(null, qrisUploadError, undefined, () =>
    setQrisUploadError(null),
  );
  const [receiptModal, setReceiptModal] = useState<CheckoutReceiptData | null>(
    null,
  );
  const [measuredReceiptHeightMm, setMeasuredReceiptHeightMm] = useState<
    number | null
  >(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const resellerMenuRef = useRef<HTMLDivElement | null>(null);
  const qrisFileInputRef = useRef<HTMLInputElement | null>(null);

  const loadCatalog = useCallback(async () => {
    try {
      setErrorMsg(null);
      const res = await fetch(
        `/api/v1/pos/catalog?storeId=${encodeURIComponent(activeStoreId)}`,
      );
      const json = await res.json();
      if (json.success) {
        setProducts(json.data.products);
        setResellers(json.data.resellers);
        setQrisImageUrl(json.data.storeQrisImageUrl || null);
      } else {
        setErrorMsg(json.error?.message || "Gagal memuat katalog POS.");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal memuat katalog POS.",
      );
    } finally {
      setLoading(false);
    }
  }, [activeStoreId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/pos/catalog?storeId=${encodeURIComponent(activeStoreId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) {
          setProducts(json.data.products);
          setResellers(json.data.resellers);
          setQrisImageUrl(json.data.storeQrisImageUrl || null);
          if (json.data.resellers?.length > 0) {
            const preferred =
              json.data.resellers.find(
                (r: ResellerOption) => r.id === "reseller-01",
              ) || json.data.resellers[0];
            setSelectedResellerId((prev) => prev || preferred.id);
          }
        } else {
          setErrorMsg(json.error?.message || "Gagal memuat katalog POS.");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(
          err instanceof Error ? err.message : "Gagal memuat katalog POS.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeStoreId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        setFastMode((prev) => !prev);
        searchInputRef.current?.focus();
      } else if (e.key === "Escape") {
        setFilterMenuOpen(false);
        setResellerPickerOpen(false);
        setReceiptModal(null);
        setShowQrisModal(false);
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (filterMenuRef.current && !filterMenuRef.current.contains(target)) {
        setFilterMenuOpen(false);
      }
      if (
        resellerMenuRef.current &&
        !resellerMenuRef.current.contains(target)
      ) {
        setResellerPickerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const getProductPacksInCart = (productId: string) => {
    return cart
      .filter((c) => c.productId === productId)
      .reduce(
        (sum, c) =>
          sum +
          (c.soldUnitType === "BOX" ? c.soldQty * c.packsPerBox : c.soldQty),
        0,
      );
  };

  const handleAddToCart = (
    prod: PosCatalogProduct,
    unitType: "PACK" | "BOX",
  ) => {
    setErrorMsg(null);
    const additionalPacks = unitType === "BOX" ? prod.packsPerBox : 1;
    const currentPacksInCart = getProductPacksInCart(prod.id);

    if (currentPacksInCart + additionalPacks > prod.totalHealthyPacks) {
      if (prod.expiredBlockedPacks > 0 && prod.totalHealthyPacks === 0) {
        setErrorMsg(
          `Stok sehat ${prod.name} habis! Terdapat ${prod.expiredBlockedPacks} Pack pada batch kedaluwarsa yang diblokir otomatis oleh proteksi FEFO.`,
        );
      } else {
        setErrorMsg(
          `Stok sehat ${prod.name} tidak mencukupi untuk menambah 1 ${
            unitType === "BOX" ? prod.wholesaleUnitName : prod.retailUnitName
          }. Sisa stok sehat: ${prod.totalHealthyPacks} Pack.`,
        );
      }
      return;
    }

    const lineKey = `${prod.id}-${unitType}`;
    const unitPrice =
      unitType === "BOX" ? prod.wholesalePricePerBox : prod.retailPricePerPack;
    const promoPct = prod.firstFefoPickingBatch?.promoDiscountPct || 0;
    const pickingLabel = prod.firstFefoPickingBatch
      ? `${prod.firstFefoPickingBatch.batchNumber} (Exp ${prod.firstFefoPickingBatch.daysToExpiry} Hr)`
      : "Antrean FEFO";
    const shortBatch = getShortBatchCode(
      prod.firstFefoPickingBatch?.batchNumber,
    );

    setCart((prev) => {
      const existing = prev.find((item) => item.key === lineKey);
      if (existing) {
        return prev.map((item) =>
          item.key === lineKey ? { ...item, soldQty: item.soldQty + 1 } : item,
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
          standardCogsPerPack:
            prod.standardCogsPerPack ??
            Math.round(prod.retailPricePerPack * 0.78),
          promoDiscountPct: promoPct,
          pickingBatchLabel: pickingLabel,
          shortBatchCode: shortBatch,
          isBelowRop: prod.isBelowRop,
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
            const addPacks = item.soldUnitType === "BOX" ? item.packsPerBox : 1;
            if (
              getProductPacksInCart(prod.id) + addPacks >
              prod.totalHealthyPacks
            ) {
              setErrorMsg(
                `Stok sehat ${prod.name} maksimum ${prod.totalHealthyPacks} Pack.`,
              );
              return item;
            }
          }
          return { ...item, soldQty: nextQty };
        })
        .filter((x): x is CartLine => x !== null),
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

  const estimatedMarginRp = cart.reduce((sum, item) => {
    const gross = item.unitPrice * item.soldQty;
    const disc =
      item.promoDiscountPct > 0
        ? Math.round(gross * (item.promoDiscountPct / 100))
        : 0;
    const net = gross - disc;
    const totalPacks =
      item.soldUnitType === "BOX"
        ? item.soldQty * item.packsPerBox
        : item.soldQty;
    const cogs = item.standardCogsPerPack * totalPacks;
    return sum + (net - cogs);
  }, 0);

  const totalCartUnits = cart.reduce((sum, item) => sum + item.soldQty, 0);

  const apiPaymentMethod: "QRIS" | "CASH" =
    payUiOption === "CASH" ? "CASH" : "QRIS";

  const handleQrisFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setQrisUploadError(null);
    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setQrisUploadError("Format gambar QRIS harus PNG, JPG, atau WEBP.");
      e.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setQrisUploadError("Ukuran gambar QRIS maksimal 2 MB.");
      e.target.value = "";
      return;
    }

    setQrisUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Gagal membaca file gambar."));
        reader.readAsDataURL(file);
      });

      const res = await fetch("/api/v1/stores/qris-image", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: activeStoreId,
          imageDataUrl: dataUrl,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setQrisUploadError(
          json.error?.message || "Gagal menyimpan gambar QRIS.",
        );
      } else {
        setQrisImageUrl(json.data.qrisImageUrl);
      }
    } catch (err) {
      setQrisUploadError(
        err instanceof Error ? err.message : "Gagal mengunggah gambar QRIS.",
      );
    } finally {
      setQrisUploading(false);
      e.target.value = "";
    }
  };

  const handleRemoveQrisImage = async () => {
    setQrisUploadError(null);
    setQrisUploading(true);
    try {
      const res = await fetch(
        `/api/v1/stores/qris-image?storeId=${encodeURIComponent(activeStoreId)}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (!json.success) {
        setQrisUploadError(
          json.error?.message || "Gagal menghapus gambar QRIS.",
        );
      } else {
        setQrisImageUrl(null);
        setShowQrisModal(false);
      }
    } catch (err) {
      setQrisUploadError(
        err instanceof Error ? err.message : "Gagal menghapus gambar QRIS.",
      );
    } finally {
      setQrisUploading(false);
    }
  };

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
          paymentMethod: apiPaymentMethod,
          cashReceived:
            apiPaymentMethod === "CASH" && cashReceivedInput
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
        err instanceof Error ? err.message : "Gagal memproses transaksi.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      e.preventDefault();
      const q = searchQuery.trim().toLowerCase();
      const exactSku = products.find((p) => p.skuCode.toLowerCase() === q);
      const target =
        exactSku ||
        (filteredProducts.length === 1 ? filteredProducts[0] : null);
      if (target) {
        handleAddToCart(target, "PACK");
        if (fastMode || exactSku) {
          setSearchQuery("");
        }
      }
    }
  };

  const categories = Array.from(
    new Set(products.map((p) => p.category).filter(Boolean)),
  );

  const filteredProducts = products.filter((p) => {
    const q = searchQuery.toLowerCase();
    const matchesQuery =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.skuCode.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q);
    if (!matchesQuery) return false;

    if (selectedCategory !== "ALL" && p.category !== selectedCategory) {
      return false;
    }

    const packsInCart = getProductPacksInCart(p.id);
    const remainingPacks = p.totalHealthyPacks - packsInCart;
    const isCritical = p.isBelowRop || remainingPacks <= 0;
    const isFefoPrio =
      !isCritical &&
      ((p.firstFefoPickingBatch?.daysToExpiry ?? 999) < 30 ||
        p.firstFefoPickingBatch?.fefoStatus === "PRIORITY_FEFO");

    if (statusFilter === "CRITICAL") return isCritical;
    if (statusFilter === "FEFO") return isFefoPrio;
    if (statusFilter === "SAFE") return !isCritical && !isFefoPrio;
    return true;
  });

  const activeReseller = resellers.find((r) => r.id === selectedResellerId);

  return (
    <div className="space-y-5">
      <div className={receiptModal ? "print:hidden space-y-5" : "space-y-5"}>
        {/* Top Page Header (no white box wrapper) */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h1 className="text-[22px] sm:text-[24px] font-bold text-[#0F172A] tracking-tight leading-snug">
              Kasir POS Cerdas Multi-Satuan (Eceran &amp; Dus)
            </h1>
            <p className="text-[13px] text-[#64748B] mt-0.5">
              Konversi otomatis kardus ke bungkus &amp; pemotongan stok dari
              Batch Kedaluwarsa Terdekat (FEFO)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <span className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white border border-[#E2E8F0] text-xs font-medium text-[#334155] inline-flex items-center gap-2 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <span className="w-2 h-2 rounded-full bg-[#10B981] shrink-0" />
              <span>Shift Pagi • Scanner Aktif</span>
            </span>

            <button
              type="button"
              onClick={() => {
                setFastMode((prev) => !prev);
                searchInputRef.current?.focus();
              }}
              aria-pressed={fastMode}
              className={`min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-medium inline-flex items-center gap-2 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352] ${
                fastMode
                  ? "bg-[#D7F0E6] border-[#0F6352]/40 text-[#0F6352] font-semibold"
                  : "bg-white hover:bg-[#F8FAFC] border-[#E2E8F0] text-[#334155]"
              }`}
            >
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
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <path d="M6 10h.01" />
                <path d="M10 10h.01" />
                <path d="M14 10h.01" />
                <path d="M18 10h.01" />
                <path d="M8 14h8" />
              </svg>
              <span>
                {fastMode ? "Mode Cepat Aktif (F2)" : "Mode Cepat (F2)"}
              </span>
            </button>
          </div>
        </div>

        {/* Main Workspace: Catalog (Left) + Active Order Cart (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_350px] xl:grid-cols-[minmax(0,1fr)_390px] gap-5 items-start">
          {/* Left Catalog Panel */}
          <section
            aria-label="Katalog produk POS multi-satuan"
            className="min-w-0 w-full bg-white rounded-2xl border border-[#E5E9EC] p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4"
          >
            {/* Search & Filter Toolbar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <div className="relative flex-1 min-w-0">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-4 h-4 text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="search"
                  aria-label="Cari nama produk frozen food atau scan barcode"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Cari nama produk frozen food atau scan barcode..."
                  className="w-full pl-10 pr-12 sm:pr-11 py-2.5 min-h-[44px] sm:min-h-[42px] text-xs rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[#0F172A] placeholder:text-[#94A3B8] focus:bg-white focus:outline-none focus:border-[#0F6352]"
                />
                <button
                  type="button"
                  onClick={() => searchInputRef.current?.focus()}
                  aria-label="Fokus input pemindai barcode"
                  title="Scan barcode atau tekan Enter pada kode SKU"
                  className="absolute right-0.5 sm:right-1.5 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] rounded-lg text-[#0F6352] hover:bg-[#D7F0E6]/60 flex items-center justify-center transition-colors"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                  >
                    <path d="M4 7V5a1 1 0 0 1 1-1h2" />
                    <path d="M17 4h2a1 1 0 0 1 1 1v2" />
                    <path d="M20 17v2a1 1 0 0 1-1 1h-2" />
                    <path d="M7 20H5a1 1 0 0 1-1-1v-2" />
                    <path d="M8 8v8" />
                    <path d="M12 8v8" />
                    <path d="M16 8v8" />
                  </svg>
                </button>
              </div>

              <div className="relative" ref={filterMenuRef}>
                <button
                  type="button"
                  onClick={() => setFilterMenuOpen((prev) => !prev)}
                  aria-expanded={filterMenuOpen}
                  aria-label="Filter status stok produk"
                  className={`w-full sm:w-auto min-h-[44px] sm:min-h-[42px] px-4 py-2 rounded-xl border text-xs font-medium inline-flex items-center justify-center gap-2 transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352] ${
                    statusFilter !== "ALL"
                      ? "bg-[#D7F0E6] border-[#0F6352]/40 text-[#0F6352] font-semibold"
                      : "bg-white hover:bg-[#F8FAFC] border-[#E2E8F0] text-[#334155]"
                  }`}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                  >
                    <line x1="4" y1="6" x2="20" y2="6" />
                    <line x1="7" y1="12" x2="17" y2="12" />
                    <line x1="10" y1="18" x2="14" y2="18" />
                  </svg>
                  <span>Filter</span>
                </button>

                {filterMenuOpen && (
                  <div
                    role="menu"
                    aria-label="Filter kondisi stok"
                    className="absolute right-0 mt-1.5 w-52 bg-white rounded-xl border border-[#E2E8F0] shadow-lg p-1.5 z-30 text-xs"
                  >
                    {(
                      [
                        ["ALL", "Semua Status Stok"],
                        ["CRITICAL", "Stok Kritis (<= ROP)"],
                        ["FEFO", "Prioritas FEFO (<30 Hr)"],
                        ["SAFE", "Stok Aman"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setStatusFilter(key);
                          setFilterMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                          statusFilter === key
                            ? "bg-[#D7F0E6] text-[#0F6352] font-semibold"
                            : "text-[#334155] hover:bg-[#F8FAFC]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Category Pills */}
            <div
              role="tablist"
              aria-label="Kategori produk"
              className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <button
                type="button"
                role="tab"
                aria-selected={selectedCategory === "ALL"}
                onClick={() => setSelectedCategory("ALL")}
                className={`min-h-[44px] sm:min-h-[34px] px-4 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352] ${
                  selectedCategory === "ALL"
                    ? "bg-[#0F6352] text-white font-semibold shadow-2xs"
                    : "bg-transparent hover:bg-[#F8FAFC] text-[#64748B] hover:text-[#0F172A] font-medium"
                }`}
              >
                Semua ({products.length})
              </button>
              {categories.map((cat) => {
                const active = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelectedCategory(cat)}
                    className={`min-h-[44px] sm:min-h-[34px] px-3.5 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352] ${
                      active
                        ? "bg-[#0F6352] text-white font-semibold shadow-2xs"
                        : "bg-transparent hover:bg-[#F8FAFC] text-[#64748B] hover:text-[#0F172A] font-medium"
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            {/* Product Grid */}
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3.5 animate-pulse">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-44 rounded-2xl bg-[#F8FAFC] border border-[#E5E9EC]"
                  />
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="py-12 px-4 text-center rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC]/60 space-y-2.5">
                <div className="text-xs font-semibold text-[#334155]">
                  Belum ada produk (Master SKU) di toko ini.
                </div>
                <div className="text-[11px] text-[#64748B]">
                  Tambahkan Master SKU terlebih dahulu di menu Inventaris FEFO
                  agar produk dapat dijual di kasir POS.
                </div>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="py-12 px-4 text-center rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC]/60 space-y-2.5">
                <div className="text-xs font-semibold text-[#334155]">
                  Produk tidak ditemukan dengan kriteria pencarian saat ini.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedCategory("ALL");
                    setStatusFilter("ALL");
                  }}
                  className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-white border border-[#E2E8F0] hover:bg-[#F1F5F9] text-xs font-semibold text-[#0F6352]"
                >
                  Reset Pencarian &amp; Filter
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3.5">
                {filteredProducts.map((prod) => {
                  const packsInCart = getProductPacksInCart(prod.id);
                  const remainingPacks = prod.totalHealthyPacks - packsInCart;
                  const canAddPack = remainingPacks >= 1;
                  const canAddBox = remainingPacks >= prod.packsPerBox;
                  const isCritical = prod.isBelowRop || remainingPacks <= 0;
                  const daysExp =
                    prod.firstFefoPickingBatch?.daysToExpiry ?? 999;
                  const isFefoWarning =
                    !isCritical &&
                    (daysExp < 30 ||
                      prod.firstFefoPickingBatch?.fefoStatus ===
                        "PRIORITY_FEFO");
                  const shortBatch = getShortBatchCode(
                    prod.firstFefoPickingBatch?.batchNumber,
                  );

                  return (
                    <article
                      key={prod.id}
                      className="min-w-0 bg-white rounded-2xl border border-[#E5E9EC] hover:border-[#CBD5E1] p-4 flex flex-col justify-between gap-3.5 transition-colors"
                    >
                      {/* Top SKU + Status Pill */}
                      <div className="space-y-3 min-w-0">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="font-mono text-[11px] text-[#64748B] truncate">
                            SKU: {prod.skuCode}
                          </span>

                          {isCritical ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700 border border-red-200/80 shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                              Kritis • {remainingPacks} {prod.retailUnitName}
                            </span>
                          ) : isFefoWarning ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200/80 shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              FEFO • {daysExp} Hari
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#EBF8F2] text-[#0F6352] border border-[#CCE8DB] shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                              Aman • {remainingPacks} {prod.retailUnitName}
                            </span>
                          )}
                        </div>

                        {/* Product Thumbnail Tile + Name & Conversion */}
                        <div className="flex items-center gap-3">
                          <div
                            aria-hidden="true"
                            className="w-12 h-12 rounded-xl bg-[#F4F7F6] border border-[#E5E9EC] flex flex-col items-center justify-center shrink-0 text-[#0F6352]"
                          >
                            <span className="text-xs font-extrabold tracking-tight leading-none">
                              {getProductCodeMonogram(prod.name)}
                            </span>
                            <span className="text-[9px] font-mono text-[#64748B] mt-1 leading-none">
                              {prod.packsPerBox}P
                            </span>
                          </div>
                          <div className="min-w-0">
                            <h2 className="text-[13px] font-bold text-[#0F172A] leading-snug truncate">
                              {prod.name}
                            </h2>
                            <div className="text-[11px] font-mono text-[#64748B] mt-0.5 truncate">
                              1 {prod.wholesaleUnitName} = {prod.packsPerBox}{" "}
                              {prod.retailUnitName}
                              {prod.firstFefoPickingBatch
                                ? ` • ${shortBatch}`
                                : ""}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Dual Unit Quick Add Buttons */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={!canAddPack}
                          onClick={() => handleAddToCart(prod, "PACK")}
                          aria-label={`Tambah 1 ${prod.retailUnitName} ${prod.name}`}
                          className="min-h-[44px] sm:min-h-[40px] px-2 py-2 rounded-xl border border-[#E2E8F0] bg-white hover:border-[#0F6352] hover:bg-[#F8FAFC] disabled:opacity-40 text-[11px] sm:text-xs font-semibold text-[#0F172A] text-center truncate transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
                        >
                          + {prod.retailUnitName} •{" "}
                          {formatShortPriceRb(prod.retailPricePerPack)}
                        </button>

                        <button
                          type="button"
                          disabled={!canAddBox}
                          onClick={() => handleAddToCart(prod, "BOX")}
                          aria-label={`Tambah 1 ${prod.wholesaleUnitName} ${prod.name}`}
                          className="min-h-[44px] sm:min-h-[40px] px-2 py-2 rounded-xl border border-[#BFE6D6] bg-[#EBF8F2] hover:bg-[#D7F0E6] disabled:opacity-40 text-[11px] sm:text-xs font-semibold text-[#0F6352] text-center truncate transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
                        >
                          + {prod.wholesaleUnitName} •{" "}
                          {formatShortPriceRb(prod.wholesalePricePerBox)}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* Right Active Invoice / Cart Panel */}
          <aside
            aria-label="Nota aktif dan checkout kasir"
            className="min-w-0 w-full"
          >
            <form
              onSubmit={handleCheckout}
              className="w-full min-w-0 bg-white rounded-2xl border border-[#E5E9EC] p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4 lg:sticky lg:top-20"
            >
              {/* Active Invoice Header */}
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#F1F5F9]">
                <div className="flex items-center gap-2 min-w-0">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4 text-[#0F6352] shrink-0"
                  >
                    <path d="M4 3h16v18l-2.5-1.5L15 21l-3-1.5L9 21l-2.5-1.5L4 21V3Z" />
                    <path d="M8 8h8" />
                    <path d="M8 12h8" />
                    <path d="M8 16h5" />
                  </svg>
                  <h2 className="text-[14px] font-bold text-[#0F172A] truncate">
                    Nota Aktif (Transaksi Baru)
                  </h2>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#475569] text-[11px] font-medium shrink-0">
                  Grosir &amp; Ecer
                </span>
              </div>

              {/* Customer / Reseller Card with Ganti Selector */}
              <div className="relative" ref={resellerMenuRef}>
                <div className="bg-[#F8FAFC] border border-[#E5E9EC] rounded-xl px-3 py-2.5 flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      aria-hidden="true"
                      className="w-9 h-9 rounded-full bg-[#DCE9FF] text-[#1D4ED8] font-bold text-xs flex items-center justify-center shrink-0"
                    >
                      {getInitials(
                        activeReseller?.businessName || "Pelanggan Umum",
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#0F172A] truncate">
                        {activeReseller?.businessName || "Pelanggan Umum"}
                      </div>
                      <div className="text-[11px] text-[#64748B] truncate">
                        {activeReseller
                          ? `Reseller Terdaftar (${activeReseller.culinarySegment})`
                          : "Walk-in Eceran"}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setResellerPickerOpen((prev) => !prev)}
                    aria-expanded={resellerPickerOpen}
                    aria-label="Ganti pelanggan atau mitra reseller"
                    className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-semibold text-[#0F6352] hover:bg-[#D7F0E6]/60 inline-flex items-center gap-1 shrink-0 transition-colors"
                  >
                    <span>Ganti</span>
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3.5 h-3.5"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                </div>

                {resellerPickerOpen && (
                  <div
                    role="listbox"
                    aria-label="Pilih pelanggan atau reseller"
                    className="absolute left-0 right-0 mt-1.5 max-h-60 overflow-y-auto bg-white rounded-xl border border-[#E2E8F0] shadow-lg p-1.5 z-30 text-xs space-y-0.5"
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={selectedResellerId === ""}
                      onClick={() => {
                        setSelectedResellerId("");
                        setResellerPickerOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between ${
                        selectedResellerId === ""
                          ? "bg-[#D7F0E6] text-[#0F6352] font-semibold"
                          : "text-[#334155] hover:bg-[#F8FAFC]"
                      }`}
                    >
                      <span>Pelanggan Umum (Walk-in Eceran)</span>
                    </button>
                    {resellers.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        role="option"
                        aria-selected={selectedResellerId === r.id}
                        onClick={() => {
                          setSelectedResellerId(r.id);
                          setResellerPickerOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between gap-2 ${
                          selectedResellerId === r.id
                            ? "bg-[#D7F0E6] text-[#0F6352] font-semibold"
                            : "text-[#334155] hover:bg-[#F8FAFC]"
                        }`}
                      >
                        <span className="truncate">{r.businessName}</span>
                        <span className="text-[10px] font-mono text-[#64748B] shrink-0">
                          {r.culinarySegment}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Cart Items */}
              <div className="space-y-3 max-h-64 overflow-y-auto pr-0.5">
                {cart.length === 0 ? (
                  <div className="py-8 px-4 text-center text-xs text-[#64748B] border border-dashed border-[#CBD5E1] rounded-xl bg-[#F8FAFC]/50">
                    Keranjang masih kosong. Klik tombol{" "}
                    <strong className="text-[#0F172A]">+ Pack</strong> atau{" "}
                    <strong className="text-[#0F6352]">+ Dus</strong> pada
                    katalog produk.
                  </div>
                ) : (
                  cart.map((item) => {
                    const gross = item.unitPrice * item.soldQty;
                    const disc =
                      item.promoDiscountPct > 0
                        ? Math.round(gross * (item.promoDiscountPct / 100))
                        : 0;
                    const netLine = gross - disc;
                    const effectiveUnitPrice = Math.round(
                      netLine / item.soldQty,
                    );

                    return (
                      <div
                        key={item.key}
                        className="pb-3 border-b border-[#F1F5F9] last:border-b-0 last:pb-0 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-xs font-bold text-[#0F172A] leading-snug">
                            {item.productName}
                          </div>
                          <div className="font-mono text-xs font-bold text-[#0F172A] tabular-nums shrink-0">
                            {formatRp(netLine)}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <div className="inline-flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
                            <button
                              type="button"
                              onClick={() => handleUpdateQty(item.key, -1)}
                              aria-label={`Kurangi ${item.productName}`}
                              className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center text-xs font-bold text-[#475569] hover:text-[#0F172A]"
                            >
                              -
                            </button>
                            <span className="px-2 text-xs font-semibold text-[#0F172A] whitespace-nowrap">
                              {item.soldQty} {item.unitLabel}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUpdateQty(item.key, 1)}
                              aria-label={`Tambah ${item.productName}`}
                              className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center text-xs font-bold text-[#475569] hover:text-[#0F172A]"
                            >
                              +
                            </button>
                          </div>

                          <div className="text-[11px] font-mono text-right truncate">
                            {item.isBelowRop ? (
                              <span className="text-[#0F6352] font-medium">
                                FEFO {item.shortBatchCode} • Auto-RFQ Siap
                              </span>
                            ) : (
                              <span className="text-[#64748B]">
                                FEFO {item.shortBatchCode} •{" "}
                                {formatRp(effectiveUnitPrice)}/
                                {item.unitLabel.toLowerCase()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Payment Methods */}
              <div className="pt-3 border-t border-[#F1F5F9] space-y-3">
                <div className="text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                  Metode Pembayaran
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayUiOption("QRIS")}
                    className={`min-w-0 min-h-[44px] sm:min-h-[40px] px-1.5 py-2 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352] ${
                      payUiOption === "QRIS"
                        ? "bg-[#EBF8F2] border-[#0F6352] text-[#0F6352]"
                        : "bg-white hover:bg-[#F8FAFC] border-[#E2E8F0] text-[#475569]"
                    }`}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3.5 h-3.5 shrink-0"
                    >
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <path d="M14 14h3v3h-3z" />
                      <path d="M18 18h3v3h-3z" />
                    </svg>
                    <span>QRIS</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPayUiOption("CASH")}
                    className={`min-w-0 min-h-[44px] sm:min-h-[40px] px-1.5 py-2 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352] ${
                      payUiOption === "CASH"
                        ? "bg-[#EBF8F2] border-[#0F6352] text-[#0F6352]"
                        : "bg-white hover:bg-[#F8FAFC] border-[#E2E8F0] text-[#475569]"
                    }`}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3.5 h-3.5 shrink-0"
                    >
                      <rect x="2" y="6" width="20" height="12" rx="2" />
                      <circle cx="12" cy="12" r="2.5" />
                    </svg>
                    <span>Tunai</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPayUiOption("TRANSFER")}
                    className={`min-w-0 min-h-[44px] sm:min-h-[40px] px-1.5 py-2 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352] ${
                      payUiOption === "TRANSFER"
                        ? "bg-[#EBF8F2] border-[#0F6352] text-[#0F6352]"
                        : "bg-white hover:bg-[#F8FAFC] border-[#E2E8F0] text-[#475569]"
                    }`}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3.5 h-3.5 shrink-0"
                    >
                      <path d="M3 21h18" />
                      <path d="M5 6l7-3 7 3" />
                      <path d="M6 10v8" />
                      <path d="M12 10v8" />
                      <path d="M18 10v8" />
                    </svg>
                    <span>Transfer</span>
                  </button>
                </div>

                {payUiOption === "QRIS" && (
                  <div className="bg-[#F8FAFC] border border-[#E5E9EC] rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="pos-qris-file"
                        className="text-[11px] font-semibold text-[#475569]"
                      >
                        Gambar QRIS Toko (Opsional)
                      </label>
                      {qrisImageUrl && (
                        <span className="text-[10px] font-medium text-[#0F6352]">
                          Tersimpan
                        </span>
                      )}
                    </div>

                    <input
                      id="pos-qris-file"
                      ref={qrisFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleQrisFileChange}
                      className="sr-only"
                    />

                    {qrisImageUrl ? (
                      <div className="flex items-center gap-3">
                        <Image
                          src={qrisImageUrl}
                          alt="Kode QRIS toko untuk pembayaran kasir"
                          width={56}
                          height={56}
                          unoptimized
                          className="w-14 h-14 rounded-lg border border-[#E2E8F0] bg-white object-contain shrink-0"
                        />
                        <div className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setShowQrisModal(true)}
                            className="min-h-[36px] px-2.5 py-1 rounded-lg bg-[#0F6352] hover:bg-[#0B4F41] text-white text-[11px] font-semibold transition-colors"
                          >
                            Perbesar QR
                          </button>
                          <button
                            type="button"
                            disabled={qrisUploading}
                            onClick={() => qrisFileInputRef.current?.click()}
                            className="min-h-[36px] px-2.5 py-1 rounded-lg bg-white hover:bg-[#F1F5F9] border border-[#CBD5E1] text-[#334155] text-[11px] font-medium transition-colors"
                          >
                            {qrisUploading ? "Menyimpan..." : "Ganti"}
                          </button>
                          <button
                            type="button"
                            disabled={qrisUploading}
                            onClick={handleRemoveQrisImage}
                            className="min-h-[36px] px-2.5 py-1 rounded-lg bg-white hover:bg-red-50 border border-[#E2E8F0] text-red-600 text-[11px] font-medium transition-colors"
                          >
                            Hapus
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={qrisUploading}
                        onClick={() => qrisFileInputRef.current?.click()}
                        className="w-full min-h-[44px] sm:min-h-[40px] px-3 py-2 rounded-lg border border-dashed border-[#CBD5E1] bg-white hover:border-[#0F6352] hover:bg-[#EBF8F2]/40 text-xs font-medium text-[#475569] hover:text-[#0F6352] inline-flex items-center justify-center gap-2 transition-colors focus-visible:outline-2 focus-visible:outline-[#0F6352]"
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="w-4 h-4 shrink-0"
                        >
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <span>
                          {qrisUploading
                            ? "Mengunggah gambar QRIS..."
                            : "Unggah Gambar QRIS (PNG/JPG)"}
                        </span>
                      </button>
                    )}
                  </div>
                )}

                {payUiOption === "CASH" && (
                  <div>
                    <label
                      htmlFor="pos-cash-received"
                      className="block text-[11px] font-semibold text-[#475569] mb-1"
                    >
                      Nominal Uang Tunai Diterima (Rp)
                    </label>
                    <input
                      id="pos-cash-received"
                      type="number"
                      placeholder={String(cartSubtotal)}
                      value={cashReceivedInput}
                      onChange={(e) => setCashReceivedInput(e.target.value)}
                      className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-[#CBD5E1] text-xs font-bold text-[#0F172A] focus:outline-none focus:border-[#0F6352]"
                    />
                  </div>
                )}

                {payUiOption === "TRANSFER" && (
                  <div className="text-[11px] text-[#475569] bg-[#F8FAFC] border border-[#E5E9EC] rounded-lg px-3 py-1.5">
                    Pembayaran transfer bank dicatat sebagai pelunasan nontunai
                    (QRIS/Transfer).
                  </div>
                )}

                {/* Estimasi Margin Bersih */}
                <div className="bg-[#F8FAFC] border border-[#E5E9EC] rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-[#64748B] font-medium">
                    Estimasi Margin Bersih
                  </span>
                  <span
                    className={`font-mono font-bold tabular-nums ${
                      estimatedMarginRp < 0
                        ? "text-amber-700"
                        : "text-[#0F6352]"
                    }`}
                  >
                    {activeRole === "CASHIER"
                      ? "Tersembunyi (Kasir)"
                      : estimatedMarginRp < 0
                        ? `-Rp ${Math.abs(estimatedMarginRp).toLocaleString("id-ID")}`
                        : `+${formatRp(estimatedMarginRp)}`}
                  </span>
                </div>

                {/* Total Pembayaran */}
                <div className="flex flex-wrap items-end justify-between gap-2 pt-1">
                  <div className="min-w-0">
                    <div className="text-[11px] text-[#64748B] font-medium">
                      Total Pembayaran
                    </div>
                    <div className="text-[22px] sm:text-[26px] font-bold text-[#0F172A] tracking-tight tabular-nums leading-none mt-1">
                      {formatRp(cartSubtotal)}
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#475569] text-[11px] font-medium shrink-0">
                    {cart.length} Jenis Item ({totalCartUnits} Unit)
                  </span>
                </div>

                {/* Primary CTA */}
                <button
                  type="submit"
                  disabled={cart.length === 0 || submitting}
                  className="w-full min-h-[46px] px-4 py-3 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] disabled:bg-[#CBD5E1] disabled:text-slate-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6352]"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4 shrink-0"
                  >
                    <path d="M4 3h16v18l-2.5-1.5L15 21l-3-1.5L9 21l-2.5-1.5L4 21V3Z" />
                    <path d="M8 9h8" />
                    <path d="M8 13h5" />
                  </svg>
                  <span>
                    {submitting
                      ? "Memproses Transaksi Atomik..."
                      : "Bayar & Kirim Struk WA →"}
                  </span>
                </button>

                <div className="text-[11px] text-[#64748B] flex items-center justify-center gap-1.5">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-3.5 h-3.5 text-[#0F6352] shrink-0"
                  >
                    <path d="m7 7 10 10-5 5V2l5 5L7 17" />
                  </svg>
                  <span>
                    Auto-cetak struk Bluetooth &amp; potong stok realtime
                  </span>
                </div>
              </div>
            </form>
          </aside>
        </div>
      </div>

      {/* Thermal Receipt Modal (Reference Design without Logo) */}
      {receiptModal &&
        (() => {
          const rawIso = receiptModal.createdAtIso || new Date().toISOString();
          const dateObj = new Date(rawIso);
          const pad2 = (n: number) => n.toString().padStart(2, "0");
          const dateYmd = Number.isNaN(dateObj.getTime())
            ? rawIso.slice(0, 10)
            : `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(
                dateObj.getDate(),
              )}`;
          const timeHms = Number.isNaN(dateObj.getTime())
            ? "08:46:36"
            : `${pad2(dateObj.getHours())}:${pad2(dateObj.getMinutes())}:${pad2(
                dateObj.getSeconds(),
              )}`;

          const rawPhone = receiptModal.storePhone || "08116800101";
          const displayPhone = rawPhone.startsWith("+62")
            ? `0${rawPhone.slice(3)}`
            : rawPhone;

          const digitsFromDate = `${dateYmd.replace(/-/g, "")}${timeHms.replace(
            /:/g,
            "",
          )}`;
          const invDigits =
            receiptModal.invoiceNumber.replace(/\D/g, "") || "01";
          const numericRefId = `164135${digitsFromDate}${invDigits.slice(-2)}`;

          const seqSuffix = receiptModal.invoiceNumber.split("-").pop() || "1";
          const queueNoLabel = `No.0-${Number(seqSuffix) || seqSuffix}`;

          const totalQtyUnits = receiptModal.items.reduce(
            (acc, it) => acc + it.soldQty,
            0,
          );

          const payLabel =
            payUiOption === "TRANSFER"
              ? "Transfer"
              : receiptModal.paymentMethod === "CASH"
                ? "Cash"
                : "QRIS";

          const cleanInvCode = receiptModal.invoiceNumber.replace(/^#/, "");
          const fallbackPrintHeightMm = Math.max(
            158,
            138 + receiptModal.items.length * 16,
          );
          const effectivePrintHeightMm = Math.max(
            fallbackPrintHeightMm,
            measuredReceiptHeightMm ?? 0,
          );

          return (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="pos-receipt-modal-title"
              className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4 overflow-y-auto print:static print:inset-auto print:z-auto print:bg-white print:p-0 print:m-0 print:overflow-visible print:block"
            >
              <style>{`
                @media print {
                  @page {
                    size: 80mm ${effectivePrintHeightMm}mm;
                    margin: 0mm;
                  }
                  html, body {
                    width: 80mm !important;
                    min-height: 0 !important;
                    height: auto !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    background: #ffffff !important;
                    color: #111111 !important;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                  }
                  #pos-thermal-receipt {
                    width: 80mm !important;
                    max-width: 80mm !important;
                    margin: 0 !important;
                    padding: 5.5mm 5mm !important;
                    border: none !important;
                    box-shadow: none !important;
                    border-radius: 0 !important;
                    box-sizing: border-box !important;
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                  }
                }
              `}</style>
              <div className="bg-[#F4F6F8] rounded-2xl max-w-md w-full p-4 sm:p-5 shadow-2xl border border-[#E2E8F0] space-y-4 max-h-[92vh] overflow-y-auto print:bg-white print:max-w-none print:w-auto print:max-h-none print:overflow-visible print:shadow-none print:border-0 print:rounded-none print:p-0 print:m-0 print:space-y-0">
                {/* Thermal Paper Sheet */}
                <article
                  id="pos-thermal-receipt"
                  ref={(el) => {
                    if (el) {
                      const heightMm =
                        Math.ceil((el.offsetHeight * 25.4) / 96) + 8;
                      if (
                        heightMm > 90 &&
                        heightMm !== measuredReceiptHeightMm
                      ) {
                        setMeasuredReceiptHeightMm(heightMm);
                      }
                    }
                  }}
                  className="bg-white text-[#111111] max-w-[330px] mx-auto px-5 py-6 rounded-lg shadow-xs border border-[#E2E8F0] text-[12.5px] leading-[1.45] font-sans"
                >
                  {/* Top Centered Store Header (No Logo) */}
                  <div className="text-center space-y-0.5">
                    <h3
                      id="pos-receipt-modal-title"
                      className="text-[18px] font-medium text-[#111111] tracking-tight leading-snug"
                    >
                      {receiptModal.storeName || "Manajerku Frozen Food"}
                    </h3>
                    <div className="text-[12.5px] text-[#111111]">
                      {receiptModal.storeAddress || "Banda Aceh"}
                    </div>
                    <div className="text-[12.5px] text-[#111111]">
                      {receiptModal.storeBranchName || "Cabang Utama"}
                    </div>
                    <div className="text-[12.5px] text-[#111111]">
                      No. Telp {displayPhone}
                    </div>
                    <div className="text-[12.5px] text-[#111111] tabular-nums">
                      {numericRefId}
                    </div>
                  </div>

                  {/* Dashed Divider 1 */}
                  <div className="border-b border-dashed border-[#222222] my-3" />

                  {/* Date/Time & Cashier/Customer Metadata */}
                  <div className="flex justify-between items-start gap-3 text-[12.5px]">
                    <div className="space-y-0.5 tabular-nums">
                      <div>{dateYmd}</div>
                      <div>{timeHms}</div>
                    </div>
                    <div className="text-right space-y-0.5">
                      <div>{receiptModal.cashierName || "Kasir 01"}</div>
                      <div>{receiptModal.customerName}</div>
                      <div>{receiptModal.customerTypeLabel}</div>
                    </div>
                  </div>
                  <div className="mt-2.5 text-[12.5px]">{queueNoLabel}</div>

                  {/* Dashed Divider 2 */}
                  <div className="border-b border-dashed border-[#222222] my-3" />

                  {/* Numbered Items List */}
                  <div className="space-y-2">
                    {receiptModal.items.map((item, idx) => {
                      const unitLabel =
                        item.soldUnitType === "BOX" ? "dus" : "pack";
                      const effectiveUnitPrice = Math.round(
                        item.subtotalAmount / Math.max(1, item.soldQty),
                      );
                      return (
                        <div key={item.id} className="space-y-0.5">
                          <div className="font-bold text-[#111111]">
                            {idx + 1}. {item.productName}
                          </div>
                          <div className="flex justify-between items-baseline gap-2 pl-2.5">
                            <span className="tabular-nums">
                              {item.soldQty} {unitLabel} x{" "}
                              {effectiveUnitPrice.toLocaleString("id-ID")}
                            </span>
                            <span className="tabular-nums shrink-0">
                              {formatRp(item.subtotalAmount)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Dashed Divider 3 */}
                  <div className="border-b border-dashed border-[#222222] my-3" />

                  {/* Total QTY */}
                  <div className="text-[12.5px] tabular-nums">
                    Total QTY : {totalQtyUnits}
                  </div>

                  {/* Dashed Divider 4 */}
                  <div className="border-b border-dashed border-[#222222] my-3" />

                  {/* Sub Total, Total, Bayar, Kembali */}
                  <div className="space-y-1 text-[12.5px]">
                    <div className="flex justify-between items-baseline">
                      <span>Sub Total</span>
                      <span className="tabular-nums">
                        {formatRp(receiptModal.totalAmountRp)}
                      </span>
                    </div>
                    <div className="flex justify-between items-baseline font-bold text-[14px]">
                      <span>Total</span>
                      <span className="tabular-nums">
                        {formatRp(receiptModal.totalAmountRp)}
                      </span>
                    </div>
                    <div className="flex justify-between items-baseline pt-0.5">
                      <span>Bayar ({payLabel})</span>
                      <span className="tabular-nums">
                        {formatRp(receiptModal.cashReceivedRp)}
                      </span>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span>Kembali</span>
                      <span className="tabular-nums">
                        {formatRp(receiptModal.changeAmountRp)}
                      </span>
                    </div>
                  </div>

                  {/* Centered Footer */}
                  <div className="mt-5 text-center space-y-2 text-[12px]">
                    <div>Terimakasih Telah Berbelanja</div>
                    <div className="space-y-0.5">
                      <div>Link Kritik dan Saran:</div>
                      <div className="break-all">
                        manajerku.id/e-receipt/{cleanInvCode}
                      </div>
                    </div>
                  </div>
                </article>

                {/* Screen-only ROP Notification & Action Buttons */}
                {receiptModal.triggeredRfqSessions.length > 0 && (
                  <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-1.5 text-[11px] text-amber-900 print:hidden">
                    <div className="font-bold">
                      Pemicu Pengadaan Proaktif (ROP) Aktif
                    </div>
                    {receiptModal.triggeredRfqSessions.map((rfq) => (
                      <div key={rfq.rfqSessionId}>
                        Stok <strong>{rfq.productName}</strong> kini tersisa{" "}
                        {rfq.healthyStockPacks} Pack (&le; ROP{" "}
                        {rfq.reorderPointPacks} Pack). Sesi{" "}
                        <strong>{rfq.rfqCode}</strong> telah disiapkan dengan 3
                        kandidat distributor untuk persetujuan 1-klik Owner.
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setReceiptModal(null);
                        onNavigateTab("whatsapp");
                      }}
                      className="mt-1 min-h-[36px] px-3 py-1.5 bg-amber-800 hover:bg-amber-900 text-white rounded-lg font-bold"
                    >
                      Lihat Permohonan Izin Auto-RFQ
                    </button>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1 print:hidden text-xs">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white font-semibold"
                  >
                    Cetak Struk Termal
                  </button>
                  <button
                    type="button"
                    onClick={() => setReceiptModal(null)}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-[#FFFFFF] hover:bg-[#E2E8F0] border border-[#CBD5E1] text-[#334155] font-semibold"
                  >
                    Selesai
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* QRIS Enlarged Preview Modal */}
      {showQrisModal && qrisImageUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pos-qris-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-[#E2E8F0] max-w-sm w-full p-5 space-y-4 text-center shadow-xl">
            <div className="space-y-1">
              <h3
                id="pos-qris-modal-title"
                className="text-base font-bold text-[#0F172A]"
              >
                Scan QRIS Pembayaran
              </h3>
              <p className="text-xs text-[#64748B]">
                Total Tagihan:{" "}
                <strong className="text-[#0F6352] font-mono">
                  {formatRp(cartSubtotal)}
                </strong>
              </p>
            </div>

            <div className="bg-[#F8FAFC] border border-[#E5E9EC] rounded-xl p-3 flex items-center justify-center">
              <Image
                src={qrisImageUrl}
                alt="Kode QRIS toko ukuran besar"
                width={260}
                height={260}
                unoptimized
                className="max-h-64 w-auto object-contain rounded-lg"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowQrisModal(false)}
              className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white text-xs font-semibold"
            >
              Tutup
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
