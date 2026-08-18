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
  hypeGanho: number;
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
  hype: number;
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
          hype: Number(s.hype) || 0,
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
      .map(({ row }) => rowToTour(row))
      .filter((t) => {
        if (artistaFiltro) return normalizeComparison(t.artista) === artistaFiltro;
        if (telegramId) return meusArtistasNorm.has(normalizeComparison(t.artista));
        return true;
      });

    return jsonOk(tours);
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

    return jsonOk(rowToTour(found.row));
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
        hype: 0,
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

const HYPE_POR_ACAO: Record<TourAcaoDia["tipo"], number> = {
  foto: 40,
  interacao: 25,
  entrevista: 30,
  especial: 50,
};

const HYPE_SOLD_OUT = 100;

interface AcaoDiaPayload {
  telegramId?: string;
  idUnico?: string;
  showNumero?: number;
  tipo?: TourAcaoDia["tipo"];
  texto?: string;
  fotoUrl?: string;
}

// POST /api/turnes/acao — o jogador realiza uma ação no dia do show (foto,
// interação, entrevista ou evento especial). Cada ação soma "hype"; ao
// atingir o limiar, o show fica esgotado (sold out garantido).
export async function realizarAcaoDiaController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as AcaoDiaPayload;
    const telegramId = normalizeText(body.telegramId);
    const idUnico = normalizeText(body.idUnico);
    const showNumero = Number(body.showNumero);
    const tipo = body.tipo;
    const texto = normalizeText(body.texto);

    if (!telegramId || !idUnico || !showNumero || !tipo || !HYPE_POR_ACAO[tipo]) {
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
    if (show.soldOut) return jsonError("Esse show já está esgotado.");

    const hoje = formatDataBR(new Date());
    if (show.data !== hoje) {
      return jsonError(`Ações só podem ser feitas no dia do show (${show.data}).`);
    }

    const hypeGanho = HYPE_POR_ACAO[tipo];
    show.acoes.push({
      tipo,
      texto,
      fotoUrl: normalizeText(body.fotoUrl) || null,
      data: new Date().toISOString(),
      hypeGanho,
    });
    show.hype = Math.min(HYPE_SOLD_OUT, show.hype + hypeGanho);

    if (show.hype >= HYPE_SOLD_OUT) {
      show.soldOut = true;
      show.vendidos = show.capacidade;
      show.status = "Esgotado";
    } else {
      show.vendidos = Math.round((show.capacidade * show.hype) / 100);
      show.status = "Agendado";
    }
    show.receita = show.vendidos * show.repasseIngresso;

    const novaArrecadacao = tour.agenda.reduce((s, x) => s + x.receita, 0);

    const rowIndex = found.rowIndex;
    const agendaCol = colIndexToA1Letter(TOUR_HEADERS.indexOf("agenda"));
    const arrecadacaoCol = colIndexToA1Letter(TOUR_HEADERS.indexOf("arrecadacao_em_tempo_real"));
    const showAtualCol = colIndexToA1Letter(TOUR_HEADERS.indexOf("show_atual"));

    await Promise.all([
      googleSheetsService.usuarios.updateValues(TOURS_SHEET, `${agendaCol}${rowIndex}`, [
        [JSON.stringify(tour.agenda)],
      ]),
      googleSheetsService.usuarios.updateValues(TOURS_SHEET, `${arrecadacaoCol}${rowIndex}`, [
        [novaArrecadacao],
      ]),
      googleSheetsService.usuarios.updateValues(TOURS_SHEET, `${showAtualCol}${rowIndex}`, [
        [`${show.cidade} (show ${show.numero})`],
      ]),
    ]);

    somarPrestigio({ telegramId }, "turne_acao_dia").catch(() => {});
    if (show.soldOut) {
      somarPrestigio({ telegramId }, "turne_sold_out").catch(() => {});
    }

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
