import {
  readValues,
  updateValues,
  ensureSheetTab,
  normalizeText,
  normalizeComparison,
} from "../services/googleSheetsService";
import { getArtistNamesForOwner } from "./artistasController";

// Perfil > Festivais > Inscrição — formulário simples (1 artista + 1 gênero
// por envio), período fixo 11/11 a 17/11/2026 às 23:59 (horário de
// Brasília). Cada jogador pode inscrever cada um dos PRÓPRIOS artistas uma
// vez só (edita depois se quiser trocar o gênero, nunca duplica linha).
//
// Planilha dedicada (criada manualmente pelo usuário, já com as colunas):
// https://docs.google.com/spreadsheets/d/1lFw9l76tYZYCDXhZsoiftIEzCvKcjCrI_oBpvUdwAlo
// Aba "Inscrições_Festivais": A ARTISTA | B GÊNERO MUSICAL | C DATA DE INSCRIÇÃO
const FESTIVAIS_SPREADSHEET_ID = "1lFw9l76tYZYCDXhZsoiftIEzCvKcjCrI_oBpvUdwAlo";
const FESTIVAIS_SHEET = "Inscrições_Festivais";

export const GENEROS_FESTIVAL = [
  "Pop",
  "Dance",
  "K-Pop",
  "Eletrônica",
  "Rock",
  "Indie",
  "Alternativo",
  "Latina",
  "Rap",
  "Hip-Hop",
  "R&B",
] as const;

// Abertura 11/11/2026 00:00 e encerramento 17/11/2026 23:59, horário de
// Brasília (UTC-3) — mesmo ajuste de fuso já usado em indicacoesController.ts
// (hojeBR) pra não virar o dia errado cedo demais/tarde demais.
const ABERTURA_ISO = "2026-11-11T00:00:00-03:00";
const ENCERRAMENTO_ISO = "2026-11-17T23:59:59-03:00";
export const DEADLINE_LABEL = "17/11 às 23:59 (horário de Brasília)";

export function statusInscricaoFestival(): "agendado" | "aberto" | "encerrado" {
  const agora = Date.now();
  const abertura = new Date(ABERTURA_ISO).getTime();
  const encerramento = new Date(ENCERRAMENTO_ISO).getTime();
  if (agora < abertura) return "agendado";
  if (agora > encerramento) return "encerrado";
  return "aberto";
}

function dataHoraBR(): string {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function lerInscricoes(): Promise<{ linha: number; artista: string; genero: string; data: string }[]> {
  await ensureSheetTab(FESTIVAIS_SPREADSHEET_ID, FESTIVAIS_SHEET);
  const rows = await readValues(FESTIVAIS_SPREADSHEET_ID, FESTIVAIS_SHEET, "A2:C20000").catch(() => []);
  return rows
    .map((row, i) => ({ linha: i + 2, artista: normalizeText(row[0]), genero: normalizeText(row[1]), data: normalizeText(row[2]) }))
    .filter((r) => r.artista);
}

// GET /api/festivais/inscricao?telegramId=...
// Devolve os artistas do jogador, os gêneros disponíveis, o status do
// período e as inscrições já feitas (pra pré-preencher o form em modo
// "editar" em vez de deixar parecer que nunca inscreveu).
export async function getFestivalInscricaoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const telegramId = normalizeText(url.searchParams.get("telegramId"));
  if (!telegramId) return jsonResponse({ success: false, error: "telegramId é obrigatório." }, 400);

  const [artistas, todasInscricoes] = await Promise.all([
    getArtistNamesForOwner(telegramId),
    lerInscricoes(),
  ]);

  const artistasNorm = new Set(artistas.map((a) => normalizeComparison(a)));
  const minhasInscricoes = todasInscricoes
    .filter((r) => artistasNorm.has(normalizeComparison(r.artista)))
    .map((r) => ({ artista: r.artista, genero: r.genero, data: r.data }));

  return jsonResponse({
    success: true,
    data: {
      status: statusInscricaoFestival(),
      deadlineLabel: DEADLINE_LABEL,
      artistas,
      generos: GENEROS_FESTIVAL,
      inscricoes: minhasInscricoes,
    },
  });
}

// POST /api/festivais/inscricao { telegramId, artista, genero }
// Cria a inscrição do artista (primeira vez) ou edita o gênero de uma já
// existente — nunca duplica linha pro mesmo artista. Sempre checa, igual
// ao resto do app (ver getArtistNamesForOwner), que o artista escolhido é
// de verdade de posse do jogador antes de gravar qualquer coisa.
export async function postFestivalInscricaoController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    telegramId?: string;
    artista?: string;
    genero?: string;
  };
  const telegramId = normalizeText(body.telegramId);
  const artista = normalizeText(body.artista);
  const genero = normalizeText(body.genero);

  if (!telegramId || !artista || !genero) {
    return jsonResponse({ success: false, error: "telegramId, artista e genero são obrigatórios." }, 400);
  }

  const status = statusInscricaoFestival();
  if (status === "agendado") {
    return jsonResponse({ success: false, error: "As inscrições ainda não abriram." }, 403);
  }
  if (status === "encerrado") {
    return jsonResponse({ success: false, error: `As inscrições já encerraram (prazo era ${DEADLINE_LABEL}).` }, 403);
  }

  const generoValido = GENEROS_FESTIVAL.find((g) => normalizeComparison(g) === normalizeComparison(genero));
  if (!generoValido) {
    return jsonResponse({ success: false, error: "Gênero musical inválido." }, 400);
  }

  const meusArtistas = await getArtistNamesForOwner(telegramId);
  const artistaValido = meusArtistas.find((a) => normalizeComparison(a) === normalizeComparison(artista));
  if (!artistaValido) {
    return jsonResponse({ success: false, error: "Esse artista não é seu — selecione um dos seus próprios artistas." }, 403);
  }

  await ensureSheetTab(FESTIVAIS_SPREADSHEET_ID, FESTIVAIS_SHEET);
  const header = await readValues(FESTIVAIS_SPREADSHEET_ID, FESTIVAIS_SHEET, "A1:C1").catch(() => []);
  if (!normalizeText(header?.[0]?.[0])) {
    await updateValues(FESTIVAIS_SPREADSHEET_ID, FESTIVAIS_SHEET, "A1:C1", [
      ["ARTISTA", "GÊNERO MUSICAL", "DATA DE INSCRIÇÃO"],
    ]);
  }

  const inscricoes = await lerInscricoes();
  const existente = inscricoes.find((r) => normalizeComparison(r.artista) === normalizeComparison(artistaValido));
  const agora = dataHoraBR();

  if (existente) {
    await updateValues(FESTIVAIS_SPREADSHEET_ID, FESTIVAIS_SHEET, `A${existente.linha}:C${existente.linha}`, [
      [artistaValido, generoValido, agora],
    ]);
    return jsonResponse({ success: true, data: { editado: true, artista: artistaValido, genero: generoValido, data: agora } });
  }

  // Mesma lição já aplicada em todo o app nesta sessão (bug de
  // corrupção/desalinhamento do appendRow nativo em abas com dado
  // "aparentemente ocupado" em qualquer coluna à direita): acha a próxima
  // linha REALMENTE vazia lendo a própria aba e escreve num intervalo
  // fixo via updateValues, nunca via :append.
  const todasAsLinhas = await readValues(FESTIVAIS_SPREADSHEET_ID, FESTIVAIS_SHEET, "A2:A20000").catch(() => []);
  let linhaAlvo = 2;
  for (let i = 0; i < todasAsLinhas.length; i++) {
    if (normalizeText(todasAsLinhas[i]?.[0])) linhaAlvo = i + 3;
  }
  await updateValues(FESTIVAIS_SPREADSHEET_ID, FESTIVAIS_SHEET, `A${linhaAlvo}:C${linhaAlvo}`, [
    [artistaValido, generoValido, agora],
  ]);

  return jsonResponse({ success: true, data: { editado: false, artista: artistaValido, genero: generoValido, data: agora } });
}

// ---- Popup diário de lembrete (Perfil > Festivais), mesmo padrão de
// popupVmaStatusController/popupVmaDismissController (indicacoesController.ts)
// — aba própria, dedicada, na mesma planilha auxiliar "registrosCharts" já
// usada por esse outro popup, pra não misturar estado dos dois.
const POPUP_SPREADSHEET_KEY = "registrosCharts";
const POPUP_SHEET = "FESTIVAL_POPUP_STATUS";
export const FESTIVAL_POPUP_IMAGE_URL = "/festivais/popup.webp";

function hojeBR(): string {
  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const dd = String(hoje.getDate()).padStart(2, "0");
  const mm = String(hoje.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${hoje.getFullYear()}`;
}

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

// GET /api/festivais/popup-status?telegramId=...
export async function popupFestivalStatusController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const telegramId = normalizeText(url.searchParams.get("telegramId"));
  if (!telegramId) return jsonResponse({ success: false, error: "telegramId é obrigatório." }, 400);

  if (statusInscricaoFestival() !== "aberto") {
    return jsonResponse({ success: true, data: { shouldShow: false } });
  }

  await ensurePopupSheetPronta();
  const existente = await lerLinhaPopup(telegramId);
  const hoje = hojeBR();

  if (existente?.status === "inscrito") {
    return jsonResponse({ success: true, data: { shouldShow: false } });
  }
  if (existente?.ultimaExibicao === hoje) {
    return jsonResponse({ success: true, data: { shouldShow: false } });
  }

  if (existente) {
    await updateValues(POPUP_SPREADSHEET_KEY, POPUP_SHEET, `C${existente.linha}`, [[hoje]]);
  } else {
    const rows = await readValues(POPUP_SPREADSHEET_KEY, POPUP_SHEET, "A2:A20000").catch(() => []);
    let linhaAlvo = 2;
    for (let i = 0; i < rows.length; i++) {
      if (normalizeText(rows[i]?.[0])) linhaAlvo = i + 3;
    }
    await updateValues(POPUP_SPREADSHEET_KEY, POPUP_SHEET, `A${linhaAlvo}:C${linhaAlvo}`, [[telegramId, "", hoje]]);
  }

  return jsonResponse({
    success: true,
    data: {
      shouldShow: true,
      festival: {
        id: "festivais-2026",
        premiacao: "Festivais",
        capaUrl: FESTIVAL_POPUP_IMAGE_URL,
        encerramento: DEADLINE_LABEL,
      },
    },
  });
}

// POST /api/festivais/popup-dismiss { telegramId } — "Já me inscrevi": não
// mostra mais o popup pra esse jogador (permanente, não só por hoje).
export async function popupFestivalDismissController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { telegramId?: string };
  const telegramId = normalizeText(body.telegramId);
  if (!telegramId) return jsonResponse({ success: false, error: "telegramId é obrigatório." }, 400);

  await ensurePopupSheetPronta();
  const existente = await lerLinhaPopup(telegramId);
  const hoje = hojeBR();

  if (existente) {
    await updateValues(POPUP_SPREADSHEET_KEY, POPUP_SHEET, `B${existente.linha}:C${existente.linha}`, [
      ["inscrito", hoje],
    ]);
  } else {
    const rows = await readValues(POPUP_SPREADSHEET_KEY, POPUP_SHEET, "A2:A20000").catch(() => []);
    let linhaAlvo = 2;
    for (let i = 0; i < rows.length; i++) {
      if (normalizeText(rows[i]?.[0])) linhaAlvo = i + 3;
    }
    await updateValues(POPUP_SPREADSHEET_KEY, POPUP_SHEET, `A${linhaAlvo}:C${linhaAlvo}`, [[telegramId, "inscrito", hoje]]);
  }

  return jsonResponse({ success: true });
}
