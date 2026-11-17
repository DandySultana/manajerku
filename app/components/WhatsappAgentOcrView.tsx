"use client";

import React, { useCallback, useEffect, useState } from "react";
import { formatRp } from "./CommandCenterDashboard";
import { useConfirmDialog } from "./ConfirmActionModal";
import { useGooeyToastFlash } from "./GooeyToastProvider";

interface SupplierQuoteItem {
  supplier_id: string;
  supplier_name: string;
  phone: string;
  rating: number;
  slot_price_per_box: number | null;
  slot_moq_boxes: number | null;
  slot_batch_expiry_date: string | null;
  slot_freezer_delivery: boolean | null;
  turn_count: number;
  status: string;
}

interface RfqSessionItem {
  id: string;
  rfqCode: string;
  productId: string;
  productName: string;
  skuCode: string;
  requestedQtyBoxes: number;
  triggerSource: string;
  status: string;
  quotes: SupplierQuoteItem[];
  bestPricePerBoxRp: number | null;
  estimatedPoTotalRp: number | null;
  cashUsagePct: number | null;
}

interface PurchaseOrderItem {
  id: string;
  poNumber: string;
  supplierName: string;
  supplierPhone: string;
  productName: string;
  orderQtyBoxes: number;
  orderQtyPacks: number;
  agreedPricePerBoxRp: number;
  totalAmountRp: number;
  cashUsagePct: number;
  promisedBatchExpiry: string;
  deliveryNotes: string | null;
  status: string;
  pdfDocumentUrl: string;
  b2bCommissionAmountRp: number;
}

interface WaMsgItem {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  senderPhone: string;
  recipientPhone: string;
  detectedRole: string;
  messageType: string;
  contentText: string;
  mediaUrl: string | null;
  createdAt: string;
}

function formatRfqStatusLabel(status: string): {
  label: string;
  badgeClass: string;
} {
  switch (status) {
    case "AWAITING_OWNER_RFQ_APPROVAL":
      return {
        label: "Menunggu Balasan 'KIRIM RFQ' dari WA Owner",
        badgeClass: "bg-amber-50 text-amber-800 border border-amber-200",
      };
    case "NEGOTIATING":
      return {
        label: "Sedang Negosiasi via OpenWA",
        badgeClass: "bg-sky-50 text-sky-800 border border-sky-200",
      };
    case "AWAITING_OWNER_PO_APPROVAL":
      return {
        label: "Menunggu Balasan 'SETUJUI PO #1' dari WA Owner",
        badgeClass: "bg-[#D7F0E6] text-[#0F6352] border border-[#0F6352]/20",
      };
    case "PO_ISSUED":
    case "COMPLETED":
      return {
        label: "PO Diterbitkan via WhatsApp",
        badgeClass: "bg-[#D7F0E6] text-[#0F6352] border border-[#0F6352]/20",
      };
    default:
      return {
        label: status,
        badgeClass: "bg-slate-100 text-slate-700 border border-slate-200",
      };
  }
}

function formatQuoteSlotStatus(status: string, turnCount: number): {
  label: string;
  badgeClass: string;
} {
  if (status === "COMPLETE") {
    return {
      label: "Lengkap (4/4)",
      badgeClass: "bg-[#D7F0E6] text-[#0F6352]",
    };
  }
  if (status === "PENDING_SEND") {
    return {
      label: "Belum Dikirim",
      badgeClass: "bg-slate-100 text-slate-600",
    };
  }
  if (status === "SENT" || turnCount === 0) {
    return {
      label: "Menunggu Balasan",
      badgeClass: "bg-amber-50 text-amber-800 border border-amber-200",
    };
  }
  return {
    label: `Belum Lengkap (${turnCount}x Chat)`,
    badgeClass: "bg-amber-50 text-amber-800 border border-amber-200",
  };
}

export default function WhatsappAgentOcrView({
  activeStoreId,
  onNavigateTab,
}: {
  activeStoreId: string;
  activeRole?: "OWNER" | "CASHIER" | "ADMIN";
  onNavigateTab?: (tab: string) => void;
}) {
  const [ownerWhatsappPhone, setOwnerWhatsappPhone] =
    useState<string>("+6282298606699");
  const [ownerName, setOwnerName] = useState<string>("Pemilik Toko");
  const [openWaAgentPhone, setOpenWaAgentPhone] =
    useState<string>("+62895351009379");

  const [rfqSessions, setRfqSessions] = useState<RfqSessionItem[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderItem[]>([]);
  const [messages, setMessages] = useState<WaMsgItem[]>([]);
  const [suppliers, setSuppliers] = useState<
    Array<{ id: string; name: string; phoneWhatsapp: string }>
  >([]);
  const [selectedRfqId, setSelectedRfqId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const confirmDialog = useConfirmDialog();

  useGooeyToastFlash(
    feedbackMsg,
    errorMsg,
    () => setFeedbackMsg(null),
    () => setErrorMsg(null)
  );

  // Unified OpenWA Simulator State (Owner Phone vs Supplier Phone)
  const [simActorMode, setSimActorMode] = useState<"OWNER" | "SUPPLIER">(
    "OWNER"
  );
  const [simOwnerText, setSimOwnerText] = useState("");
  const [simOwnerImageName, setSimOwnerImageName] = useState("");
  const [simSupplierPhone, setSimSupplierPhone] = useState("");
  const [simSupplierText, setSimSupplierText] = useState("");

  // OpenWA Server Setup Panel State
  const [showSetupPanel, setShowSetupPanel] = useState(false);
  const [openWaApiUrl, setOpenWaApiUrl] = useState("http://localhost:8085");
  const [openWaApiKey, setOpenWaApiKey] = useState("manajerku-secret");
  const [testingOpenWa, setTestingOpenWa] = useState(false);

  const [chatFilter, setChatFilter] = useState<"ALL" | "OWNER" | "SUPPLIER">(
    "ALL"
  );

  const fetchWhatsappData = useCallback(async () => {
    const [waRes, suppRes] = await Promise.all([
      fetch(
        `/api/v1/webhooks/whatsapp?storeId=${encodeURIComponent(activeStoreId)}`
      ),
      fetch(`/api/v1/suppliers?storeId=${encodeURIComponent(activeStoreId)}`),
    ]);
    return Promise.all([waRes.json(), suppRes.json()]);
  }, [activeStoreId]);

  const applyWhatsappData = useCallback(
    ([json, suppJson]: [
      {
        success: boolean;
        data?: {
          ownerName?: string;
          ownerWhatsappPhone?: string;
          openWaGateway?: {
            agentPhone: string;
            apiUrl: string;
            webhookEndpoint: string;
            sessionActive: boolean;
          };
          rfqSessions: RfqSessionItem[];
          purchaseOrders: PurchaseOrderItem[];
          whatsappMessages: WaMsgItem[];
        };
      },
      {
        success: boolean;
        data?: {
          suppliers: Array<{ id: string; name: string; phoneWhatsapp: string }>;
        };
      },
    ]) => {
      if (suppJson.success && Array.isArray(suppJson.data?.suppliers)) {
        const list = suppJson.data.suppliers;
        setSuppliers(list);
        setSimSupplierPhone((prev) =>
          list.some((s) => s.phoneWhatsapp === prev)
            ? prev
            : list[0]?.phoneWhatsapp || ""
        );
      } else {
        setSuppliers([]);
        setSimSupplierPhone("");
      }
      if (json.success && json.data) {
        if (json.data.ownerWhatsappPhone) {
          setOwnerWhatsappPhone(json.data.ownerWhatsappPhone);
        }
        if (json.data.ownerName) {
          setOwnerName(json.data.ownerName);
        }
        if (json.data.openWaGateway?.agentPhone) {
          setOpenWaAgentPhone(json.data.openWaGateway.agentPhone);
        }
        setRfqSessions(json.data.rfqSessions);
        setPurchaseOrders(json.data.purchaseOrders);
        setMessages(json.data.whatsappMessages);
        if (json.data.rfqSessions.length > 0) {
          const sessions = json.data.rfqSessions;
          setSelectedRfqId((prev) =>
            sessions.some((r) => r.id === prev) ? prev : sessions[0].id
          );
        } else {
          setSelectedRfqId("");
        }
      }
    },
    []
  );

  const loadState = useCallback(async () => {
    try {
      setErrorMsg(null);
      const data = await fetchWhatsappData();
      applyWhatsappData(data);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal memuat data OpenWA."
      );
    } finally {
      setLoading(false);
    }
  }, [fetchWhatsappData, applyWhatsappData]);

  useEffect(() => {
    let cancelled = false;
    fetchWhatsappData()
      .then((data) => {
        if (cancelled) return;
        setErrorMsg(null);
        applyWhatsappData(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(
          err instanceof Error ? err.message : "Gagal memuat data OpenWA."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWhatsappData, applyWhatsappData]);

  const activeRfq =
    rfqSessions.find((r) => r.id === selectedRfqId) || rfqSessions[0] || null;
  const openPoForOcr =
    purchaseOrders.find(
      (p) => p.status === "APPROVED_WA" || p.status === "PDF_SENT"
    ) || null;

  const candidateMap = new Map<string, { name: string; phone: string }>();
  if (activeRfq?.quotes) {
    for (const q of activeRfq.quotes) {
      candidateMap.set(q.phone, { name: q.supplier_name, phone: q.phone });
    }
  }
  for (const s of suppliers) {
    if (!candidateMap.has(s.phoneWhatsapp)) {
      candidateMap.set(s.phoneWhatsapp, {
        name: s.name,
        phone: s.phoneWhatsapp,
      });
    }
  }
  const candidateOptions = Array.from(candidateMap.values());

  const effectiveSimPhone =
    candidateOptions.some((c) => c.phone === simSupplierPhone)
      ? simSupplierPhone
      : candidateOptions[0]?.phone || "";

  // Send simulated OpenWA onMessage event from Owner's WhatsApp
  const handleSendOwnerOpenWaMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simOwnerText.trim()) return;
    setFeedbackMsg(null);
    setErrorMsg(null);

    const ownerDigits = ownerWhatsappPhone.replace(/\D/g, "");
    const res = await fetch("/api/v1/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "onMessage",
        storeId: activeStoreId,
        rfqSessionId: activeRfq?.id || selectedRfqId || undefined,
        data: {
          from: `${ownerDigits}@c.us`,
          body: simOwnerText,
          filename: simOwnerImageName || undefined,
        },
      }),
    });
    const json = await res.json();
    if (json.success) {
      const replyText =
        json.data?.replyMessage ||
        (json.data?.poNumber
          ? `PO ${json.data.poNumber} diterbitkan via WhatsApp (${formatRp(
              json.data.totalAmountRp
            )}).`
          : "Pesan WhatsApp Owner berhasil diproses oleh OpenWA.");
      setFeedbackMsg(replyText);
      setSimOwnerText("");
      setSimOwnerImageName("");
      await loadState();
    } else {
      setErrorMsg(json.error?.message || "Gagal memproses pesan OpenWA Owner.");
    }
  };

  // Send simulated OpenWA onMessage event from Supplier's WhatsApp
  const handleSendSupplierOpenWaMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simSupplierText.trim()) return;
    setFeedbackMsg(null);
    setErrorMsg(null);

    const suppDigits = effectiveSimPhone.replace(/\D/g, "");
    const res = await fetch("/api/v1/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "onMessage",
        storeId: activeStoreId,
        rfqSessionId: activeRfq?.id || selectedRfqId || undefined,
        data: {
          from: `${suppDigits}@c.us`,
          body: simSupplierText,
        },
      }),
    });
    const json = await res.json();
    if (json.success) {
      setFeedbackMsg(
        `Balasan WhatsApp ${json.data.supplierName} diterima OpenWA (${json.data.slotCompletenessStatus}). Balasan AI: "${json.data.agentReplyToSupplier}"`
      );
      setSimSupplierText("");
      await loadState();
    } else {
      setErrorMsg(
        json.error?.message || "Gagal memproses pesan OpenWA Supplier."
      );
    }
  };

  const activeStatusMeta = activeRfq
    ? formatRfqStatusLabel(activeRfq.status)
    : null;

  const supplierPhoneSet = new Set(candidateOptions.map((c) => c.phone));

  const isSupplierMessage = (m: WaMsgItem) => {
    if (m.detectedRole === "SUPPLIER") return true;
    if (m.detectedRole === "OWNER" || m.detectedRole === "CASHIER") {
      return false;
    }
    const targetPhone =
      m.direction === "INBOUND" ? m.senderPhone : m.recipientPhone;
    if (supplierPhoneSet.has(targetPhone)) return true;
    if (
      m.contentText.startsWith("Halo ") ||
      m.contentText.startsWith("Terima kasih Kak") ||
      m.contentText.startsWith("Baik Kak")
    ) {
      return true;
    }
    return false;
  };

  const filteredMessages = messages.filter((m) => {
    if (chatFilter === "ALL") return true;
    const isSupp = isSupplierMessage(m);
    return chatFilter === "SUPPLIER" ? isSupp : !isSupp;
  });

  const cleanAgentDigits = openWaAgentPhone.replace(/\D/g, "");

  const handleSaveAndTestOpenWa = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await confirmDialog({
      title: "Simpan Perubahan Konfigurasi OpenWA?",
      description:
        "Pengaturan URL server dan API Key OpenWA akan diperbarui serta diuji koneksinya ke nomor WhatsApp Owner.",
      detailText: `Endpoint: ${openWaApiUrl}`,
      confirmLabel: "Ya, Simpan & Uji",
      cancelLabel: "Batal",
      variant: "primary",
    });
    if (!ok) return;
    setTestingOpenWa(true);
    setFeedbackMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/v1/openwa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiUrl: openWaApiUrl,
          apiKey: openWaApiKey,
          testPhone: ownerWhatsappPhone,
        }),
      });
      const json = await res.json();
      if (json.success) {
        const note =
          json.data?.testDispatchResult?.statusNote ||
          "Konfigurasi OpenWA disimpan.";
        setFeedbackMsg(
          `Konfigurasi OpenWA (${openWaApiUrl}) diperbarui. ${note}`
        );
      } else {
        setErrorMsg(json.error?.message || "Gagal menguji koneksi OpenWA.");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menguji koneksi OpenWA."
      );
    } finally {
      setTestingOpenWa(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Minimalist Top Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-[22px] sm:text-[24px] font-bold text-[#0F172A] tracking-tight leading-snug">
            Integrasi OpenWA &amp; Asisten WhatsApp Owner
          </h1>
          <p className="text-[13px] text-[#64748B] mt-0.5">
            Owner terhubung langsung dengan asisten AI dan WA Blast melalui
            aplikasi WhatsApp pribadi via OpenWA
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowSetupPanel((prev) => !prev)}
            className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-white hover:bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-semibold text-[#334155] inline-flex items-center gap-2 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-[#10B981] shrink-0" />
            <span>Konfigurasi Server OpenWA</span>
          </button>
          <a
            href={`https://wa.me/${cleanAgentDigits}?text=${encodeURIComponent(
              "Halo Manajerku AI, cek stok dan kas"
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
          >
            <span>Buka Chat di WhatsApp</span>
          </a>
        </div>
      </div>

      {showSetupPanel && (
        <form
          onSubmit={handleSaveAndTestOpenWa}
          className="bg-white rounded-2xl border border-[#CBD5E1] p-5 shadow-xs space-y-4 text-xs"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[#F1F5F9] pb-3">
            <div>
              <h2 className="text-[14px] font-bold text-[#0F172A]">
                Cara Menghubungkan Aplikasi ke OpenWA Server (Asisten AI &amp; WA
                Blast)
              </h2>
              <p className="text-[#64748B] mt-0.5">
                Jalankan perintah CLI OpenWA berikut di terminal Anda, scan QR
                WhatsApp nomor khusus aplikasi, lalu klik Simpan &amp; Test Ping
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSetupPanel(false)}
              className="text-[#64748B] hover:text-[#0F172A] font-bold px-2 py-1"
            >
              ✕
            </button>
          </div>

          <div className="bg-[#0F172A] text-[#F8FAFC] p-3.5 rounded-xl font-mono text-[11.5px] overflow-x-auto">
            npx @open-wa/wa-automate --port 8085 --webhook
            &quot;http://localhost:3000/api/v1/webhooks/whatsapp&quot; -k
            &quot;{openWaApiKey || "manajerku-secret"}&quot;
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-5">
              <label className="block font-semibold text-[#334155] mb-1">
                URL Server OpenWA (`OPENWA_API_URL`)
              </label>
              <input
                type="text"
                value={openWaApiUrl}
                onChange={(e) => setOpenWaApiUrl(e.target.value)}
                placeholder="http://localhost:8085"
                className="w-full h-10 px-3 rounded-xl border border-[#CBD5E1] bg-white text-[#0F172A]"
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block font-semibold text-[#334155] mb-1">
                API Key OpenWA (`-k`)
              </label>
              <input
                type="text"
                value={openWaApiKey}
                onChange={(e) => setOpenWaApiKey(e.target.value)}
                placeholder="manajerku-secret"
                className="w-full h-10 px-3 rounded-xl border border-[#CBD5E1] bg-white text-[#0F172A]"
              />
            </div>
            <div className="sm:col-span-3">
              <button
                type="submit"
                disabled={testingOpenWa}
                className="w-full h-10 px-3 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white font-semibold transition-colors"
              >
                {testingOpenWa ? "Menguji..." : "Simpan & Test Ping"}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Main Split: Left 7 Cols (Live RFQ Monitor + OpenWA Simulator) + Right 5 Cols (OpenWA Live Chat Stream) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-7 space-y-5">
          {/* Card 1: Monitor Status Negosiasi RFQ & Penawaran Distributor */}
          <section className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-[0_1px_3px_rgba(15,23,42,0.03)] space-y-4">
            <div className="space-y-3 pb-3.5 border-b border-[#F1F5F9]">
              <div>
                <h2 className="text-[15px] font-bold text-[#0F172A]">
                  Monitor Negosiasi Kulakan (Auto-RFQ via OpenWA)
                </h2>
                <p className="text-xs text-[#64748B] mt-0.5">
                  Pantauan status 4 syarat kulakan yang dinegosiasikan asisten AI
                  dengan distributor di WhatsApp
                </p>
              </div>

              {rfqSessions.length > 0 && (
                <select
                  aria-label="Pilih sesi RFQ"
                  value={selectedRfqId}
                  onChange={(e) => setSelectedRfqId(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] text-xs font-semibold text-[#0F172A] focus:outline-2 focus:outline-[#0F6352]"
                >
                  {rfqSessions.map((r) => {
                    const st = formatRfqStatusLabel(r.status);
                    return (
                      <option key={r.id} value={r.id}>
                        {r.rfqCode} • {r.requestedQtyBoxes} Dus {r.productName}{" "}
                        ({st.label})
                      </option>
                    );
                  })}
                </select>
              )}
            </div>

            {loading && rfqSessions.length === 0 ? (
              <div
                className="space-y-3.5 animate-pulse"
                role="status"
                aria-busy="true"
                aria-label="Memuat sesi negosiasi Auto-RFQ..."
              >
                <div className="flex items-center justify-between gap-3 bg-[#F8FAFC] px-4 py-3 rounded-xl border border-[#E2E8F0]">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-48 rounded bg-[#CBD5E1]" />
                    <div className="h-5 w-24 rounded-full bg-[#E2E8F0]" />
                  </div>
                  <div className="h-3.5 w-28 rounded bg-[#E2E8F0]" />
                </div>
                <div className="overflow-hidden rounded-xl border border-[#E2E8F0] divide-y divide-[#F1F5F9]">
                  <div className="bg-[#F8FAFC] px-3 py-2.5 flex items-center justify-between gap-3">
                    <div className="h-3 w-24 rounded bg-[#CBD5E1]" />
                    <div className="h-3 w-20 rounded bg-[#E2E8F0]" />
                    <div className="h-3 w-14 rounded bg-[#E2E8F0]" />
                    <div className="h-3 w-16 rounded bg-[#E2E8F0]" />
                    <div className="h-3 w-16 rounded bg-[#E2E8F0]" />
                  </div>
                  {[1, 2, 3].map((r) => (
                    <div
                      key={r}
                      className="px-3 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="space-y-1.5">
                        <div className="h-3.5 w-32 rounded bg-[#CBD5E1]" />
                        <div className="h-2.5 w-24 rounded bg-[#F1F5F9]" />
                      </div>
                      <div className="h-3.5 w-20 rounded bg-[#E2E8F0]" />
                      <div className="h-3.5 w-14 rounded bg-[#F1F5F9]" />
                      <div className="h-3.5 w-16 rounded bg-[#E2E8F0]" />
                      <div className="h-5 w-20 rounded-full bg-[#F1F5F9]" />
                    </div>
                  ))}
                </div>
              </div>
            ) : activeRfq && activeStatusMeta ? (
              <div className="space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3 bg-[#F8FAFC] px-4 py-3 rounded-xl border border-[#E2E8F0] text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[#334155]">
                      {activeRfq.rfqCode} • {activeRfq.requestedQtyBoxes} Dus{" "}
                      {activeRfq.productName}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${activeStatusMeta.badgeClass}`}
                    >
                      {activeStatusMeta.label}
                    </span>
                  </div>
                  <span className="text-[11px] text-[#64748B]">
                    PO Terbit: {purchaseOrders.length} Dokumen
                  </span>
                </div>

                {/* Clean 4-Variable Comparison Table */}
                <div className="overflow-x-auto rounded-xl border border-[#E2E8F0]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[11px] font-semibold text-[#64748B]">
                        <th className="py-2.5 px-3">Distributor</th>
                        <th className="py-2.5 px-3">Harga / Dus</th>
                        <th className="py-2.5 px-3">MOQ</th>
                        <th className="py-2.5 px-3">Exp Batch</th>
                        <th className="py-2.5 px-3">Freezer</th>
                        <th className="py-2.5 px-3 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F1F5F9]">
                      {activeRfq.quotes.map((q) => {
                        const slotMeta = formatQuoteSlotStatus(
                          q.status,
                          q.turn_count
                        );
                        return (
                          <tr
                            key={q.supplier_id}
                            className="hover:bg-[#F8FAFC]/60 transition-colors"
                          >
                            <td className="py-3 px-3">
                              <div className="font-semibold text-[#0F172A]">
                                {q.supplier_name}
                              </div>
                              <div className="text-[11px] font-mono text-[#64748B] mt-0.5">
                                {q.phone} • Rating {q.rating}
                              </div>
                            </td>
                            <td className="py-3 px-3 font-semibold text-[#0F172A] tabular-nums">
                              {q.slot_price_per_box ? (
                                formatRp(q.slot_price_per_box)
                              ) : (
                                <span className="text-[#94A3B8] font-normal">
                                  Menunggu
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-[#334155] tabular-nums">
                              {q.slot_moq_boxes ? (
                                `${q.slot_moq_boxes} Dus`
                              ) : (
                                <span className="text-[#94A3B8]">Menunggu</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-[#334155]">
                              {q.slot_batch_expiry_date || (
                                <span className="text-[#94A3B8]">Menunggu</span>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              {q.slot_freezer_delivery === null ? (
                                <span className="text-[#94A3B8]">Menunggu</span>
                              ) : q.slot_freezer_delivery ? (
                                <span className="text-[#0F6352] font-semibold">
                                  Tersedia
                                </span>
                              ) : (
                                <span className="text-red-600 font-semibold">
                                  Tidak
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right">
                              <span
                                className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${slotMeta.badgeClass}`}
                              >
                                {slotMeta.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="py-7 px-4 text-center rounded-xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] space-y-2">
                <div className="text-xs font-semibold text-[#334155]">
                  Belum ada sesi negosiasi Auto-RFQ aktif di toko ini
                </div>
                <p className="text-xs text-[#64748B] max-w-md mx-auto">
                  Saat stok produk menyentuh batas minimum (ROP), asisten AI
                  akan langsung mengirim pesan WhatsApp ke nomor Owner (
                  {ownerWhatsappPhone}).
                </p>
                {onNavigateTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateTab("suppliers")}
                    className="mt-1 inline-flex items-center min-h-[36px] px-4 py-1.5 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] text-white text-xs font-semibold transition-colors"
                  >
                    Buka Database Supplier
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Card 2: Unified OpenWA Incoming Webhook Simulator (Owner WA vs Supplier WA) */}
          <section className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-[0_1px_3px_rgba(15,23,42,0.03)] space-y-4 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-[#F1F5F9]">
              <div>
                <h2 className="text-[15px] font-bold text-[#0F172A]">
                  Simulasi Chat Masuk ke Webhook OpenWA
                </h2>
                <p className="text-xs text-[#64748B] mt-0.5">
                  Uji pengiriman pesan dari WhatsApp HP Owner atau WhatsApp
                  Supplier ke nomor khusus aplikasi ({openWaAgentPhone})
                </p>
              </div>

              <div className="inline-flex bg-[#F8FAFC] p-1 rounded-xl border border-[#E2E8F0] shrink-0">
                <button
                  type="button"
                  onClick={() => setSimActorMode("OWNER")}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                    simActorMode === "OWNER"
                      ? "bg-[#0F6352] text-white"
                      : "text-[#64748B] hover:text-[#0F172A]"
                  }`}
                >
                  Dari WA Owner
                </button>
                <button
                  type="button"
                  onClick={() => setSimActorMode("SUPPLIER")}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                    simActorMode === "SUPPLIER"
                      ? "bg-[#0F6352] text-white"
                      : "text-[#64748B] hover:text-[#0F172A]"
                  }`}
                >
                  Dari WA Supplier
                </button>
              </div>
            </div>

            {simActorMode === "OWNER" ? (
              <form
                onSubmit={handleSendOwnerOpenWaMessage}
                className="space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-[#334155]">
                    Pengirim: {ownerName} ({ownerWhatsappPhone}) → OpenWA
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSimOwnerText("Cek stok FEFO")}
                      className="px-2.5 py-1 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#334155] text-[11px] font-medium transition-colors"
                    >
                      Cek Stok FEFO
                    </button>
                    <button
                      type="button"
                      onClick={() => setSimOwnerText("Cek kas dan laba")}
                      className="px-2.5 py-1 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#334155] text-[11px] font-medium transition-colors"
                    >
                      Cek Saldo Kas
                    </button>
                    <button
                      type="button"
                      onClick={() => setSimOwnerText("Kirim RFQ")}
                      className="px-2.5 py-1 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#334155] text-[11px] font-medium transition-colors"
                    >
                      Kirim RFQ
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSimOwnerText("Setujui PO #1, kirim sore ini")
                      }
                      className="px-2.5 py-1 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#334155] text-[11px] font-medium transition-colors"
                    >
                      Setujui PO #1
                    </button>
                    <button
                      type="button"
                      onClick={() => setSimOwnerText("Blast promo")}
                      className="px-2.5 py-1 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#334155] text-[11px] font-medium transition-colors"
                    >
                      WA Blast Promo
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const prodName =
                          openPoForOcr?.productName ||
                          activeRfq?.productName ||
                          "Nugget Crispy 500g";
                        const qtyBoxes =
                          openPoForOcr?.orderQtyBoxes ||
                          activeRfq?.requestedQtyBoxes ||
                          5;
                        const expDate =
                          openPoForOcr?.promisedBatchExpiry || "2027-10-14";
                        setSimOwnerImageName("Foto_Label_Kardus_WA.jpg");
                        setSimOwnerText(
                          `${prodName} | ${qtyBoxes} Dus | Batch FN-219 | Exp ${expDate}`
                        );
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[#D7F0E6] hover:bg-[#C2E8D8] text-[#0F6352] text-[11px] font-semibold transition-colors"
                    >
                      Kirim Foto Label Kardus (OCR)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <input
                    type="text"
                    placeholder="Ketik pesan WhatsApp dari HP Owner (misal: Kirim RFQ, Setujui PO #1, Cek kas)..."
                    value={simOwnerText}
                    onChange={(e) => setSimOwnerText(e.target.value)}
                    className="sm:col-span-9 h-10 px-3 rounded-xl border border-[#CBD5E1] bg-white text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-2 focus:outline-[#0F6352]"
                  />
                  <button
                    type="submit"
                    disabled={!simOwnerText.trim()}
                    className="sm:col-span-3 h-10 px-3 rounded-xl bg-[#0F6352] hover:bg-[#0B4F41] disabled:opacity-50 text-white font-semibold transition-colors"
                  >
                    Kirim via OpenWA
                  </button>
                </div>
              </form>
            ) : (
              <form
                onSubmit={handleSendSupplierOpenWaMessage}
                className="space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-[#334155]">
                    Pengirim: WhatsApp Distributor → OpenWA
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setSimSupplierText(
                          "Harga Rp 420rb per dus minimal ambil 15 dus ya"
                        )
                      }
                      className="px-2.5 py-1 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#334155] text-[11px] font-medium transition-colors"
                    >
                      Contoh Balasan Sebagian (2 Info)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSimSupplierText(
                          "Ready 5 dus harga Rp 405rb/dus, MOQ 5 dus, batch exp 14 Okt 2027, kita antar pakai mobil freezer sore ini"
                        )
                      }
                      className="px-2.5 py-1 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#334155] text-[11px] font-medium transition-colors"
                    >
                      Contoh Balasan Lengkap (4 Info)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <select
                    aria-label="Pilih nomor distributor"
                    value={effectiveSimPhone}
                    onChange={(e) => setSimSupplierPhone(e.target.value)}
                    disabled={candidateOptions.length === 0}
                    className="sm:col-span-4 h-10 px-3 rounded-xl border border-[#CBD5E1] bg-white font-medium text-[#0F172A] disabled:bg-[#F8FAFC] focus:outline-2 focus:outline-[#0F6352]"
                  >
                    {candidateOptions.length === 0 ? (
                      <option value="">Belum ada distributor</option>
                    ) : (
                      candidateOptions.map((s) => (
                        <option key={s.phone} value={s.phone}>
                          {s.name} ({s.phone})
                        </option>
                      ))
                    )}
                  </select>
                  <input
                    type="text"
                    placeholder="Ketik balasan WhatsApp dari distributor..."
                    value={simSupplierText}
                    onChange={(e) => setSimSupplierText(e.target.value)}
                    className="sm:col-span-5 h-10 px-3 rounded-xl border border-[#CBD5E1] bg-white text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-2 focus:outline-[#0F6352]"
                  />
                  <button
                    type="submit"
                    disabled={!simSupplierText.trim()}
                    className="sm:col-span-3 h-10 px-3 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] disabled:opacity-50 text-white font-semibold transition-colors"
                  >
                    Kirim Balasan
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>

        {/* Right Column: Clean Minimalist Live WhatsApp Conversation Panel */}
        <aside className="lg:col-span-5">
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(15,23,42,0.03)] overflow-hidden flex flex-col">
            {/* Clean Chat Header */}
            <div className="px-4 py-3.5 border-b border-[#E2E8F0] space-y-3 bg-white">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-[#0F6352] text-white font-bold text-sm flex items-center justify-center shrink-0">
                    M
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-[#0F172A] truncate">
                      Manajerku AI ({openWaAgentPhone})
                    </div>
                    <div className="text-[11px] text-[#64748B] flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                      <span>
                        OpenWA Gateway • Terhubung ke WA Owner &amp; Supplier
                      </span>
                    </div>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#475569] text-[11px] font-semibold shrink-0">
                  {filteredMessages.length} Pesan
                </span>
              </div>

              {/* Channel Filter Tabs: Semua vs AI <-> Owner vs AI <-> Supplier */}
              <div className="grid grid-cols-3 gap-1.5 bg-[#F8FAFC] p-1 rounded-xl border border-[#E2E8F0] text-[11px]">
                <button
                  type="button"
                  onClick={() => setChatFilter("ALL")}
                  className={`py-1.5 px-2 rounded-lg font-semibold transition-colors ${
                    chatFilter === "ALL"
                      ? "bg-[#0F6352] text-white"
                      : "text-[#64748B] hover:text-[#0F172A]"
                  }`}
                >
                  Semua ({messages.length})
                </button>
                <button
                  type="button"
                  onClick={() => setChatFilter("OWNER")}
                  className={`py-1.5 px-2 rounded-lg font-semibold transition-colors ${
                    chatFilter === "OWNER"
                      ? "bg-[#0F6352] text-white"
                      : "text-[#64748B] hover:text-[#0F172A]"
                  }`}
                >
                  AI ↔ WA Owner
                </button>
                <button
                  type="button"
                  onClick={() => setChatFilter("SUPPLIER")}
                  className={`py-1.5 px-2 rounded-lg font-semibold transition-colors ${
                    chatFilter === "SUPPLIER"
                      ? "bg-[#0F6352] text-white"
                      : "text-[#64748B] hover:text-[#0F172A]"
                  }`}
                >
                  AI ↔ WA Supplier
                </button>
              </div>
            </div>

            {/* Clean Light Chat Feed */}
            <div className="bg-[#F8FAFC] p-4 space-y-3 h-[430px] overflow-y-auto text-xs">
              {loading ? (
                <div
                  className="space-y-3.5 animate-pulse py-1"
                  role="status"
                  aria-busy="true"
                  aria-label="Memuat riwayat percakapan OpenWA..."
                >
                  {[1, 2, 3, 4].map((idx) => {
                    const isLeft = idx % 2 === 1;
                    return (
                      <div
                        key={idx}
                        className={`flex flex-col ${
                          isLeft ? "items-start" : "items-end"
                        }`}
                      >
                        <div className="h-2.5 w-36 rounded bg-[#E2E8F0] mb-1.5" />
                        <div
                          className={`w-[78%] rounded-2xl p-3.5 space-y-2 border ${
                            isLeft
                              ? "bg-white border-[#E2E8F0]"
                              : "bg-[#EBF8F2] border-[#CCE8DB]"
                          }`}
                        >
                          <div className="h-3 w-full rounded bg-[#CBD5E1]" />
                          <div className="h-3 w-4/5 rounded bg-[#E2E8F0]" />
                          <div className="h-2.5 w-1/2 rounded bg-[#F1F5F9]" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : filteredMessages.length === 0 ? (
                <div className="text-center text-[#64748B] py-16 px-4 space-y-1">
                  <div className="font-semibold text-[#334155]">
                    Belum ada percakapan pada kategori ini
                  </div>
                  <p className="text-[11px]">
                    Pesan antara OpenWA ({openWaAgentPhone}) dengan WhatsApp
                    Owner maupun Supplier akan tampil di sini.
                  </p>
                </div>
              ) : (
                filteredMessages.map((m) => {
                  const isInbound = m.direction === "INBOUND";
                  const isSupp = isSupplierMessage(m);
                  const channelLabel = isInbound
                    ? isSupp
                      ? `WA Supplier (${m.senderPhone}) → OpenWA`
                      : `WA Owner (${m.senderPhone}) → OpenWA`
                    : isSupp
                      ? `OpenWA → WA Supplier (${m.recipientPhone})`
                      : `OpenWA → WA Owner (${m.recipientPhone})`;

                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${
                        isInbound ? "items-end" : "items-start"
                      }`}
                    >
                      <div
                        className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 space-y-1.5 ${
                          isInbound
                            ? "bg-[#0F6352] text-white rounded-br-xs"
                            : "bg-white text-[#0F172A] border border-[#E2E8F0] rounded-bl-xs shadow-[0_1px_2px_rgba(15,23,42,0.02)]"
                        }`}
                      >
                        <div
                          className={`text-[10px] font-semibold flex items-center justify-between gap-2 ${
                            isInbound ? "text-white/85" : "text-[#0F6352]"
                          }`}
                        >
                          <span>{channelLabel}</span>
                        </div>
                        {m.mediaUrl && (
                          <div
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-mono truncate ${
                              isInbound
                                ? "bg-black/20 text-white"
                                : "bg-[#F1F5F9] text-[#334155]"
                            }`}
                          >
                            Lampiran: {m.mediaUrl}
                          </div>
                        )}
                        <div className="whitespace-pre-line leading-relaxed text-[12px]">
                          {m.contentText}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Clean Chat Footer */}
            <div className="bg-white px-4 py-2.5 border-t border-[#E2E8F0] flex items-center justify-between text-[11px] text-[#64748B]">
              <span>Webhook OpenWA: /api/v1/webhooks/whatsapp</span>
              <span className="text-[#0F6352] font-semibold">
                Sinkronisasi Real-Time
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
