import {
  googleSheetsService,
  ensureSheetTab,
  readValues,
  appendRow,
  normalizeText,
  normalizeComparison,
} from "../services/googleSheetsService";
import { getArtistNamesForOwner } from "./artistasController";
import { getCatalog } from "./catalogController";
import { PRECO_PLAYLIST_MINIMA, PLAYLIST_MINIMA } from "./playlistsInvestimentoController";
import { getSaldosEcoin, semanaAtual, acharLinhaLivreEcoinInvestimento, descontarSaldoArtista } from "./marketController";

// -------------------- Spotlight Banner --------------------
//
// Item especial do Market: um banner rotativo na home, comprado por
// artista (1 ativo por vez), escolhendo a plataforma (Spotify/Apple
// Music/YouTube) — o preço é o da playlist mínima daquela plataforma.
//
// Desconto é IMEDIATO na compra, direto em DADOS!AD (descontarSaldoArtista)
// — não espera ninguém comentar. O que só acontece quando alguém clica no
// banner e, dentro da janela de tempo, comenta no tópico de lançamento é o
// REGISTRO da playlist mínima em "ECOIN + INVESTIMENTO": a linha já foi
// reservada no momento da compra (coluna C = "(BANNER)", nunca o nome do
// artista — combinado assim pra esse registro não citar o artista), o
// comentário só preenche E (música/álbum) e G/I/K (playlist da
// plataforma escolhida) nessa MESMA linha reservada. Reservar na compra
// evita que outra compra (Music Boost, Album Boost, Playlist manual)
// reaproveite essa linha como "livre" antes do comentário acontecer —
// toda busca de linha livre nesse pool olha só se a coluna C está vazia.
//
// MARKET_BANNERS (planilha usuarios):
// A id | B data | C telegramId | D usuario | E artista | F plataforma
// (SPOTIFY/APPLE MUSIC/YOUTUBE) | G musicaOuAlbum | H topicoId |
// I imagemUrl | J dataExpira (ISO) | K status | L tab (musicas/albuns —
// pra montar o link do tópico igual ao Forum: /empire-play/forum?tab=X&id=topicoId)
// | M linhaEcoin (linha reservada em ECOIN + INVESTIMENTO na compra)
const BANNERS_SHEET = "MARKET_BANNERS";
const BANNERS_HEADER = [
  "Id",
  "Data",
  "TelegramID",
  "Usuario",
  "Artista",
  "Plataforma",
  "MusicaOuAlbum",
  "TopicoID",
  "ImagemUrl",
  "DataExpira",
  "Status",
  "Tab",
  "LinhaEcoin",
];

const ECOIN_SHEET_BANNER = "ECOIN + INVESTIMENTO";
const ECOIN_RESERVA_BANNER_MARCADOR = "(BANNER)";
const COL_PLATAFORMA_ECOIN: Record<string, string> = { SPOTIFY: "G", "APPLE MUSIC": "I", YOUTUBE: "K" };

// MARKET_BANNER_CLIQUES (planilha usuarios): rastreia clique -> comentário
// pra liberar o bônus de playlist só uma vez por usuário/banner.
// A data | B telegramId | C bannerId | D topicoId | E usado (TRUE/FALSE)
const CLIQUES_SHEET = "MARKET_BANNER_CLIQUES";
const CLIQUES_HEADER = ["Data", "TelegramID", "BannerID", "TopicoID", "Usado"];

// Janela de tempo em que um comentário ainda "conta" como vindo do clique
// no banner.
const JANELA_CLIQUE_MS = 60 * 60 * 1000; // 60 minutos
const DURACAO_BANNER_MS = 4 * 24 * 60 * 60 * 1000; // 4 dias

const PLATAFORMAS_VALIDAS = new Set(["SPOTIFY", "APPLE MUSIC", "YOUTUBE"]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

interface BannerRow {
  linha: number;
  id: string;
  data: string;
  telegramId: string;
  usuario: string;
  artista: string;
  plataforma: string;
  musicaOuAlbum: string;
  topicoId: string;
  imagemUrl: string;
  dataExpira: string;
  status: string;
  tab: string;
  linhaEcoin: number | null;
}

async function getTodosBanners(): Promise<BannerRow[]> {
  const rows = await googleSheetsService.usuarios.readValues(BANNERS_SHEET).catch(() => []);
  return rows
    .slice(1)
    .map((r, i) => ({
      linha: i + 2,
      id: normalizeText(r[0]),
      data: normalizeText(r[1]),
      telegramId: normalizeText(r[2]),
      usuario: normalizeText(r[3]),
      artista: normalizeText(r[4]),
      plataforma: normalizeText(r[5]),
      musicaOuAlbum: normalizeText(r[6]),
      topicoId: normalizeText(r[7]),
      imagemUrl: normalizeText(r[8]),
      dataExpira: normalizeText(r[9]),
      status: normalizeText(r[10]),
      tab: normalizeText(r[11]),
      linhaEcoin: Number(normalizeText(r[12])) || null,
    }))
    .filter((b) => b.id);
}

/**
 * GET /api/market/banners/ativos
 * Banners ainda dentro da janela de 4 dias, ordenados do primeiro pro
 * último comprado (fila de exibição).
 */
export async function getBannersAtivosController(): Promise<Response> {
  const banners = await getTodosBanners();
  const agora = Date.now();
  const ativos = banners
    .filter((b) => {
      const expira = Date.parse(b.dataExpira);
      return Number.isFinite(expira) && expira > agora;
    })
    .sort((a, b) => Date.parse(a.data) - Date.parse(b.data))
    .map((b) => ({
      id: b.id,
      artista: b.artista,
      titulo: b.musicaOuAlbum,
      imagemUrl: b.imagemUrl,
      topicoId: b.topicoId,
      tab: b.tab || "musicas",
    }));
  return jsonResponse({ success: true, data: ativos });
}

/**
 * GET /api/market/banners/opcoes?telegramId=...&artista=...
 * Músicas/álbuns do artista com tópico já existente, pra escolher o que
 * o banner vai divulgar.
 */
export async function getBannerOpcoesController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const telegramId = normalizeText(url.searchParams.get("telegramId"));
  const artista = normalizeText(url.searchParams.get("artista"));
  if (!telegramId || !artista) return jsonResponse({ success: true, data: [] });

  const meusArtistas = await getArtistNamesForOwner(telegramId);
  if (!meusArtistas.some((a) => normalizeComparison(a) === normalizeComparison(artista))) {
    return jsonResponse({ success: false, error: "Esse artista não é seu." }, 403);
  }

  const [musicas, albuns] = await Promise.all([
    getCatalog("musicas", { artist: artista }),
    getCatalog("albuns", { artist: artista }),
  ]);

  const opcoes = [...musicas, ...albuns]
    .filter((item) => normalizeComparison(item.artist) === normalizeComparison(artista))
    .filter((item) => item.telegramTopicId)
    .map((item) => ({
      titulo: item.title,
      topicoId: item.telegramTopicId as string,
      capa: item.cover,
      tipo: item.type,
    }));

  return jsonResponse({ success: true, data: opcoes });
}

async function registrarCompraBanner(params: {
  telegramId: string;
  usuario: string;
  artista: string;
  plataforma: string;
  preco: number;
}): Promise<void> {
  const { telegramId, usuario, artista, plataforma, preco } = params;
  await ensureSheetTab("usuarios", "Market_Compras");
  const existentes = await readValues("usuarios", "Market_Compras", "A1:A1");
  if (!existentes.length || !existentes[0]?.[0]) {
    await appendRow(
      "usuarios",
      "Market_Compras",
      ["Data", "TelegramID", "Usuario", "ProdutoID", "Produto", "Preco", "Detalhe", "Status", "Moeda", "Artista", "Semana"],
      "A:K",
      "OVERWRITE",
    );
  }
  await appendRow(
    "usuarios",
    "Market_Compras",
    [
      new Date().toISOString(),
      telegramId,
      usuario,
      "spotlight_banner",
      "Spotlight Banner",
      preco,
      plataforma,
      "Pendente",
      "ecoin",
      artista,
      semanaAtual(),
    ],
    "A:K",
    "OVERWRITE",
  );
}

/**
 * POST /api/market/banners/comprar
 * body: { telegramId, usuario, artista, plataforma, musicaOuAlbum, topicoId, imagemUrl }
 */
export async function postComprarBannerController(request: Request): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corpo inválido." }, 400);
  }

  const telegramId = String(body?.telegramId || "").trim();
  const usuario = String(body?.usuario || "").trim();
  const artista = String(body?.artista || "").trim();
  const plataforma = String(body?.plataforma || "").trim().toUpperCase();
  const musicaOuAlbum = String(body?.musicaOuAlbum || "").trim();
  const topicoId = String(body?.topicoId || "").trim();
  const imagemUrl = String(body?.imagemUrl || "").trim();
  const tab = String(body?.tab || "musicas").trim() === "albuns" ? "albuns" : "musicas";

  if (!telegramId || !artista) {
    return jsonResponse({ success: false, error: "Usuário/artista não identificado." }, 400);
  }
  if (!PLATAFORMAS_VALIDAS.has(plataforma)) {
    return jsonResponse({ success: false, error: "Plataforma inválida." }, 400);
  }
  if (!musicaOuAlbum || !topicoId) {
    return jsonResponse({ success: false, error: "Selecione a música ou álbum a divulgar." }, 400);
  }
  if (!imagemUrl) {
    return jsonResponse({ success: false, error: "Envie a imagem do banner." }, 400);
  }

  const meusArtistas = await getArtistNamesForOwner(telegramId);
  if (!meusArtistas.some((a) => normalizeComparison(a) === normalizeComparison(artista))) {
    return jsonResponse({ success: false, error: "Esse artista não é seu." }, 403);
  }

  const banners = await getTodosBanners();
  const agora = Date.now();
  const jaTemAtivo = banners.some((b) => {
    if (normalizeComparison(b.artista) !== normalizeComparison(artista)) return false;
    const expira = Date.parse(b.dataExpira);
    return Number.isFinite(expira) && expira > agora;
  });
  if (jaTemAtivo) {
    return jsonResponse({ success: false, error: "Esse artista já tem um banner ativo." }, 400);
  }

  const preco = PRECO_PLAYLIST_MINIMA[plataforma];
  const saldos = await getSaldosEcoin([artista]);
  const saldoEcoin = saldos.get(normalizeComparison(artista)) ?? 0;
  if (saldoEcoin < preco) {
    return jsonResponse({ success: false, error: "ECoin insuficiente." }, 400);
  }

  const id = `BAN_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const dataExpira = new Date(agora + DURACAO_BANNER_MS).toISOString();

  // Reserva já na compra a linha em ECOIN + INVESTIMENTO que vai receber
  // a playlist mínima SE alguém comentar depois — marca C com um valor
  // fixo (nunca o nome do artista) só pra tirar a linha do pool de
  // "livres" e ninguém mais pegar ela por engano antes do comentário.
  const linhaEcoin = await acharLinhaLivreEcoinInvestimento();
  await googleSheetsService.registrosCharts.updateValues(ECOIN_SHEET_BANNER, `C${linhaEcoin}`, [
    [ECOIN_RESERVA_BANNER_MARCADOR],
  ]);

  // Desconto é na hora, direto do saldo do artista — independe de alguém
  // comentar ou não.
  await descontarSaldoArtista(artista, preco);

  await ensureSheetTab("usuarios", BANNERS_SHEET);
  const existentes = await readValues("usuarios", BANNERS_SHEET, "A1:A1");
  if (!existentes.length || !existentes[0]?.[0]) {
    await appendRow("usuarios", BANNERS_SHEET, BANNERS_HEADER, "A:M", "OVERWRITE");
  }
  await appendRow(
    "usuarios",
    BANNERS_SHEET,
    [
      id,
      new Date(agora).toISOString(),
      telegramId,
      usuario,
      artista,
      plataforma,
      musicaOuAlbum,
      topicoId,
      imagemUrl,
      dataExpira,
      "Ativo",
      tab,
      linhaEcoin,
    ],
    "A:M",
    "OVERWRITE",
  );

  await registrarCompraBanner({ telegramId, usuario, artista, plataforma, preco });

  return jsonResponse({ success: true, data: { id, dataExpira } });
}

/**
 * POST /api/market/banners/clique
 * body: { telegramId, bannerId }
 * Guarda (usuário, tópico, timestamp) pra, se esse mesmo usuário comentar
 * no tópico dentro da janela de tempo, liberar o bônus de playlist.
 */
export async function postCliqueBannerController(request: Request): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corpo inválido." }, 400);
  }

  const telegramId = String(body?.telegramId || "").trim();
  const bannerId = String(body?.bannerId || "").trim();
  if (!telegramId || !bannerId) return jsonResponse({ success: false, error: "Parâmetros inválidos." }, 400);

  const banners = await getTodosBanners();
  const banner = banners.find((b) => b.id === bannerId);
  if (!banner) return jsonResponse({ success: false, error: "Banner não encontrado." }, 404);

  await ensureSheetTab("usuarios", CLIQUES_SHEET);
  const existentes = await readValues("usuarios", CLIQUES_SHEET, "A1:A1");
  if (!existentes.length || !existentes[0]?.[0]) {
    await appendRow("usuarios", CLIQUES_SHEET, CLIQUES_HEADER, "A:E", "OVERWRITE");
  }
  await appendRow(
    "usuarios",
    CLIQUES_SHEET,
    [new Date().toISOString(), telegramId, bannerId, banner.topicoId, "FALSE"],
    "A:E",
    "OVERWRITE",
  );

  return jsonResponse({ success: true });
}

/**
 * Chamado pelo forumController logo depois de um comentário ser salvo.
 * Se esse usuário clicou em algum banner ligado a esse tópico dentro da
 * janela de tempo e ainda não usou o bônus nesse banner, dispara o
 * investimento automático de playlist mínima na plataforma do banner.
 * Nunca lança — qualquer erro aqui não pode derrubar a resposta do
 * comentário, quem chama já envolve isso em try/catch.
 */
export async function processarComentarioParaBanner(telegramId: string, topicId: string): Promise<void> {
  if (!telegramId || !topicId) return;

  const rows = await googleSheetsService.usuarios.readValues(CLIQUES_SHEET).catch(() => []);
  if (rows.length < 2) return;

  const normTg = normalizeComparison(telegramId);
  const normTopico = normalizeComparison(topicId);
  const agora = Date.now();

  let linhaAlvo = -1;
  let melhorData = -1;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (normalizeComparison(normalizeText(row[1])) !== normTg) continue;
    if (normalizeComparison(normalizeText(row[3])) !== normTopico) continue;
    if (normalizeText(row[4]).toUpperCase() === "TRUE") continue;
    const ts = Date.parse(normalizeText(row[0]));
    if (!Number.isFinite(ts) || agora - ts > JANELA_CLIQUE_MS) continue;
    if (ts > melhorData) {
      melhorData = ts;
      linhaAlvo = i + 1; // linha real na planilha (1-based, header na linha 1)
    }
  }
  if (linhaAlvo === -1) return;

  const bannerId = normalizeText(rows[linhaAlvo - 1][2]);
  const banners = await getTodosBanners();
  const banner = banners.find((b) => b.id === bannerId);
  if (!banner) return;

  // Marca usado ANTES de escrever o investimento — evita corrida em
  // comentários muito próximos gerando bônus em dobro.
  await googleSheetsService.usuarios.updateValues(CLIQUES_SHEET, `E${linhaAlvo}`, [["TRUE"]]);

  if (!banner.linhaEcoin) return;
  const colPlataforma = COL_PLATAFORMA_ECOIN[banner.plataforma];
  const playlist = PLAYLIST_MINIMA[banner.plataforma];
  if (!colPlataforma || !playlist) return;

  // Só preenche E (música/álbum) e a coluna da plataforma na linha JÁ
  // RESERVADA na compra — nunca reescreve C, que fica com o marcador
  // "(BANNER)" em vez do nome do artista (combinado assim de propósito).
  await googleSheetsService.registrosCharts
    .updateValues(ECOIN_SHEET_BANNER, `E${banner.linhaEcoin}`, [[banner.musicaOuAlbum]])
    .catch(() => {});
  await googleSheetsService.registrosCharts
    .updateValues(ECOIN_SHEET_BANNER, `${colPlataforma}${banner.linhaEcoin}`, [[playlist]])
    .catch(() => {});
}

/**
 * GET /api/market/banners/meus?telegramId=...
 * Banners (ativos ou não) dos artistas que esse jogador controla — pra
 * gerenciar em Gestão (ver status, excluir se precisar).
 */
export async function getMeusBannersController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const telegramId = normalizeText(url.searchParams.get("telegramId"));
  if (!telegramId) return jsonResponse({ success: true, data: [] });

  const meusArtistas = await getArtistNamesForOwner(telegramId);
  const normMeus = new Set(meusArtistas.map(normalizeComparison));

  const banners = await getTodosBanners();
  const agora = Date.now();
  const meus = banners
    .filter((b) => normMeus.has(normalizeComparison(b.artista)))
    .sort((a, b) => Date.parse(b.data) - Date.parse(a.data))
    .map((b) => ({
      id: b.id,
      artista: b.artista,
      titulo: b.musicaOuAlbum,
      plataforma: b.plataforma,
      imagemUrl: b.imagemUrl,
      dataExpira: b.dataExpira,
      ativo: b.status !== "Removido" && Number.isFinite(Date.parse(b.dataExpira)) && Date.parse(b.dataExpira) > agora,
    }));

  return jsonResponse({ success: true, data: meus });
}

/**
 * POST /api/market/banners/deletar
 * body: { telegramId, bannerId }
 * Remove o banner da fila de exibição (marca Status="Removido" e expira
 * na hora — não apaga a linha, mantém histórico pra reconciliação).
 */
export async function postDeletarBannerController(request: Request): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corpo inválido." }, 400);
  }

  const telegramId = String(body?.telegramId || "").trim();
  const bannerId = String(body?.bannerId || "").trim();
  if (!telegramId || !bannerId) return jsonResponse({ success: false, error: "Parâmetros inválidos." }, 400);

  const banners = await getTodosBanners();
  const banner = banners.find((b) => b.id === bannerId);
  if (!banner) return jsonResponse({ success: false, error: "Banner não encontrado." }, 404);

  const meusArtistas = await getArtistNamesForOwner(telegramId);
  if (!meusArtistas.some((a) => normalizeComparison(a) === normalizeComparison(banner.artista))) {
    return jsonResponse({ success: false, error: "Esse banner não é seu." }, 403);
  }

  await googleSheetsService.usuarios.updateValues(BANNERS_SHEET, `K${banner.linha}`, [["Removido"]]);
  await googleSheetsService.usuarios.updateValues(BANNERS_SHEET, `J${banner.linha}`, [[new Date(0).toISOString()]]);

  return jsonResponse({ success: true });
}
