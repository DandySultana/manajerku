"use client";

import React, { useCallback, useEffect, useState } from "react";
import { formatRp } from "./CommandCenterDashboard";

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

export default function WhatsappAgentOcrView({
  activeStoreId,
  activeRole,
}: {
  activeStoreId: string;
  activeRole: "OWNER" | "CASHIER" | "ADMIN";
}) {
  const [rfqSessions, setRfqSessions] = useState<RfqSessionItem[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderItem[]>([]);
  const [messages, setMessages] = useState<WaMsgItem[]>([]);
  const [selectedRfqId, setSelectedRfqId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Supplier Reply Simulator Form (FR-503)
  const [simSupplierPhone, setSimSupplierPhone] = useState("+628116800101");
  const [simSupplierText, setSimSupplierText] = useState(
    "Ready 5 dus harga Rp 405rb/dus, MOQ 5 dus, batch exp 14 Okt 2027, kita antar pakai mobil freezer sore ini",
  );

  // Vision OCR Box Label Simulator Form (PRD-06: FR-601, FR-602, FR-603)
  const [ocrLabelHint, setOcrLabelHint] = useState(
    "Nugget Crispy 500g | 5 Dus | Batch FN-219 | Exp 14 Okt 2027",
  );
  const [ocrCaption, setOcrCaption] = useState(
    "Barang baru sampai, tolong input ke stok FEFO ya",
  );
  const [ocrImageName, setOcrImageName] = useState(
    "Foto_Label_Kardus_BekuJaya.jpg",
  );

  const loadState = useCallback(async () => {
    try {
      setErrorMsg(null);
      const res = await fetch(
        `/api/v1/webhooks/whatsapp?storeId=${encodeURIComponent(activeStoreId)}`,
      );
      const json = await res.json();
      if (json.success) {
        setRfqSessions(json.data.rfqSessions);
        setPurchaseOrders(json.data.purchaseOrders);
        setMessages(json.data.whatsappMessages);
        if (!selectedRfqId && json.data.rfqSessions.length > 0) {
          setSelectedRfqId(json.data.rfqSessions[0].id);
        }
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal memuat state WhatsApp AI.",
      );
    } finally {
      setLoading(false);
    }
  }, [activeStoreId, selectedRfqId]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const handleApproveSendRfq = async (rfqId: string) => {
    setFeedbackMsg(null);
    setErrorMsg(null);
    const res = await fetch(`/api/v1/procurement/rfq/${rfqId}/approve-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: activeStoreId, actorRole: activeRole }),
    });
    const json = await res.json();
    if (json.success) {
      setFeedbackMsg(
        `Izin 1-Klik Owner diterima! ${json.data.dispatchedCount} pesan RFQ dikirim secara bertahap (rate-limited) ke kandidat distributor.`,
      );
      await loadState();
    } else {
      setErrorMsg(json.error?.message || "Gagal mengirim RFQ.");
    }
  };

  const handleSimulateSupplierReply = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackMsg(null);
    setErrorMsg(null);
    const res = await fetch("/api/v1/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        rfqSessionId: selectedRfqId || undefined,
        fromPhone: simSupplierPhone,
        messageText: simSupplierText,
      }),
    });
    const json = await res.json();
    if (json.success) {
      setFeedbackMsg(
        `Balasan Supplier diproses oleh Gemini 2.5 Flash Slot-Check (Status: ${json.data.slotCompletenessStatus}). Balasan Agen: "${json.data.agentReplyToSupplier}"`,
      );
      await loadState();
    } else {
      setErrorMsg(json.error?.message || "Gagal memproses pesan supplier.");
    }
  };

  const handleApprovePo = async (rfqId: string) => {
    setFeedbackMsg(null);
    setErrorMsg(null);
    const res = await fetch(`/api/v1/procurement/rfq/${rfqId}/approve-po`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        actorRole: activeRole,
        selectedOptionRank: 1,
        deliveryNotes: "Setujui PO #1, kirim sore ini",
      }),
    });
    const json = await res.json();
    if (json.success) {
      setFeedbackMsg(
        `Purchase Order ${json.data.poNumber} diterbitkan! Saldo Kas Kulakan sebesar ${formatRp(
          json.data.totalAmountRp,
        )} telah dikunci dan dokumen PDF dikirim ke WhatsApp ${
          json.data.supplierName
        }.`,
      );
      await loadState();
    } else {
      setErrorMsg(json.error?.message || "Gagal menyetujui PO.");
    }
  };

  const handleSubmitVisionOcr = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackMsg(null);
    setErrorMsg(null);
    const res = await fetch("/api/v1/inventory/ocr-receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        actorRole: activeRole,
        imageUrl: ocrImageName,
        captionText: ocrCaption,
        labelTextHint: ocrLabelHint,
      }),
    });
    const json = await res.json();
    if (json.success) {
      setFeedbackMsg(json.data.whatsappReplyMessage);
      await loadState();
    } else {
      setErrorMsg(json.error?.message || "Gagal memproses Vision OCR.");
    }
  };

  const activeRfq =
    rfqSessions.find((r) => r.id === selectedRfqId) || rfqSessions[0] || null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <span className="text-[11px] font-bold uppercase text-emerald-700">
          PRD-05 & PRD-06 • Dual-Role WhatsApp Agent, Multi-Turn 4-Slot RFQ &
          Multimodal Vision OCR
        </span>
        <h1 className="text-xl font-bold text-slate-900">
          Asisten AI WhatsApp Dual-Role (Negosiator Supplier & Asisten Owner /
          Vision OCR)
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Satu nomor WhatsApp resmi dengan identifikasi nomor otomatis:
          Negosiasi 4 variabel dengan distributor, ACC PO 1-klik, dan pembacaan
          foto label kardus barang masuk ke antrean FEFO
        </p>
      </div>

      {feedbackMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-xl text-xs font-semibold flex items-center justify-between">
          <span>{feedbackMsg}</span>
          <button
            onClick={() => setFeedbackMsg(null)}
            className="text-emerald-700 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

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

      {/* Main Split: Left 7 Cols (Multi-Turn Slot-Check & Vision OCR Controls) + Right 5 Cols (WhatsApp Mobile Mockup matching Page 8!) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Cols */}
        <div className="lg:col-span-7 space-y-6">
          {/* Card 1: Stateful Multi-Turn 4-Variable Slot-Check Inspector (PRD-05) */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  1. Peran Negosiator: Stateful Multi-Turn 4-Variable Slot-Check
                </h2>
                <p className="text-[11px] text-slate-500">
                  Memeriksa Harga/Dus, MOQ, Tanggal Expired Batch, dan Mobil
                  Freezer secara otomatis
                </p>
              </div>
              <select
                value={selectedRfqId}
                onChange={(e) => setSelectedRfqId(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold bg-white"
              >
                {rfqSessions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.rfqCode} — {r.requestedQtyBoxes} Dus {r.productName} (
                    {r.status})
                  </option>
                ))}
              </select>
            </div>

            {activeRfq && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="text-xs">
                    <span className="font-bold text-slate-900">
                      Status Sesi {activeRfq.rfqCode}:
                    </span>{" "}
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[11px]">
                      {activeRfq.status}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {activeRfq.status === "AWAITING_OWNER_RFQ_APPROVAL" && (
                      <button
                        type="button"
                        onClick={() => handleApproveSendRfq(activeRfq.id)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                      >
                        ✓ Izin 1-Klik Owner: Kirim RFQ ke 3 Supplier
                      </button>
                    )}
                    {activeRfq.status === "AWAITING_OWNER_PO_APPROVAL" && (
                      <button
                        type="button"
                        onClick={() => handleApprovePo(activeRfq.id)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                      >
                        ✓ ACC 1-Klik Owner: Terbitkan PO PDF & Kunci Kas
                      </button>
                    )}
                  </div>
                </div>

                {/* 4-Slot Matrix Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase">
                        <th className="py-2 px-2">Kandidat Distributor</th>
                        <th className="py-2 px-2">1. Harga/Dus</th>
                        <th className="py-2 px-2">2. MOQ</th>
                        <th className="py-2 px-2">3. Batch Exp</th>
                        <th className="py-2 px-2">4. Mobil Freezer</th>
                        <th className="py-2 px-2">Status Slot</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeRfq.quotes.map((q) => (
                        <tr key={q.supplier_id}>
                          <td className="py-2.5 px-2">
                            <div className="font-bold text-slate-900">
                              {q.supplier_name} (★{q.rating})
                            </div>
                            <div className="text-[10px] font-mono text-slate-400">
                              {q.phone}
                            </div>
                          </td>
                          <td className="py-2.5 px-2 font-bold">
                            {q.slot_price_per_box
                              ? formatRp(q.slot_price_per_box)
                              : "⏳ Belum"}
                          </td>
                          <td className="py-2.5 px-2">
                            {q.slot_moq_boxes
                              ? `${q.slot_moq_boxes} Dus`
                              : "⏳ Belum"}
                          </td>
                          <td className="py-2.5 px-2">
                            {q.slot_batch_expiry_date || "⏳ Belum"}
                          </td>
                          <td className="py-2.5 px-2">
                            {q.slot_freezer_delivery === null
                              ? "⏳ Belum"
                              : q.slot_freezer_delivery
                                ? "✓ Ya"
                                : "✕ Tidak"}
                          </td>
                          <td className="py-2.5 px-2">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                q.status === "COMPLETE"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {q.status} ({q.turn_count} Turn)
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Simulate Incoming Supplier Reply Form */}
                <form
                  onSubmit={handleSimulateSupplierReply}
                  className="pt-3 border-t border-slate-100 space-y-2 text-xs"
                >
                  <div className="font-bold text-slate-800">
                    Simulasikan Balasan Chat WhatsApp dari Nomor Kandidat
                    Distributor (FR-503):
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      value={simSupplierPhone}
                      onChange={(e) => setSimSupplierPhone(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold"
                    >
                      <option value="+628116800101">
                        CV Beku Jaya (+628116800101)
                      </option>
                      <option value="+628116800102">
                        Grosir Makmur (+628116800102)
                      </option>
                      <option value="+628116800103">
                        UD Rantai Dingin (+628116800103)
                      </option>
                    </select>
                    <input
                      type="text"
                      value={simSupplierText}
                      onChange={(e) => setSimSupplierText(e.target.value)}
                      className="sm:col-span-2 px-3 py-2 rounded-xl border border-slate-300"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSimSupplierText(
                          "Harga Rp 420rb per dus minimal ambil 15 dus ya",
                        )
                      }
                      className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-medium cursor-pointer"
                    >
                      Contoh Belum Lengkap (2 Variabel)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSimSupplierText(
                          "Ready 5 dus harga Rp 405rb/dus, MOQ 5 dus, batch exp 14 Okt 2027, kita antar pakai mobil freezer sore ini",
                        )
                      }
                      className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-medium cursor-pointer"
                    >
                      Contoh Lengkap (4 Variabel)
                    </button>
                    <button
                      type="submit"
                      className="ml-auto px-4 py-1.5 rounded-xl bg-slate-900 text-white font-semibold cursor-pointer"
                    >
                      Kirim Balasan Supplier ke Webhook →
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          {/* Card 2: Vision OCR Cardboard Box Label Inbound Receiving (PRD-06) */}
          <form
            onSubmit={handleSubmitVisionOcr}
            className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3 text-xs"
          >
            <div>
              <span className="text-[10px] font-bold uppercase text-emerald-700">
                PRD-06 • Gemini 2.5 Flash Multimodal Vision OCR
              </span>
              <h2 className="text-sm font-bold text-slate-900">
                2. Peran Asisten Toko: Input Barang Masuk Cukup Foto Label
                Kardus di WhatsApp
              </h2>
              <p className="text-[11px] text-slate-500">
                Mengekstrak SKU, Jumlah Dus (otomatis dikonversi ke Pack), Kode
                Batch, dan Tanggal Kedaluwarsa langsung ke Antrean FEFO
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Unggah Foto Label Kardus (Kamera / File)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setOcrImageName(file.name);
                    }
                  }}
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-300 text-xs bg-slate-50"
                />
                <div className="text-[10px] font-mono text-slate-500 mt-1">
                  File aktif: {ocrImageName}
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Pesan Pengantar (Caption WA Owner/Staf)
                </label>
                <input
                  type="text"
                  value={ocrCaption}
                  onChange={(e) => setOcrCaption(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  Teks Cetakan pada Label Kardus (Hasil Ekstraksi Kamera Vision
                  OCR)
                </label>
                <input
                  type="text"
                  value={ocrLabelHint}
                  onChange={(e) => setOcrLabelHint(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold text-emerald-950 bg-emerald-50/40"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold shadow-xs cursor-pointer"
              >
                📷 Kirim Foto Kardus ke Vision OCR & Masukkan ke Antrean FEFO
              </button>
            </div>
          </form>
        </div>

        {/* Right 5 Cols: Authentic WhatsApp Frontline Agent Mobile Mockup (Matching Page 8 Right Mockup!) */}
        <div className="lg:col-span-5">
          <div className="bg-slate-950 rounded-3xl p-3 shadow-xl border border-slate-800 max-w-md mx-auto">
            {/* WhatsApp Header */}
            <div className="bg-emerald-900 text-white px-4 py-3 rounded-t-2xl flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-emerald-500 text-slate-950 font-black flex items-center justify-center text-sm">
                M
              </div>
              <div>
                <div className="text-xs font-bold flex items-center gap-1">
                  Manajerku AI <span className="text-emerald-300">✓</span>
                </div>
                <div className="text-[10px] text-emerald-200">
                  ACC 1-Klik & Vision OCR Kardus • Online 24/7
                </div>
              </div>
            </div>

            {/* Chat Wallpaper Area */}
            <div className="bg-[#0b141a] p-4 space-y-3 h-[460px] overflow-y-auto text-xs">
              {loading ? (
                <div className="text-center text-slate-500 py-8">
                  Memuat percakapan WhatsApp...
                </div>
              ) : (
                messages.map((m) => {
                  const isOutboundFromOwner = m.direction === "INBOUND";
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${
                        isOutboundFromOwner ? "items-end" : "items-start"
                      }`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 space-y-1.5 ${
                          isOutboundFromOwner
                            ? "bg-emerald-700 text-white rounded-br-xs"
                            : "bg-slate-800 text-slate-100 rounded-bl-xs border border-slate-700"
                        }`}
                      >
                        <div className="text-[9px] font-mono opacity-75 flex justify-between gap-3">
                          <span>
                            {isOutboundFromOwner
                              ? `${m.detectedRole} (${m.senderPhone})`
                              : `Manajerku AI → ${m.recipientPhone}`}
                          </span>
                        </div>
                        {m.mediaUrl && (
                          <div className="px-2.5 py-1.5 rounded-lg bg-black/30 text-[11px] font-mono flex items-center gap-1.5">
                            <span>📷</span>
                            <span>{m.mediaUrl}</span>
                          </div>
                        )}
                        <div className="whitespace-pre-line leading-relaxed text-[11px]">
                          {m.contentText}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom PO Status Bar inside Phone Mockup */}
            <div className="bg-slate-900 text-slate-300 px-4 py-2.5 rounded-b-2xl border-t border-slate-800 flex items-center justify-between text-[11px]">
              <span>PO Terbit: {purchaseOrders.length} Dokumen</span>
              <span className="text-emerald-400 font-semibold">
                ● Webhook 2 Arah Aktif
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
