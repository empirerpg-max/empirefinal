import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

const PROGRAMACAO_SHEET = "Programacao_RPG";
const PRESENCA_SHEET = "Presenca_TV";

interface ProgramaRow {
  id: string;
  rowIndex: number;
  titulo: string;
  categoria: string;
  subtitulo: string;
  cover: string;
  stream_url: string;
  topico_url: string;
  data: string;
  horario: string;
  duracao_seg: number;
  buff: string;
  statusRaw: string;
  tipoEvento: string;
}

// Empire TV roda em horário de Brasília (UTC-3), sem horário de verão.
function parseDataHorario(data: string, horario: string): number | null {
  const m = data.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const h = horario.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !h) return null;
  const [, dd, mm, yyyy] = m;
  const [, hh, min] = h;
  // Date.UTC + 3h compensa o UTC-3 de Brasília.
  return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh) + 3, Number(min));
}

async function readProgramas(): Promise<ProgramaRow[]> {
  const rows = await googleSheetsService.agendaTV.readValues(PROGRAMACAO_SHEET).catch(() => []);
  if (!rows || rows.length < 2) return [];
  // Ordem, Drive_ID, Data, Horario, Duracao_Seg, Programa, Tipo, Material, Buff, Status, Topico_ID, Topico_URL, Capa_URL, [...TIPO_EVENTO em qualquer coluna extra]
  const headers = rows[0].map((h) => normalizeComparison(h));
  const tipoEventoCol = headers.findIndex((h) => h === "tipo_evento");

  return rows
    .slice(1)
    .map((r, i) => ({
      rowIndex: i + 2,
      programa: normalizeText(r[5]),
      tipo: normalizeText(r[6]),
      material: normalizeText(r[7]),
      buff: normalizeText(r[8]),
      status: normalizeText(r[9]),
      data: normalizeText(r[2]),
      horario: normalizeText(r[3]),
      duracaoSeg: Number(r[4] || 0),
      topicoUrl: normalizeText(r[11]),
      capaUrl: normalizeText(r[12]),
      tipoEvento: tipoEventoCol >= 0 ? normalizeText(r[tipoEventoCol]) : "",
    }))
    .filter((r) => r.programa)
    .map((r) => ({
      id: `row_${r.rowIndex}`,
      rowIndex: r.rowIndex,
      titulo: r.programa,
      categoria: r.tipo,
      subtitulo: r.material,
      cover: r.capaUrl,
      stream_url: r.topicoUrl,
      topico_url: r.topicoUrl,
      data: r.data,
      horario: r.horario,
      duracao_seg: r.duracaoSeg,
      buff: r.buff,
      statusRaw: r.status,
      tipoEvento: r.tipoEvento,
    }));
}

/**
 * GET /api/tv/programas
 * Substitui listar_programas_tv + a detecção de "ao vivo agora" do Apps
 * Script legado — tudo numa passada só. "Ao vivo" é calculado comparando o
 * horário de cada linha (Data+Horario, horário de Brasília) com agora.
 */
export async function getProgramasTVController(): Promise<Response> {
  try {
    const [programas, presencaRows] = await Promise.all([
      readProgramas(),
      googleSheetsService.agendaTV.readValues(PRESENCA_SHEET).catch(() => []),
    ]);

    const espectadoresPorPrograma = new Map<string, Set<string>>();
    for (const r of presencaRows.slice(1)) {
      const programaId = normalizeText(r[1]);
      const telegramId = normalizeText(r[2]);
      if (!programaId || !telegramId) continue;
      if (!espectadoresPorPrograma.has(programaId)) espectadoresPorPrograma.set(programaId, new Set());
      espectadoresPorPrograma.get(programaId)!.add(telegramId);
    }

    const now = Date.now();
    const data = programas.map((p) => {
      const start = parseDataHorario(p.data, p.horario);
      const end = start !== null ? start + p.duracao_seg * 1000 : null;
      const aoVivo = start !== null && end !== null && now >= start && now <= end;
      const statusLower = p.statusRaw.toLowerCase();
      const finalizado =
        !aoVivo && (statusLower === "finalizado" || statusLower === "concluido" || statusLower === "concluído");
      return {
        id: p.id,
        titulo: p.titulo,
        categoria: p.categoria,
        subtitulo: p.subtitulo,
        cover: p.cover,
        stream_url: p.stream_url,
        topico_url: p.topico_url,
        data: p.data,
        horario: p.horario,
        duracao_min: p.duracao_seg ? Math.round(p.duracao_seg / 60) : undefined,
        buff: p.buff || undefined,
        status: aoVivo ? "transmitindo" : p.statusRaw || undefined,
        ao_vivo: aoVivo,
        finalizado,
        espectadores: espectadoresPorPrograma.get(p.id)?.size || 0,
      };
    });

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("[getProgramasTVController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao listar programação da TV." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

/**
 * POST /api/tv/presenca
 * body: { programa_id, telegram_id, nome, watched_seconds }
 */
export async function registrarPresencaTVController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      programa_id?: string;
      telegram_id?: string;
      nome?: string;
      watched_seconds?: number;
    };
    const programaId = (body.programa_id || "").trim();
    const telegramId = (body.telegram_id || "").trim();
    if (!programaId || !telegramId) {
      return new Response(JSON.stringify({ ok: false, erro: "programa_id e telegram_id são obrigatórios." }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    await googleSheetsService.agendaTV.appendRow(PRESENCA_SHEET, [
      new Date().toISOString(),
      programaId,
      telegramId,
      body.nome || "Anônimo",
      String(body.watched_seconds || 0),
    ]);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("[registrarPresencaTVController] Erro:", error);
    return new Response(JSON.stringify({ ok: false, erro: error.message || "Erro ao registrar presença." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

/**
 * GET /api/tv/presenca?programa_id=...
 */
export async function listarPresencaTVController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const programaId = normalizeText(url.searchParams.get("programa_id"));
    if (!programaId) {
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    const rows = await googleSheetsService.agendaTV.readValues(PRESENCA_SHEET).catch(() => []);
    const normId = normalizeComparison(programaId);

    // Um jogador manda vários "pings" (a cada intervalo assistido) pro mesmo
    // programa — somamos o maior watched_seconds já visto por pessoa, não
    // cada linha isolada, senão o percentual fica errado.
    const porPessoa = new Map<string, { telegram_id: string; nome: string; watched_seconds: number }>();
    for (const r of rows.slice(1)) {
      if (normalizeComparison(r[1]) !== normId) continue;
      const telegramId = normalizeText(r[2]);
      if (!telegramId) continue;
      const seconds = Number(r[4] || 0);
      const atual = porPessoa.get(telegramId);
      if (!atual || seconds > atual.watched_seconds) {
        porPessoa.set(telegramId, { telegram_id: telegramId, nome: normalizeText(r[3]) || "Anônimo", watched_seconds: seconds });
      }
    }

    const programas = await readProgramas();
    const programa = programas.find((p) => p.id === programaId);
    const duracaoSeg = programa?.duracao_seg || 0;

    const data = Array.from(porPessoa.values()).map((p) => ({
      ...p,
      percentual: duracaoSeg > 0 ? Math.min(100, Math.round((p.watched_seconds / duracaoSeg) * 100)) : 0,
    }));

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("[listarPresencaTVController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao listar presença." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Participação na Empire TV → REGISTRO (métrica de presença + chat)
//
// Uma "transmissão" é um grupo de linhas de Programacao_RPG com a mesma
// Data + Programa (cada linha é só um segmento: vinheta, música, etc). Pra
// cada jogador que participou, calculamos:
//   - % de presença = segundos assistidos (somados em todos os segmentos)
//     / duração total da transmissão (soma de Duracao_Seg dos segmentos).
//   - % de chat = mensagens enviadas no chat da transmissão, numa escala
//     onde 10 mensagens = 100% (linear abaixo disso).
//   - percentual final = o MAIOR dos dois — cobre tanto quem só assiste
//     quanto quem só comenta.
// O percentual é comparado contra a aba "Regras" (TIPO, ENVIO DO TIPO DE
// REGISTRO, PORCENTAGEM) pra achar a faixa certa, e o resultado é gravado
// em REGISTRO (B = jogador, C = vazio, D = "ENVIO DO TIPO DE REGISTRO").
// ─────────────────────────────────────────────────────────────────────────

const REGRAS_SHEET = "Regras";
const PROCESSADO_SHEET = "TV_Participacao_Processada";
const REGISTRO_SHEET = "REGISTRO";
const CHAT_MSGS_PARA_100_PORCENTO = 10;
const MINUTOS_BUFFER_PRE_PROCESSAMENTO = 5;

interface RegraTier {
  label: string; // valor exato da coluna D em REGISTRO (dropdown)
  min: number;
  max: number;
}

// Lê a aba "Regras" e monta um mapa TIPO (normalizado) → faixas de %.
// 100% dinâmico — o usuário pode ajustar rótulos/faixas na planilha a
// qualquer momento, sem precisar mexer no código.
async function readRegras(): Promise<Map<string, RegraTier[]>> {
  const rows = await googleSheetsService.agendaTV.readValues(REGRAS_SHEET).catch(() => []);
  const mapa = new Map<string, RegraTier[]>();
  if (!rows || rows.length < 2) return mapa;

  for (const row of rows.slice(1)) {
    const tipo = normalizeComparison(row[0] || "");
    const label = normalizeText(row[1]);
    const faixaTexto = normalizeText(row[2]);
    if (!tipo || !label) continue;

    const m = faixaTexto.match(/(\d+)\s*a\s*(\d+)/i);
    if (!m) continue;
    const tier: RegraTier = { label, min: Number(m[1]), max: Number(m[2]) };

    if (!mapa.has(tipo)) mapa.set(tipo, []);
    mapa.get(tipo)!.push(tier);
  }

  for (const tiers of mapa.values()) tiers.sort((a, b) => a.min - b.min);
  return mapa;
}

function escolherTier(tiers: RegraTier[] | undefined, percentual: number): RegraTier | null {
  if (!tiers || tiers.length === 0 || percentual < 1) return null;
  const encontrada = tiers.find((t) => percentual >= t.min && percentual <= t.max);
  if (encontrada) return encontrada;
  // Percentual acima da última faixa cadastrada (ex: planilha só vai até
  // "71 a 100%" mas por algum motivo calculamos >100) — usa a mais alta.
  const maisAlta = tiers[tiers.length - 1];
  return percentual > maisAlta.max ? maisAlta : null;
}

interface BroadcastGroup {
  data: string;
  programa: string;
  tipoEvento: string;
  rowIds: string[];
  totalDuracaoSeg: number;
  endTs: number | null;
}

function agruparTransmissoes(programas: ProgramaRow[]): BroadcastGroup[] {
  const grupos = new Map<string, BroadcastGroup>();

  for (const p of programas) {
    const key = `${p.data}|${p.titulo}`;
    if (!grupos.has(key)) {
      grupos.set(key, {
        data: p.data,
        programa: p.titulo,
        tipoEvento: p.tipoEvento,
        rowIds: [],
        totalDuracaoSeg: 0,
        endTs: null,
      });
    }
    const grupo = grupos.get(key)!;
    grupo.rowIds.push(p.id);
    grupo.totalDuracaoSeg += p.duracao_seg || 0;
    if (!grupo.tipoEvento && p.tipoEvento) grupo.tipoEvento = p.tipoEvento;

    const start = parseDataHorario(p.data, p.horario);
    if (start !== null) {
      const end = start + (p.duracao_seg || 0) * 1000;
      if (grupo.endTs === null || end > grupo.endTs) grupo.endTs = end;
    }
  }

  return Array.from(grupos.values());
}

// Chaves de transmissões já processadas — evita gravar o mesmo evento duas
// vezes a cada vez que o cron roda.
async function readProcessados(): Promise<Set<string>> {
  const rows = await googleSheetsService.agendaTV.readValues(PROCESSADO_SHEET).catch(() => []);
  const set = new Set<string>();
  for (const row of rows.slice(1)) {
    const data = normalizeText(row[0]);
    const programa = normalizeText(row[1]);
    if (data && programa) set.add(`${data}|${programa}`);
  }
  return set;
}

// Soma, por jogador, o total de segundos assistidos ao longo de todos os
// segmentos de uma transmissão (cada segmento tem seu próprio "row_N" em
// Presenca_TV, então uma transmissão inteira é a soma de vários).
async function somarPresencaPorTransmissao(
  rowIds: string[],
): Promise<Map<string, { nome: string; watchedSeconds: number }>> {
  const rows = await googleSheetsService.agendaTV.readValues(PRESENCA_SHEET).catch(() => []);
  const rowIdSet = new Set(rowIds);
  // Timestamp,Programa_ID,Telegram_ID,Nome,Watched_Seconds
  const porSegmento = new Map<string, Map<string, { nome: string; seconds: number }>>();

  for (const r of rows.slice(1)) {
    const programaId = normalizeText(r[1]);
    if (!rowIdSet.has(programaId)) continue;
    const telegramId = normalizeText(r[2]);
    if (!telegramId) continue;
    const seconds = Number(r[4] || 0);
    const nome = normalizeText(r[3]) || "Anônimo";

    if (!porSegmento.has(programaId)) porSegmento.set(programaId, new Map());
    const porPessoa = porSegmento.get(programaId)!;
    const atual = porPessoa.get(telegramId);
    if (!atual || seconds > atual.seconds) {
      porPessoa.set(telegramId, { nome, seconds });
    }
  }

  const total = new Map<string, { nome: string; watchedSeconds: number }>();
  for (const porPessoa of porSegmento.values()) {
    for (const [telegramId, { nome, seconds }] of porPessoa) {
      const atual = total.get(telegramId);
      total.set(telegramId, {
        nome: atual?.nome || nome,
        watchedSeconds: (atual?.watchedSeconds || 0) + seconds,
      });
    }
  }
  return total;
}

function getSupabaseCreds(): { url: string; key: string } {
  const url =
    (typeof process !== "undefined" && process.env?.SUPABASE_URL) ||
    (globalThis as any).__SUPABASE_URL__ ||
    "";
  const key =
    (typeof process !== "undefined" && process.env?.SUPABASE_SERVICE_ROLE_KEY) ||
    (globalThis as any).__SUPABASE_SERVICE_ROLE_KEY__ ||
    "";
  return { url, key };
}

// Conta mensagens de chat por jogador (user_id) numa transmissão — soma de
// todos os segmentos (mesma chave "row_N" usada no chat, igual Presença).
async function contarChatPorTransmissao(
  rowIds: string[],
): Promise<Map<string, { nome: string; count: number }>> {
  const resultado = new Map<string, { nome: string; count: number }>();
  const { url, key } = getSupabaseCreds();
  if (!url || !key || rowIds.length === 0) return resultado;

  try {
    const idsParam = rowIds.map((id) => `"${id}"`).join(",");
    const restUrl = `${url}/rest/v1/tv_chat_messages?programa_id=in.(${idsParam})&select=user_id,user_name`;
    const res = await fetch(restUrl, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return resultado;
    const rows = (await res.json()) as Array<{ user_id: string; user_name: string }>;
    for (const r of rows) {
      const userId = normalizeText(r.user_id);
      if (!userId) continue;
      const atual = resultado.get(userId);
      resultado.set(userId, {
        nome: atual?.nome || normalizeText(r.user_name) || "Anônimo",
        count: (atual?.count || 0) + 1,
      });
    }
  } catch (err) {
    console.warn("[contarChatPorTransmissao] Erro ao consultar Supabase:", err);
  }
  return resultado;
}

// Grava uma linha de participação em REGISTRO — mesmo mecanismo do
// registrarAuditLog (registroLogController.ts), mas coluna C fica vazia
// (não é um conteúdo de chart, é participação na TV).
async function gravarRegistroParticipacaoTV(nomeJogador: string, tipoRegistro: string): Promise<void> {
  try {
    const colunaB = await googleSheetsService.registrosCharts.readValues(REGISTRO_SHEET, "B:B");
    let proximaLinha = colunaB.length + 1;
    while (proximaLinha > 1 && !normalizeText(colunaB[proximaLinha - 2]?.[0])) {
      proximaLinha--;
    }
    await googleSheetsService.registrosCharts.updateValues(
      REGISTRO_SHEET,
      `B${proximaLinha}:D${proximaLinha}`,
      [[nomeJogador, "", tipoRegistro]],
    );
  } catch (err) {
    console.warn("[gravarRegistroParticipacaoTV] Erro ao gravar em REGISTRO:", err);
  }
}

/**
 * Processa transmissões da Empire TV recém-encerradas: calcula % de
 * presença/chat por jogador, gera os registros de participação em REGISTRO
 * e marca a transmissão como processada. Chamado pelo cron (ver
 * src/server.ts, handler "scheduled") a cada 10 minutos.
 */
export async function processarParticipacaoTV(): Promise<{
  transmissoesProcessadas: number;
  registrosGravados: number;
}> {
  // A conta de serviço não tem permissão pra criar abas novas na planilha
  // Agenda_TV (só editar conteúdo de abas já existentes) — a aba
  // TV_Participacao_Processada precisa já existir, criada manualmente.
  const processadoRows = await googleSheetsService.agendaTV.readValues(PROCESSADO_SHEET).catch(() => []);
  if (processadoRows.length === 0) {
    await googleSheetsService.agendaTV.appendRow(PROCESSADO_SHEET, ["Data", "Programa", "ProcessadoEm"]);
  }

  const [programas, regras, processados] = await Promise.all([
    readProgramas(),
    readRegras(),
    readProcessados(),
  ]);

  const grupos = agruparTransmissoes(programas);
  const now = Date.now();
  const bufferMs = MINUTOS_BUFFER_PRE_PROCESSAMENTO * 60 * 1000;

  let transmissoesProcessadas = 0;
  let registrosGravados = 0;

  for (const grupo of grupos) {
    const key = `${grupo.data}|${grupo.programa}`;
    if (processados.has(key)) continue;
    if (!grupo.endTs || now < grupo.endTs + bufferMs) continue; // ainda não acabou (ou falta a folga de segurança)
    if (!grupo.tipoEvento) {
      console.warn(`[processarParticipacaoTV] "${key}" sem TIPO_EVENTO — pulando.`);
      continue;
    }
    const tiers = regras.get(normalizeComparison(grupo.tipoEvento.trim()));
    if (!tiers || tiers.length === 0) {
      console.warn(`[processarParticipacaoTV] Nenhuma regra encontrada pro TIPO "${grupo.tipoEvento}".`);
      continue;
    }

    const [presenca, chat] = await Promise.all([
      somarPresencaPorTransmissao(grupo.rowIds),
      contarChatPorTransmissao(grupo.rowIds),
    ]);

    const jogadores = new Set([...presenca.keys(), ...chat.keys()]);
    for (const telegramId of jogadores) {
      const p = presenca.get(telegramId);
      const c = chat.get(telegramId);
      const presencaPct =
        grupo.totalDuracaoSeg > 0 ? Math.min(100, ((p?.watchedSeconds || 0) / grupo.totalDuracaoSeg) * 100) : 0;
      const chatPct = Math.min(100, ((c?.count || 0) / CHAT_MSGS_PARA_100_PORCENTO) * 100);
      const percentual = Math.round(Math.max(presencaPct, chatPct));

      const tier = escolherTier(tiers, percentual);
      if (!tier) continue;

      const nomeJogador = p?.nome || c?.nome || "Anônimo";
      await gravarRegistroParticipacaoTV(nomeJogador, tier.label);
      registrosGravados++;
    }

    await googleSheetsService.agendaTV.appendRow(PROCESSADO_SHEET, [
      grupo.data,
      grupo.programa,
      new Date().toISOString(),
    ]);
    transmissoesProcessadas++;
  }

  return { transmissoesProcessadas, registrosGravados };
}
