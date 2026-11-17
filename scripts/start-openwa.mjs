import { spawn } from "node:child_process";

const port = process.env.OPENWA_PORT || "8085";
const apiKey = process.env.OPENWA_API_KEY || "manajerku-secret";
const webhookUrl =
  process.env.OPENWA_WEBHOOK_URL ||
  "http://localhost:3000/api/v1/webhooks/whatsapp";

const useHeadful =
  process.argv.includes("--headful") || process.env.OPENWA_HEADFUL === "1";

console.log("==========================================================");
console.log("  MANAJERKU - OPENWA REAL WHATSAPP GATEWAY LAUNCHER");
console.log("==========================================================");
console.log(`  Port Server OpenWA : http://localhost:${port}`);
console.log(`  Webhook Aplikasi   : ${webhookUrl}`);
console.log(`  API Key            : ${apiKey}`);
if (useHeadful) {
  console.log("  Mode Login         : Browser Terlihat (--headful)");
  console.log("  Instruksi Kode     : Di jendela Chrome WhatsApp Web, klik");
  console.log("                       'Tautkan dengan nomor telepon' di bawah QR");
  console.log("                       untuk mendapatkan 8 digit kode pairing.");
} else {
  console.log("  Instruksi          : Tunggu QR Code muncul di bawah ini,");
  console.log("                       lalu Scan dari WhatsApp HP Anda");
  console.log("                       (Perangkat Tertaut -> Tautkan Perangkat).");
  console.log("  Alternatif Kode    : Jalankan 'npm run openwa:code' jika ingin");
  console.log("                       login pakai kode 8 digit tanpa scan QR.");
}
console.log("==========================================================\n");

const isWin = process.platform === "win32";
const cmd = isWin ? "npx.cmd" : "npx";
const args = [
  "@open-wa/wa-automate",
  "--port",
  port,
  "--webhook",
  webhookUrl,
  "-k",
  apiKey,
  "--use-chrome",
  "--session-id",
  "manajerku-openwa-agent",
  ...(useHeadful ? ["--headful"] : []),
];

const proc = spawn(cmd, args, {
  stdio: "inherit",
  shell: isWin,
});

proc.on("exit", (code) => {
  process.exit(code ?? 0);
});
