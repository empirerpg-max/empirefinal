// Casa as linhas da aba "Music Videos" com as mensagens de vídeo do grupo
// de arquivo do Telegram (pra onde tudo foi encaminhado), usando dois
// exports locais (Telegram Desktop → Exportar histórico do chat → JSON):
//   - TELEGRAM_EXPORT_PATH: o grupo de arquivo (o que o bot realmente lê
//     pra tocar os vídeos — os IDs que vão na planilha são de lá).
//   - SOURCE_EXPORT_PATH: o grupo original, onde os nomes de arquivo e as
//     legendas costumam bater melhor com o título do tópico. Serve só
//     pra achar a correspondência; o ID final gravado é sempre do grupo
//     de arquivo (via nome do arquivo, que se mantém igual ao encaminhar).
//
// Passos, em ordem de confiança:
//   1) Descrição da planilha == legenda da mensagem no grupo de arquivo
//      (quase certeza).
//   2) Título do tópico ~= legenda/nome do arquivo no grupo de arquivo
//      (fallback mais fraco).
//   3) Ordem cronológica: a ordem das linhas na planilha segue a mesma
//      ordem das mensagens no grupo de arquivo (vídeo enviado poucos
//      segundos após o tópico ser criado) — preenche lacunas entre
//      pontos já confirmados, só quando a contagem bate exatamente.
//   4) Título do tópico ~= legenda/nome do arquivo no grupo ORIGINAL,
//      resolvendo pro ID correspondente no grupo de arquivo via nome de
//      arquivo (usa uma cópia ainda não usada, já que o grupo de arquivo
//      tem vídeos duplicados).
import { readFileSync } from "node:fs";
import { google } from "googleapis";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo";
const SHEET_NAME = process.env.SHEET_NAME || "Music Videos";
const EXPORT_PATH = process.env.TELEGRAM_EXPORT_PATH || "data/telegram-export.json";
const SOURCE_EXPORT_PATH = process.env.SOURCE_EXPORT_PATH || "data/telegram-source-export.json";
const DRY_RUN = process.env.DRY_RUN === "true";
const DESCRICAO_THRESHOLD = 0.85;
const TITLE_FALLBACK_THRESHOLD = 0.55;
const SOURCE_TITLE_THRESHOLD = 0.5;

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

// Coeficiente de sobreposição (intersection / menor conjunto): melhor que
// Jaccard pra comparar um título curto contra uma legenda bem mais longa
// (ex.: "SA5M - new face" vs "new face\nstarring: SA5M, Denver\ndirected
// by: melina matsoukas") — o Jaccard penaliza demais as palavras extras
// da legenda; o overlap não.
function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  return intersection / Math.min(a.size, b.size);
}

type ExportMessage = {
  id: number;
  media_type?: string;
  text?: string | Array<string | { type: string; text: string }>;
  file_name?: string;
};

type Candidate = { id: number; text: string; tokens: Set<string>; fileNameNorm: string };

function extractText(message: ExportMessage): string {
  if (typeof message.text === "string") return message.text;
  if (!Array.isArray(message.text)) return "";
  return message.text.map((part) => (typeof part === "string" ? part : part.text)).join("");
}

function loadCandidates(path: string): Candidate[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { messages: ExportMessage[] };
  const candidates: Candidate[] = [];
  for (const message of raw.messages) {
    if (message.media_type !== "video_file") continue;
    const fileName = message.file_name || "";
    const text = [extractText(message), fileName].filter(Boolean).join(" ");
    if (!text.trim()) continue;
    candidates.push({ id: message.id, text, tokens: tokenSet(text), fileNameNorm: fileName.trim().toLowerCase() });
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
  const candidates = loadCandidates(EXPORT_PATH);
  console.log(`${candidates.length} mensagens com vídeo no export do grupo de arquivo.`);

  let sourceCandidates: Candidate[] = [];
  try {
    sourceCandidates = loadCandidates(SOURCE_EXPORT_PATH);
    console.log(`${sourceCandidates.length} mensagens com vídeo no export do grupo original.`);
  } catch {
    console.log("Sem export do grupo original (SOURCE_EXPORT_PATH não encontrado) — pulando passo 4.");
  }

  const sheets = await getSheetsClient();
  const range = `${SHEET_NAME}!A:Z`;
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const rows = data.values || [];
  if (rows.length < 2) throw new Error(`Aba "${SHEET_NAME}" vazia ou não encontrada.`);

  const header = rows[0].map((h) => normalize(String(h)));

  if (process.env.DEBUG_HEADER === "true") {
    console.log("\n--- DEBUG_HEADER ---");
    rows[0].forEach((h: string, i: number) => console.log(i, String.fromCharCode(65 + i), JSON.stringify(h)));
    console.log("--- coluna C (idx 2) x coluna L (idx 11) pra cada linha telegram ---");
    for (let i = 1; i < rows.length; i++) {
      if (normalize(rows[i][10] || "") !== "telegram") continue;
      console.log(`row=${i + 1} title=${JSON.stringify(rows[i][1] || "")} C=${JSON.stringify(rows[i][2] || "")} L=${JSON.stringify(rows[i][11] || "")}`);
    }
    console.log("--- índice calculado pelo findIndex ---");
    console.log("titleCol calc:", header.findIndex((h) => h.includes("titulo do topico") || h.includes("titulo")));
    console.log("idMensagemCol calc:", header.findIndex((h) => h.includes("id da mensagem")));
    console.log("--- FIM DEBUG_HEADER ---\n");
    return;
  }

  const titleCol = header.findIndex((h) => h.includes("titulo do topico") || h.includes("titulo"));
  const fonteCol = header.findIndex((h) => h === "fonte");
  const idMensagemCol = header.findIndex((h) => h.includes("id da mensagem"));
  const descricaoCol = header.findIndex((h) => h.includes("descricao"));
  if (titleCol < 0 || fonteCol < 0 || idMensagemCol < 0 || descricaoCol < 0) {
    throw new Error(
      `Não encontrei as colunas esperadas (título/fonte/ID da mensagem/descrição). Cabeçalho: ${rows[0].join(" | ")}`
    );
  }
  const colLetter = String.fromCharCode(65 + idMensagemCol);

  // Estado compartilhado por todas as etapas: id atual de cada linha
  // (índice na array `rows`) e quais IDs do grupo de arquivo já estão em uso.
  const currentId = new Map<number, string>();
  for (let i = 1; i < rows.length; i++) {
    if (normalize(rows[i][fonteCol] || "") !== "telegram") continue;
    const v = rows[i][idMensagemCol];
    if (v) currentId.set(i, v);
  }
  const usedArchiveIds = new Set<number>(
    [...currentId.values()].filter((v) => /^\d+$/.test(v)).map((v) => Number(v))
  );
  const updates: { range: string; values: string[][] }[] = [];

  function assign(rowIndex: number, id: number, label: string) {
    currentId.set(rowIndex, String(id));
    usedArchiveIds.add(id);
    const sheetRow = rowIndex + 1;
    updates.push({ range: `${SHEET_NAME}!${colLetter}${sheetRow}`, values: [[String(id)]] });
    console.log(`${label} -> mensagem ${id}`);
  }
  function clear(rowIndex: number, id: number, reason: string) {
    currentId.delete(rowIndex);
    usedArchiveIds.delete(id);
    const sheetRow = rowIndex + 1;
    updates.push({ range: `${SHEET_NAME}!${colLetter}${sheetRow}`, values: [[""]] });
    console.log(`✗ ${reason}`);
  }

  const findBest = (tokens: Set<string>, pool: Candidate[], exclude: (id: number) => boolean) => {
    let best: { candidate: Candidate; score: number } | null = null;
    for (const candidate of pool) {
      if (exclude(candidate.id)) continue;
      const score = jaccard(tokens, candidate.tokens);
      if (score > (best?.score ?? 0)) best = { candidate, score };
    }
    return best;
  };

  // --- Passo 1 e 2: Descrição (alta confiança) e título (fallback) ---
  let exact = 0;
  let fallback = 0;
  let corrected = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (normalize(row[fonteCol] || "") !== "telegram") continue;
    const title = row[titleCol] || "";
    const descricao = row[descricaoCol] || "";
    const existingId = currentId.get(i) || null;
    const ownId = existingId && /^\d+$/.test(existingId) ? Number(existingId) : null;
    const isUsedByAnother = (id: number) => usedArchiveIds.has(id) && id !== ownId;

    let best: { candidate: Candidate; score: number } | null = null;
    let viaDescricao = false;
    if (descricao.trim()) {
      best = findBest(tokenSet(descricao), candidates, isUsedByAnother);
      viaDescricao = true;
    }
    if ((!best || best.score < DESCRICAO_THRESHOLD) && title.trim()) {
      const titleBest = findBest(tokenSet(title), candidates, isUsedByAnother);
      if (titleBest && (!best || titleBest.score > best.score)) {
        best = titleBest;
        viaDescricao = false;
      }
    }

    const threshold = viaDescricao ? DESCRICAO_THRESHOLD : TITLE_FALLBACK_THRESHOLD;
    if (!best || best.score < threshold) continue;

    if (ownId !== null && best.candidate.id !== ownId) {
      // se o próprio candidato atual empata (ex.: legenda duplicada em
      // outra mensagem), não troca por um "achado" que não é melhor.
      const ownCandidate = candidates.find((c) => c.id === ownId);
      if (ownCandidate) {
        const ownScore = jaccard(viaDescricao ? tokenSet(descricao) : tokenSet(title), ownCandidate.tokens);
        if (ownScore >= best.score) continue;
      }
    }

    const newId = best.candidate.id;
    if (existingId && Number(existingId) === newId) continue; // já está certo
    if (existingId && Number(existingId) !== newId && !(viaDescricao && best.score >= DESCRICAO_THRESHOLD)) {
      continue; // só corrige valor já preenchido com evidência de alta confiança
    }

    if (existingId && Number(existingId) !== newId) {
      corrected += 1;
      assign(i, newId, `↻ [${best.score.toFixed(2)}] "${title}" corrigido: ${existingId}`);
    } else if (viaDescricao) {
      exact += 1;
      assign(i, newId, `✓ [desc ${best.score.toFixed(2)}] "${title}"`);
    } else {
      fallback += 1;
      assign(i, newId, `~ [título ${best.score.toFixed(2)}] "${title}"`);
    }
  }
  console.log(
    `\n${exact} casados por Descrição, ${fallback} por título (grupo de arquivo), ${corrected} corrigidos.`
  );

  // --- Passo 3: ordem cronológica ---
  // A ordem das linhas na planilha segue a mesma ordem das mensagens no
  // grupo de arquivo. Usamos as correspondências já confirmadas como
  // âncoras e preenchemos os vídeos entre duas âncoras na mesma ordem,
  // só quando a quantidade de linhas vazias bate exatamente com a
  // quantidade de mensagens de vídeo disponíveis no intervalo.

  type TgRow = { rowIndex: number; sheetRow: number; title: string };
  const tgRows: TgRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (normalize(rows[i][fonteCol] || "") !== "telegram") continue;
    tgRows.push({ rowIndex: i, sheetRow: i + 1, title: rows[i][titleCol] || "" });
  }

  const withId = tgRows
    .map((r) => ({ ...r, id: currentId.has(r.rowIndex) ? Number(currentId.get(r.rowIndex)) : null }))
    .filter((r): r is TgRow & { id: number } => r.id !== null);

  const tails: number[] = [];
  const tailsRowIdx: number[] = [];
  const prevOf: number[] = new Array(withId.length).fill(-1);
  for (let i = 0; i < withId.length; i++) {
    const v = withId[i].id;
    let lo = 0,
      hi = tails.length;
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

  const anchors: { rowIndex: number; id: number }[] = [];
  withId.forEach((r, idx) => {
    const isDuplicate = (idCounts.get(r.id) || 0) > 1;
    if (lisIndexes.has(idx)) {
      anchors.push({ rowIndex: r.rowIndex, id: r.id });
    } else if (isDuplicate) {
      clear(r.rowIndex, r.id, `"${r.title}" tinha ID duplicado (${r.id}, já usado por outra linha em posição mais coerente) — removido.`);
    }
    // se não é duplicado e não está na ordem: mantém (é um vídeo repetido
    // no arquivo, conteúdo correto, só não bate a ordem).
  });

  const sortedArchiveIds = candidates.map((c) => c.id).sort((a, b) => a - b);
  let ordinalMatched = 0;
  const gapMismatches: string[] = [];

  for (let a = 0; a < anchors.length - 1; a++) {
    const [prev, next] = [anchors[a], anchors[a + 1]];
    const gapRows = tgRows.filter(
      (r) => r.rowIndex > prev.rowIndex && r.rowIndex < next.rowIndex && !currentId.has(r.rowIndex)
    );
    if (gapRows.length === 0) continue;

    const gapCandidateIds = sortedArchiveIds.filter((id) => id > prev.id && id < next.id && !usedArchiveIds.has(id));

    if (gapRows.length === gapCandidateIds.length) {
      for (let g = 0; g < gapRows.length; g++) {
        assign(gapRows[g].rowIndex, gapCandidateIds[g], `⇢ [ordem] "${gapRows[g].title}"`);
        ordinalMatched += 1;
      }
    } else {
      gapMismatches.push(
        `Intervalo entre linha ${prev.rowIndex + 1} (id ${prev.id}) e linha ${next.rowIndex + 1} (id ${next.id}): ${gapRows.length} linha(s) sem vídeo x ${gapCandidateIds.length} vídeo(s) disponível(is).`
      );
    }
  }
  console.log(`${ordinalMatched} casados por ordem cronológica.`);

  // --- Passo 4: grupo original (legenda/nome do arquivo mais parecido
  // com o título), resolvendo pro ID do grupo de arquivo via nome de
  // arquivo (usa uma cópia ainda não usada). Usa coeficiente de
  // sobreposição em vez de Jaccard, porque o título da planilha é bem
  // mais curto que a legenda original (ex.: "SA5M - new face" vs "new
  // face\nstarring: SA5M, Denver\ndirected by: melina matsoukas") — e
  // exige pelo menos 2 palavras em comum, pra não bater por coincidência
  // de uma palavra só (ex. "TED" aparecendo em qualquer legenda). ---
  const SOURCE_MIN_OVERLAP_WORDS = 2;
  let sourceMatched = 0;
  const sourceConflicts: string[] = [];
  if (sourceCandidates.length > 0) {
    const archiveByFilename = new Map<string, number[]>();
    for (const c of candidates) {
      if (!c.fileNameNorm) continue;
      const list = archiveByFilename.get(c.fileNameNorm) || [];
      list.push(c.id);
      archiveByFilename.set(c.fileNameNorm, list);
    }

    const findBestOverlap = (tokens: Set<string>, exclude: Set<Candidate>) => {
      let best: { candidate: Candidate; score: number } | null = null;
      for (const c of sourceCandidates) {
        if (exclude.has(c)) continue;
        let shared = 0;
        for (const t of tokens) if (c.tokens.has(t)) shared += 1;
        if (shared < SOURCE_MIN_OVERLAP_WORDS) continue;
        const score = shared / Math.min(tokens.size, c.tokens.size);
        if (score > (best?.score ?? 0)) best = { candidate: c, score };
      }
      return best;
    };

    const sourceUsed = new Set<Candidate>();
    for (const r of tgRows) {
      if (currentId.has(r.rowIndex)) continue;
      if (!r.title.trim()) continue;

      const pick = findBestOverlap(tokenSet(r.title), sourceUsed);
      if (!pick || pick.score < SOURCE_TITLE_THRESHOLD) continue;

      const archiveIds = (archiveByFilename.get(pick.candidate.fileNameNorm) || []).filter(
        (id) => !usedArchiveIds.has(id)
      );
      if (archiveIds.length === 0) {
        sourceConflicts.push(
          `"${r.title}" bateu com o vídeo original "${pick.candidate.fileNameNorm}" [${pick.score.toFixed(2)}], mas não sobrou nenhuma cópia livre no grupo de arquivo.`
        );
        continue;
      }

      sourceUsed.add(pick.candidate);
      assign(r.rowIndex, archiveIds[0], `⟲ [original ${pick.score.toFixed(2)}] "${r.title}"`);
      sourceMatched += 1;
    }
  }
  console.log(`${sourceMatched} casados via grupo original.`);

  const stillUnmatched = tgRows.filter((r) => !currentId.has(r.rowIndex));
  console.log(`\n${stillUnmatched.length} linhas ainda sem correspondência confiável.`);
  if (gapMismatches.length) {
    console.log("\nIntervalos onde a contagem não bateu (casamento por ordem):");
    for (const line of gapMismatches) console.log(`  ? ${line}`);
  }
  if (sourceConflicts.length) {
    console.log("\nBateu com o grupo original mas sem cópia livre no grupo de arquivo:");
    for (const line of sourceConflicts) console.log(`  ! ${line}`);
  }
  if (stillUnmatched.length) {
    console.log("\nSem correspondência:");
    for (const r of stillUnmatched) console.log(`  - ${r.title}`);
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
