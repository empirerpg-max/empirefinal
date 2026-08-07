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
  console.log(`${lowConfidence.length} sem correspondência confiável (antes do casamento por ordem).`);

  // --- Passo 3: casamento por ordem cronológica ---
  // A ordem das linhas na planilha segue a mesma ordem das mensagens no
  // Telegram (o vídeo é enviado poucos segundos depois de o tópico ser
  // criado). Usamos as correspondências já confirmadas como "âncoras" e
  // preenchemos os vídeos entre duas âncoras na mesma ordem, mas só quando
  // a quantidade de linhas vazias bate exatamente com a quantidade de
  // mensagens de vídeo disponíveis naquele intervalo — senão fica sem
  // corresponder, pra não arriscar errar.

  type TgRow = { rowIndex: number; sheetRow: number; title: string; existingId: string | null };
  const finalId = new Map<number, string>(); // rowIndex -> id (após passos 1 e 2)
  for (const u of updates) {
    const m = u.range.match(/(\d+)$/);
    if (m) finalId.set(Number(m[1]) - 1, u.values[0][0]);
  }

  const tgRows: TgRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (normalize(row[fonteCol] || "") !== "telegram") continue;
    const id = finalId.get(i) ?? (row[idMensagemCol] || null);
    tgRows.push({ rowIndex: i, sheetRow: i + 1, title: row[titleCol] || "", existingId: id });
  }

  // Só olhamos linhas com ID numérico válido pra montar as âncoras.
  const withId = tgRows
    .map((r, idx) => ({ ...r, order: idx, id: r.existingId && /^\d+$/.test(r.existingId) ? Number(r.existingId) : null }))
    .filter((r): r is TgRow & { order: number; id: number } => r.id !== null);

  // Maior subsequência estritamente crescente de IDs (na ordem das linhas).
  const tails: number[] = [];
  const tailsRowIdx: number[] = [];
  const prevOf: number[] = new Array(withId.length).fill(-1);
  for (let i = 0; i < withId.length; i++) {
    const v = withId[i].id;
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = v;
    tailsRowIdx[lo] = i;
    prevOf[i] = lo > 0 ? tailsRowIdx[lo - 1] : -1;
  }
  const lisIndexes = new Set<number>();
  let k = tailsRowIdx[tailsRowIdx.length - 1];
  while (k !== undefined && k !== -1) {
    lisIndexes.add(k);
    k = prevOf[k];
  }

  const idCounts = new Map<number, number>();
  for (const r of withId) idCounts.set(r.id, (idCounts.get(r.id) || 0) + 1);

  // IDs "reservados" (não disponíveis pra preencher lacunas): qualquer ID já
  // usado por alguma linha, seja âncora confiável ou não.
  const reserved = new Set<number>(withId.map((r) => r.id));

  const clearUpdates: { range: string; values: string[][] }[] = [];
  const anchors: { rowIndex: number; id: number }[] = [];
  withId.forEach((r, idx) => {
    const isDuplicate = (idCounts.get(r.id) || 0) > 1;
    if (lisIndexes.has(idx)) {
      anchors.push({ rowIndex: r.rowIndex, id: r.id });
    } else if (isDuplicate) {
      // ID duplicado e essa ocorrência não é a que se encaixa na ordem
      // cronológica → provavelmente foi atribuída errada. Limpa.
      const colLetter = String.fromCharCode(65 + idMensagemCol);
      clearUpdates.push({ range: `${SHEET_NAME}!${colLetter}${r.sheetRow}`, values: [[""]] });
      reserved.delete(r.id); // libera pro casamento por ordem, se sobrar sem dono
      console.log(`✗ "${r.title}" tinha ID duplicado (${r.id}, já usado por outra linha em posição mais coerente) — removido.`);
    }
    // se não é duplicado e não está na LIS: mantém como está (é um vídeo
    // repetido no arquivo do Telegram, conteúdo correto, só não bate a
    // ordem — sem problema).
  });

  const clearedRowIndexes = new Set(clearUpdates.map((u) => Number(u.range.match(/(\d+)$/)![1]) - 1));

  const candidatesById = new Map(candidates.map((c) => [c.id, c] as const));
  const sortedCandidateIds = [...candidatesById.keys()].sort((a, b) => a - b);

  let ordinalMatched = 0;
  const ordinalUnmatched: string[] = [];

  for (let a = 0; a < anchors.length - 1; a++) {
    const [prev, next] = [anchors[a], anchors[a + 1]];
    const gapRows = tgRows.filter(
      (r) =>
        r.rowIndex > prev.rowIndex &&
        r.rowIndex < next.rowIndex &&
        (clearedRowIndexes.has(r.rowIndex) || !r.existingId)
    );
    if (gapRows.length === 0) continue;

    const gapCandidateIds = sortedCandidateIds.filter((id) => id > prev.id && id < next.id && !reserved.has(id));

    if (gapRows.length === gapCandidateIds.length) {
      for (let g = 0; g < gapRows.length; g++) {
        const id = gapCandidateIds[g];
        reserved.add(id);
        const colLetter = String.fromCharCode(65 + idMensagemCol);
        updates.push({ range: `${SHEET_NAME}!${colLetter}${gapRows[g].sheetRow}`, values: [[String(id)]] });
        ordinalMatched += 1;
        console.log(`⇢ [ordem] "${gapRows[g].title}" -> mensagem ${id}`);
      }
    } else {
      for (const r of gapRows) ordinalUnmatched.push(r.title);
      console.log(
        `? Intervalo entre linha ${prev.rowIndex + 1} (id ${prev.id}) e linha ${next.rowIndex + 1} (id ${next.id}): ${gapRows.length} linha(s) sem vídeo x ${gapCandidateIds.length} vídeo(s) disponível(is) — não bate, deixado sem correspondência.`
      );
    }
  }

  for (const u of clearUpdates) updates.push(u);

  console.log(`\n${ordinalMatched} casados por ordem cronológica.`);
  console.log(`${ordinalUnmatched.length} ainda sem correspondência confiável (contagem não bateu no intervalo).`);
  if (ordinalUnmatched.length) {
    console.log("Sem correspondência (contagem não bateu):");
    for (const title of ordinalUnmatched) console.log(`  - ${title}`);
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
