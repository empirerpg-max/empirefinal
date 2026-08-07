// Casa as linhas da aba "Music Videos" com as mensagens de vídeo do grupo
// do Telegram usando um export local (Telegram Desktop → Exportar histórico
// do chat → JSON), em vez de escanear a API ao vivo (mais rápido, sem
// "flood wait", e usa a coluna Descrição — que guarda a legenda original
// de cada vídeo — pra um casamento quase perfeito, em vez de comparar só
// pelo título "bonito").
import { readFileSync } from "node:fs";
import { google } from "googleapis";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo";
const SHEET_NAME = process.env.SHEET_NAME || "Music Videos";
const EXPORT_PATH = process.env.TELEGRAM_EXPORT_PATH || "data/telegram-export.json";
const DRY_RUN = process.env.DRY_RUN === "true";
const DESCRICAO_THRESHOLD = 0.85;
const TITLE_FALLBACK_THRESHOLD = 0.55;

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

type ExportMessage = {
  id: number;
  media_type?: string;
  text?: string | Array<string | { type: string; text: string }>;
  file_name?: string;
};

type Candidate = { id: number; text: string; tokens: Set<string> };

function extractText(message: ExportMessage): string {
  if (typeof message.text === "string") return message.text;
  if (!Array.isArray(message.text)) return "";
  return message.text.map((part) => (typeof part === "string" ? part : part.text)).join("");
}

function loadCandidates(): Candidate[] {
  const raw = JSON.parse(readFileSync(EXPORT_PATH, "utf8")) as { messages: ExportMessage[] };
  const candidates: Candidate[] = [];
  for (const message of raw.messages) {
    if (message.media_type !== "video_file") continue;
    const text = [extractText(message), message.file_name].filter(Boolean).join(" ");
    if (!text.trim()) continue;
    candidates.push({ id: message.id, text, tokens: tokenSet(text) });
  }
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
  const candidates = loadCandidates();
  console.log(`${candidates.length} mensagens com vídeo no export local.`);

  const sheets = await getSheetsClient();
  const range = `${SHEET_NAME}!A:Z`;
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const rows = data.values || [];
  if (rows.length < 2) throw new Error(`Aba "${SHEET_NAME}" vazia ou não encontrada.`);

  const header = rows[0].map((h) => normalize(String(h)));
  const titleCol = header.findIndex((h) => h.includes("titulo do topico") || h.includes("titulo"));
  const fonteCol = header.findIndex((h) => h === "fonte");
  const idMensagemCol = header.findIndex((h) => h.includes("id da mensagem"));
  const descricaoCol = header.findIndex((h) => h.includes("descricao"));
  if (titleCol < 0 || fonteCol < 0 || idMensagemCol < 0 || descricaoCol < 0) {
    throw new Error(
      `Não encontrei as colunas esperadas (título/fonte/ID da mensagem/descrição). Cabeçalho: ${rows[0].join(" | ")}`
    );
  }

  const used = new Set<number>();
  const updates: { range: string; values: string[][] }[] = [];
  const lowConfidence: string[] = [];
  let exact = 0;
  let fallback = 0;
  let corrected = 0;

  const findBest = (tokens: Set<string>) => {
    let best: { candidate: Candidate; score: number } | null = null;
    for (const candidate of candidates) {
      if (used.has(candidate.id)) continue;
      const score = jaccard(tokens, candidate.tokens);
      if (score > (best?.score ?? 0)) best = { candidate, score };
    }
    return best;
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const fonte = normalize(row[fonteCol] || "");
    if (fonte !== "telegram") continue;
    const title = row[titleCol] || "";
    const descricao = row[descricaoCol] || "";
    const existingId = row[idMensagemCol];

    let best: { candidate: Candidate; score: number } | null = null;
    let viaDescricao = false;
    if (descricao.trim()) {
      best = findBest(tokenSet(descricao));
      viaDescricao = true;
    }
    if ((!best || best.score < DESCRICAO_THRESHOLD) && title.trim()) {
      const titleBest = findBest(tokenSet(title));
      if (titleBest && (!best || titleBest.score > best.score)) {
        best = titleBest;
        viaDescricao = false;
      }
    }

    const threshold = viaDescricao ? DESCRICAO_THRESHOLD : TITLE_FALLBACK_THRESHOLD;
    if (!best || best.score < threshold) {
      if (!existingId) lowConfidence.push(title);
      continue;
    }

    const newId = String(best.candidate.id);
    if (existingId && existingId === newId) continue; // já está certo, nada a fazer
    if (existingId && existingId !== newId && !(viaDescricao && best.score >= DESCRICAO_THRESHOLD)) {
      // só corrige um valor já preenchido se a nova evidência for de alta confiança (via Descrição)
      continue;
    }

    used.add(best.candidate.id);
    const sheetRow = i + 1;
    const colLetter = String.fromCharCode(65 + idMensagemCol);
    updates.push({ range: `${SHEET_NAME}!${colLetter}${sheetRow}`, values: [[newId]] });

    if (existingId && existingId !== newId) {
      corrected += 1;
      console.log(`↻ [${best.score.toFixed(2)}] "${title}" corrigido: ${existingId} -> ${newId}`);
    } else if (viaDescricao) {
      exact += 1;
      console.log(`✓ [desc ${best.score.toFixed(2)}] "${title}" -> mensagem ${newId}`);
    } else {
      fallback += 1;
      console.log(`~ [título ${best.score.toFixed(2)}] "${title}" -> mensagem ${newId}`);
    }
  }

  console.log(
    `\n${exact} casados por Descrição (alta confiança), ${fallback} por título (confiança menor), ${corrected} corrigidos.`
  );
  console.log(`${lowConfidence.length} sem correspondência confiável.`);
  if (lowConfidence.length) {
    console.log("Sem correspondência:");
    for (const title of lowConfidence) console.log(`  - ${title}`);
  }

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
