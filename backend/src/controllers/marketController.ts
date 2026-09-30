import {
  googleSheetsService,
  ensureSheetTab,
  readValues,
  appendRow,
  normalizeText,
  normalizeComparison,
  normalizeHeader,
} from "../services/googleSheetsService";
import { getNivelAtual, gastarPrestigio, getNiveis, getRegrasPrestigio } from "../services/prestigioService";
import { getArtistNamesForOwner } from "./artistasController";
import { gravarLinhaRegistro } from "./registroLogController";
import { resolveNomeOficial } from "./forumController";

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
export function semanaAtual(): string {
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

// Limites [início, fim) da semana Empire vigente, em "pseudo-UTC" — os
// campos UTC do Date já representam o horário de Brasília (mesmo truque de
// semanaAtual() acima: sempre soma/subtrai contra Date.now() - 3h).
function limitesSemanaAtual(): { inicio: Date; fim: Date } {
  const agora = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const diaSemana = agora.getUTCDay();
  const diasDesdeQuarta = (diaSemana - 3 + 7) % 7;
  const inicio = new Date(agora);
  inicio.setUTCHours(0, 0, 0, 0);
  inicio.setUTCDate(agora.getUTCDate() - diasDesdeQuarta);
  const fim = new Date(inicio);
  fim.setUTCDate(inicio.getUTCDate() + 7);
  return { inicio, fim };
}

// Usuários!Aniversário guarda "DD/MM" (sem ano, ex: "26/04", "17/9") — o
// ano não importa pra essa checagem mesmo (é só data de nascimento).
// Verdadeiro se o dia de aniversário (em qualquer ano próximo, pra cobrir
// virada de ano) cai dentro da semana Empire vigente (quarta 00:00 até
// terça 23:59, Brasília). Aceita também AAAA-MM-DD por compatibilidade
// com qualquer linha antiga gravada nesse formato por engano.
function estaNaSemanaDoAniversario(dataAniversario: string): boolean {
  const iso = dataAniversario.match(/^\d{4}-(\d{2})-(\d{2})$/);
  const brDate = dataAniversario.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!iso && !brDate) return false;
  const mes = Number(iso ? iso[1] : brDate![2]);
  const dia = Number(iso ? iso[2] : brDate![1]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  const { inicio, fim } = limitesSemanaAtual();
  for (const ano of [inicio.getUTCFullYear() - 1, inicio.getUTCFullYear(), inicio.getUTCFullYear() + 1]) {
    const candidato = new Date(Date.UTC(ano, mes - 1, dia));
    if (candidato >= inicio && candidato < fim) return true;
  }
  return false;
}

async function getAniversarioJogador(telegramId: string, usuario: string): Promise<string> {
  const rows = await googleSheetsService.usuarios.readValues("Usuários").catch(() => []);
  if (rows.length < 2) return "";
  const header = rows[0].map((h) => normalizeHeader(h));
  const colAniversario = header.indexOf("aniversario");
  if (colAniversario === -1) return "";
  const colId = header.indexOf("id");
  const colUsuario = header.indexOf("usuario");
  const normId = normalizeComparison(telegramId);
  const normUsuario = normalizeComparison(usuario);
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const bateId = !!normId && colId !== -1 && normalizeComparison(row[colId]) === normId;
    const bateUsuario = !!normUsuario && colUsuario !== -1 && normalizeComparison(row[colUsuario]) === normUsuario;
    if (bateId || bateUsuario) return normalizeText(row[colAniversario]);
  }
  return "";
}

// DADOS!AC (nome do artista) .. AI ("SALDO FINAL" — saldo ao vivo, já
// descontando depósito/investimento da semana) — mesma coluna que a
// fórmula de ECOIN + INVESTIMENTO!D já usa (PROCV(C;DADOS!AC:AI;7;0), AI
// é a 7ª coluna a partir de AC). AD ("SALDO ORIGINAL") é só o teto fixo de
// R$1.500.000, igual pra todo mundo — nunca é o saldo disponível de
// verdade, por isso não pode ser usado aqui.
export async function getSaldosEcoin(nomesArtistas: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (nomesArtistas.length === 0) return mapa;
  const rows = await googleSheetsService.registrosCharts.readValues("DADOS", "AC1:AI5000").catch(() => []);
  for (const row of rows) {
    const nome = normalizeText(row[0]);
    if (!nome) continue;
    // Valor vem formatado como "R$ 1.500.000" — tira tudo que não for
    // dígito/vírgula/sinal antes de trocar separador BR pro formato que o
    // parseFloat entende.
    const bruto = normalizeText(row[6]).replace(/[^\d,-]/g, "");
    const saldo = parseFloat(bruto.replace(",", ".")) || 0;
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

  const itensBase = await getMarketItens();

  // Item Aniversário só é clicável na semana (Empire, quarta-terça,
  // Brasília) em que cai o aniversário do jogador — vem de Usuários!M.
  let podeAniversario = false;
  if (telegramId || usuario) {
    const dataAniversario = await getAniversarioJogador(telegramId, usuario).catch(() => "");
    podeAniversario = dataAniversario ? estaNaSemanaDoAniversario(dataAniversario) : false;
  }
  const itens = itensBase.map((item) =>
    item.id === "aniversario" ? { ...item, disponivel: podeAniversario } : { ...item, disponivel: true },
  );

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

// Week Off tem cooldown de 3 meses por jogador — verifica no próprio log
// de Market_Compras (já é a fonte de verdade de tudo que foi comprado).
const WEEK_OFF_COOLDOWN_DIAS = 90;

async function diasDesdeUltimoWeekOff(telegramId: string): Promise<number | null> {
  const rows = await readValues("usuarios", COMPRAS_SHEET).catch(() => []);
  const normTg = normalizeComparison(telegramId);
  let maisRecente = -1;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (normalizeComparison(normalizeText(row[1])) !== normTg) continue;
    if (normalizeText(row[3]) !== "week_off") continue;
    const ts = Date.parse(normalizeText(row[0]));
    if (Number.isFinite(ts) && ts > maisRecente) maisRecente = ts;
  }
  if (maisRecente === -1) return null;
  return Math.floor((Date.now() - maisRecente) / (24 * 60 * 60 * 1000));
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

  if (item.id === "week_off") {
    const dias = await diasDesdeUltimoWeekOff(telegramId);
    if (dias !== null && dias < WEEK_OFF_COOLDOWN_DIAS) {
      const faltam = WEEK_OFF_COOLDOWN_DIAS - dias;
      return jsonResponse(
        { success: false, error: `Você já usou Week Off recentemente. Faltam ${faltam} dia${faltam === 1 ? "" : "s"} pra poder comprar de novo.` },
        400,
      );
    }
  }

  if (item.id === "aniversario") {
    const dataAniversario = await getAniversarioJogador(telegramId, usuario).catch(() => "");
    if (!dataAniversario || !estaNaSemanaDoAniversario(dataAniversario)) {
      return jsonResponse(
        { success: false, error: "Esse item só pode ser comprado na semana do seu aniversário." },
        400,
      );
    }
  }

  const semana = semanaAtual();

  try {
    if (item.moeda === "prestigio") {
      const novoSaldo = await gastarPrestigio({ telegramId, usuario }, item.preco);
      await registrarCompra({ item, telegramId, usuario, artista, detalhe, semana, status: "Pendente" });
      if (item.id === "week_off" || item.id === "aniversario") {
        const nomeOficial = await resolveNomeOficial(telegramId, usuario);
        const tipoRegistro = item.id === "week_off" ? "WEEK OFF" : "ANIVERSÁRIO";
        await gravarLinhaRegistro([nomeOficial, "", tipoRegistro]).catch((err) =>
          console.warn(`[Market] Falha ao gravar ${tipoRegistro} em REGISTRO:`, err),
        );
      }
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
// GET /api/market/admin/diagnostico-usuarios — one-off: dump do cabeçalho +
// 3 primeiras linhas de "Usuários", pra confirmar o header real da coluna M
// (data de aniversário) antes de implementar a validação do item Aniversário.
export async function diagnosticoUsuariosController(): Promise<Response> {
  const rows = await googleSheetsService.usuarios.readValues("Usuários").catch(() => []);
  return jsonResponse({
    success: true,
    data: {
      totalLinhas: rows.length,
      cabecalho: rows[0] || [],
      colunaM_header: (rows[0] || [])[12] || null,
      primeiras: rows.slice(1, 4),
    },
  });
}

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

// GET /api/market/admin/fix-aniversario-formato — one-off: converte
// qualquer linha de Usuários!Aniversário que esteja em AAAA-MM-DD (escrito
// por engano antes do formato ser corrigido pra "DD/MM", o padrão que a
// coluna já usava) de volta pro formato certo.
export async function fixAniversarioFormatoController(): Promise<Response> {
  const rows = await googleSheetsService.usuarios.readValues("Usuários").catch(() => []);
  if (rows.length < 2) return jsonResponse({ success: true, data: [] });

  const header = rows[0].map((h) => normalizeHeader(h));
  const colAniversario = header.indexOf("aniversario");
  if (colAniversario === -1) return jsonResponse({ success: false, error: "Coluna Aniversário não encontrada." }, 404);
  const colUsuario = header.indexOf("usuario");

  const corrigidos: { linha: number; usuario: string; de: string; para: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const valor = normalizeText(row[colAniversario]);
    const m = valor.match(/^\d{4}-(\d{2})-(\d{2})$/);
    if (!m) continue;
    const novoValor = `${m[2]}/${m[1]}`;
    const colLetter = String.fromCharCode(65 + colAniversario);
    await googleSheetsService.usuarios.updateValues("Usuários", `${colLetter}${i + 1}`, [[novoValor]]);
    corrigidos.push({ linha: i + 1, usuario: normalizeText(row[colUsuario]), de: valor, para: novoValor });
  }

  return jsonResponse({ success: true, data: corrigidos });
}
