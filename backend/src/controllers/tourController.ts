import {
  googleSheetsService,
  normalizeHeader,
  normalizeText,
  normalizeComparison,
  dedupeHeaders,
  ensureSheetTab,
} from "../services/googleSheetsService";
import { somarPrestigio } from "../services/prestigioService";
import { getArtistNamesForOwner } from "./artistasController";

const LOCAIS_SHEET = "DADOS_TOUR";
const TOURS_SHEET = "CONTROLE_TOURS";
const COMENTARIOS_SHEET = "Turnes_Comentarios";

// Colunas atuais de CONTROLE_TOURS (nesta ordem, ver leitura do schema real):
// ID usuário | Artista | ID único | Nome da turnê | Porte | Total de shows |
// Data início | Data término | Agenda | Arrecadação em tempo real | Status |
// Show atual | Show anterior
// Acrescentamos 2 colunas novas no fim (compatível com as linhas antigas,
// que só ficam com essas células em branco): Capa | Meta de lucro
const TOUR_HEADERS = [
  "id_usuario",
  "artista",
  "id_unico",
  "nome_da_turne",
  "porte",
  "total_de_shows",
  "data_inicio",
  "data_termino",
  "agenda",
  "arrecadacao_em_tempo_real",
  "status",
  "show_atual",
  "show_anterior",
  "capa",
  "meta_de_lucro",
] as const;

function colIndexToA1Letter(colIndex: number): string {
  let temp = colIndex;
  let letter = "";
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

export interface LocalTurne {
  continente: string;
  cidade: string;
  local: string;
  categoria: string;
  capacidade: number;
  precoIngresso: number;
  repasseIngresso: number;
  lucroMaximo: number;
}

function parseNumeroBR(v: string): number {
  // Planilha usa "20.000" (ponto como separador de milhar) em alguns campos.
  const cleaned = normalizeText(v).replace(/\./g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
}

async function readLocais(): Promise<LocalTurne[]> {
  const rows = await googleSheetsService.usuarios.readValues(LOCAIS_SHEET).catch(() => []);
  if (!rows || rows.length < 2) return [];
  const headers = dedupeHeaders(
    LOCAIS_SHEET,
    rows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const idx = {
    continente: headers.indexOf("continente"),
    cidade: headers.indexOf("cidade"),
    local: headers.indexOf("local_venue"),
    categoria: headers.indexOf("categoria"),
    capacidade: headers.indexOf("capacidade"),
    preco: headers.indexOf("preco_por_ingresso"),
    repasse: headers.indexOf("repasse_por_ingresso"),
    lucroMaximo: headers.indexOf("lucro_maximo_100_esgotado"),
  };
  return rows
    .slice(1)
    .filter((r) => normalizeText(r[idx.local]))
    .map((r) => ({
      continente: normalizeText(r[idx.continente]),
      cidade: normalizeText(r[idx.cidade]),
      local: normalizeText(r[idx.local]),
      categoria: normalizeText(r[idx.categoria]),
      capacidade: parseNumeroBR(r[idx.capacidade]),
      precoIngresso: parseNumeroBR(r[idx.preco]),
      repasseIngresso: parseNumeroBR(r[idx.repasse]),
      lucroMaximo: parseNumeroBR(r[idx.lucroMaximo]),
    }));
}

export interface TourAcaoDia {
  tipo: "foto" | "interacao" | "entrevista" | "especial";
  texto: string;
  fotoUrl?: string | null;
  data: string; // ISO timestamp de quando a ação foi feita
  vendidosPct: number; // % da capacidade que essa ação garantiu
  automatica?: boolean; // true quando o show passou sem o jogador agir
}

export interface TourShow {
  numero: number;
  data: string; // dd/mm/yyyy
  local: string;
  cidade: string;
  categoria: string;
  capacidade: number;
  vendidos: number;
  precoIngresso: number;
  repasseIngresso: number;
  lucroMaximo: number;
  receita: number;
  status: string;
  soldOut: boolean;
  acoes: TourAcaoDia[];
}

export interface Tour {
  idUsuario: string;
  artista: string;
  idUnico: string;
  nomeTurne: string;
  porte: string;
  totalShows: number;
  dataInicio: string;
  dataTermino: string;
  agenda: TourShow[];
  arrecadacaoTempoReal: number;
  status: string;
  showAtual: string;
  showAnterior: string;
  capaUrl: string;
  metaLucro: number;
  sistemaNovo: boolean;
}

async function readToursRaw(): Promise<{ rowIndex: number; row: string[] }[]> {
  const rows = await googleSheetsService.usuarios.readValues(TOURS_SHEET).catch(() => []);
  if (!rows || rows.length < 2) return [];
  return rows.slice(1).map((row, i) => ({ rowIndex: i + 2, row }));
}

function rowToTour(row: string[]): Tour {
  const get = (key: (typeof TOUR_HEADERS)[number]) => normalizeText(row[TOUR_HEADERS.indexOf(key)]);
  let agenda: TourShow[] = [];
  try {
    const raw = JSON.parse(get("agenda") || "[]");
    agenda = Array.isArray(raw)
      ? raw.map((s: any) => ({
          numero: Number(s.numero) || 0,
          data: String(s.data || ""),
          local: String(s.local || ""),
          cidade: String(s.cidade || ""),
          categoria: String(s.categoria || ""),
          capacidade: Number(s.capacidade) || 0,
          vendidos: Number(s.vendidos) || 0,
          precoIngresso: Number(s.precoIngresso) || 0,
          repasseIngresso: Number(s.repasseIngresso) || 0,
          lucroMaximo: Number(s.lucroMaximo) || 0,
          receita: Number(s.receita) || 0,
          status: String(s.status || "Agendado"),
          soldOut: !!s.soldOut,
          acoes: Array.isArray(s.acoes) ? s.acoes : [],
        }))
      : [];
  } catch {
    agenda = [];
  }
  const capaUrl = get("capa");
  return {
    idUsuario: get("id_usuario"),
    artista: get("artista"),
    idUnico: get("id_unico"),
    nomeTurne: get("nome_da_turne"),
    porte: get("porte"),
    totalShows: parseInt(get("total_de_shows"), 10) || agenda.length,
    dataInicio: get("data_inicio"),
    dataTermino: get("data_termino"),
    agenda,
    arrecadacaoTempoReal: parseNumeroBR(get("arrecadacao_em_tempo_real")),
    status: get("status"),
    showAtual: get("show_atual"),
    showAnterior: get("show_anterior"),
    capaUrl,
    metaLucro: parseNumeroBR(get("meta_de_lucro")),
    // Turnês antigas (pré-reforma) não têm capa nem hype nos shows — ficam
    // marcadas como histórico read-only, sem receber novas ações.
    sistemaNovo: !!capaUrl,
  };
}

function jsonError(error: string, status = 400): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function getTelegramId(request: Request): string {
  const url = new URL(request.url);
  return String(
    url.searchParams.get("telegramId") || request.headers.get("x-telegram-id") || "",
  ).trim();
}

// GET /api/turnes/locais — lista os locais disponíveis (DADOS_TOUR), pronta
// pro seletor de cidades/venues na criação da turnê.
export async function getLocaisTurneController(): Promise<Response> {
  try {
    const locais = await readLocais();
    return jsonOk(locais);
  } catch (err) {
    console.error("[getLocaisTurneController] Erro:", err);
    return jsonError("Falha ao carregar os locais disponíveis.", 500);
  }
}

const BASELINE_SELLTHROUGH = 0.25;

// POST /api/turnes/simular — simulação de lucro mín/máx em tempo real
// conforme o jogador escolhe os locais, antes de criar a turnê de verdade.
export async function simularTurneController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as { locais?: string[] };
    const nomesLocais = Array.isArray(body.locais) ? body.locais : [];
    if (nomesLocais.length === 0) {
      return jsonOk({ lucroMinimo: 0, lucroMaximo: 0, shows: [] });
    }
    const todos = await readLocais();
    const escolhidos = nomesLocais
      .map((nome) => todos.find((l) => normalizeComparison(l.local) === normalizeComparison(nome)))
      .filter((l): l is LocalTurne => !!l);

    const lucroMaximo = escolhidos.reduce((soma, l) => soma + l.capacidade * l.repasseIngresso, 0);
    const lucroMinimo = Math.round(lucroMaximo * BASELINE_SELLTHROUGH);

    return jsonOk({
      lucroMinimo,
      lucroMaximo,
      baselineSellthrough: BASELINE_SELLTHROUGH,
      shows: escolhidos,
    });
  } catch (err) {
    console.error("[simularTurneController] Erro:", err);
    return jsonError("Falha ao simular a turnê.", 500);
  }
}

// GET /api/turnes?telegramId=...&artista=... — turnês do artista (ou de
// todos os artistas do dono, se `artista` não vier).
export async function getTurnesController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const telegramId = getTelegramId(request);
    const artistaFiltro = normalizeComparison(url.searchParams.get("artista") || "");

    const [raw, meusArtistas] = await Promise.all([
      readToursRaw(),
      telegramId ? getArtistNamesForOwner(telegramId) : Promise.resolve<string[]>([]),
    ]);
    const meusArtistasNorm = new Set(meusArtistas.map((a) => normalizeComparison(a)));

    const tours = raw
      .map(({ row, rowIndex }) => ({ tour: rowToTour(row), rowIndex }))
      .filter(({ tour }) => {
        if (artistaFiltro) return normalizeComparison(tour.artista) === artistaFiltro;
        if (telegramId) return meusArtistasNorm.has(normalizeComparison(tour.artista));
        return true;
      });

    await Promise.all(
      tours.map(async ({ tour, rowIndex }) => {
        if (tour.sistemaNovo && resolverShowsAutomaticos(tour)) {
          await persistAgenda(rowIndex, tour).catch(() => {});
        }
      }),
    );

    return jsonOk(tours.map(({ tour }) => tour));
  } catch (err) {
    console.error("[getTurnesController] Erro:", err);
    return jsonError("Falha ao carregar as turnês.", 500);
  }
}

// GET /api/turnes/detalhe?idUnico=... — uma turnê específica com a agenda
// completa (calendário + feed de ações).
export async function getTurneDetalheController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const idUnico = normalizeComparison(url.searchParams.get("idUnico") || "");
    if (!idUnico) return jsonError("idUnico é obrigatório.");

    const raw = await readToursRaw();
    const idUnicoCol = TOUR_HEADERS.indexOf("id_unico");
    const found = raw.find(({ row }) => normalizeComparison(row[idUnicoCol]) === idUnico);
    if (!found) return jsonError("Turnê não encontrada.", 404);

    const tour = rowToTour(found.row);
    if (tour.sistemaNovo && resolverShowsAutomaticos(tour)) {
      await persistAgenda(found.rowIndex, tour).catch(() => {});
    }

    return jsonOk(tour);
  } catch (err) {
    console.error("[getTurneDetalheController] Erro:", err);
    return jsonError("Falha ao carregar a turnê.", 500);
  }
}

interface CriarTurnePayload {
  telegramId?: string;
  artista?: string;
  nomeTurne?: string;
  capaUrl?: string;
  metaLucro?: number;
  dataInicio?: string; // dd/mm/yyyy
  intervaloDias?: number; // dias entre um show e o próximo (padrão 3)
  locais?: string[]; // nomes dos locais (DADOS_TOUR."Local (Venue)"), na ordem desejada
}

function formatDataBR(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function parseDataBR(value: string): Date | null {
  const m = normalizeText(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

// POST /api/turnes/criar — cria a turnê, gerando a agenda automaticamente a
// partir dos locais escolhidos.
export async function criarTurneController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as CriarTurnePayload;
    const telegramId = normalizeText(body.telegramId);
    const artista = normalizeText(body.artista);
    const nomeTurne = normalizeText(body.nomeTurne);
    const locaisNomes = Array.isArray(body.locais) ? body.locais : [];
    const intervaloDias = Math.max(1, Number(body.intervaloDias) || 3);

    if (!telegramId || !artista || !nomeTurne || locaisNomes.length === 0) {
      return jsonError("telegramId, artista, nomeTurne e locais são obrigatórios.");
    }

    const meusArtistas = await getArtistNamesForOwner(telegramId);
    if (!meusArtistas.some((a) => normalizeComparison(a) === normalizeComparison(artista))) {
      return jsonError("Esse artista não pertence a este jogador.", 403);
    }

    const todosLocais = await readLocais();
    const escolhidos = locaisNomes
      .map((nome) => todosLocais.find((l) => normalizeComparison(l.local) === normalizeComparison(nome)))
      .filter((l): l is LocalTurne => !!l);
    if (escolhidos.length === 0) {
      return jsonError("Nenhum dos locais escolhidos foi encontrado.");
    }

    const inicio = parseDataBR(body.dataInicio || "") || new Date();
    const lucroMaximoTotal = escolhidos.reduce((s, l) => s + l.capacidade * l.repasseIngresso, 0);
    const lucroMinimoTotal = Math.round(lucroMaximoTotal * BASELINE_SELLTHROUGH);
    const metaLucroRaw = Number(body.metaLucro) || lucroMinimoTotal;
    const metaLucro = Math.min(Math.max(metaLucroRaw, lucroMinimoTotal), lucroMaximoTotal);

    const agenda: TourShow[] = escolhidos.map((local, i) => {
      const data = new Date(inicio);
      data.setDate(data.getDate() + i * intervaloDias);
      return {
        numero: i + 1,
        data: formatDataBR(data),
        local: local.local,
        cidade: local.cidade,
        categoria: local.categoria,
        capacidade: local.capacidade,
        vendidos: 0,
        precoIngresso: local.precoIngresso,
        repasseIngresso: local.repasseIngresso,
        lucroMaximo: local.capacidade * local.repasseIngresso,
        receita: 0,
        status: "Agendado",
        soldOut: false,
        acoes: [],
      };
    });

    const ultimaData = agenda[agenda.length - 1]?.data || formatDataBR(inicio);
    const idUnico = `${artista}${telegramId}_${Date.now()}`;
    const porte = escolhidos[0]?.categoria || "";

    const row = TOUR_HEADERS.map((key) => {
      switch (key) {
        case "id_usuario":
          return telegramId;
        case "artista":
          return artista;
        case "id_unico":
          return idUnico;
        case "nome_da_turne":
          return nomeTurne;
        case "porte":
          return porte;
        case "total_de_shows":
          return agenda.length;
        case "data_inicio":
          return formatDataBR(inicio);
        case "data_termino":
          return ultimaData;
        case "agenda":
          return JSON.stringify(agenda);
        case "arrecadacao_em_tempo_real":
          return 0;
        case "status":
          return "Planejando";
        case "show_atual":
          return "";
        case "show_anterior":
          return "";
        case "capa":
          return normalizeText(body.capaUrl);
        case "meta_de_lucro":
          return metaLucro;
        default:
          return "";
      }
    });

    await googleSheetsService.usuarios.appendRow(TOURS_SHEET, row);

    return jsonOk({ idUnico, lucroMinimoTotal, lucroMaximoTotal, metaLucro, agenda });
  } catch (err) {
    console.error("[criarTurneController] Erro:", err);
    return jsonError("Falha ao criar a turnê.", 500);
  }
}

// Cada show recebe SÓ UMA ação — não acumula. O tipo escolhido já define o
// resultado direto (% da capacidade vendida) na hora.
const VENDIDOS_PCT_POR_ACAO: Record<TourAcaoDia["tipo"], number> = {
  foto: 100, // foto + resumo: sold out garantido
  interacao: 50,
  entrevista: 70,
  especial: 100, // evento especial: sold out garantido
};

// Faixa usada quando o jogador NÃO faz nenhuma ação no dia do show — a
// arrecadação não fica zerada, só sai de um sorteio dentro desse limite.
const AUTOMATICO_PCT_MIN = 10;
const AUTOMATICO_PCT_MAX = 55;

// Hash simples e determinístico (mesmo seed => sempre o mesmo resultado) —
// evita usar Math.random() e mudar o resultado toda vez que a turnê é lida.
function seededPct(seed: string, min: number, max: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const normalizado = (Math.abs(hash) % 1000) / 1000; // 0..1
  return Math.round(min + normalizado * (max - min));
}

async function persistAgenda(rowIndex: number, tour: Tour): Promise<void> {
  const novaArrecadacao = tour.agenda.reduce((s, x) => s + x.receita, 0);
  const agendaCol = colIndexToA1Letter(TOUR_HEADERS.indexOf("agenda"));
  const arrecadacaoCol = colIndexToA1Letter(TOUR_HEADERS.indexOf("arrecadacao_em_tempo_real"));
  await Promise.all([
    googleSheetsService.usuarios.updateValues(TOURS_SHEET, `${agendaCol}${rowIndex}`, [
      [JSON.stringify(tour.agenda)],
    ]),
    googleSheetsService.usuarios.updateValues(TOURS_SHEET, `${arrecadacaoCol}${rowIndex}`, [
      [novaArrecadacao],
    ]),
  ]);
}

// Resolve automaticamente (in-place) qualquer show cuja data já passou e que
// o jogador nunca tocou (sem ação nenhuma) — dá um resultado aleatório
// (porém determinístico, sempre o mesmo pro mesmo show) dentro da faixa
// AUTOMATICO_PCT_*, em vez de deixar a arrecadação zerada pra sempre.
// Devolve true se algo mudou (pra saber se precisa persistir).
function resolverShowsAutomaticos(tour: Tour): boolean {
  const hoje = formatDataBR(new Date());
  const hojeDate = parseDataBR(hoje);
  let mudou = false;
  for (const show of tour.agenda) {
    if (show.acoes.length > 0) continue;
    const data = parseDataBR(show.data);
    if (!data || !hojeDate || data >= hojeDate) continue;

    const pct = seededPct(`${tour.idUnico}-${show.numero}`, AUTOMATICO_PCT_MIN, AUTOMATICO_PCT_MAX);
    show.acoes.push({
      tipo: "interacao",
      texto: "O artista não fez nada especial nesse dia — o público apareceu por conta própria.",
      fotoUrl: null,
      data: data.toISOString(),
      vendidosPct: pct,
      automatica: true,
    });
    show.vendidos = Math.round((show.capacidade * pct) / 100);
    show.receita = show.vendidos * show.repasseIngresso;
    show.soldOut = false;
    show.status = "Realizado automaticamente";
    mudou = true;
  }
  return mudou;
}

interface AcaoDiaPayload {
  telegramId?: string;
  idUnico?: string;
  showNumero?: number;
  tipo?: TourAcaoDia["tipo"];
  texto?: string;
  fotoUrl?: string;
}

// POST /api/turnes/acao — o jogador realiza A ação do dia do show (foto,
// interação, entrevista ou evento especial) — só uma por show, sem
// acumular; o tipo escolhido já decide o resultado (sold out ou não) na
// hora.
export async function realizarAcaoDiaController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as AcaoDiaPayload;
    const telegramId = normalizeText(body.telegramId);
    const idUnico = normalizeText(body.idUnico);
    const showNumero = Number(body.showNumero);
    const tipo = body.tipo;
    const texto = normalizeText(body.texto);

    if (!telegramId || !idUnico || !showNumero || !tipo || !VENDIDOS_PCT_POR_ACAO[tipo]) {
      return jsonError("telegramId, idUnico, showNumero e tipo (válido) são obrigatórios.");
    }
    if (!texto) return jsonError("Escreva um resumo/texto para a ação.");

    const raw = await readToursRaw();
    const idUnicoCol = TOUR_HEADERS.indexOf("id_unico");
    const found = raw.find(
      ({ row }) => normalizeComparison(row[idUnicoCol]) === normalizeComparison(idUnico),
    );
    if (!found) return jsonError("Turnê não encontrada.", 404);

    const tour = rowToTour(found.row);
    if (normalizeComparison(tour.idUsuario) !== normalizeComparison(telegramId)) {
      return jsonError("Essa turnê não pertence a este jogador.", 403);
    }

    const show = tour.agenda.find((s) => s.numero === showNumero);
    if (!show) return jsonError("Show não encontrado nessa turnê.", 404);
    if (show.acoes.length > 0) {
      return jsonError("Esse show já teve a ação do dia registrada.");
    }

    const hoje = formatDataBR(new Date());
    if (show.data !== hoje) {
      return jsonError(`Ações só podem ser feitas no dia do show (${show.data}).`);
    }

    const pct = VENDIDOS_PCT_POR_ACAO[tipo];
    show.acoes.push({
      tipo,
      texto,
      fotoUrl: normalizeText(body.fotoUrl) || null,
      data: new Date().toISOString(),
      vendidosPct: pct,
    });
    show.vendidos = Math.round((show.capacidade * pct) / 100);
    show.soldOut = pct >= 100;
    show.status = show.soldOut ? "Esgotado" : "Realizado";
    show.receita = show.vendidos * show.repasseIngresso;

    const rowIndex = found.rowIndex;
    const showAtualCol = colIndexToA1Letter(TOUR_HEADERS.indexOf("show_atual"));
    await Promise.all([
      persistAgenda(rowIndex, tour),
      googleSheetsService.usuarios.updateValues(TOURS_SHEET, `${showAtualCol}${rowIndex}`, [
        [`${show.cidade} (show ${show.numero})`],
      ]),
    ]);

    somarPrestigio({ telegramId }, "turne_acao_dia").catch(() => {});
    if (show.soldOut) {
      somarPrestigio({ telegramId }, "turne_sold_out").catch(() => {});
    }

    const novaArrecadacao = tour.agenda.reduce((s, x) => s + x.receita, 0);
    return jsonOk({ show, arrecadacaoTempoReal: novaArrecadacao });
  } catch (err) {
    console.error("[realizarAcaoDiaController] Erro:", err);
    return jsonError("Falha ao registrar a ação do dia.", 500);
  }
}

interface ComentarioTurne {
  idUnico: string;
  showNumero: number;
  telegramId: string;
  usuario: string;
  texto: string;
  data: string;
}

// GET /api/turnes/comentarios?idUnico=...&showNumero=... — comentários de um
// show específico (a "central de notícias" da turnê).
export async function getComentariosTurneController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const idUnico = normalizeComparison(url.searchParams.get("idUnico") || "");
    const showNumero = url.searchParams.get("showNumero");
    if (!idUnico) return jsonError("idUnico é obrigatório.");

    const rows = await googleSheetsService.usuarios.readValues(COMENTARIOS_SHEET).catch(() => []);
    if (!rows || rows.length < 2) return jsonOk([]);

    const headers = dedupeHeaders(
      COMENTARIOS_SHEET,
      rows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
    );
    const idx = {
      idUnico: headers.indexOf("id_unico"),
      showNumero: headers.indexOf("show_numero"),
      usuario: headers.indexOf("usuario"),
      telegramId: headers.indexOf("telegram_id"),
      texto: headers.indexOf("texto"),
      data: headers.indexOf("data"),
    };

    const comentarios: ComentarioTurne[] = rows
      .slice(1)
      .filter(
        (r) =>
          normalizeComparison(r[idx.idUnico]) === idUnico &&
          (!showNumero || normalizeText(r[idx.showNumero]) === normalizeText(showNumero)),
      )
      .map((r) => ({
        idUnico: normalizeText(r[idx.idUnico]),
        showNumero: parseInt(normalizeText(r[idx.showNumero]), 10) || 0,
        telegramId: normalizeText(r[idx.telegramId]),
        usuario: normalizeText(r[idx.usuario]),
        texto: normalizeText(r[idx.texto]),
        data: normalizeText(r[idx.data]),
      }));

    return jsonOk(comentarios);
  } catch (err) {
    console.error("[getComentariosTurneController] Erro:", err);
    return jsonError("Falha ao carregar os comentários.", 500);
  }
}

interface ComentarPayload {
  idUnico?: string;
  showNumero?: number;
  telegramId?: string;
  usuario?: string;
  texto?: string;
}

// POST /api/turnes/comentar — comenta num show da turnê; comentar também
// soma prestígio (mesmo padrão do fórum).
export async function comentarTurneController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as ComentarPayload;
    const idUnico = normalizeText(body.idUnico);
    const showNumero = Number(body.showNumero) || 0;
    const telegramId = normalizeText(body.telegramId);
    const usuario = normalizeText(body.usuario);
    const texto = normalizeText(body.texto);

    if (!idUnico || !showNumero || !texto || (!telegramId && !usuario)) {
      return jsonError("idUnico, showNumero, texto e identificação do jogador são obrigatórios.");
    }

    await ensureSheetTab("usuarios", COMENTARIOS_SHEET);
    const existing = await googleSheetsService.usuarios.readValues(COMENTARIOS_SHEET).catch(() => []);
    if (!existing || existing.length === 0) {
      await googleSheetsService.usuarios.updateValues(COMENTARIOS_SHEET, "A1:F1", [
        ["ID único", "Show número", "Telegram ID", "Usuário", "Texto", "Data"],
      ]);
    }
    const row = [idUnico, showNumero, telegramId, usuario, texto, new Date().toISOString()];
    await googleSheetsService.usuarios.appendRow(COMENTARIOS_SHEET, row);

    somarPrestigio({ telegramId, usuario }, "comentario_turne").catch(() => {});

    return jsonOk({ ok: true });
  } catch (err) {
    console.error("[comentarTurneController] Erro:", err);
    return jsonError("Falha ao comentar.", 500);
  }
}

export interface MissaoProxima {
  idUnico: string;
  artista: string;
  nomeTurne: string;
  showNumero: number;
  local: string;
  cidade: string;
  data: string;
  diasRestantes: number;
  hoje: boolean;
}

// GET /api/turnes/missoes?telegramId=... — próximos shows (não esgotados)
// de todos os artistas do jogador, ordenados por data — pra ele se planejar
// antes do dia da ação chegar.
export async function getMissoesController(request: Request): Promise<Response> {
  try {
    const telegramId = getTelegramId(request);
    if (!telegramId) return jsonOk([]);

    const meusArtistas = await getArtistNamesForOwner(telegramId);
    const meusArtistasNorm = new Set(meusArtistas.map((a) => normalizeComparison(a)));

    const raw = await readToursRaw();
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const missoes: MissaoProxima[] = [];
    for (const { row } of raw) {
      const tour = rowToTour(row);
      if (!tour.sistemaNovo) continue;
      if (!meusArtistasNorm.has(normalizeComparison(tour.artista))) continue;

      for (const show of tour.agenda) {
        if (show.soldOut) continue;
        const data = parseDataBR(show.data);
        if (!data) continue;
        const diffMs = data.getTime() - hoje.getTime();
        const diasRestantes = Math.round(diffMs / (1000 * 60 * 60 * 24));
        if (diasRestantes < 0) continue;
        missoes.push({
          idUnico: tour.idUnico,
          artista: tour.artista,
          nomeTurne: tour.nomeTurne,
          showNumero: show.numero,
          local: show.local,
          cidade: show.cidade,
          data: show.data,
          diasRestantes,
          hoje: diasRestantes === 0,
        });
      }
    }

    missoes.sort((a, b) => a.diasRestantes - b.diasRestantes);
    return jsonOk(missoes.slice(0, 20));
  } catch (err) {
    console.error("[getMissoesController] Erro:", err);
    return jsonError("Falha ao carregar as próximas missões.", 500);
  }
}

export interface FeedItem {
  idUnico: string;
  artista: string;
  nomeTurne: string;
  showNumero: number;
  local: string;
  cidade: string;
  data: string;
  soldOut: boolean;
  tipo: TourAcaoDia["tipo"];
  texto: string;
  fotoUrl?: string | null;
  vendidosPct: number;
  timestamp: string;
}

// GET /api/turnes/feed?limit=20 — central de notícias global: últimas ações
// do dia postadas em QUALQUER turnê do sistema novo, mais recentes primeiro.
// Não inclui shows resolvidos automaticamente (o jogador não postou nada).
export async function getFeedGlobalController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10) || 20));

    const raw = await readToursRaw();
    const itens: FeedItem[] = [];
    for (const { row } of raw) {
      const tour = rowToTour(row);
      if (!tour.sistemaNovo) continue;
      for (const show of tour.agenda) {
        for (const acao of show.acoes) {
          if (acao.automatica) continue;
          itens.push({
            idUnico: tour.idUnico,
            artista: tour.artista,
            nomeTurne: tour.nomeTurne,
            showNumero: show.numero,
            local: show.local,
            cidade: show.cidade,
            data: show.data,
            soldOut: show.soldOut,
            tipo: acao.tipo,
            texto: acao.texto,
            fotoUrl: acao.fotoUrl,
            vendidosPct: acao.vendidosPct,
            timestamp: acao.data,
          });
        }
      }
    }

    itens.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return jsonOk(itens.slice(0, limit));
  } catch (err) {
    console.error("[getFeedGlobalController] Erro:", err);
    return jsonError("Falha ao carregar a central de notícias.", 500);
  }
}
