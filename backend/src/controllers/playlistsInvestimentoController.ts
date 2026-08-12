import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";
import { getArtistNamesForOwner } from "./artistasController";
import { colIndexToA1Letter, jsonResponse } from "./pontoController";

// Ponto → Playlists vive na mesma planilha "registrosCharts", aba
// "ECOIN + INVESTIMENTO" — layout confirmado ao vivo (linha 1 vazia, linha 2
// é o cabeçalho, dados a partir da linha 3). As linhas NÃO são reservadas
// por jogador: são um bloco comum de linhas em branco que qualquer jogador
// pode reivindicar pra uma nova música/investimento, e a aba INTEIRA é
// limpa toda semana quando os charts resetam (confirmado pelo usuário).
//
// ECOIN + INVESTIMENTO: A (não usada) | B NOME DO JOGADOR (calculado, não
// mexemos) | C NOME DO ARTISTA | D $ BANK ACCOUNT (fórmula
// =PROCV(C;DADOS!AC:AI;7;0), não mexemos) | E NOME DA MÚSICA | F (não
// usada) | G INVESTIMENTO PLAYLIST SPOTIFY | H valor (fórmula, não
// mexemos) | I INVESTIMENTO PLAYLIST APPLE MUSIC | J valor (fórmula) |
// K INVESTIMENTO PLAYLIST YOUTUBE | L valor (fórmula) | M/N (não usadas) |
// O TOTAL GASTO INVESTIMENTO (fórmula, soma de H+J+L).
//
// Só escrevemos em C, E, G, I, K — nunca em B, D, H, J, L, O (todas
// calculadas pela própria planilha via fórmula/PROCV). O preço de cada
// playlist vem da tabela em DADOS!AK:AL (confirmado ao vivo, replicada
// abaixo como whitelist — os preços em si raramente mudam, mas os nomes
// exatos das playlists são o que valida o valor aceito pelo backend).

const SHEET = "ECOIN + INVESTIMENTO";
const DATA_START_ROW = 3;

const COL = {
  ARTISTA: 2, // C
  BANK: 3, // D (leitura only)
  MUSICA: 4, // E
  SPOTIFY: 6, // G
  SPOTIFY_VALOR: 7, // H (leitura only)
  APPLE: 8, // I
  APPLE_VALOR: 9, // J (leitura only)
  YOUTUBE: 10, // K
  YOUTUBE_VALOR: 11, // L (leitura only)
  TOTAL: 14, // O (leitura only)
};

// DADOS!AK1:AL14 (Spotify), AK16:AL29 (Apple Music), AK31:AL33 (YouTube).
const PRECOS_SPOTIFY: Record<string, number> = {
  "TOPO TODAY'S TOP HITS": 370000,
  "TODAY'S TOP HITS": 350000,
  "POP UP": 340000,
  "ROCK SOLID": 340000,
  "RAP CAVIAR": 340000,
  MINT: 340000,
  "ARE & BE": 340000,
  "VIVA LATINO": 340000,
  "ALTERNATIVE PARTY": 340000,
  "JUST HITS": 290000,
  "NEW SONGS": 250000,
  "WORKOUT TIME": 210000,
  "RANDOM SONGS": 150000,
  "THIS IS... (ARTIST)": 100000,
};
const PRECOS_APPLE_MUSIC: Record<string, number> = {
  "TOPO TODAY'S HITS": 350000,
  "TODAY'S HITS": 320000,
  "A-LIST POP": 300000,
  "hyped<D>": 300000,
  RAPLIFE: 300000,
  danceXL: 300000,
  "R&B NOW": 300000,
  "!DalePlay!": 300000,
  "ALT CTRL": 300000,
  "JUST HITS": 250000,
  "JUST NEW": 210000,
  "GYM SONGS": 170000,
  "RANDOM SONGS": 110000,
  "JUST... (ARTIST)": 60000,
};
const PRECOS_YOUTUBE: Record<string, number> = {
  "Ad 5 segundos (Comercial/Vídeo)": 200000,
  "Ad 30 segundos (Comercial/Vídeo)": 220000,
  "Ad (Vídeo Completo)": 250000,
};

const PLATAFORMAS: Record<string, { col: number; valorCol: number; precos: Record<string, number> }> = {
  SPOTIFY: { col: COL.SPOTIFY, valorCol: COL.SPOTIFY_VALOR, precos: PRECOS_SPOTIFY },
  "APPLE MUSIC": { col: COL.APPLE, valorCol: COL.APPLE_VALOR, precos: PRECOS_APPLE_MUSIC },
  YOUTUBE: { col: COL.YOUTUBE, valorCol: COL.YOUTUBE_VALOR, precos: PRECOS_YOUTUBE },
};

export const PLAYLIST_OPTIONS = {
  SPOTIFY: Object.keys(PRECOS_SPOTIFY),
  "APPLE MUSIC": Object.keys(PRECOS_APPLE_MUSIC),
  YOUTUBE: Object.keys(PRECOS_YOUTUBE),
};

interface InvestimentoLinha {
  linha: number;
  musica: string;
  bankAccount: string;
  spotify: string;
  spotifyValor: string;
  apple: string;
  appleValor: string;
  youtube: string;
  youtubeValor: string;
  total: string;
}

function rowToInvestimento(row: string[], linha: number): InvestimentoLinha {
  return {
    linha,
    musica: normalizeText(row[COL.MUSICA]),
    bankAccount: normalizeText(row[COL.BANK]),
    spotify: normalizeText(row[COL.SPOTIFY]),
    spotifyValor: normalizeText(row[COL.SPOTIFY_VALOR]),
    apple: normalizeText(row[COL.APPLE]),
    appleValor: normalizeText(row[COL.APPLE_VALOR]),
    youtube: normalizeText(row[COL.YOUTUBE]),
    youtubeValor: normalizeText(row[COL.YOUTUBE_VALOR]),
    total: normalizeText(row[COL.TOTAL]),
  };
}

function parseMoeda(v: string): number {
  return parseFloat(v.replace(/[^\d,-]/g, "").replace(",", ".")) || 0;
}

async function getMusicasDoArtista(artista: string): Promise<string[]> {
  const rows = await googleSheetsService.registrosCharts.readValues("PONTOS");
  const normArtista = normalizeComparison(artista);
  const musicas = new Set<string>();
  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (normalizeComparison(row[2]) !== normArtista) continue;
    const musica = normalizeText(row[3]);
    if (musica) musicas.add(musica);
  }
  return Array.from(musicas);
}

/**
 * GET /api/ponto/playlists?telegramId=...
 * Devolve, agrupado por artista do jogador, as músicas já em investimento
 * (linhas da aba que já são desse artista) e o saldo do artista.
 *
 * Importante: `D` ($ BANK ACCOUNT) já é o saldo AO VIVO, compartilhado
 * entre todas as linhas do artista — a própria planilha desconta o gasto
 * (H/J/L de toda música dele) assim que uma playlist é escolhida. Por
 * isso é o mesmo valor em todas as linhas do artista num dado instante, e
 * o backend só repassa esse valor — nunca subtrai nada de novo por cima.
 */
export async function getInvestimentosController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const telegramId = normalizeText(url.searchParams.get("telegramId"));
  if (!telegramId) return jsonResponse({ artistas: [], grupos: [] });

  const artistNames = await getArtistNamesForOwner(telegramId);
  if (artistNames.length === 0) return jsonResponse({ artistas: [], grupos: [] });

  const normArtistNames = new Set(artistNames.map(normalizeComparison));
  const rows = await googleSheetsService.registrosCharts.readValues(SHEET);

  const grupos = new Map<string, InvestimentoLinha[]>();
  const saldoPorArtista = new Map<string, number>();

  for (let i = DATA_START_ROW - 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const artista = normalizeText(row[COL.ARTISTA]);
    if (!artista || !normArtistNames.has(normalizeComparison(artista))) continue;

    if (!grupos.has(artista)) grupos.set(artista, []);
    grupos.get(artista)!.push(rowToInvestimento(row, i + 1));

    const bank = normalizeText(row[COL.BANK]);
    if (bank) saldoPorArtista.set(artista, parseMoeda(bank));
  }

  return jsonResponse({
    artistas: artistNames,
    grupos: Array.from(grupos.entries()).map(([artista, linhas]) => ({
      artista,
      linhas,
      saldo: saldoPorArtista.get(artista) ?? 0,
    })),
  });
}

/**
 * POST /api/ponto/playlists/iniciar
 * Reivindica a primeira linha totalmente vazia da aba (C em branco) pra um
 * novo par artista+música do jogador. Só aceita artista e música que já
 * são do jogador (via ARTISTAS/PONTOS) — nunca texto livre.
 */
export async function iniciarInvestimentoController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    telegramId?: string;
    artista?: string;
    musica?: string;
  };
  const telegramId = normalizeText(body.telegramId);
  const artista = normalizeText(body.artista);
  const musica = normalizeText(body.musica);
  if (!telegramId || !artista || !musica) {
    return jsonResponse({ ok: false, error: "Parâmetros inválidos." }, 400);
  }

  const artistNames = await getArtistNamesForOwner(telegramId);
  const normArtistNames = new Set(artistNames.map(normalizeComparison));
  if (!normArtistNames.has(normalizeComparison(artista))) {
    return jsonResponse({ ok: false, error: "Esse artista não é seu." }, 403);
  }

  const musicasDoArtista = await getMusicasDoArtista(artista);
  if (!musicasDoArtista.some((m) => normalizeComparison(m) === normalizeComparison(musica))) {
    return jsonResponse({ ok: false, error: "Essa música não pertence a esse artista." }, 403);
  }

  const rows = await googleSheetsService.registrosCharts.readValues(SHEET);
  let linhaLivre = -1;
  for (let i = DATA_START_ROW - 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!normalizeText(row[COL.ARTISTA])) {
      linhaLivre = i + 1;
      break;
    }
  }
  if (linhaLivre === -1) {
    return jsonResponse(
      { ok: false, error: "Sem linha disponível pra investimento essa semana." },
      409,
    );
  }

  await googleSheetsService.registrosCharts.updateValues(SHEET, `C${linhaLivre}`, [[artista]]);
  await googleSheetsService.registrosCharts.updateValues(SHEET, `E${linhaLivre}`, [[musica]]);

  const confirmacao = await googleSheetsService.registrosCharts.readValues(SHEET, `A${linhaLivre}:O${linhaLivre}`);
  const row = confirmacao?.[0] || [];
  if (normalizeComparison(row[COL.ARTISTA]) !== normalizeComparison(artista)) {
    return jsonResponse(
      { ok: false, error: "A linha foi ocupada por outro jogador ao mesmo tempo, tenta de novo." },
      409,
    );
  }

  return jsonResponse({ ok: true, linha: linhaLivre, investimento: rowToInvestimento(row, linhaLivre) });
}

/**
 * POST /api/ponto/playlists/investir
 * Escolhe (ou troca) a playlist de uma plataforma numa linha que já é do
 * jogador. Valor gasto é calculado pela própria planilha (fórmula/PROCV) —
 * só validamos que a playlist escolhida é uma das aceitas pra plataforma.
 */
export async function investirPlaylistController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    telegramId?: string;
    linha?: number;
    plataforma?: string;
    playlist?: string;
  };
  const { telegramId, linha, plataforma, playlist } = body;

  if (!telegramId || !linha || linha < DATA_START_ROW || !plataforma || !playlist) {
    return jsonResponse({ ok: false, error: "Parâmetros inválidos." }, 400);
  }

  const config = PLATAFORMAS[plataforma];
  if (!config) return jsonResponse({ ok: false, error: "Plataforma inválida." }, 400);
  if (!(playlist in config.precos)) {
    return jsonResponse({ ok: false, error: "Playlist não permitida pra essa plataforma." }, 400);
  }

  const artistNames = await getArtistNamesForOwner(telegramId);
  const normArtistNames = new Set(artistNames.map(normalizeComparison));

  const rowCells = await googleSheetsService.registrosCharts.readValues(SHEET, `A${linha}:O${linha}`);
  const row = rowCells?.[0] || [];
  const artistaDaLinha = normalizeText(row[COL.ARTISTA]);
  if (!artistaDaLinha || !normArtistNames.has(normalizeComparison(artistaDaLinha))) {
    return jsonResponse({ ok: false, error: "Essa linha não pertence a um artista seu." }, 403);
  }

  const colLetter = colIndexToA1Letter(config.col);
  await googleSheetsService.registrosCharts.updateValues(SHEET, `${colLetter}${linha}`, [[playlist]]);

  const confirmacao = await googleSheetsService.registrosCharts.readValues(SHEET, `A${linha}:O${linha}`);
  const rowAtualizada = confirmacao?.[0] || [];

  return jsonResponse({ ok: true, investimento: rowToInvestimento(rowAtualizada, linha) });
}
