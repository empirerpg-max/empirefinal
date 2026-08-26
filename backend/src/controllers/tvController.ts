import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";
import { somarPrestigio } from "../services/prestigioService";

// "Programacao_RPG" é uma aba antiga/duplicada que ficou sem manutenção —
// as capas lá estão todas com o link quebrado (uc?export=view&id= sem
// nenhum ID depois do "="). A aba realmente mantida hoje, com capas válidas,
// é "Agenda_TV" (confirmado pelo usuário) — layout diferente, sem coluna de
// duração (Duracao_Seg simplesmente não existe nela, por isso fica sempre 0
// aqui; nada no app hoje depende desse valor pra funcionar de verdade, só
// afeta o cálculo interno de "ao vivo agora"/progresso assistido).
const PROGRAMACAO_SHEET = "Agenda_TV";
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
  salaId: string;
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
  // Agenda_TV: Programa, Tipo, Material, Buff, Data, Horario, Capa_URL, Status, Topico_ID, Topico_URL, TIPO_EVENTO
  const headers = rows[0].map((h) => normalizeComparison(h));
  const tipoEventoCol = headers.findIndex((h) => h === "tipo_evento");
  // Antes essa coluna não existia na aba (por isso ficava sempre 0, o que
  // quebrava silenciosamente o cálculo de % de presença — a duração total da
  // transmissão dava 0 e o percentual de presença nunca passava de 0%, mesmo
  // com o jogador assistindo a live inteira). Procura pelo cabeçalho em vez
  // de posição fixa, pra funcionar tanto se a coluna já existir hoje quanto
  // se for adicionada depois em qualquer posição.
  const duracaoSegCol = headers.findIndex((h) => h === "duracao_seg");

  return rows
    .slice(1)
    .map((r, i) => ({
      rowIndex: i + 2,
      programa: normalizeText(r[0]),
      tipo: normalizeText(r[1]),
      material: normalizeText(r[2]),
      buff: normalizeText(r[3]),
      status: normalizeText(r[7]),
      data: normalizeText(r[4]),
      horario: normalizeText(r[5]),
      duracaoSeg: duracaoSegCol >= 0 ? Number(r[duracaoSegCol]) || 0 : 0,
      // Topico_ID = ID de sala único por transmissão (ex: "empirehits_20260602_2015"),
      // criado manualmente em Agenda_TV e replicado em Programacao_TV — é o que
      // realmente identifica "essa transmissão específica" (título+data sozinhos
      // repetem em reprises/mesmo programa em datas diferentes com mesmo nome).
      salaId: normalizeText(r[8]),
      topicoUrl: normalizeText(r[9]),
      capaUrl: normalizeText(r[6]),
      tipoEvento: tipoEventoCol >= 0 ? normalizeText(r[tipoEventoCol]) : "",
    }))
    .filter((r) => r.programa)
    .map((r) => ({
      // Antes o "id" era sempre `row_${rowIndex}` — a posição da linha na
      // planilha. Como o Topico_ID (salaId) já é preenchido manualmente
      // pelo usuário exatamente pra ser "o identificador estável dessa
      // transmissão específica" (ver comentário no tipo acima), usar a
      // posição da linha em vez dele quebrava tudo que depende de um id
      // ESTÁVEL entre uma leitura e outra: assim que alguém edita a Agenda_TV
      // (adiciona/reordena uma linha) durante o dia, toda transmissão abaixo
      // da edição muda de "id" no meio do evento — o chat resseta pra quem
      // já estava vendo, a presença registrada até ali vira outro id, e duas
      // pessoas que carregaram a tela em momentos diferentes (antes/depois
      // da edição) acabam em salas de chat diferentes falando do mesmo
      // programa ao vivo. Usar o salaId (quando preenchido) resolve tudo
      // isso de uma vez, porque ele não muda com a posição da linha.
      id: r.salaId || `row_${r.rowIndex}`,
      rowIndex: r.rowIndex,
      titulo: r.programa,
      categoria: r.tipo,
      subtitulo: r.material,
      cover: r.capaUrl,
      stream_url: r.topicoUrl,
      topico_url: r.topicoUrl,
      salaId: r.salaId,
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
      const statusLower = p.statusRaw.toLowerCase();
      // "Transmitindo" na planilha é a fonte da verdade — o admin marca
      // manualmente quando a live começa. O cálculo por horário (abaixo)
      // era o único jeito antes, mas como "Agenda_TV" não tem coluna de
      // duração (duracao_seg sempre 0), a "janela" de transmissão durava 0
      // segundos e NUNCA batia com o horário atual — status "Transmitindo"
      // era sempre ignorado. Por isso nada aparecia como ao vivo mesmo com
      // o status certo na planilha.
      const statusDizAoVivo = statusLower === "transmitindo" || statusLower === "ao vivo" || statusLower === "ao_vivo";
      const statusDizFinalizado =
        statusLower === "finalizado" || statusLower === "concluido" || statusLower === "concluído";
      const start = parseDataHorario(p.data, p.horario);
      // "duracao_seg" quase nunca vem preenchido (a aba real, Agenda_TV, não
      // tem essa coluna) — usar só ele fazia a "janela" de transmissão durar
      // 0 segundos, então NUNCA batia com o horário atual e a live nunca
      // começava sozinha (só ativando manualmente o status). Com duração
      // desconhecida, assume uma janela padrão generosa (6h) a partir do
      // horário agendado — a transmissão entra ao vivo sozinha no horário
      // marcado e sai sozinha depois de um tempo razoável se ninguém
      // finalizar manualmente. "Finalizado" na planilha sempre corta a
      // transmissão na hora, mesmo se ainda estiver dentro dessa janela.
      const JANELA_PADRAO_MS = 6 * 60 * 60 * 1000;
      const duracaoMs = p.duracao_seg > 0 ? p.duracao_seg * 1000 : JANELA_PADRAO_MS;
      const end = start !== null ? start + duracaoMs : null;
      const aoVivoPorHorario = start !== null && end !== null && now >= start && now <= end && !statusDizFinalizado;
      const aoVivo = !statusDizFinalizado && (statusDizAoVivo || aoVivoPorHorario);
      const finalizado = !aoVivo && statusDizFinalizado;
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
  chave: string;
  data: string;
  programa: string;
  tipoEvento: string;
  rowIds: string[];
  totalDuracaoSeg: number;
  endTs: number | null;
}

// Margem aplicada ao último segmento quando a duração precisa ser estimada
// (coluna Duracao_Seg ainda não existe/está zerada na planilha) — sem isso o
// último segmento contaria 0s e o total ficaria menor que o real.
const MINUTOS_ESTIMATIVA_ULTIMO_SEGMENTO = 5;

function agruparTransmissoes(programas: ProgramaRow[]): BroadcastGroup[] {
  const grupos = new Map<string, BroadcastGroup>();
  const startsPorGrupo = new Map<string, number[]>();

  for (const p of programas) {
    // Sala única (Topico_ID) é a chave real de uma transmissão — cai pra
    // data+título só pra linhas antigas gravadas antes da coluna existir.
    const key = p.salaId || `${p.data}|${p.titulo}`;
    if (!grupos.has(key)) {
      grupos.set(key, {
        chave: key,
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
      if (!startsPorGrupo.has(key)) startsPorGrupo.set(key, []);
      startsPorGrupo.get(key)!.push(start);
      const end = start + (p.duracao_seg || 0) * 1000;
      if (grupo.endTs === null || end > grupo.endTs) grupo.endTs = end;
    }
  }

  // Fallback: se Duracao_Seg não existe/está zerada (totalDuracaoSeg = 0), a
  // duração real é estimada pelo intervalo entre o primeiro e o último
  // segmento (+ margem pro último), em vez de deixar a transmissão inteira
  // sem duração — sem isso, % de presença nunca sai de 0% mesmo com o
  // jogador assistindo a live inteira.
  for (const grupo of grupos.values()) {
    if (grupo.totalDuracaoSeg > 0) continue;
    const starts = startsPorGrupo.get(grupo.chave);
    if (!starts || starts.length === 0) continue;
    const minStart = Math.min(...starts);
    const maxStart = Math.max(...starts);
    const estimadoSeg = Math.round((maxStart - minStart) / 1000) + MINUTOS_ESTIMATIVA_ULTIMO_SEGMENTO * 60;
    grupo.totalDuracaoSeg = estimadoSeg;
    grupo.endTs = maxStart + MINUTOS_ESTIMATIVA_ULTIMO_SEGMENTO * 60 * 1000;
  }

  return Array.from(grupos.values());
}

// Chaves de transmissões já processadas — evita gravar o mesmo evento duas
// vezes a cada vez que o cron roda. Grava a mesma chave usada em
// agruparTransmissoes (Topico_ID/sala quando existe, senão data|programa) —
// senão duas transmissões de sala diferente com mesmo título+data (ex:
// reprise no mesmo dia) ficariam marcadas como a mesma coisa.
async function readProcessados(): Promise<Set<string>> {
  const rows = await googleSheetsService.agendaTV.readValues(PROCESSADO_SHEET).catch(() => []);
  const set = new Set<string>();
  for (const row of rows.slice(1)) {
    const chave = normalizeText(row[0]);
    if (chave) set.add(chave);
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

// Presença/chat às vezes trazem o nome todo em minúsculo (ex: "weuller" em
// vez de "Weuller") — capitaliza cada palavra antes de gravar em REGISTRO,
// só acabamento visual, não mexe na fonte (Presenca_TV/chat).
function titleCase(nome: string): string {
  return nome
    .split(/(\s+)/)
    .map((parte) => (parte.trim() ? parte[0].toUpperCase() + parte.slice(1).toLowerCase() : parte))
    .join("");
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
      [[titleCase(nomeJogador), "", tipoRegistro]],
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
    await googleSheetsService.agendaTV.appendRow(
      PROCESSADO_SHEET,
      ["Chave", "Programa", "ProcessadoEm"],
      "A:C",
    );
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
    const key = grupo.chave;
    const chaveLegada = `${grupo.data}|${grupo.programa}`;
    // Linhas gravadas em TV_Participacao_Processada ANTES da mudança pra
    // chave por sala (Topico_ID) usavam só "data|programa" — sem checar
    // também esse formato antigo, toda transmissão já processada antes
    // dessa mudança nunca batia com a chave nova, e o cron reprocessava ela
    // do zero a cada 10 minutos, gravando um REGISTRO novo mesmo depois do
    // usuário apagar o anterior.
    if (processados.has(key) || processados.has(chaveLegada)) continue;
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

      // Assistir_tv exige presença quase completa (>=90%) — prestígio por
      // chat foi removido: a pedido do usuário, porque contava mensagens de
      // chat de qualquer ponto no tempo daquela transmissão (incluindo chat
      // antigo, de dias atrás, quando uma transmissão ficava "perdida" sem
      // ser marcada como processada e era reprocessada bem depois) e não dá
      // pra controlar spam de comentário por comentário de forma justa.
      if (presencaPct >= 90) {
        await somarPrestigio({ telegramId }, "assistir_tv").catch(() => {});
      }
    }

    await googleSheetsService.agendaTV.appendRow(
      PROCESSADO_SHEET,
      [grupo.chave, grupo.programa, new Date().toISOString()],
      "A:C",
    );
    transmissoesProcessadas++;
  }

  return { transmissoesProcessadas, registrosGravados };
}
