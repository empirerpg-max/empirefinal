import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";
import { getArtistNamesForOwner } from "./artistasController";

// Ponto vive na planilha "registrosCharts" (a mesma do REGISTRO de audit
// log), aba "PONTOS" — layout confirmado ao vivo. As 3 primeiras linhas são
// cabeçalho (a real fica na linha 3); os dados começam na linha 4.
//
// PONTOS: A jogador | B (não usada) | C ACT (artista) | D MÚSICA | E WEEKS |
//         F PONTOS DISPONÍVEIS | G PONTOS UTILIZADOS | H BILLBOARD HOT 100 |
//         I SPOTIFY | J APPLE MUSIC | K YOUTUBE | L DIGITAL SALES |
//         M BILLBOARD 200 | N (flag, não usada) | O DATA DE LANÇAMENTO
//
// Colunas X-AD são um segundo bloco espelhado (totais calculados/travados
// por outro processo) — este controller nunca lê nem escreve nelas.
//
// Substitui a dependência antiga do Apps Script (acao=ponto_listar_pontos/
// ponto_salvar_celula/ponto_get_jogador).

const SHEET = "PONTOS";
const DATA_START_ROW = 4; // primeira linha real de dados (1-based)

const CATEGORY_COLUMNS: Record<string, number> = {
  "BILLBOARD HOT 100": 7,
  SPOTIFY: 8,
  "APPLE MUSIC": 9,
  YOUTUBE: 10,
  "DIGITAL SALES": 11,
  "BILLBOARD 200": 12,
};

export const CATEGORY_OPTIONS: Record<string, string[]> = {
  "BILLBOARD HOT 100": ["1,00%", "2,00%", "3,00%", "4,00%", "5,00%", "6,00%", "7,00%", "8,00%", "9,00%", "10,00%"],
  SPOTIFY: ["30,00%", "40,00%", "50,00%", "60,00%", "70,00%"],
  "APPLE MUSIC": ["30,00%", "40,00%", "50,00%", "60,00%", "70,00%"],
  YOUTUBE: ["10,00%", "15,00%", "20,00%", "25,00%", "30,00%", "35,00%", "40,00%", "45,00%", "50,00%", "55,00%", "60,00%", "65,00%", "70,00%"],
  "DIGITAL SALES": ["10,00%", "15,00%", "20,00%", "25,00%", "30,00%", "35,00%", "40,00%", "45,00%", "50,00%", "55,00%", "60,00%", "65,00%", "70,00%"],
  "BILLBOARD 200": ["10,00%", "15,00%", "20,00%", "25,00%", "30,00%", "35,00%", "40,00%", "45,00%", "50,00%", "55,00%", "60,00%", "65,00%", "70,00%"],
};

function colIndexToA1Letter(colIndex: number): string {
  let temp = colIndex;
  let letter = "";
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface PontoMusica {
  linha: number;
  artista: string;
  musica: string;
  weeks: string;
  pontosDisponiveis: string;
  pontosUtilizados: string;
  categorias: Record<string, string>;
  dataLancamento: string;
}

function rowToMusica(row: string[], linha: number): PontoMusica {
  const categorias: Record<string, string> = {};
  for (const [nome, col] of Object.entries(CATEGORY_COLUMNS)) {
    categorias[nome] = normalizeText(row[col]);
  }
  return {
    linha,
    artista: normalizeText(row[2]),
    musica: normalizeText(row[3]),
    weeks: normalizeText(row[4]),
    pontosDisponiveis: normalizeText(row[5]),
    pontosUtilizados: normalizeText(row[6]),
    categorias,
    dataLancamento: normalizeText(row[14]),
  };
}

/**
 * GET /api/ponto?telegramId=...
 * Devolve as músicas de todos os artistas do jogador, agrupadas por artista.
 */
export async function getPontosController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const telegramId = normalizeText(url.searchParams.get("telegramId"));
  if (!telegramId) return jsonResponse({ artistas: [], grupos: [] });

  const artistNames = await getArtistNamesForOwner(telegramId);
  if (artistNames.length === 0) return jsonResponse({ artistas: [], grupos: [] });

  const normArtistNames = new Set(artistNames.map(normalizeComparison));
  const rows = await googleSheetsService.registrosCharts.readValues(SHEET);

  const grupos = new Map<string, PontoMusica[]>();
  for (let i = DATA_START_ROW - 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.some((cell) => normalizeText(cell))) continue;
    const artista = normalizeText(row[2]);
    if (!artista || !normArtistNames.has(normalizeComparison(artista))) continue;
    const musica = rowToMusica(row, i + 1);
    if (!grupos.has(artista)) grupos.set(artista, []);
    grupos.get(artista)!.push(musica);
  }

  return jsonResponse({
    artistas: artistNames,
    grupos: Array.from(grupos.entries()).map(([artista, musicas]) => ({ artista, musicas })),
  });
}

/**
 * POST /api/ponto/salvar
 * Grava a % escolhida numa categoria — só permitido se a música for de um
 * artista do próprio jogador (telegramId), e só com uma das opções válidas
 * pra aquela categoria (nunca um valor arbitrário vindo do cliente).
 */
export async function salvarPontoCelulaController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    telegramId?: string;
    linha?: number;
    coluna?: string;
    valor?: string;
  };
  const { telegramId, linha, coluna, valor } = body;

  if (!telegramId || !linha || linha < DATA_START_ROW || !coluna || !valor) {
    return jsonResponse({ ok: false, error: "Parâmetros inválidos." }, 400);
  }

  const colIndex = CATEGORY_COLUMNS[coluna];
  if (colIndex === undefined) {
    return jsonResponse({ ok: false, error: "Categoria inválida." }, 400);
  }
  if (!CATEGORY_OPTIONS[coluna].includes(valor)) {
    return jsonResponse({ ok: false, error: "Valor não permitido pra essa categoria." }, 400);
  }

  const artistNames = await getArtistNamesForOwner(telegramId);
  if (artistNames.length === 0) {
    return jsonResponse({ ok: false, error: "Nenhum artista vinculado a esse jogador." }, 403);
  }

  const rowCells = await googleSheetsService.registrosCharts.readValues(SHEET, `A${linha}:D${linha}`);
  const artistaDaLinha = normalizeText(rowCells?.[0]?.[2]);
  const normArtistNames = new Set(artistNames.map(normalizeComparison));
  if (!artistaDaLinha || !normArtistNames.has(normalizeComparison(artistaDaLinha))) {
    return jsonResponse({ ok: false, error: "Essa música não pertence a um artista seu." }, 403);
  }

  const colLetter = colIndexToA1Letter(colIndex);
  await googleSheetsService.registrosCharts.updateValues(SHEET, `${colLetter}${linha}`, [[valor]]);

  return jsonResponse({ ok: true });
}
