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

export function colIndexToA1Letter(colIndex: number): string {
  let temp = colIndex;
  let letter = "";
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

export function jsonResponse(body: unknown, status = 200): Response {
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

  const rows = await googleSheetsService.registrosCharts.readValues(SHEET);

  // Mapa normalizado → nome canônico (o da aba ARTISTAS), pra agrupar
  // corretamente mesmo se o texto na aba PONTOS variar de maiúscula/acento.
  const canonicalByNorm = new Map(artistNames.map((nome) => [normalizeComparison(nome), nome]));

  // Começa com TODOS os artistas do jogador (mesmo sem nenhuma música ainda
  // na aba PONTOS), pra sempre aparecerem na lista/carrossel do app.
  const grupos = new Map<string, PontoMusica[]>(artistNames.map((nome) => [nome, []]));

  for (let i = DATA_START_ROW - 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.some((cell) => normalizeText(cell))) continue;
    const artista = normalizeText(row[2]);
    const canonico = artista && canonicalByNorm.get(normalizeComparison(artista));
    if (!canonico) continue;
    const musica = rowToMusica(row, i + 1);
    grupos.get(canonico)!.push(musica);
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

  const rowCells = await googleSheetsService.registrosCharts.readValues(SHEET, `A${linha}:M${linha}`);
  const row = rowCells?.[0] || [];
  const artistaDaLinha = normalizeText(row[2]);
  const normArtistNames = new Set(artistNames.map(normalizeComparison));
  if (!artistaDaLinha || !normArtistNames.has(normalizeComparison(artistaDaLinha))) {
    return jsonResponse({ ok: false, error: "Essa música não pertence a um artista seu." }, 403);
  }

  let somaOutras = 0;
  for (const [nome, col] of Object.entries(CATEGORY_COLUMNS)) {
    if (nome === coluna) continue;
    somaOutras += parsePercent(normalizeText(row[col]));
  }
  if (somaOutras + parsePercent(valor) > 100.001) {
    return jsonResponse(
      { ok: false, error: "Essa escolha faria a soma da linha passar de 100%." },
      400,
    );
  }

  const colLetter = colIndexToA1Letter(colIndex);
  await googleSheetsService.registrosCharts.updateValues(SHEET, `${colLetter}${linha}`, [[valor]]);

  return jsonResponse({ ok: true });
}

function parsePercent(v: string): number {
  return parseFloat(v.replace("%", "").replace(",", ".")) || 0;
}

/**
 * Sorteia uma combinação válida (uma opção de cada categoria) cuja soma dê
 * exatamente 100%. Spotify e Apple Music (múltiplos de 10, 30-70) resolvem a
 * sobra depois de sortear as outras 4 categorias — dá muito mais chance de
 * achar uma combinação válida rápido do que sortear as 6 de uma vez.
 */
function sortearCombinacao100(): Record<string, string> | null {
  const spotifyOpts = CATEGORY_OPTIONS.SPOTIFY;
  const appleOpts = CATEGORY_OPTIONS["APPLE MUSIC"];

  for (let tentativa = 0; tentativa < 500; tentativa++) {
    const bb100 = CATEGORY_OPTIONS["BILLBOARD HOT 100"][
      Math.floor(Math.random() * CATEGORY_OPTIONS["BILLBOARD HOT 100"].length)
    ];
    const youtube = CATEGORY_OPTIONS.YOUTUBE[Math.floor(Math.random() * CATEGORY_OPTIONS.YOUTUBE.length)];
    const digital = CATEGORY_OPTIONS["DIGITAL SALES"][
      Math.floor(Math.random() * CATEGORY_OPTIONS["DIGITAL SALES"].length)
    ];
    const bb200 = CATEGORY_OPTIONS["BILLBOARD 200"][
      Math.floor(Math.random() * CATEGORY_OPTIONS["BILLBOARD 200"].length)
    ];

    const restante = 100 - (parsePercent(bb100) + parsePercent(youtube) + parsePercent(digital) + parsePercent(bb200));

    const candidatos: [string, string][] = [];
    for (const sp of spotifyOpts) {
      for (const am of appleOpts) {
        if (Math.abs(parsePercent(sp) + parsePercent(am) - restante) < 0.001) {
          candidatos.push([sp, am]);
        }
      }
    }
    if (candidatos.length === 0) continue;

    const [spotify, apple] = candidatos[Math.floor(Math.random() * candidatos.length)];
    return {
      "BILLBOARD HOT 100": bb100,
      SPOTIFY: spotify,
      "APPLE MUSIC": apple,
      YOUTUBE: youtube,
      "DIGITAL SALES": digital,
      "BILLBOARD 200": bb200,
    };
  }
  return null;
}

/**
 * POST /api/ponto/distribuir-aleatorio
 * Pra cada música dos artistas do jogador que ainda não tem NENHUMA
 * categoria preenchida (nunca sobrescreve uma escolha manual já feita),
 * sorteia uma combinação de % por categoria que soma exatamente 100%.
 */
export async function distribuirPontosAleatorioController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { telegramId?: string };
  const telegramId = normalizeText(body.telegramId);
  if (!telegramId) return jsonResponse({ ok: false, error: "telegramId obrigatório." }, 400);

  const artistNames = await getArtistNamesForOwner(telegramId);
  if (artistNames.length === 0) {
    return jsonResponse({ ok: false, error: "Nenhum artista vinculado a esse jogador." }, 403);
  }
  const normArtistNames = new Set(artistNames.map(normalizeComparison));

  const rows = await googleSheetsService.registrosCharts.readValues(SHEET);
  let distribuidas = 0;

  for (let i = DATA_START_ROW - 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.some((cell) => normalizeText(cell))) continue;
    const artista = normalizeText(row[2]);
    if (!artista || !normArtistNames.has(normalizeComparison(artista))) continue;

    const jaDistribuida = Object.values(CATEGORY_COLUMNS).some((col) => normalizeText(row[col]));
    if (jaDistribuida) continue;

    const combo = sortearCombinacao100();
    if (!combo) continue;

    const linha = i + 1;
    for (const [categoria, valor] of Object.entries(combo)) {
      const colLetter = colIndexToA1Letter(CATEGORY_COLUMNS[categoria]);
      await googleSheetsService.registrosCharts.updateValues(SHEET, `${colLetter}${linha}`, [[valor]]);
    }
    distribuidas++;
  }

  return jsonResponse({ ok: true, distribuidas });
}

/**
 * POST /api/ponto/limpar
 * Apaga as 6 categorias de uma música (volta pra vazio) — pra quem se
 * arrependeu da escolha e quer recomeçar do zero, seja pra escolher
 * manualmente de novo ou pra rodar "distribuir aleatório" de novo nela
 * (que só preenche linhas totalmente vazias).
 */
export async function limparPontoCelulaController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    telegramId?: string;
    linha?: number;
  };
  const { telegramId, linha } = body;

  if (!telegramId || !linha || linha < DATA_START_ROW) {
    return jsonResponse({ ok: false, error: "Parâmetros inválidos." }, 400);
  }

  const artistNames = await getArtistNamesForOwner(telegramId);
  if (artistNames.length === 0) {
    return jsonResponse({ ok: false, error: "Nenhum artista vinculado a esse jogador." }, 403);
  }

  const rowCells = await googleSheetsService.registrosCharts.readValues(SHEET, `A${linha}:M${linha}`);
  const row = rowCells?.[0] || [];
  const artistaDaLinha = normalizeText(row[2]);
  const normArtistNames = new Set(artistNames.map(normalizeComparison));
  if (!artistaDaLinha || !normArtistNames.has(normalizeComparison(artistaDaLinha))) {
    return jsonResponse({ ok: false, error: "Essa música não pertence a um artista seu." }, 403);
  }

  const colunas = Object.values(CATEGORY_COLUMNS).sort((a, b) => a - b);
  const primeira = colIndexToA1Letter(colunas[0]);
  const ultima = colIndexToA1Letter(colunas[colunas.length - 1]);
  await googleSheetsService.registrosCharts.updateValues(SHEET, `${primeira}${linha}:${ultima}${linha}`, [
    colunas.map(() => ""),
  ]);

  return jsonResponse({ ok: true });
}
