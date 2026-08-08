// Reconverte vídeos do grupo de arquivo do Telegram (Music Videos) para um
// formato leve e compatível — H.264 + faststart + teto de bitrate — e
// reenvia ao mesmo grupo, gravando o novo message_id em colunas NOVAS ao
// final da aba, sem sobrescrever o original. Resolve os três problemas
// identificados na auditoria: arquivos pesados demais, índice do MP4 (moov
// atom) no fim do arquivo, e .MOV de iPhone em HEVC incompatível.
//
// Uso: dry-run por padrão. Passe DRY_RUN=false pra escrever de verdade, e
// LIMIT=<n> pra processar só os primeiros N vídeos pendentes (útil pra
// validar num lote pequeno antes de rodar o catálogo inteiro).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { google } from "googleapis";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo";
const SHEET_NAME = process.env.SHEET_NAME || "Music Videos";
const DRY_RUN = process.env.DRY_RUN !== "false";
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : undefined;

const API_ID = Number(process.env.TELEGRAM_API_ID || 0);
const API_HASH = process.env.TELEGRAM_API_HASH || "";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_SOURCE_CHAT_ID || "-1004353239109";

const NEW_ID_HEADER = "ID da mensagem (reconvertido)";
const STATUS_HEADER = "Status da reconversão";

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
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function columnLetter(zeroBasedIndex: number): string {
  let n = zeroBasedIndex + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

async function getSheetsClient() {
  const creds = JSON.parse(googleCredsRaw!);
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: creds.client_email, private_key: creds.private_key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function runFfmpeg(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // H.264 (compatível com praticamente qualquer aparelho, ao contrário do
    // HEVC dos .MOV de iPhone), índice no início do arquivo (+faststart —
    // resolve o "baixar 500MB antes do primeiro frame"), resolução limitada
    // a 1080p e bitrate de vídeo limitado a ~6 Mbps (a auditoria encontrou
    // vídeos de até 40 Mbps em 4K, muito acima do que uma conexão móvel
    // sustenta).
    const args = [
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-profile:v",
      "main",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "medium",
      "-vf",
      "scale='min(1920,iw)':-2",
      "-maxrate",
      "6M",
      "-bufsize",
      "12M",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outputPath,
    ];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => reject(new Error(`Falha ao iniciar ffmpeg: ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg saiu com código ${code}:\n${stderr.slice(-2000)}`));
    });
  });
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
  // A aba tem duas colunas "ID da mensagem": a do grupo original (antes de
  // "fonte") e a do grupo de arquivo (depois de "fonte") — é esta última
  // que o app usa pra tocar o vídeo, e é ela que reconvertemos.
  const idMensagemCol = header.findIndex((h, i) => h.includes("id da mensagem") && i > fonteCol);
  if (titleCol < 0 || fonteCol < 0 || idMensagemCol < 0) {
    throw new Error(
      `Não encontrei as colunas esperadas (título/fonte/ID da mensagem). Cabeçalho: ${rows[0].join(" | ")}`,
    );
  }

  // Colunas novas de saída, sempre ao final da aba existente (nunca no
  // meio — regra do projeto, e evita deslocar qualquer coluna já em uso).
  let newIdCol = header.findIndex((h) => h.includes("id da mensagem (reconvertido)"));
  let statusCol = header.findIndex((h) => h.includes("status da reconvers"));
  const headerUpdates: { range: string; values: string[][] }[] = [];
  if (newIdCol < 0) {
    newIdCol = header.length;
    headerUpdates.push({
      range: `${SHEET_NAME}!${columnLetter(newIdCol)}1`,
      values: [[NEW_ID_HEADER]],
    });
    header.push(normalize(NEW_ID_HEADER));
  }
  if (statusCol < 0) {
    statusCol = header.length;
    headerUpdates.push({
      range: `${SHEET_NAME}!${columnLetter(statusCol)}1`,
      values: [[STATUS_HEADER]],
    });
    header.push(normalize(STATUS_HEADER));
  }

  type PendingRow = { rowIndex: number; sheetRow: number; title: string; messageId: number };
  const pending: PendingRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (normalize(row[fonteCol] || "") !== "telegram") continue;
    if ((row[newIdCol] || "").trim()) continue; // já reconvertido
    const rawId = (row[idMensagemCol] || "").trim();
    if (!rawId || !/^\d+$/.test(rawId)) continue;
    pending.push({
      rowIndex: i,
      sheetRow: i + 1,
      title: row[titleCol] || `(linha ${i + 1})`,
      messageId: Number(rawId),
    });
  }

  const batch = LIMIT ? pending.slice(0, LIMIT) : pending;
  console.log(
    `${pending.length} vídeo(s) pendente(s) de reconversão na aba "${SHEET_NAME}"` +
      (LIMIT ? `; processando os primeiros ${batch.length} (LIMIT=${LIMIT}).` : "."),
  );

  if (DRY_RUN) {
    console.log(
      "\nDRY_RUN — nada será baixado, convertido ou reenviado. Lista do que seria processado:",
    );
    for (const item of batch) console.log(`  - [msg ${item.messageId}] ${item.title}`);
    return;
  }

  if (headerUpdates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: "RAW", data: headerUpdates },
    });
    console.log(`Cabeçalho(s) novo(s) criado(s): ${headerUpdates.map((u) => u.range).join(", ")}`);
  }

  const client = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
    connectionRetries: 5,
  });
  await client.start({ botAuthToken: BOT_TOKEN });

  const workDir = mkdtempSync(join(tmpdir(), "retranscode-"));
  let ok = 0;
  let failed = 0;

  try {
    for (const item of batch) {
      const inputPath = join(workDir, `${item.messageId}-in.mp4`);
      const outputPath = join(workDir, `${item.messageId}-out.mp4`);
      const rowUpdates: { range: string; values: string[][] }[] = [];

      try {
        console.log(`\n[msg ${item.messageId}] "${item.title}" — baixando...`);
        const messages = await client.getMessages(CHAT_ID, { ids: [item.messageId] });
        const message = messages[0];
        if (!message || !message.media) {
          throw new Error("Mensagem ou mídia não encontrada no grupo de arquivo.");
        }

        const buffer = await client.downloadMedia(message, {});
        if (!buffer) throw new Error("Download retornou vazio.");
        writeFileSync(inputPath, buffer as Buffer);

        console.log(`[msg ${item.messageId}] convertendo com ffmpeg...`);
        await runFfmpeg(inputPath, outputPath);

        console.log(`[msg ${item.messageId}] reenviando ao Telegram...`);
        const sent = await client.sendFile(CHAT_ID, {
          file: outputPath,
          caption: item.title,
          forceDocument: false,
        });
        const newMessageId = sent.id;
        if (!newMessageId) throw new Error("Envio não retornou um message_id.");

        rowUpdates.push(
          {
            range: `${SHEET_NAME}!${columnLetter(newIdCol)}${item.sheetRow}`,
            values: [[String(newMessageId)]],
          },
          { range: `${SHEET_NAME}!${columnLetter(statusCol)}${item.sheetRow}`, values: [["ok"]] },
        );
        console.log(`[msg ${item.messageId}] ✓ nova mensagem ${newMessageId}`);
        ok += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[msg ${item.messageId}] ✗ erro: ${message}`);
        rowUpdates.push({
          range: `${SHEET_NAME}!${columnLetter(statusCol)}${item.sheetRow}`,
          values: [[`erro: ${message.slice(0, 200)}`]],
        });
        failed += 1;
      }

      if (rowUpdates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: { valueInputOption: "RAW", data: rowUpdates },
        });
      }

      // Limpa os arquivos temporários deste vídeo antes do próximo, e dá um
      // respiro entre envios pra não estourar limite de flood do Telegram.
      for (const p of [inputPath, outputPath]) {
        try {
          rmSync(p, { force: true });
        } catch {
          /* ignora */
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  console.log(`\nConcluído: ${ok} reconvertido(s), ${failed} com erro.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
