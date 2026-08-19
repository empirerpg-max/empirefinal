import { googleSheetsService, normalizeText, ensureSheetTab } from "../services/googleSheetsService";

// Menu Acervo — revistas (galeria de páginas) e entrevistas (perguntas e
// respostas em texto), publicadas pelos próprios jogadores pra seus
// artistas. Mesma planilha "usuarios" já usada por Social/Usuários, em
// abas próprias:
//
// ACERVO_REVISTAS:   A id | B artista | C titulo | D capa | E paginas (JSON array de URLs) | F data | G telegram_id
// ACERVO_ENTREVISTAS: A id | B artista | C titulo | D capa | E perguntas (JSON array de {pergunta,resposta}) | F data | G telegram_id

const SHEETS = {
  revistas: "ACERVO_REVISTAS",
  entrevistas: "ACERVO_ENTREVISTAS",
} as const;

function genId(prefix: string): string {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${prefix}-${rand}`;
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
    tgId?: string;
  };

  const artista = (body.artista || "").trim();
  const titulo = (body.titulo || "").trim();
  const paginas = (body.paginas || []).filter(Boolean);

  if (!artista || !titulo || paginas.length === 0) {
    return jsonResponse({ ok: false, error: "Artista, título e ao menos 1 página são obrigatórios." }, 400);
  }

  await ensureSheetTab("usuarios", SHEETS.revistas);
  const existing = await googleSheetsService.usuarios.readValues(SHEETS.revistas).catch(() => []);
  if (!existing || existing.length === 0) {
    await googleSheetsService.usuarios.updateValues(SHEETS.revistas, "A1:G1", [
      ["ID", "Artista", "Título", "Capa", "Páginas", "Data", "Telegram ID"],
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
  ]);

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
    tgId?: string;
  };

  const artista = (body.artista || "").trim();
  const titulo = (body.titulo || "").trim();
  const perguntas = (body.perguntas || []).filter((p) => p?.pergunta?.trim() && p?.resposta?.trim());

  if (!artista || !titulo || perguntas.length === 0) {
    return jsonResponse(
      { ok: false, error: "Artista, título e ao menos 1 pergunta/resposta são obrigatórios." },
      400,
    );
  }

  await ensureSheetTab("usuarios", SHEETS.entrevistas);
  const existing = await googleSheetsService.usuarios.readValues(SHEETS.entrevistas).catch(() => []);
  if (!existing || existing.length === 0) {
    await googleSheetsService.usuarios.updateValues(SHEETS.entrevistas, "A1:G1", [
      ["ID", "Artista", "Título", "Capa", "Perguntas", "Data", "Telegram ID"],
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
  ]);

  return jsonResponse({ ok: true, id });
}
