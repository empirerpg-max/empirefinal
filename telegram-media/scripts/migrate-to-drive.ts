// Migra vídeos do grupo de arquivo do Telegram (Music Videos) pro Google
// Drive do usuário: baixa (preferindo a versão já reconvertida, quando
// existir), sobe pra pasta indicada, deixa público "qualquer um com o link
// pode ver", e atualiza a planilha (fonte -> "drive", "Link do vídeo"
// preenchido). Nunca apaga as colunas do Telegram — só passa a apontar pra
// nova fonte, então dá pra reverter manualmente se algo sair errado.
//
// Uso: dry-run por padrão. Passe DRY_RUN=false pra migrar de verdade, e
// LIMIT=<n> pra migrar só os primeiros N vídeos pendentes (útil pra validar
// num lote pequeno antes do catálogo inteiro).
import { mkdtempSync, rmSync, createReadStream, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { google } from "googleapis";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo";
const SHEET_NAME = process.env.SHEET_NAME || "Music Videos";
const DRY_RUN = process.env.DRY_RUN !== "false";
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : undefined;
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || "1_9NRK_XOlbom7W6a-1xCxGyDbdq3WVfM";

const API_ID = Number(process.env.TELEGRAM_API_ID || 0);
const API_HASH = process.env.TELEGRAM_API_HASH || "";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_SOURCE_CHAT_ID || "-1004353239109";

const googleCredsRaw = process.env.GOOGLE_CREDENTIALS_JSON;
const DRIVE_OAUTH_CLIENT_ID = process.env.DRIVE_OAUTH_CLIENT_ID || "";
const DRIVE_OAUTH_CLIENT_SECRET = process.env.DRIVE_OAUTH_CLIENT_SECRET || "";
const DRIVE_OAUTH_REFRESH_TOKEN = process.env.DRIVE_OAUTH_REFRESH_TOKEN || "";
if (!googleCredsRaw) {
  console.error("Faltando GOOGLE_CREDENTIALS_JSON.");
  process.exit(1);
}
if (!API_ID || !API_HASH || !BOT_TOKEN) {
  console.error("Faltando TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_BOT_TOKEN.");
  process.exit(1);
}
if (!DRIVE_OAUTH_CLIENT_ID || !DRIVE_OAUTH_CLIENT_SECRET || !DRIVE_OAUTH_REFRESH_TOKEN) {
  console.error(
    "Faltando DRIVE_OAUTH_CLIENT_ID / DRIVE_OAUTH_CLIENT_SECRET / DRIVE_OAUTH_REFRESH_TOKEN — " +
      "contas de serviço não têm cota de armazenamento própria no Drive, então o upload precisa " +
      "ser autenticado como a conta pessoal dona da pasta de destino.",
  );
  process.exit(1);
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
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

async function getSheetsAuth() {
  const creds = JSON.parse(googleCredsRaw!);
  return new google.auth.GoogleAuth({
    credentials: { client_email: creds.client_email, private_key: creds.private_key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// O upload precisa ser autenticado como a conta pessoal do usuário (via
// OAuth, com refresh token obtido uma vez no OAuth Playground) — contas de
// serviço não têm cota de armazenamento própria no Drive, então
// drive.files.create com uma service account sempre falha com "Service
// Accounts do not have storage quota", mesmo com a pasta compartilhada.
function getDriveOAuthClient() {
  const oauth2Client = new google.auth.OAuth2(DRIVE_OAUTH_CLIENT_ID, DRIVE_OAUTH_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: DRIVE_OAUTH_REFRESH_TOKEN });
  return oauth2Client;
}

async function main() {
  const sheetsAuth = await getSheetsAuth();
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth });
  const drive = google.drive({ version: "v3", auth: getDriveOAuthClient() });

  const range = `${SHEET_NAME}!A:ZZ`;
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const rows = data.values || [];
  if (rows.length < 2) throw new Error(`Aba "${SHEET_NAME}" vazia ou não encontrada.`);

  const header = rows[0].map((h) => normalize(String(h ?? "")));
  const titleCol = header.findIndex((h) => h.includes("titulo do topico") || h.includes("titulo"));
  const fonteCol = header.findIndex((h) => h === "fonte");
  const idMensagemCol = header.findIndex((h, i) => h.includes("id da mensagem") && i > fonteCol);
  const newIdCol = header.findIndex((h) => h.includes("id da mensagem (reconvertido)"));
  const driveLinkCol = header.findIndex((h) => h.includes("link do video"));
  if (titleCol < 0 || fonteCol < 0 || idMensagemCol < 0 || driveLinkCol < 0) {
    throw new Error(
      `Não encontrei as colunas esperadas (título/fonte/ID da mensagem/Link do vídeo). Cabeçalho: ${rows[0].join(" | ")}`,
    );
  }

  type PendingRow = { rowIndex: number; sheetRow: number; title: string; messageId: number };
  const pending: PendingRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (normalize(row[fonteCol] || "") !== "telegram") continue;
    if ((row[driveLinkCol] || "").trim()) continue; // já migrado
    const reconvertedRaw = newIdCol >= 0 ? (row[newIdCol] || "").trim() : "";
    const rawId = reconvertedRaw || (row[idMensagemCol] || "").trim();
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
    `${pending.length} vídeo(s) pendente(s) de migração na aba "${SHEET_NAME}"` +
      (LIMIT ? `; processando os primeiros ${batch.length} (LIMIT=${LIMIT}).` : "."),
  );

  if (DRY_RUN) {
    console.log("\nDRY_RUN — nada será baixado ou enviado. Lista do que seria processado:");
    for (const item of batch) console.log(`  - [msg ${item.messageId}] ${item.title}`);
    return;
  }

  const client = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
    connectionRetries: 5,
  });
  await client.start({ botAuthToken: BOT_TOKEN });

  const workDir = mkdtempSync(join(tmpdir(), "migrate-drive-"));
  let ok = 0;
  let failed = 0;

  try {
    for (const item of batch) {
      const filePath = join(workDir, `${item.messageId}.mp4`);

      try {
        console.log(`\n[msg ${item.messageId}] "${item.title}" — baixando...`);
        const messages = await client.getMessages(CHAT_ID, { ids: [item.messageId] });
        const message = messages[0];
        if (!message || !message.media) {
          throw new Error("Mensagem ou mídia não encontrada no grupo de arquivo.");
        }

        await client.downloadMedia(message, { outputFile: filePath });
        const sizeMb = (statSync(filePath).size / 1024 / 1024).toFixed(1);
        console.log(`[msg ${item.messageId}] baixado (${sizeMb} MB), subindo pro Drive...`);

        const safeName = item.title.replace(/[\\/]/g, "-").trim();
        const uploadRes = await drive.files.create({
          requestBody: {
            name: `${safeName}.mp4`,
            parents: [DRIVE_FOLDER_ID],
          },
          media: {
            mimeType: "video/mp4",
            body: createReadStream(filePath),
          },
          fields: "id, webViewLink",
        });
        const fileId = uploadRes.data.id;
        if (!fileId) throw new Error("Upload não retornou um ID de arquivo.");

        await drive.permissions.create({
          fileId,
          requestBody: { role: "reader", type: "anyone" },
        });

        const driveLink = `https://drive.google.com/file/d/${fileId}/view?usp=drivesdk`;

        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            valueInputOption: "RAW",
            data: [
              {
                range: `${SHEET_NAME}!${columnLetter(driveLinkCol)}${item.sheetRow}`,
                values: [[driveLink]],
              },
              {
                range: `${SHEET_NAME}!${columnLetter(fonteCol)}${item.sheetRow}`,
                values: [["drive"]],
              },
            ],
          },
        });

        console.log(`[msg ${item.messageId}] ✓ migrado: ${driveLink}`);
        ok += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[msg ${item.messageId}] ✗ erro: ${message}`);
        failed += 1;
      } finally {
        try {
          rmSync(filePath, { force: true });
        } catch {
          /* ignora */
        }
      }

      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  console.log(`\nConcluído: ${ok} migrado(s), ${failed} com erro.`);
  await client.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
