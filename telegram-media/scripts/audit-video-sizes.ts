// Só mede: soma o tamanho de cada vídeo do Telegram (aba Music Videos) sem
// baixar nada, pra saber quanto espaço a migração pro Google Drive vai
// ocupar antes de gastar tempo baixando/reenviando de verdade. Usa a versão
// reconvertida (mais leve) quando já existir, senão o arquivo original.
import { google } from "googleapis";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo";
const SHEET_NAME = process.env.SHEET_NAME || "Music Videos";

const API_ID = Number(process.env.TELEGRAM_API_ID || 0);
const API_HASH = process.env.TELEGRAM_API_HASH || "";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_SOURCE_CHAT_ID || "-1004353239109";

const googleCredsRaw = process.env.GOOGLE_CREDENTIALS_JSON;
if (!googleCredsRaw) {
  console.error("Faltando GOOGLE_CREDENTIALS_JSON.");
  process.exit(1);
}
if (!API_ID || !API_HASH || !BOT_TOKEN) {
  console.error("Faltando TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_BOT_TOKEN.");
  process.exit(1);
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

async function getSheetsClient() {
  const creds = JSON.parse(googleCredsRaw!);
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: creds.client_email, private_key: creds.private_key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024;
  return `${gb.toFixed(2)} GB`;
}

async function main() {
  const sheets = await getSheetsClient();
  const range = `${SHEET_NAME}!A:ZZ`;
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const rows = data.values || [];
  if (rows.length < 2) throw new Error(`Aba "${SHEET_NAME}" vazia ou não encontrada.`);

  const header = rows[0].map((h) => normalize(String(h ?? "")));
  const titleCol = header.findIndex((h) => h.includes("titulo do topico") || h.includes("titulo"));
  const fonteCol = header.findIndex((h) => h === "fonte");
  const idMensagemCol = header.findIndex((h, i) => h.includes("id da mensagem") && i > fonteCol);
  const newIdCol = header.findIndex((h) => h.includes("id da mensagem (reconvertido)"));

  const targets: { title: string; messageId: number; usingReconverted: boolean }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (normalize(row[fonteCol] || "") !== "telegram") continue;
    const reconvertedRaw = newIdCol >= 0 ? (row[newIdCol] || "").trim() : "";
    const rawId = reconvertedRaw || (row[idMensagemCol] || "").trim();
    if (!rawId || !/^\d+$/.test(rawId)) continue;
    targets.push({
      title: row[titleCol] || `(linha ${i + 1})`,
      messageId: Number(rawId),
      usingReconverted: !!reconvertedRaw,
    });
  }

  console.log(`${targets.length} vídeo(s) do Telegram encontrados na aba "${SHEET_NAME}".`);

  const client = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
    connectionRetries: 5,
  });
  await client.start({ botAuthToken: BOT_TOKEN });

  let totalBytes = 0;
  let found = 0;
  let missing = 0;
  const BATCH = 50;

  for (let i = 0; i < targets.length; i += BATCH) {
    const slice = targets.slice(i, i + BATCH);
    const ids = slice.map((t) => t.messageId);
    const messages = await client.getMessages(CHAT_ID, { ids });
    for (let j = 0; j < slice.length; j++) {
      const message = messages[j];
      const size: number | undefined = (message?.media as any)?.document?.size?.toJSNumber?.();
      if (message && size) {
        totalBytes += size;
        found += 1;
      } else {
        missing += 1;
        console.log(`  ✗ não encontrado ou sem mídia: [msg ${slice[j].messageId}] ${slice[j].title}`);
      }
    }
    console.log(`Progresso: ${Math.min(i + BATCH, targets.length)}/${targets.length}`);
  }

  console.log(`\n=== RESULTADO ===`);
  console.log(`Vídeos com tamanho lido: ${found}`);
  console.log(`Vídeos não encontrados/sem mídia: ${missing}`);
  console.log(`Tamanho total: ${formatBytes(totalBytes)} (${totalBytes} bytes)`);

  await client.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
