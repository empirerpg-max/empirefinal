import {
  readValues,
  updateValues,
  appendRow,
  normalizeText,
  normalizeComparison,
  ensureSheetTab,
} from "../services/googleSheetsService";
import { getArtistNamesForOwner } from "./artistasController";
import { resolveNomeOficial } from "./forumController";

// "Indicar" (Perfil > Premiações > Indicar) — cada premiação retroativa vira
// uma planilha própria, sempre no MESMO formato de 3 abas, confirmado ao
// vivo com o usuário:
//
// Detalhes (1 linha de dados, linha 2):
//   A Premiação | B Abertura | C Encerramento | D Início elegibilidade |
//   E Término elegibilidade | F Tipo de Material (bate com a aba de tipos
//   do Catálogo) | G Capa
//
// Categorias (1 linha por categoria, a partir da linha 2):
//   A Categoria | B Descritivo (exibido) | C Tipo de categoria (não exibido,
//   não usado por enquanto) | D Gênero (filtro, não usado por enquanto) |
//   E Tipo de música (filtro — se preenchido, só materiais cujo EDIÇÃO
//   CHARTS!D contém uma das palavras daqui) | F PREMIA ("MUSIC VIDEO" |
//   "ÁLBUM" | "ARTIST" — de que fonte vêm os indicáveis dessa categoria)
//
// Indicações (o app escreve aqui conforme os jogadores indicam):
//   A Categoria | B Título | C Artista | D Artista+Título (só registro) |
//   E Código único do material | F Jogador que indicou
//
// Cada jogador só pode indicar material dos PRÓPRIOS artistas (mesma regra
// de posse usada no resto do app, getArtistNamesForOwner).
//
// Registry das planilhas "Indicar" ativas — cada nova premiação desse tipo
// que o usuário criar entra aqui (mesmo formato, nova linha).
const PREMIACOES_INDICAR: string[] = [
  "1d6lwyAjkLfgJz9ffhxfxPT1UYJ6eonjvRzascptU_Ao",
];

const ADMIN_ID = "810141686";

interface DetalhesAward {
  id: string;
  premiacao: string;
  abertura: string;
  encerramento: string;
  inicioElegibilidade: string;
  terminoElegibilidade: string;
  tipoMaterial: string;
  capaUrl: string;
  status: "agendado" | "aberto" | "encerrado";
}

interface CategoriaAward {
  categoria: string;
  descritivo: string;
  genero: string;
  tipoMusica: string;
  premia: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Datas nessas planilhas vêm como texto "DD/MM/AAAA" (confirmado ao vivo) —
// converte pra Date comparável. Encerramento é INCLUSIVO até o fim do dia
// (confirmado: "se é até 30/09, quando virar o dia 1 não pode mais").
function parseDataBR(str: string): Date | null {
  const m = normalizeText(str).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function calcularStatus(abertura: string, encerramento: string): DetalhesAward["status"] {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dAbertura = parseDataBR(abertura);
  const dEncerramento = parseDataBR(encerramento);
  if (dAbertura && hoje < dAbertura) return "agendado";
  if (dEncerramento) {
    const fimDoDia = new Date(dEncerramento);
    fimDoDia.setHours(23, 59, 59, 999);
    if (hoje > fimDoDia) return "encerrado";
  }
  return "aberto";
}

async function lerDetalhes(awardId: string): Promise<DetalhesAward | null> {
  const rows = await readValues(awardId, "Detalhes", "A2:G2").catch(() => []);
  const row = rows?.[0];
  if (!row || !normalizeText(row[0])) return null;
  const abertura = normalizeText(row[1]);
  const encerramento = normalizeText(row[2]);
  return {
    id: awardId,
    premiacao: normalizeText(row[0]),
    abertura,
    encerramento,
    inicioElegibilidade: normalizeText(row[3]),
    terminoElegibilidade: normalizeText(row[4]),
    tipoMaterial: normalizeText(row[5]),
    capaUrl: normalizeText(row[6]),
    status: calcularStatus(abertura, encerramento),
  };
}

async function lerCategorias(awardId: string): Promise<CategoriaAward[]> {
  const rows = await readValues(awardId, "Categorias", "A2:F1000").catch(() => []);
  return rows
    .filter((r) => normalizeText(r[0]))
    .map((r) => ({
      categoria: normalizeText(r[0]),
      descritivo: normalizeText(r[1]),
      genero: normalizeText(r[3]),
      tipoMusica: normalizeText(r[4]),
      premia: normalizeText(r[5]),
    }));
}

// GET /api/premiacoes/indicar/awards
export async function listarPremiacoesIndicarController(): Promise<Response> {
  const detalhes = await Promise.all(PREMIACOES_INDICAR.map((id) => lerDetalhes(id).catch(() => null)));
  return jsonResponse({ success: true, data: detalhes.filter((d): d is DetalhesAward => !!d) });
}

// GET /api/premiacoes/indicar/categorias?awardId=...
export async function listarCategoriasIndicarController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const awardId = normalizeText(url.searchParams.get("awardId"));
  if (!awardId) return jsonResponse({ success: false, error: "awardId é obrigatório." }, 400);
  const [detalhes, categorias] = await Promise.all([lerDetalhes(awardId), lerCategorias(awardId)]);
  if (!detalhes) return jsonResponse({ success: false, error: "Premiação não encontrada." }, 404);
  return jsonResponse({ success: true, data: { detalhes, categorias } });
}

interface Candidato {
  titulo: string;
  artista: string;
  codigoUnico: string;
}

async function dentroDaElegibilidade(dataStr: string, inicio: string, termino: string): Promise<boolean> {
  const data = parseDataBR(dataStr);
  if (!data) return false;
  const dInicio = parseDataBR(inicio);
  const dTermino = parseDataBR(termino);
  if (dInicio && data < dInicio) return false;
  if (dTermino) {
    const fimDoDia = new Date(dTermino);
    fimDoDia.setHours(23, 59, 59, 999);
    if (data > fimDoDia) return false;
  }
  return true;
}

// Categorias!E ("tipo de música") pode trazer mais de uma palavra
// (separadas por vírgula) — elegível se EDIÇÃO CHARTS!D contiver qualquer
// uma delas.
async function passaFiltroTipoMusica(codigoUnico: string, tipoMusicaFiltro: string, cacheEdicaoCharts: Map<string, string>): Promise<boolean> {
  if (!tipoMusicaFiltro || !codigoUnico) return true;
  const tipoNaPlanilha = cacheEdicaoCharts.get(normalizeComparison(codigoUnico));
  if (!tipoNaPlanilha) return false;
  const palavras = tipoMusicaFiltro.split(",").map((p) => normalizeComparison(p.trim())).filter(Boolean);
  const tipoNorm = normalizeComparison(tipoNaPlanilha);
  return palavras.some((p) => tipoNorm.includes(p));
}

// GET /api/premiacoes/indicar/candidatos?awardId=...&categoria=...&telegramId=...
export async function listarCandidatosIndicarController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const awardId = normalizeText(url.searchParams.get("awardId"));
  const categoriaNome = normalizeText(url.searchParams.get("categoria"));
  const telegramId = normalizeText(url.searchParams.get("telegramId"));
  if (!awardId || !categoriaNome || !telegramId) {
    return jsonResponse({ success: false, error: "awardId, categoria e telegramId são obrigatórios." }, 400);
  }

  const [detalhes, categorias, meusArtistas] = await Promise.all([
    lerDetalhes(awardId),
    lerCategorias(awardId),
    getArtistNamesForOwner(telegramId),
  ]);
  if (!detalhes) return jsonResponse({ success: false, error: "Premiação não encontrada." }, 404);
  const categoria = categorias.find((c) => normalizeComparison(c.categoria) === normalizeComparison(categoriaNome));
  if (!categoria) return jsonResponse({ success: false, error: "Categoria não encontrada." }, 404);

  const normArtistas = new Set(meusArtistas.map(normalizeComparison));
  const candidatos: Candidato[] = [];
  const premiaNorm = normalizeComparison(categoria.premia);

  if (premiaNorm === "artist" || premiaNorm.includes("artist")) {
    for (const artista of meusArtistas) {
      candidatos.push({ titulo: artista, artista, codigoUnico: "" });
    }
  } else if (premiaNorm.includes("album") || premiaNorm.includes("álbum") || premiaNorm.includes("albuns")) {
    const albunsRows = await readValues("principal", "Albuns").catch(() => []);
    for (let i = 1; i < albunsRows.length; i++) {
      const row = albunsRows[i];
      const fullTitle = normalizeText(row[6]);
      if (!fullTitle) continue;
      const sep = fullTitle.indexOf(" - ");
      const artista = sep >= 0 ? fullTitle.slice(0, sep).trim() : fullTitle;
      if (!normArtistas.has(normalizeComparison(artista))) continue;
      const dataLancamento = normalizeText(row[0]);
      if (!(await dentroDaElegibilidade(dataLancamento, detalhes.inicioElegibilidade, detalhes.terminoElegibilidade))) continue;
      candidatos.push({
        titulo: sep >= 0 ? fullTitle.slice(sep + 3).trim() : fullTitle,
        artista,
        codigoUnico: normalizeText(row[11]),
      });
    }
  } else {
    // Padrão: material do tipo definido em Detalhes!F (ex: "Music Video")
    // — PONTOS!N marca se a música tem vídeo lançado, O é a data dele, AE
    // o código único pra cruzar com EDIÇÃO CHARTS.
    const [pontosRows, edicaoChartsRows] = await Promise.all([
      readValues("registrosCharts", "PONTOS").catch(() => []),
      categoria.tipoMusica ? readValues("edicaoCharts", "EDIÇÃO CHARTS", "A2:BD20000").catch(() => []) : Promise.resolve([]),
    ]);

    const cacheEdicaoCharts = new Map<string, string>();
    for (const row of edicaoChartsRows) {
      const codigo = normalizeText(row[55]); // BD (0-based: A=0 ... BD=55)
      if (codigo) cacheEdicaoCharts.set(normalizeComparison(codigo), normalizeText(row[3])); // D - TIPO DE MÚSICA
    }

    for (let i = 3; i < pontosRows.length; i++) {
      const row = pontosRows[i];
      if (!row) continue;
      const artista = normalizeText(row[2]); // C
      if (!normArtistas.has(normalizeComparison(artista))) continue;
      const temVideo = normalizeText(row[13]); // N
      if (!temVideo || normalizeComparison(temVideo) === "nao" || normalizeComparison(temVideo) === "não") continue;
      const dataVideo = normalizeText(row[14]); // O
      if (!(await dentroDaElegibilidade(dataVideo, detalhes.inicioElegibilidade, detalhes.terminoElegibilidade))) continue;
      const codigoUnico = normalizeText(row[30]); // AE
      if (!(await passaFiltroTipoMusica(codigoUnico, categoria.tipoMusica, cacheEdicaoCharts))) continue;
      // PONTOS!D vem como "Artista - Título" completo — tira o prefixo do
      // artista, senão o título indicado sai duplicando o nome dele.
      const musicaCompleta = normalizeText(row[3]); // D
      if (!musicaCompleta) continue;
      const prefixo = `${artista} - `;
      const titulo = musicaCompleta.toLowerCase().startsWith(prefixo.toLowerCase())
        ? musicaCompleta.slice(prefixo.length).trim()
        : musicaCompleta;
      candidatos.push({ titulo, artista, codigoUnico });
    }
  }

  return jsonResponse({ success: true, data: candidatos });
}

// POST /api/premiacoes/indicar
export async function criarIndicacaoController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    awardId?: string;
    categoria?: string;
    titulo?: string;
    artista?: string;
    codigoUnico?: string;
    telegramId?: string;
  };
  const awardId = normalizeText(body.awardId);
  const categoria = normalizeText(body.categoria);
  const titulo = normalizeText(body.titulo);
  const artista = normalizeText(body.artista);
  const codigoUnico = normalizeText(body.codigoUnico);
  const telegramId = normalizeText(body.telegramId);
  if (!awardId || !categoria || !titulo || !artista || !telegramId) {
    return jsonResponse({ success: false, error: "Campos obrigatórios ausentes." }, 400);
  }

  const detalhes = await lerDetalhes(awardId);
  if (!detalhes) return jsonResponse({ success: false, error: "Premiação não encontrada." }, 404);
  if (detalhes.status !== "aberto") {
    return jsonResponse({ success: false, error: "Essa premiação não está aberta pra indicações no momento." }, 403);
  }

  const categorias = await lerCategorias(awardId);
  const categoriaObj = categorias.find((c) => normalizeComparison(c.categoria) === normalizeComparison(categoria));
  if (!categoriaObj) return jsonResponse({ success: false, error: "Categoria não encontrada." }, 404);

  // Dono só pode indicar material dele mesmo — pra categoria PREMIA=ARTIST
  // o "artista" indicado É o material, então a checagem é sobre ele
  // próprio; nos outros casos, sobre o dono do material indicado.
  const meusArtistas = await getArtistNamesForOwner(telegramId);
  const normArtistas = new Set(meusArtistas.map(normalizeComparison));
  if (!normArtistas.has(normalizeComparison(artista)) && telegramId !== ADMIN_ID) {
    return jsonResponse({ success: false, error: "Esse material não é de um artista seu." }, 403);
  }

  const nomeJogador = await resolveNomeOficial(telegramId, "Jogador");

  // Evita indicação idêntica duplicada (mesmo jogador, categoria e título).
  const existentesRows = await readValues(awardId, "Indicações", "A2:F20000").catch(() => []);
  const jaExiste = existentesRows.some(
    (r) =>
      normalizeComparison(normalizeText(r[0])) === normalizeComparison(categoria) &&
      normalizeComparison(normalizeText(r[1])) === normalizeComparison(titulo) &&
      normalizeComparison(normalizeText(r[5])) === normalizeComparison(nomeJogador),
  );
  if (jaExiste) return jsonResponse({ success: false, error: "Você já indicou esse material nessa categoria." }, 409);

  await appendRow(awardId, "Indicações", [categoria, titulo, artista, `${artista} - ${titulo}`, codigoUnico, nomeJogador], "A:F");

  return jsonResponse({ success: true });
}

// GET /api/premiacoes/indicar/minhas?awardId=...&telegramId=...
export async function listarMinhasIndicacoesController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const awardId = normalizeText(url.searchParams.get("awardId"));
  const telegramId = normalizeText(url.searchParams.get("telegramId"));
  if (!awardId || !telegramId) return jsonResponse({ success: false, error: "awardId e telegramId são obrigatórios." }, 400);

  const nomeJogador = await resolveNomeOficial(telegramId, "Jogador");
  const rows = await readValues(awardId, "Indicações", "A2:F20000").catch(() => []);
  const minhas = rows
    .map((r, i) => ({
      linha: i + 2,
      categoria: normalizeText(r[0]),
      titulo: normalizeText(r[1]),
      artista: normalizeText(r[2]),
      jogador: normalizeText(r[5]),
    }))
    .filter((r) => r.categoria && normalizeComparison(r.jogador) === normalizeComparison(nomeJogador));

  return jsonResponse({ success: true, data: minhas });
}

// POST /api/premiacoes/indicar/remover
export async function removerIndicacaoController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    awardId?: string;
    linha?: number;
    telegramId?: string;
  };
  const awardId = normalizeText(body.awardId);
  const linha = Number(body.linha);
  const telegramId = normalizeText(body.telegramId);
  if (!awardId || !linha || linha < 2 || !telegramId) {
    return jsonResponse({ success: false, error: "awardId, linha e telegramId são obrigatórios." }, 400);
  }

  const detalhes = await lerDetalhes(awardId);
  if (!detalhes) return jsonResponse({ success: false, error: "Premiação não encontrada." }, 404);
  if (detalhes.status !== "aberto" && telegramId !== ADMIN_ID) {
    return jsonResponse({ success: false, error: "Essa premiação não está mais aberta." }, 403);
  }

  const nomeJogador = await resolveNomeOficial(telegramId, "Jogador");
  const rows = await readValues(awardId, "Indicações", `A${linha}:F${linha}`).catch(() => []);
  const row = rows?.[0];
  if (!row || !normalizeText(row[0])) return jsonResponse({ success: false, error: "Indicação não encontrada." }, 404);
  if (normalizeComparison(normalizeText(row[5])) !== normalizeComparison(nomeJogador) && telegramId !== ADMIN_ID) {
    return jsonResponse({ success: false, error: "Essa indicação não é sua." }, 403);
  }

  await updateValues(awardId, "Indicações", `A${linha}:F${linha}`, [["", "", "", "", "", ""]]);
  return jsonResponse({ success: true });
}

// ---- Popup diário de lembrete de indicação (VMA) ----
// Aba própria "VMA_POPUP_STATUS" na planilha registrosCharts (mesma
// planilha de outras abas auxiliares como INFOS ACTS e PONTOS) —
// A telegramId | B status ("" ou "indicado", permanente) |
// C última exibição (DD/MM/AAAA, controla o "1x por dia").
const POPUP_SPREADSHEET_KEY = "registrosCharts";
const POPUP_SHEET = "VMA_POPUP_STATUS";
// A premiação que o popup promove é sempre a primeira (e, por ora, única)
// entrada de PREMIACOES_INDICAR — se um dia existir mais de uma premiação
// aberta simultaneamente, decidir qual delas o popup deve trazer.
const POPUP_AWARD_ID = PREMIACOES_INDICAR[0];

function hojeBR(): string {
  // Horário de Brasília (UTC-3) — mesmo ajuste usado no crédito de
  // login_diario, pra "hoje" não virar o dia seguinte cedo demais.
  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const dd = String(hoje.getDate()).padStart(2, "0");
  const mm = String(hoje.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${hoje.getFullYear()}`;
}

// Garante a aba E o cabeçalho (linha 1) — sem o cabeçalho, a primeira
// escrita numa aba recém-criada caía na própria linha 1 (a API do Sheets
// aponta "primeira linha livre" pra linha 1 numa aba totalmente vazia),
// enquanto a leitura sempre partia de A2, então essa primeira linha nunca
// era enxergada de novo (bug real: usuário clicava "já indiquei", a escrita
// ia pra uma linha que a leitura seguinte não via, e o popup voltava a
// aparecer). Com cabeçalho fixo em A1:C1, dado sempre começa em A2 tanto
// pra leitura quanto pra escrita (appendRow), sem ambiguidade.
async function ensurePopupSheetPronta(): Promise<void> {
  await ensureSheetTab(POPUP_SPREADSHEET_KEY, POPUP_SHEET);
  const header = await readValues(POPUP_SPREADSHEET_KEY, POPUP_SHEET, "A1:C1").catch(() => []);
  if (!normalizeText(header?.[0]?.[0])) {
    await updateValues(POPUP_SPREADSHEET_KEY, POPUP_SHEET, "A1:C1", [
      ["telegramId", "status", "ultima_exibicao"],
    ]);
  }
}

async function lerLinhaPopup(telegramId: string): Promise<{ linha: number; status: string; ultimaExibicao: string } | null> {
  const rows = await readValues(POPUP_SPREADSHEET_KEY, POPUP_SHEET, "A2:C20000").catch(() => []);
  const idx = rows.findIndex((r) => normalizeComparison(normalizeText(r[0])) === normalizeComparison(telegramId));
  if (idx === -1) return null;
  const row = rows[idx];
  return { linha: idx + 2, status: normalizeText(row[1]), ultimaExibicao: normalizeText(row[2]) };
}

// GET /api/premiacoes/indicar/popup-status?telegramId=...
// Decide se o popup diário de lembrete deve aparecer pra esse jogador e,
// se sim, já marca como "exibido hoje" nessa mesma chamada (evita reexibir
// no mesmo dia mesmo se o jogador só fechar o popup sem clicar em nada).
export async function popupVmaStatusController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const telegramId = normalizeText(url.searchParams.get("telegramId"));
  if (!telegramId) return jsonResponse({ success: false, error: "telegramId é obrigatório." }, 400);
  if (!POPUP_AWARD_ID) return jsonResponse({ success: true, data: { shouldShow: false } });

  const detalhes = await lerDetalhes(POPUP_AWARD_ID);
  if (!detalhes || detalhes.status !== "aberto") {
    return jsonResponse({ success: true, data: { shouldShow: false } });
  }

  await ensurePopupSheetPronta();
  const existente = await lerLinhaPopup(telegramId);
  const hoje = hojeBR();

  if (existente?.status === "indicado") {
    return jsonResponse({ success: true, data: { shouldShow: false } });
  }
  if (existente?.ultimaExibicao === hoje) {
    return jsonResponse({ success: true, data: { shouldShow: false } });
  }

  if (existente) {
    await updateValues(POPUP_SPREADSHEET_KEY, POPUP_SHEET, `C${existente.linha}`, [[hoje]]);
  } else {
    // "OVERWRITE" (não o padrão "INSERT_ROWS"): o modo padrão insere e
    // EMPURRA linhas existentes pra baixo — em chamadas concorrentes
    // (vários jogadores abrindo o app ao mesmo tempo) isso desalinhava
    // linha/coluna de escritas anteriores (bug real observado: telegramId
    // numa linha, "indicado" e a data em linhas/colunas diferentes).
    // OVERWRITE sempre escreve na próxima linha vazia de verdade, sem
    // deslocar nada.
    await appendRow(POPUP_SPREADSHEET_KEY, POPUP_SHEET, [telegramId, "", hoje], "A:C", "OVERWRITE");
  }

  return jsonResponse({
    success: true,
    data: {
      shouldShow: true,
      award: {
        id: detalhes.id,
        premiacao: detalhes.premiacao,
        capaUrl: detalhes.capaUrl,
        encerramento: detalhes.encerramento,
      },
    },
  });
}

// POST /api/premiacoes/indicar/popup-dismiss — "Já indiquei": não mostra
// mais o popup pra esse jogador (permanente, não só por hoje).
export async function popupVmaDismissController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { telegramId?: string };
  const telegramId = normalizeText(body.telegramId);
  if (!telegramId) return jsonResponse({ success: false, error: "telegramId é obrigatório." }, 400);

  await ensurePopupSheetPronta();
  const existente = await lerLinhaPopup(telegramId);
  const hoje = hojeBR();

  if (existente) {
    await updateValues(POPUP_SPREADSHEET_KEY, POPUP_SHEET, `B${existente.linha}:C${existente.linha}`, [
      ["indicado", hoje],
    ]);
  } else {
    await appendRow(POPUP_SPREADSHEET_KEY, POPUP_SHEET, [telegramId, "indicado", hoje], "A:C", "OVERWRITE");
  }

  return jsonResponse({ success: true });
}

// GET /api/premiacoes/indicar/admin/popup-reset?telegramId=... — one-off de
// teste: limpa o estado do popup pra esse jogador (volta a valer "nunca
// visto"), útil pra validar o popup sem esperar o dia seguinte virar.
export async function adminPopupVmaResetController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const telegramId = normalizeText(url.searchParams.get("telegramId"));
  if (!telegramId) return jsonResponse({ success: false, error: "telegramId é obrigatório." }, 400);

  await ensurePopupSheetPronta();
  const existente = await lerLinhaPopup(telegramId);
  if (existente) {
    await updateValues(POPUP_SPREADSHEET_KEY, POPUP_SHEET, `B${existente.linha}:C${existente.linha}`, [["", ""]]);
  }
  return jsonResponse({ success: true, reset: !!existente });
}

// GET /api/premiacoes/indicar/admin/popup-limpar-tudo — one-off de
// migração: apaga TODO o conteúdo de VMA_POPUP_STATUS (linhas escritas
// antes do fix do cabeçalho, que podiam estar na linha 1 sem serem vistas
// nunca mais pela leitura, que sempre partia de A2). Depois disso a
// próxima checagem recria o cabeçalho certinho em A1:C1.
export async function adminPopupVmaLimparTudoController(): Promise<Response> {
  await updateValues(
    POPUP_SPREADSHEET_KEY,
    POPUP_SHEET,
    "A1:C200",
    Array.from({ length: 200 }, () => ["", "", ""]),
  ).catch(() => {});
  return jsonResponse({ success: true });
}
