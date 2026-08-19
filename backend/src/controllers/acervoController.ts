import { googleSheetsService, normalizeText, normalizeComparison, dedupeHeaders, normalizeHeader, ensureSheetTab } from "../services/googleSheetsService";
import { registrarAuditLog } from "./registroLogController";

// Menu Acervo — revistas (galeria de páginas) e entrevistas (perguntas e
// respostas em texto), publicadas pelos próprios jogadores pra seus
// artistas. Mesma planilha "usuarios" já usada por Social/Usuários, em
// abas próprias:
//
// ACERVO_REVISTAS:    A id | B artista | C titulo | D capa | E paginas (JSON array de URLs) | F data | G telegram_id | H musicas (JSON array de "Artista - Título")
// ACERVO_ENTREVISTAS: A id | B artista | C titulo | D capa | E perguntas (JSON array de {pergunta,resposta}) | F data | G telegram_id | H musicas (JSON array de "Artista - Título")
//
// Cada revista/entrevista precisa estar vinculada a pelo menos 1 música do
// chart do artista — ao publicar, grava 1 linha em REGISTRO (planilha
// registrosCharts, mesma que os pontos diários leem) por música
// selecionada, coluna C = nome da música, D = tipo fixo conforme o tipo de
// conteúdo (confirmado pelo usuário).
const REGISTRO_TIPO_REVISTA = "ESPECIAIS (CAPA DE REVISTA, REVIEWS, PHOTOSHOOTS)";
const REGISTRO_TIPO_ENTREVISTA = "ENTREVISTAS (VÍDEOS, DESCRITIVA)";

const SHEETS = {
  revistas: "ACERVO_REVISTAS",
  entrevistas: "ACERVO_ENTREVISTAS",
} as const;

function genId(prefix: string): string {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${prefix}-${rand}`;
}

// Nome "oficial" do jogador (coluna A da aba Usuários) — mesmo padrão do
// forumController, pra REGISTRO nunca sair com o nome de login errado.
async function resolveNomeOficial(telegramId: string, fallback: string): Promise<string> {
  try {
    const rows = await googleSheetsService.usuarios.readValues("Usuários");
    if (!rows || rows.length < 2) return fallback;
    const headers = dedupeHeaders(
      "Usuários",
      rows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
    );
    const nomeCol = headers.indexOf("nome");
    const idCol = headers.indexOf("id");
    if (nomeCol === -1 || idCol === -1) return fallback;
    const normId = normalizeComparison(telegramId);
    const match = rows.slice(1).find((r) => normalizeComparison(r[idCol]) === normId);
    const nome = match ? normalizeText(match[nomeCol]) : "";
    return nome || fallback;
  } catch (err) {
    console.warn("[acervoController] Falha ao resolver nome oficial:", err);
    return fallback;
  }
}

// Grava 1 linha em REGISTRO por música selecionada — nunca falha a
// publicação por causa disso (mesma filosofia de registrarAuditLog).
async function registrarMusicasNoRegistro(
  musicas: string[],
  telegramId: string,
  artistaFallback: string,
  tipo: string,
): Promise<void> {
  const nomeJogador = await resolveNomeOficial(telegramId, artistaFallback);
  for (const musica of musicas) {
    try {
      await registrarAuditLog({ nomeJogador, titulo: musica, tipo });
    } catch (err) {
      console.warn("[acervoController] Erro ao gravar música em REGISTRO:", musica, err);
    }
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readRows(sheet: string): Promise<string[][]> {
  const rows = await googleSheetsService.usuarios.readValues(sheet);
  return rows.slice(1).filter((row) => row.some((cell) => normalizeText(cell)));
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// -------------------- REVISTAS --------------------

export async function getAcervoRevistasController(): Promise<Response> {
  const rows = await readRows(SHEETS.revistas);
  const revistas = rows
    .map((row) => ({
      id: normalizeText(row[0]),
      artista: normalizeText(row[1]),
      titulo: normalizeText(row[2]),
      capa: normalizeText(row[3]) || undefined,
      paginas: parseJsonArray<string>(row[4]),
      data: normalizeText(row[5]),
      telegram_id: normalizeText(row[6]) || undefined,
      musicas: parseJsonArray<string>(row[7]),
    }))
    .filter((r) => r.id);

  revistas.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
  return jsonResponse(revistas);
}

export async function createAcervoRevistaController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    artista?: string;
    titulo?: string;
    capa?: string;
    paginas?: string[];
    musicas?: string[];
    tgId?: string;
  };

  const artista = (body.artista || "").trim();
  const titulo = (body.titulo || "").trim();
  const paginas = (body.paginas || []).filter(Boolean);
  const musicas = (body.musicas || []).filter(Boolean);

  if (!artista || !titulo || paginas.length === 0) {
    return jsonResponse({ ok: false, error: "Artista, título e ao menos 1 página são obrigatórios." }, 400);
  }
  if (musicas.length === 0) {
    return jsonResponse({ ok: false, error: "Selecione ao menos 1 música do chart pra essa revista." }, 400);
  }

  await ensureSheetTab("usuarios", SHEETS.revistas);
  const existing = await googleSheetsService.usuarios.readValues(SHEETS.revistas).catch(() => []);
  if (!existing || existing.length === 0) {
    await googleSheetsService.usuarios.updateValues(SHEETS.revistas, "A1:H1", [
      ["ID", "Artista", "Título", "Capa", "Páginas", "Data", "Telegram ID", "Músicas"],
    ]);
  }

  const id = genId("REVISTA");
  await googleSheetsService.usuarios.appendRow(SHEETS.revistas, [
    id,
    artista,
    titulo,
    body.capa || paginas[0] || "",
    JSON.stringify(paginas),
    new Date().toISOString(),
    body.tgId || "",
    JSON.stringify(musicas),
  ]);

  // Precisa ser aguardado (não fire-and-forget) — no Cloudflare Workers uma
  // promise não aguardada pode ser cortada assim que a Response é
  // devolvida, e essas linhas em REGISTRO são o motivo inteiro desse pedido.
  await registrarMusicasNoRegistro(musicas, body.tgId || "", artista, REGISTRO_TIPO_REVISTA);

  return jsonResponse({ ok: true, id });
}

// -------------------- ENTREVISTAS --------------------

export interface EntrevistaPergunta {
  pergunta: string;
  resposta: string;
}

export async function getAcervoEntrevistasController(): Promise<Response> {
  const rows = await readRows(SHEETS.entrevistas);
  const entrevistas = rows
    .map((row) => ({
      id: normalizeText(row[0]),
      artista: normalizeText(row[1]),
      titulo: normalizeText(row[2]),
      capa: normalizeText(row[3]) || undefined,
      perguntas: parseJsonArray<EntrevistaPergunta>(row[4]),
      data: normalizeText(row[5]),
      telegram_id: normalizeText(row[6]) || undefined,
      musicas: parseJsonArray<string>(row[7]),
    }))
    .filter((e) => e.id);

  entrevistas.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
  return jsonResponse(entrevistas);
}

export async function createAcervoEntrevistaController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    artista?: string;
    titulo?: string;
    capa?: string;
    perguntas?: EntrevistaPergunta[];
    musicas?: string[];
    tgId?: string;
  };

  const artista = (body.artista || "").trim();
  const titulo = (body.titulo || "").trim();
  const perguntas = (body.perguntas || []).filter((p) => p?.pergunta?.trim() && p?.resposta?.trim());
  const musicas = (body.musicas || []).filter(Boolean);

  if (!artista || !titulo || perguntas.length === 0) {
    return jsonResponse(
      { ok: false, error: "Artista, título e ao menos 1 pergunta/resposta são obrigatórios." },
      400,
    );
  }
  if (musicas.length === 0) {
    return jsonResponse({ ok: false, error: "Selecione ao menos 1 música do chart pra essa entrevista." }, 400);
  }

  await ensureSheetTab("usuarios", SHEETS.entrevistas);
  const existing = await googleSheetsService.usuarios.readValues(SHEETS.entrevistas).catch(() => []);
  if (!existing || existing.length === 0) {
    await googleSheetsService.usuarios.updateValues(SHEETS.entrevistas, "A1:H1", [
      ["ID", "Artista", "Título", "Capa", "Perguntas", "Data", "Telegram ID", "Músicas"],
    ]);
  }

  const id = genId("ENTREVISTA");
  await googleSheetsService.usuarios.appendRow(SHEETS.entrevistas, [
    id,
    artista,
    titulo,
    body.capa || "",
    JSON.stringify(perguntas.map((p) => ({ pergunta: p.pergunta.trim(), resposta: p.resposta.trim() }))),
    new Date().toISOString(),
    body.tgId || "",
    JSON.stringify(musicas),
  ]);

  await registrarMusicasNoRegistro(musicas, body.tgId || "", artista, REGISTRO_TIPO_ENTREVISTA);

  return jsonResponse({ ok: true, id });
}
