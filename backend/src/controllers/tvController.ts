import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

const PROGRAMACAO_SHEET = "Programacao_RPG";
const PRESENCA_SHEET = "Presenca_TV";

interface ProgramaRow {
  id: string;
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
  // Ordem, Drive_ID, Data, Horario, Duracao_Seg, Programa, Tipo, Material, Buff, Status, Topico_ID, Topico_URL, Capa_URL
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
    }))
    .filter((r) => r.programa)
    .map((r) => ({
      id: `row_${r.rowIndex}`,
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
