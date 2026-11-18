// Converte os vídeos do Google Drive (aba "Music Videos", fonte = drive) que
// estão num formato que nem todo navegador toca — principalmente HEVC/H.265,
// o padrão dos vídeos de iPhone — para H.264, que toca em qualquer aparelho.
//
// Por que existe: o Edge/Chrome no Windows só tocam HEVC se o PC tiver a
// extensão "HEVC Video Extensions" + placa de vídeo compatível. Sem isso o
// vídeo dá erro ou fica com tela preta (caso real: jogadora no Edge não
// conseguia ver a maioria dos vídeos, mas no celular tocava). A reconversão
// do Telegram (retranscode-videos.ts) nunca cobriu os vídeos que já estão
// no Drive — nem os migrados sem versão reconvertida, nem os enviados direto
// pelo Gestão.
//
// Decisões (pedidas pelo dono do projeto):
// - MÁXIMA QUALIDADE: mantém a resolução original (4K continua 4K), CRF 18
//   (visualmente idêntico ao original), sem teto de bitrate. O arquivo pode
//   ficar maior que o HEVC original — é o preço do formato compatível.
// - SEM CÓPIA: o conteúdo do MESMO arquivo do Drive é substituído (mesmo ID,
//   mesmo link — a planilha não muda) e a versão antiga guardada no
//   histórico de revisões do Drive é apagada logo em seguida, pra não ocupar
//   espaço em dobro.
//
// Só mexe no que precisa: cada vídeo é inspecionado direto no Drive (ffprobe
// lê só o cabeçalho via HTTP, sem baixar o arquivo inteiro). Já compatível →
// pula. Arquivos já verificados ganham uma marca invisível no Drive
// (appProperties.empireCompat) e são pulados nas próximas execuções.
//
// Uso: dry-run por padrão (só lista o que seria convertido). DRY_RUN=false
// converte de verdade. LIMIT=<n> limita a N conversões. TARGET=<texto ou ID
// do arquivo> processa só os vídeos cujo título contém o texto (ou com
// aquele ID do Drive), mesmo que já tenham a marca.
import { mkdtempSync, rmSync, createReadStream, createWriteStream, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { google } from "googleapis";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo";
const SHEET_NAME = process.env.SHEET_NAME || "Music Videos";
const DRY_RUN = process.env.DRY_RUN !== "false";
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : undefined;
const TARGET = process.env.TARGET?.trim() || undefined;

const COMPAT_MARK = "empireCompat";

const googleCredsRaw = process.env.GOOGLE_CREDENTIALS_JSON;
const DRIVE_OAUTH_CLIENT_ID = process.env.DRIVE_OAUTH_CLIENT_ID || "";
const DRIVE_OAUTH_CLIENT_SECRET = process.env.DRIVE_OAUTH_CLIENT_SECRET || "";
const DRIVE_OAUTH_REFRESH_TOKEN = process.env.DRIVE_OAUTH_REFRESH_TOKEN || "";
if (!googleCredsRaw) {
  console.error("Faltando GOOGLE_CREDENTIALS_JSON.");
  process.exit(1);
}
if (!DRIVE_OAUTH_CLIENT_ID || !DRIVE_OAUTH_CLIENT_SECRET || !DRIVE_OAUTH_REFRESH_TOKEN) {
  console.error(
    "Faltando DRIVE_OAUTH_CLIENT_ID / DRIVE_OAUTH_CLIENT_SECRET / DRIVE_OAUTH_REFRESH_TOKEN — " +
      "precisa ser a conta dona dos arquivos no Drive pra poder substituí-los.",
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

async function getSheetsAuth() {
  const creds = JSON.parse(googleCredsRaw!);
  return new google.auth.GoogleAuth({
    credentials: { client_email: creds.client_email, private_key: creds.private_key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

function getDriveOAuthClient() {
  const oauth2Client = new google.auth.OAuth2(DRIVE_OAUTH_CLIENT_ID, DRIVE_OAUTH_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: DRIVE_OAUTH_REFRESH_TOKEN });
  return oauth2Client;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => (stdout += c.toString()));
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("error", (err) => reject(new Error(`Falha ao iniciar ${cmd}: ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} saiu com código ${code}:\n${stderr.slice(-2000)}`));
    });
  });
}

type ProbeInfo = {
  videoCodec: string;
  pixFmt: string;
  colorTransfer: string;
  width: number;
  height: number;
  audioCodec: string | null;
};

async function probe(input: string, extraArgs: string[] = []): Promise<ProbeInfo> {
  const out = await run("ffprobe", [
    ...extraArgs,
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,codec_name,pix_fmt,color_transfer,width,height",
    "-of",
    "json",
    input,
  ]);
  const streams: any[] = JSON.parse(out).streams || [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!video) throw new Error("Nenhuma faixa de vídeo encontrada no arquivo.");
  return {
    videoCodec: String(video.codec_name || ""),
    pixFmt: String(video.pix_fmt || ""),
    colorTransfer: String(video.color_transfer || ""),
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    audioCodec: audio ? String(audio.codec_name || "") : null,
  };
}

// Toca em Chrome/Edge/Firefox/Safari em qualquer PC sem extensão: H.264 8-bit
// 4:2:0 e os formatos abertos (VP8/VP9/AV1). HEVC, ProRes, H.264 10-bit,
// MPEG-4 Part 2 etc. não tocam em todo lugar.
function isCompatible(info: ProbeInfo): boolean {
  if (info.videoCodec === "h264") return ["yuv420p", "yuvj420p"].includes(info.pixFmt);
  return ["vp8", "vp9", "av1"].includes(info.videoCodec);
}

function isHdr(info: ProbeInfo): boolean {
  return ["arib-std-b67", "smpte2084"].includes(info.colorTransfer);
}

async function convert(inputPath: string, outputPath: string, info: ProbeInfo): Promise<void> {
  // Mantém a resolução original; só arredonda pra número par (exigência do
  // H.264 4:2:0). Vídeo HDR de iPhone (HLG/PQ) é convertido pra cor normal
  // (SDR) com tone mapping — sem isso as cores ficariam lavadas/acinzentadas.
  const filters = isHdr(info)
    ? "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0," +
      "zscale=t=bt709:m=bt709:r=tv,format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2"
    : "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p";

  const audioArgs =
    info.audioCodec === null
      ? []
      : info.audioCodec === "aac"
        ? ["-c:a", "copy"] // áudio já compatível: copia sem mexer
        : ["-c:a", "aac", "-b:a", "320k"];

  await run("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    filters,
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-preset",
    "slow",
    // CRF 18 = "visualmente sem perdas" no H.264. Sem -maxrate: qualidade
    // máxima, o tamanho fica o que precisar ser.
    "-crf",
    "18",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-colorspace",
    "bt709",
    ...audioArgs,
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

function extractDriveId(value: string): string | null {
  const m = value.match(/[-\w]{25,}/);
  return m ? m[0] : null;
}

async function main() {
  const sheets = google.sheets({ version: "v4", auth: await getSheetsAuth() });
  const oauth = getDriveOAuthClient();
  const drive = google.drive({ version: "v3", auth: oauth });

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:ZZ`,
  });
  const rows = data.values || [];
  if (rows.length < 2) throw new Error(`Aba "${SHEET_NAME}" vazia ou não encontrada.`);

  const header = rows[0].map((h) => normalize(String(h ?? "")));
  const titleCol = header.findIndex((h) => h.includes("titulo do topico") || h.includes("titulo"));
  const fonteCol = header.findIndex((h) => h === "fonte" || h === "arquivo_fonte");
  const linkCols = header
    .map((h, i) => (h.includes("link do video") || h.includes("drive_url") || h.includes("drive url") ? i : -1))
    .filter((i) => i >= 0);
  if (titleCol < 0 || fonteCol < 0 || linkCols.length === 0) {
    throw new Error(
      `Não encontrei as colunas esperadas (título/fonte/Link do vídeo). Cabeçalho: ${rows[0].join(" | ")}`,
    );
  }

  type Item = { title: string; fileId: string };
  const seen = new Set<string>();
  let items: Item[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (normalize(row[fonteCol] || "") !== "drive") continue;
    const link = linkCols.map((c) => (row[c] || "").trim()).find(Boolean) || "";
    const fileId = extractDriveId(link);
    if (!fileId || seen.has(fileId)) continue;
    seen.add(fileId);
    items.push({ title: row[titleCol] || `(linha ${i + 1})`, fileId });
  }

  if (TARGET) {
    const t = normalize(TARGET);
    items = items.filter((it) => it.fileId === TARGET || normalize(it.title).includes(t));
    console.log(`TARGET="${TARGET}": ${items.length} vídeo(s) correspondente(s).`);
  }
  console.log(`${items.length} vídeo(s) do Drive na aba "${SHEET_NAME}".`);
  if (DRY_RUN) console.log("DRY_RUN — nada será alterado, só verificado.\n");

  const workDir = mkdtempSync(join(tmpdir(), "convert-drive-"));
  let converted = 0;
  let alreadyOk = 0;
  let skippedMarked = 0;
  let failed = 0;
  const toConvert: string[] = [];

  try {
    for (const item of items) {
      if (LIMIT !== undefined && converted >= LIMIT) break;
      const tag = `[${item.fileId}] "${item.title}"`;
      try {
        const meta = await drive.files.get({
          fileId: item.fileId,
          fields: "id, name, size, mimeType, appProperties",
        });
        if (!TARGET && meta.data.appProperties?.[COMPAT_MARK]) {
          skippedMarked += 1;
          continue;
        }

        const { token } = await oauth.getAccessToken();
        const info = await probe(`https://www.googleapis.com/drive/v3/files/${item.fileId}?alt=media`, [
          "-headers",
          `Authorization: Bearer ${token}\r\n`,
        ]);
        const sizeMb = (Number(meta.data.size || 0) / 1024 / 1024).toFixed(1);
        const desc = `${info.videoCodec} ${info.pixFmt} ${info.width}x${info.height}${isHdr(info) ? " HDR" : ""}, ${sizeMb} MB`;

        if (isCompatible(info)) {
          console.log(`${tag} ✓ já compatível (${desc})`);
          alreadyOk += 1;
          if (!DRY_RUN) {
            await drive.files.update({
              fileId: item.fileId,
              requestBody: { appProperties: { [COMPAT_MARK]: "original" } },
            });
          }
          continue;
        }

        toConvert.push(`${item.title} (${desc})`);
        if (DRY_RUN) {
          console.log(`${tag} ⚠ PRECISA converter (${desc})`);
          converted += 1;
          continue;
        }

        console.log(`${tag} convertendo (${desc}) — baixando...`);
        const inputPath = join(workDir, `${item.fileId}.in`);
        const outputPath = join(workDir, `${item.fileId}.mp4`);
        try {
          const res = await drive.files.get(
            { fileId: item.fileId, alt: "media" },
            { responseType: "stream" },
          );
          await new Promise<void>((resolve, reject) => {
            const ws = createWriteStream(inputPath);
            (res.data as NodeJS.ReadableStream).pipe(ws);
            ws.on("finish", () => resolve());
            ws.on("error", reject);
            (res.data as NodeJS.ReadableStream).on("error", reject);
          });

          await convert(inputPath, outputPath, info);
          const check = await probe(outputPath);
          if (!isCompatible(check)) throw new Error(`Saída inesperada: ${check.videoCodec} ${check.pixFmt}`);
          const newMb = (statSync(outputPath).size / 1024 / 1024).toFixed(1);
          console.log(`${tag} convertido (${newMb} MB), substituindo no Drive...`);

          const newName = (meta.data.name || item.title).replace(/\.(mov|mkv|m4v|avi|hevc|mp4)$/i, "") + ".mp4";
          await drive.files.update({
            fileId: item.fileId,
            requestBody: { name: newName, mimeType: "video/mp4", appProperties: { [COMPAT_MARK]: "h264" } },
            media: { mimeType: "video/mp4", body: createReadStream(outputPath) },
          });

          // Sem cópia: apaga a versão antiga que o Drive guarda sozinho no
          // histórico de revisões (senão ela ocuparia espaço por até 30 dias).
          const revs = await drive.revisions.list({ fileId: item.fileId, fields: "revisions(id)" });
          const list = revs.data.revisions || [];
          for (const rev of list.slice(0, -1)) {
            if (rev.id) await drive.revisions.delete({ fileId: item.fileId, revisionId: rev.id });
          }

          console.log(`${tag} ✓ pronto (${sizeMb} MB → ${newMb} MB)`);
          converted += 1;
        } finally {
          rmSync(inputPath, { force: true });
          rmSync(outputPath, { force: true });
        }
      } catch (err) {
        console.error(`${tag} ✗ erro: ${err instanceof Error ? err.message : String(err)}`);
        failed += 1;
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  console.log("\n──────── Resumo ────────");
  if (DRY_RUN) {
    console.log(`${toConvert.length} vídeo(s) PRECISAM ser convertidos:`);
    for (const t of toConvert) console.log(`  - ${t}`);
  } else {
    console.log(`${converted} convertido(s).`);
  }
  console.log(`${alreadyOk} já compatível(is). ${skippedMarked} já verificado(s) antes. ${failed} com erro.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
