import {
  googleSheetsService,
  ensureSheetTab,
  readValues,
  appendRow,
  normalizeText,
  normalizeComparison,
} from "../services/googleSheetsService";
import { getNivelAtual, gastarPrestigio, getNiveis, getRegrasPrestigio } from "../services/prestigioService";
import { getArtistNamesForOwner } from "./artistasController";

// -------------------- CATÁLOGO (MARKET_ITENS) --------------------
//
// Produtos deixaram de ser fixos no código — vivem numa aba própria,
// "MARKET_ITENS" (planilha usuarios), editável direto pela produção sem
// precisar de deploy. Layout confirmado com o usuário:
// A id | B nome | C descricao | D moeda (prestigio/ecoin) | E preco |
// F icone | G pedeDetalhe (TRUE/FALSE) | H detalhePlaceholder |
// I categoria | J ativo (TRUE/FALSE) | K ordem | L exclusivoGrupo
// (itens com o mesmo valor aqui são mutuamente exclusivos por artista,
// ex: os 5 níveis de "Award +N minutos") | M tipoEspecial ("leilao" pro
// item de Performance Especial, vazio nos outros) | N plataforma
// (Spotify/Apple Music/YouTube, só nos itens de playlist) | O destino
// (pra onde a compra é registrada: market_compras / ecoin_investimento /
// empirehits_compras / leilao).
const ITENS_SHEET = "MARKET_ITENS";

export interface MarketItem {
  id: string;
  nome: string;
  descricao: string;
  moeda: "prestigio" | "ecoin";
  preco: number;
  icone: string;
  pedeDetalhe: boolean;
  detalhePlaceholder: string;
  categoria: string;
  ativo: boolean;
  ordem: number;
  exclusivoGrupo: string;
  tipoEspecial: string;
  plataforma: string;
  destino: string;
}

async function getMarketItens(): Promise<MarketItem[]> {
  const rows = await googleSheetsService.usuarios.readValues(ITENS_SHEET).catch(() => []);
  return rows
    .slice(1)
    .filter((r) => normalizeText(r[0]))
    .map((r) => ({
      id: normalizeText(r[0]),
      nome: normalizeText(r[1]),
      descricao: normalizeText(r[2]),
      moeda: normalizeText(r[3]).toLowerCase() === "ecoin" ? "ecoin" : ("prestigio" as "prestigio" | "ecoin"),
      preco: Number(normalizeText(r[4]).replace(/[^\d.-]/g, "")) || 0,
      icone: normalizeText(r[5]),
      pedeDetalhe: normalizeText(r[6]).toUpperCase() === "TRUE",
      detalhePlaceholder: normalizeText(r[7]),
      categoria: normalizeText(r[8]),
      ativo: normalizeText(r[9]).toUpperCase() !== "FALSE",
      ordem: Number(normalizeText(r[10])) || 0,
      exclusivoGrupo: normalizeText(r[11]),
      tipoEspecial: normalizeText(r[12]),
      plataforma: normalizeText(r[13]),
      destino: normalizeText(r[14]) || "market_compras",
    }))
    .filter((item) => item.ativo)
    .sort((a, b) => a.ordem - b.ordem);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// Calendário Empire: semana vai de quarta 00:00 até terça 23:59 (Brasília).
// Devolve a data (AAAA-MM-DD) da quarta-feira que abre a semana vigente —
// chave estável pra saber a quais "Award +minutos"/Week Off/leilão uma
// compra pertence, mesmo sem hora exata guardada em todo lugar.
function semanaAtual(): string {
  const agora = new Date(Date.now() - 3 * 60 * 60 * 1000); // Brasília (UTC-3)
  const diaSemana = agora.getUTCDay(); // 0=domingo..6=sábado
  const diasDesdeQuarta = (diaSemana - 3 + 7) % 7; // 3 = quarta
  const inicio = new Date(agora);
  inicio.setUTCDate(agora.getUTCDate() - diasDesdeQuarta);
  const y = inicio.getUTCFullYear();
  const m = String(inicio.getUTCMonth() + 1).padStart(2, "0");
  const d = String(inicio.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// DADOS!AC (nome do artista) / AD (saldo ECoin) — mesmo saldo "ao vivo"
// já exibido e debitado automaticamente em Ponto > Playlists (planilha
// registrosCharts, ver playlistsInvestimentoController.ts).
async function getSaldosEcoin(nomesArtistas: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (nomesArtistas.length === 0) return mapa;
  const rows = await googleSheetsService.registrosCharts.readValues("DADOS", "AC1:AD5000").catch(() => []);
  for (const row of rows) {
    const nome = normalizeText(row[0]);
    if (!nome) continue;
    const saldo = parseFloat(normalizeText(row[1]).replace(/\./g, "").replace(",", ".")) || 0;
    mapa.set(normalizeComparison(nome), saldo);
  }
  const normAlvo = new Set(nomesArtistas.map(normalizeComparison));
  const filtrado = new Map<string, number>();
  for (const [chave, valor] of mapa) {
    if (normAlvo.has(chave)) filtrado.set(chave, valor);
  }
  return filtrado;
}

/**
 * GET /api/market/produtos?telegramId=...
 * Catálogo completo (MARKET_ITENS) + saldo de prestígio do jogador +
 * saldo de ECoin de cada artista dele (pros itens em ecoin, que são
 * debitados do "caixa" do artista, não do jogador).
 */
export async function getMarketProdutosController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const telegramId = url.searchParams.get("telegramId") || "";
  const usuario = url.searchParams.get("usuario") || "";

  const itens = await getMarketItens();

  let saldoPrestigio = 0;
  if (telegramId || usuario) {
    try {
      const nivel = await getNivelAtual({ telegramId, usuario });
      saldoPrestigio = nivel.prestigioAtual;
    } catch {
      saldoPrestigio = 0;
    }
  }

  let artistas: { nome: string; saldoEcoin: number }[] = [];
  if (telegramId) {
    const nomesArtistas = await getArtistNamesForOwner(telegramId);
    if (nomesArtistas.length > 0) {
      const saldos = await getSaldosEcoin(nomesArtistas);
      artistas = nomesArtistas.map((nome) => ({
        nome,
        saldoEcoin: saldos.get(normalizeComparison(nome)) ?? 0,
      }));
    }
  }

  return jsonResponse({ success: true, data: { itens, saldoPrestigio, artistas } });
}

/**
 * GET /api/market/regras
 * Pra tela "Entenda os prestígios": escada completa de níveis + as ações
 * que somam prestígio.
 */
export async function getMarketRegrasController(): Promise<Response> {
  try {
    const [niveis, regrasMap] = await Promise.all([getNiveis(), getRegrasPrestigio()]);
    const regras = Array.from(regrasMap.values()).filter((r) => r.ativo);
    return jsonResponse({ success: true, data: { niveis, regras } });
  } catch (error: any) {
    return jsonResponse({ success: false, error: error?.message || "Erro ao buscar regras." }, 500);
  }
}

// -------------------- LOG DE COMPRAS --------------------
//
// Market_Compras (planilha usuarios) é o log de TUDO que é comprado, com
// moeda/artista/semana — é o que permite conferir e repor manualmente se
// algo for cobrado errado.
const COMPRAS_SHEET = "Market_Compras";
const COMPRAS_HEADER = [
  "Data",
  "TelegramID",
  "Usuario",
  "ProdutoID",
  "Produto",
  "Preco",
  "Detalhe",
  "Status",
  "Moeda",
  "Artista",
  "Semana",
];

async function registrarCompra(params: {
  item: MarketItem;
  telegramId: string;
  usuario: string;
  artista: string;
  detalhe: string;
  semana: string;
  status: string;
}): Promise<void> {
  const { item, telegramId, usuario, artista, detalhe, semana, status } = params;
  await ensureSheetTab("usuarios", COMPRAS_SHEET);
  const existentes = await readValues("usuarios", COMPRAS_SHEET, "A1:A1");
  if (!existentes.length || !existentes[0]?.[0]) {
    await appendRow("usuarios", COMPRAS_SHEET, COMPRAS_HEADER, "A:K", "OVERWRITE");
  }
  await appendRow(
    "usuarios",
    COMPRAS_SHEET,
    [
      new Date().toISOString(),
      telegramId,
      usuario,
      item.id,
      item.nome,
      item.preco,
      detalhe,
      status,
      item.moeda,
      artista,
      semana,
    ],
    "A:K",
    "OVERWRITE",
  );
}

// EmpireHits_Compras (planilha usuarios) — itens de clipe/comercial no
// Empire Hits (destino "empirehits_compras" em MARKET_ITENS). Fica
// "Pendente" até alguém no time disponibilizar de verdade.
const EMPIREHITS_SHEET = "EmpireHits_Compras";
const EMPIREHITS_HEADER = [
  "Data",
  "TelegramID",
  "Usuario",
  "Artista",
  "ProdutoID",
  "Produto",
  "Detalhe",
  "Status",
  "Semana",
];

async function registrarEmpireHitsCompra(params: {
  item: MarketItem;
  telegramId: string;
  usuario: string;
  artista: string;
  detalhe: string;
  semana: string;
}): Promise<void> {
  const { item, telegramId, usuario, artista, detalhe, semana } = params;
  await ensureSheetTab("usuarios", EMPIREHITS_SHEET);
  const existentes = await readValues("usuarios", EMPIREHITS_SHEET, "A1:A1");
  if (!existentes.length || !existentes[0]?.[0]) {
    await appendRow("usuarios", EMPIREHITS_SHEET, EMPIREHITS_HEADER, "A:I", "OVERWRITE");
  }
  await appendRow(
    "usuarios",
    EMPIREHITS_SHEET,
    [new Date().toISOString(), telegramId, usuario, artista, item.id, item.nome, detalhe, "Pendente", semana],
    "A:I",
    "OVERWRITE",
  );
}

// ECOIN + INVESTIMENTO (planilha registrosCharts) — MESMA aba e MESMO
// mecanismo que Ponto > Playlists já usa (nunca mexido aqui: só reserva
// uma linha em branco do "pool" compartilhado e escreve C=artista,
// E=música/álbum, exatamente como iniciarInvestimentoController já faz).
// Music/Album Boost usam esse mesmo pool, mas SEMPRE reivindicam uma
// linha nova (nunca reaproveitam uma linha existente por artista+música,
// diferente da idempotência das playlists) — de propósito, pra nunca
// colidir com uma linha de playlist já em andamento do mesmo par
// artista+música.
const ECOIN_SHEET = "ECOIN + INVESTIMENTO";
const ECOIN_DATA_START_ROW = 3;
const ECOIN_COL_ARTISTA = 2; // C
const ECOIN_COL_MUSICA = 4; // E

async function registrarNoEcoinInvestimento(artista: string, item: MarketItem, detalhe: string): Promise<void> {
  const valorFinal = item.id === "album_boost" ? `REGISTRO: (ALBUM) - ${detalhe}` : detalhe;

  const rows = await googleSheetsService.registrosCharts.readValues(ECOIN_SHEET);
  let linhaLivre = -1;
  for (let i = ECOIN_DATA_START_ROW - 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!normalizeText(row[ECOIN_COL_ARTISTA])) {
      linhaLivre = i + 1;
      break;
    }
  }
  if (linhaLivre === -1) {
    throw new Error("Sem linha disponível em ECOIN + INVESTIMENTO essa semana.");
  }

  await googleSheetsService.registrosCharts.updateValues(ECOIN_SHEET, `C${linhaLivre}`, [[artista]]);
  await googleSheetsService.registrosCharts.updateValues(ECOIN_SHEET, `E${linhaLivre}`, [[valorFinal]]);
}

/**
 * POST /api/market/comprar
 * body: { itemId, telegramId, usuario, artista?, detalhe? }
 *
 * moeda=prestigio: desconta do prestígio do jogador (gastarPrestigio).
 * moeda=ecoin: exige `artista` (dono do jogador) — o ECoin é do artista,
 * não do jogador. destino=ecoin_investimento grava em ECOIN + INVESTIMENTO
 * (mesmo mecanismo das playlists, sem debitar nada à parte — quem
 * calcula o gasto é a própria planilha). destino=empirehits_compras grava
 * em EmpireHits_Compras. Os demais (market_compras) e o item de leilão
 * ficam registrados como "Pendente" pra aplicação manual — mesmo padrão
 * que já existia antes pro Week Off/Boost.
 */
export async function postMarketComprarController(request: Request): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corpo inválido." }, 400);
  }

  const itemId = String(body?.itemId || body?.produtoId || "").trim();
  const telegramId = String(body?.telegramId || "").trim();
  const usuario = String(body?.usuario || "").trim();
  const artista = String(body?.artista || "").trim();
  const detalhe = String(body?.detalhe || "").trim();

  if (!telegramId && !usuario) {
    return jsonResponse({ success: false, error: "Usuário não identificado." }, 400);
  }

  const itens = await getMarketItens();
  const item = itens.find((i) => i.id === itemId);
  if (!item) {
    return jsonResponse({ success: false, error: "Item não encontrado." }, 400);
  }
  if (item.tipoEspecial === "leilao") {
    return jsonResponse(
      { success: false, error: "Esse item é por leilão — a tela de lances ainda está sendo construída." },
      400,
    );
  }
  if (item.pedeDetalhe && !detalhe) {
    return jsonResponse({ success: false, error: "Preencha o campo pedido pelo item." }, 400);
  }
  if (item.moeda === "ecoin" && !artista) {
    return jsonResponse({ success: false, error: "Informe o artista." }, 400);
  }
  if (artista) {
    const meusArtistas = await getArtistNamesForOwner(telegramId);
    if (!meusArtistas.some((a) => normalizeComparison(a) === normalizeComparison(artista))) {
      return jsonResponse({ success: false, error: "Esse artista não é seu." }, 403);
    }
  }

  const semana = semanaAtual();

  try {
    if (item.moeda === "prestigio") {
      const novoSaldo = await gastarPrestigio({ telegramId, usuario }, item.preco);
      await registrarCompra({ item, telegramId, usuario, artista, detalhe, semana, status: "Pendente" });
      return jsonResponse({ success: true, data: { saldoPrestigio: novoSaldo } });
    }

    // moeda === "ecoin"
    if (item.destino === "ecoin_investimento") {
      await registrarNoEcoinInvestimento(artista, item, detalhe);
    } else if (item.destino === "empirehits_compras") {
      await registrarEmpireHitsCompra({ item, telegramId, usuario, artista, detalhe, semana });
    }
    // Sempre também loga em Market_Compras — é o registro central que
    // permite conferir/repor manualmente qualquer cobrança.
    await registrarCompra({ item, telegramId, usuario, artista, detalhe, semana, status: "Pendente" });

    return jsonResponse({ success: true, data: {} });
  } catch (error: any) {
    return jsonResponse({ success: false, error: error?.message || "Não foi possível comprar." }, 400);
  }
}

// GET /api/market/admin/diagnostico-itens — one-off: procura a aba
// MARKET_ITENS nas planilhas mais prováveis (usuarios, registrosCharts,
// principal) e devolve o cabeçalho + total de linhas + as 3 primeiras e 3
// últimas linhas de cada uma que encontrar, pra confirmar onde foi colada
// e se o formato bateu.
export async function diagnosticoMarketItensController(): Promise<Response> {
  const candidatos: Array<"usuarios" | "registrosCharts" | "principal"> = [
    "usuarios",
    "registrosCharts",
    "principal",
  ];
  const resultado: Record<string, unknown> = {};

  for (const chave of candidatos) {
    try {
      const rows = await (googleSheetsService as any)[chave].readValues("MARKET_ITENS");
      if (!rows || rows.length === 0) {
        resultado[chave] = { encontrada: false };
        continue;
      }
      resultado[chave] = {
        encontrada: true,
        totalLinhas: rows.length,
        cabecalho: rows[0],
        primeiras: rows.slice(1, 4),
        ultimas: rows.slice(-3),
      };
    } catch {
      resultado[chave] = { encontrada: false, erro: true };
    }
  }

  return jsonResponse({ success: true, data: resultado });
}
