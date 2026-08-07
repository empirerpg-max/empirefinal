// Roda só no GitHub Actions (workflow_dispatch) — precisa de internet de
// verdade pra falar com Telegram + Google Sheets ao mesmo tempo, coisa que
// o sandbox de desenvolvimento não tem.
//
// Lê todas as mensagens com vídeo do grupo `-1004353239109`, tenta casar
// cada uma com uma linha da aba "Music Videos" (fonte=telegram, ID da
// mensagem vazio) comparando título normalizado, e escreve o ID da
// mensagem de volta na planilha pros casos com confiança alta. Casos
// ambíguos ficam de fora — melhor deixar vazio do que errar o vídeo.
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { google } from "googleapis";

const API_ID = Number(process.env.TELEGRAM_API_ID || 0);
const API_HASH = process.env.TELEGRAM_API_HASH || "";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_SOURCE_CHAT_ID || "-1004353239109";
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo";
const SHEET_NAME = process.env.SHEET_NAME || "Music Videos";
const DRY_RUN = process.env.DRY_RUN === "true";
const MATCH_THRESHOLD = 0.55;

if (!API_ID || !API_HASH || !BOT_TOKEN) {
  console.error("Faltando TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_BOT_TOKEN.");
  process.exit(1);
}
const googleCredsRaw = process.env.GOOGLE_CREDENTIALS_JSON;
if (!googleCredsRaw) {
  console.error("Faltando GOOGLE_CREDENTIALS_JSON.");
  process.exit(1);
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(normalize(text).split(" ").filter((t) => t.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

type TelegramCandidate = { messageId: number; text: string; tokens: Set<string> };

async function fetchTelegramCandidates(): Promise<TelegramCandidate[]> {
  const session = new StringSession("");
  const client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5 });
  await client.start({ botAuthToken: BOT_TOKEN });

  const candidates: TelegramCandidate[] = [];
  for await (const message of client.iterMessages(CHAT_ID, { limit: 0 })) {
    const document = (message.media as any)?.document;
    if (!document) continue;
    const isVideo =
      document.mimeType?.startsWith("video/") ||
      document.attributes?.some((a: any) => a.className === "DocumentAttributeVideo");
    if (!isVideo) continue;

    const fileNameAttr = document.attributes?.find((a: any) => a.className === "DocumentAttributeFilename");
    const text = [message.message, fileNameAttr?.fileName].filter(Boolean).join(" ");
    if (!text.trim()) continue;

    candidates.push({ messageId: message.id, text, tokens: tokenSet(text) });
  }

  await client.disconnect();
  return candidates;
}

async function getSheetsClient() {
  const creds = JSON.parse(googleCredsRaw!);
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: creds.client_email, private_key: creds.private_key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function main() {
  console.log(`Buscando vídeos em ${CHAT_ID}...`);
  const candidates = await fetchTelegramCandidates();
  console.log(`${candidates.length} mensagens com vídeo encontradas.`);

  const sheets = await getSheetsClient();
  const range = `${SHEET_NAME}!A:Z`;
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const rows = data.values || [];
  if (rows.length < 2) throw new Error(`Aba "${SHEET_NAME}" vazia ou não encontrada.`);

  const header = rows[0].map((h) => normalize(String(h)));
  const titleCol = header.findIndex((h) => h.includes("titulo do topico") || h.includes("titulo"));
  const fonteCol = header.findIndex((h) => h === "fonte");
  const idMensagemCol = header.findIndex((h) => h.includes("id da mensagem"));
  if (titleCol < 0 || fonteCol < 0 || idMensagemCol < 0) {
    throw new Error(
      `Não encontrei as colunas esperadas (título/fonte/ID da mensagem). Cabeçalho: ${rows[0].join(" | ")}`
    );
  }

  const used = new Set<number>();
  const updates: { range: string; values: string[][] }[] = [];
  const unmatched: string[] = [];
  let matched = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const fonte = normalize(row[fonteCol] || "");
    const existingId = row[idMensagemCol];
    const title = row[titleCol] || "";
    if (fonte !== "telegram" || existingId || !title.trim()) continue;

    const rowTokens = tokenSet(title);
    let best: { candidate: TelegramCandidate; score: number } | null = null;
    for (const candidate of candidates) {
      if (used.has(candidate.messageId)) continue;
      const score = jaccard(rowTokens, candidate.tokens);
      if (score > (best?.score ?? 0)) best = { candidate, score };
    }

    if (best && best.score >= MATCH_THRESHOLD) {
      used.add(best.candidate.messageId);
      matched += 1;
      const sheetRow = i + 1; // 1-indexed, +1 pro header
      const colLetter = String.fromCharCode(65 + idMensagemCol);
      updates.push({
        range: `${SHEET_NAME}!${colLetter}${sheetRow}`,
        values: [[String(best.candidate.messageId)]],
      });
      console.log(`✓ [${best.score.toFixed(2)}] "${title}" -> mensagem ${best.candidate.messageId} ("${best.candidate.text.slice(0, 60)}")`);
    } else {
      unmatched.push(title);
    }
  }

  console.log(`\n${matched} vídeos casados automaticamente. ${unmatched.length} ficaram sem correspondência confiável:`);
  for (const title of unmatched) console.log(`  - ${title}`);

  if (DRY_RUN) {
    console.log("\nDRY_RUN=true — nada foi escrito na planilha.");
    return;
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: "RAW", data: updates },
    });
    console.log(`\n${updates.length} linhas atualizadas na planilha.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
