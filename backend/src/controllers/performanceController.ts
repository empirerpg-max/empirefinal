import { readValues, updateValues, appendRow, normalizeText, normalizeComparison, ensureSheetTab } from "../services/googleSheetsService";
import { getArtistNamesForOwner } from "./artistasController";
import { PREMIACOES_INDICAR } from "./indicacoesController";
import { lerFaseVotacao } from "./votacaoController";

// "Performance Award" (Perfil > Premiações > Votação > tela extra antes das
// categorias) — pergunta se o jogador quer que algum artista dele performe
// no evento. Mesma planilha por premiação (PREMIACOES_INDICAR), aba
// "Performances":
//   A Artista | B Quer performar? | C Link da performance | D Descritivo do
//   termo de aceite (célula única, linha 2 — config, nunca sobrescrita por
//   uma inscrição de verdade; inscrições entram a partir da linha 3, só em
//   A/B/C).
// Usa a MESMA janela de datas da fase "Votação" (Detalhes!Calendário) — não
// tem uma fase própria.
//
// Status de resposta por jogador fica numa aba auxiliar própria da mesma
// planilha, "Performances_Status" (A TelegramId | B Resposta "sim"/"nao" |
// C Data) — nunca precisa reperguntar depois de respondido (só reabre via
// botão "Me arrependi" pra quem respondeu "nao").
const PERFORMANCES_SHEET = "Performances";
const STATUS_SHEET = "Performances_Status";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface PerformancesInfo {
  termoTexto: string;
}

async function lerPerformancesInfo(awardId: string): Promise<PerformancesInfo> {
  const rows = await readValues(awardId, PERFORMANCES_SHEET, "A2:D2").catch(() => []);
  return { termoTexto: normalizeText(rows?.[0]?.[3]) };
}

async function ensureStatusSheetPronta(awardId: string): Promise<void> {
  await ensureSheetTab(awardId, STATUS_SHEET);
  const header = await readValues(awardId, STATUS_SHEET, "A1:C1").catch(() => []);
  if (!normalizeText(header?.[0]?.[0])) {
    await updateValues(awardId, STATUS_SHEET, "A1:C1", [["TelegramId", "Resposta", "Data"]]);
  }
}

async function lerStatusJogador(awardId: string, telegramId: string): Promise<{ linha: number; resposta: string } | null> {
  const rows = await readValues(awardId, STATUS_SHEET, "A2:C20000").catch(() => []);
  const idx = rows.findIndex((r) => normalizeComparison(normalizeText(r[0])) === normalizeComparison(telegramId));
  if (idx === -1) return null;
  return { linha: idx + 2, resposta: normalizeComparison(normalizeText(rows[idx][1])) };
}

function hojeBR(): string {
  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const dd = String(hoje.getDate()).padStart(2, "0");
  const mm = String(hoje.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${hoje.getFullYear()}`;
}

async function gravarStatusJogador(awardId: string, telegramId: string, resposta: "sim" | "nao"): Promise<void> {
  await ensureStatusSheetPronta(awardId);
  const existente = await lerStatusJogador(awardId, telegramId);
  if (existente) {
    await updateValues(awardId, STATUS_SHEET, `B${existente.linha}:C${existente.linha}`, [[resposta, hojeBR()]]);
  } else {
    await appendRow(awardId, STATUS_SHEET, [telegramId, resposta, hojeBR()], "A:C", "OVERWRITE");
  }
}

// GET /api/premiacoes/performance/status?awardId=...&telegramId=...
export async function statusPerformanceController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const awardId = normalizeText(url.searchParams.get("awardId"));
  const telegramId = normalizeText(url.searchParams.get("telegramId"));
  if (!awardId || !telegramId) return jsonResponse({ success: false, error: "awardId e telegramId são obrigatórios." }, 400);

  const [fase, info, status, artistas] = await Promise.all([
    lerFaseVotacao(awardId),
    lerPerformancesInfo(awardId),
    lerStatusJogador(awardId, telegramId),
    getArtistNamesForOwner(telegramId).catch(() => []),
  ]);
  if (!fase) return jsonResponse({ success: false, error: "Premiação não encontrada." }, 404);

  return jsonResponse({
    success: true,
    data: {
      statusFase: fase.status,
      termoTexto: info.termoTexto,
      artistas,
      respondido: !!status,
      resposta: status ? (status.resposta === "sim" ? "sim" : "nao") : null,
    },
  });
}

// POST /api/premiacoes/performance/responder
// body: { awardId, telegramId, resposta: "sim"|"nao", artistas?: string[] }
export async function responderPerformanceController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    awardId?: string;
    telegramId?: string;
    resposta?: string;
    artistas?: string[];
  };
  const awardId = normalizeText(body.awardId);
  const telegramId = normalizeText(body.telegramId);
  const resposta = normalizeComparison(body.resposta);
  const artistasEnviados = Array.isArray(body.artistas) ? body.artistas.map((a) => normalizeText(a)).filter(Boolean) : [];

  if (!awardId || !telegramId || (resposta !== "sim" && resposta !== "nao")) {
    return jsonResponse({ success: false, error: "awardId, telegramId e resposta (sim/nao) são obrigatórios." }, 400);
  }

  const fase = await lerFaseVotacao(awardId);
  if (!fase) return jsonResponse({ success: false, error: "Premiação não encontrada." }, 404);
  if (fase.status !== "aberto") {
    return jsonResponse({ success: false, error: "Esse período já não está mais aberto." }, 403);
  }

  if (resposta === "sim") {
    if (artistasEnviados.length === 0) {
      return jsonResponse({ success: false, error: "Selecione pelo menos um artista." }, 400);
    }
    const meusArtistas = await getArtistNamesForOwner(telegramId);
    const normMeus = new Set(meusArtistas.map(normalizeComparison));
    const invalido = artistasEnviados.find((a) => !normMeus.has(normalizeComparison(a)));
    if (invalido) {
      return jsonResponse({ success: false, error: `"${invalido}" não é um artista seu.` }, 403);
    }
    for (const artista of artistasEnviados) {
      await appendRow(awardId, PERFORMANCES_SHEET, [artista, "Sim", "", ""], "A:D");
    }
  }

  await gravarStatusJogador(awardId, telegramId, resposta as "sim" | "nao");
  return jsonResponse({ success: true });
}

interface PendenciaPerformance {
  awardId: string;
  premiacao: string;
  linha: number;
  artista: string;
}

async function listarPendenciasDoAward(awardId: string, normMeusArtistas: Set<string>): Promise<PendenciaPerformance[]> {
  const [fase, rows] = await Promise.all([
    lerFaseVotacao(awardId),
    readValues(awardId, PERFORMANCES_SHEET, "A3:D20000").catch(() => []),
  ]);
  if (!fase) return [];
  const pendencias: PendenciaPerformance[] = [];
  rows.forEach((row, i) => {
    const artista = normalizeText(row[0]);
    const querPerformar = normalizeComparison(row[1]);
    const link = normalizeText(row[2]);
    if (!artista || querPerformar !== "sim" || link) return;
    if (!normMeusArtistas.has(normalizeComparison(artista))) return;
    pendencias.push({ awardId, premiacao: fase.premiacao, linha: i + 3, artista });
  });
  return pendencias;
}

// GET /api/premiacoes/performance/pendentes?telegramId=...
// Varre todas as premiações ativas — usado tanto pra decidir se mostra o
// botão "Performance Award" em Gestão > Catálogo quanto pra listar as
// opções no modal dele.
export async function pendentesPerformanceController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const telegramId = normalizeText(url.searchParams.get("telegramId"));
  if (!telegramId) return jsonResponse({ success: false, error: "telegramId é obrigatório." }, 400);

  const meusArtistas = await getArtistNamesForOwner(telegramId).catch(() => []);
  if (meusArtistas.length === 0) return jsonResponse({ success: true, data: [] });
  const normMeus = new Set(meusArtistas.map(normalizeComparison));

  const porAward = await Promise.all(
    PREMIACOES_INDICAR.map((id) => listarPendenciasDoAward(id, normMeus).catch(() => [])),
  );
  return jsonResponse({ success: true, data: porAward.flat() });
}

// POST /api/premiacoes/performance/enviar
// body: { awardId, artista, telegramId, link }
export async function enviarPerformanceController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    awardId?: string;
    artista?: string;
    telegramId?: string;
    link?: string;
  };
  const awardId = normalizeText(body.awardId);
  const artista = normalizeText(body.artista);
  const telegramId = normalizeText(body.telegramId);
  const link = normalizeText(body.link);
  if (!awardId || !artista || !telegramId || !link) {
    return jsonResponse({ success: false, error: "awardId, artista, telegramId e link são obrigatórios." }, 400);
  }

  const meusArtistas = await getArtistNamesForOwner(telegramId).catch(() => []);
  if (!meusArtistas.some((a) => normalizeComparison(a) === normalizeComparison(artista))) {
    return jsonResponse({ success: false, error: "Esse artista não é seu." }, 403);
  }

  const rows = await readValues(awardId, PERFORMANCES_SHEET, "A3:D20000").catch(() => []);
  const idx = rows.findIndex((row) => {
    const rowArtista = normalizeText(row[0]);
    const querPerformar = normalizeComparison(row[1]);
    const rowLink = normalizeText(row[2]);
    return normalizeComparison(rowArtista) === normalizeComparison(artista) && querPerformar === "sim" && !rowLink;
  });
  if (idx === -1) {
    return jsonResponse({ success: false, error: "Nenhuma inscrição pendente encontrada pra esse artista." }, 404);
  }
  const linha = idx + 3;
  await updateValues(awardId, PERFORMANCES_SHEET, `C${linha}`, [[link]]);

  return jsonResponse({ success: true });
}
