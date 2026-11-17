/**
 * Real OpenWA (@open-wa/wa-automate) HTTP Client & Gateway Connector
 * Connects Manajerku AI Assistant & FEFO Reseller WA Blast to a live OpenWA Server
 * Default endpoint: http://localhost:8085 (configurable via OPENWA_API_URL and OPENWA_API_KEY)
 */

export interface OpenWaConfig {
  apiUrl: string;
  apiKey: string;
  webhookUrl: string;
}

const runtimeOpenWaConfig: OpenWaConfig = {
  apiUrl: process.env.OPENWA_API_URL || "http://localhost:8085",
  apiKey: process.env.OPENWA_API_KEY || "manajerku-secret",
  webhookUrl:
    process.env.OPENWA_WEBHOOK_URL ||
    "http://localhost:3000/api/v1/webhooks/whatsapp",
};

export function getOpenWaConfig(): OpenWaConfig {
  return { ...runtimeOpenWaConfig };
}

export function updateOpenWaConfig(partial: Partial<OpenWaConfig>): OpenWaConfig {
  if (partial.apiUrl && partial.apiUrl.trim()) {
    runtimeOpenWaConfig.apiUrl = partial.apiUrl.trim().replace(/\/+$/, "");
  }
  if (typeof partial.apiKey === "string") {
    runtimeOpenWaConfig.apiKey = partial.apiKey.trim();
  }
  if (partial.webhookUrl && partial.webhookUrl.trim()) {
    runtimeOpenWaConfig.webhookUrl = partial.webhookUrl.trim();
  }
  return getOpenWaConfig();
}

export function formatPhoneToOpenWaChatId(phone: string): string {
  const cleaned = phone
    .trim()
    .replace(/@(c\.us|s\.whatsapp\.net|g\.us)$/i, "")
    .replace(/\D/g, "");
  const normalizedDigits = cleaned.startsWith("08")
    ? `628${cleaned.slice(2)}`
    : cleaned;
  return `${normalizedDigits}@c.us`;
}

function formatOpenWaFailureNote(params: {
  httpStatus?: number;
  errorCode?: string;
  rawError?: string;
}): string {
  const combined = `${params.errorCode || ""} ${params.rawError || ""}`.trim();
  if (/NOT_REGISTERED_ON_WA|No LID for user|tidak terdaftar di WhatsApp/i.test(combined)) {
    return "Nomor tidak terdaftar di WhatsApp";
  }
  if (/LICENSE_REQUIRED|Not a contact|restricted or premium license/i.test(combined)) {
    return "Chat nomor baru belum didukung sesi OpenWA saat ini";
  }
  if (/STORE_NOT_READY|Execution context/i.test(combined)) {
    return "WhatsApp Web sedang memuat ulang, coba sebentar lagi";
  }
  if (/timeout|abort/i.test(combined)) {
    return "Timeout pengiriman BotWA";
  }
  if (params.httpStatus && params.httpStatus >= 400) {
    return `Gagal kirim via BotWA (HTTP ${params.httpStatus})`;
  }
  return "BotWA belum terhubung di port 8085";
}

/**
 * Dispatch an outbound WhatsApp text message through OpenWA /sendText endpoint.
 * Non-blocking when OpenWA server is not running locally so SQLite logs & tests always succeed.
 */
export async function dispatchOpenWaText(params: {
  toPhone: string;
  content: string;
}): Promise<{ deliveredToOpenWa: boolean; chatId: string; statusNote: string }> {
  const cfg = getOpenWaConfig();
  const chatId = formatPhoneToOpenWaChatId(params.toPhone);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 16000);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (cfg.apiKey) {
      headers["apiKey"] = cfg.apiKey;
      headers["Authorization"] = `Bearer ${cfg.apiKey}`;
    }

    const res = await fetch(`${cfg.apiUrl}/sendText`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        args: {
          to: chatId,
          content: params.content,
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      return {
        deliveredToOpenWa: true,
        chatId,
        statusNote: "Terkirim via BotWA",
      };
    }
    const errPayload = (await res.json().catch(() => null)) as {
      code?: string;
      error?: string;
    } | null;
    return {
      deliveredToOpenWa: false,
      chatId,
      statusNote: formatOpenWaFailureNote({
        httpStatus: res.status,
        errorCode: errPayload?.code,
        rawError: errPayload?.error,
      }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    return {
      deliveredToOpenWa: false,
      chatId,
      statusNote: formatOpenWaFailureNote({ rawError: msg }),
    };
  }
}

/**
 * Probe live OpenWA server status (/getHostNumber or /isConnected)
 */
export async function checkOpenWaServerHealth(): Promise<{
  online: boolean;
  hostPhone: string | null;
  config: OpenWaConfig;
  cliCommand: string;
}> {
  const cfg = getOpenWaConfig();
  const cliCommand = `npx @open-wa/wa-automate --port 8085 --webhook "${cfg.webhookUrl}" -k "${cfg.apiKey || "manajerku-secret"}"`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (cfg.apiKey) {
      headers["apiKey"] = cfg.apiKey;
      headers["Authorization"] = `Bearer ${cfg.apiKey}`;
    }

    const res = await fetch(`${cfg.apiUrl}/getHostNumber`, {
      method: "POST",
      headers,
      body: JSON.stringify({ args: {} }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const json = await res.json().catch(() => null);
      const hostPhone =
        json && typeof json.response === "string"
          ? `+${json.response.replace(/\D/g, "")}`
          : null;
      return {
        online: true,
        hostPhone,
        config: cfg,
        cliCommand,
      };
    }
  } catch {
    // Server offline
  }

  return {
    online: false,
    hostPhone: null,
    config: cfg,
    cliCommand,
  };
}
