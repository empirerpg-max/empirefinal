// Espelho em tempo real "Music Videos"/"Comentarios_MV" (Sheets) -> D1
// (`videos`/`comentarios_videos`) — fase 2 da migração de vídeos
// (2026-11-13). A planilha CONTINUA sendo a fonte de verdade; o D1 é cópia
// fiel, célula a célula (mesmas regras de videosDbService.ts: nada
// normalizado, nada descartado).
//
// Como fica sincronizado, em 2 camadas:
//
// 1. Tempo real (aposEscritaNaPlanilha): chamado pelo próprio
//    googleSheetsService depois de QUALQUER escrita bem-sucedida nessas 2
//    abas (updateValues, updateValuesBatch, appendRow(s), deleteRows) — não
//    depende de cada controller lembrar de espelhar (foi exatamente esse
//    "esqueci de espelhar aqui" que deixou o D1 de música dessincronizado
//    várias vezes). Relê SÓ as linhas afetadas, sem cache e sem GViz
//    (readValuesFresh), porque o Sheets grava com USER_ENTERED e pode
//    reformatar o valor — o D1 guarda o que a planilha MOSTRA, igual à
//    validação. Apagar linha (deleteRows) desloca todas as linhas de baixo,
//    então dispara a ressincronização completa daquela tabela.
//
// 2. Rede de segurança (reconciliarVideosD1, no cron de 10 min): compara
//    planilha x D1 inteiros (videosD1Validacao.ts) e corrige qualquer
//    diferença que tenha escapado (escrita manual direto na planilha,
//    falha de rede no espelho, etc.), registrando no LOGS o que corrigiu.
//
// Nenhuma função daqui lança erro pro chamador: falha de espelho nunca pode
// derrubar a escrita real na planilha (a camada 2 conserta depois).
import { googleSheetsService, readValuesFresh } from "./googleSheetsService";
import { executarEmLotes, getCatalogoDb, type D1DatabaseLike } from "./catalogoDbService";
import {
  VIDEOS_IDX_ID_TOPICO,
  chaveDoVideo,
  buildVideoUpsertStatement,
  linhaEmBranco,
  linhaPlanilhaParaVideo,
  validarLinhasVideosPlanilha,
} from "./videosDbService";
import {
  COMENTARIOS_VIDEOS_COLUNAS,
  chavesBuscaDaLinha,
  linhaPlanilhaParaComentarioVideo,
  validarLinhasComentariosVideosPlanilha,
  type ComentarioVideoRegistro,
} from "./comentariosVideosDbService";
import { validarComentariosVideos, validarVideos } from "./videosD1Validacao";

export const ABA_VIDEOS = "Music Videos";
export const ABA_COMENTARIOS_VIDEOS = "Comentarios_MV";
const ABAS_ESPELHADAS = new Set([ABA_VIDEOS, ABA_COMENTARIOS_VIDEOS]);

/** Acima disso, uma escrita "em faixa" vira ressincronização completa. */
const MAX_LINHAS_ESPELHO_PONTUAL = 40;

export function abaEspelhadaNoD1(sheetName: string): boolean {
  return ABAS_ESPELHADAS.has(sheetName);
}

// ---------------------------------------------------------------------------
// SQL próprio do espelho de comentários: upsert por linha_planilha (a chave
// de cruzamento com a planilha — ver comentariosVideosDbService.ts).
// ---------------------------------------------------------------------------
const COLS_COMENTARIO = COMENTARIOS_VIDEOS_COLUNAS.map((c) => c.coluna);
const UPSERT_COMENTARIO_SQL = `INSERT INTO comentarios_videos
  (linha_planilha, ${COLS_COMENTARIO.join(", ")}, colunas_extra_json, chaves_busca)
  VALUES (?, ${COLS_COMENTARIO.map(() => "?").join(", ")}, ?, ?)
  ON CONFLICT(linha_planilha) DO UPDATE SET
    ${[...COLS_COMENTARIO, "colunas_extra_json", "chaves_busca"].map((c) => `${c} = excluded.${c}`).join(", ")}`;

function upsertComentario(db: D1DatabaseLike, reg: ComentarioVideoRegistro) {
  return db
    .prepare(UPSERT_COMENTARIO_SQL)
    .bind(
      reg.linhaPlanilha,
      ...COLS_COMENTARIO.map((c) => reg.valores[c] ?? null),
      reg.colunasExtraJson,
      chavesBuscaDaLinha(reg.valores, reg.colunasExtraJson),
    );
}

/** "O12" | "A265:T265" | "B2:B5000" | "A:G" -> [primeira, última] linha (ou null se não der pra saber). */
export function linhasDoIntervalo(range: string): [number, number] | null {
  const semAba = range.includes("!") ? range.slice(range.lastIndexOf("!") + 1) : range;
  const m = semAba.match(/^\$?[A-Z]*\$?(\d+)?(?::\$?[A-Z]*\$?(\d+)?)?$/i);
  if (!m || !m[1]) return null;
  const ini = parseInt(m[1], 10);
  const fim = m[2] ? parseInt(m[2], 10) : ini;
  return [Math.min(ini, fim), Math.max(ini, fim)];
}

async function cabecalho(aba: string): Promise<string[]> {
  const rows = await googleSheetsService.principal.readValues(aba, "A1:ZZ1").catch(() => []);
  return rows[0] || [];
}

// ---------------------------------------------------------------------------
// Espelho pontual de linhas
// ---------------------------------------------------------------------------
async function espelharLinhasVideos(db: D1DatabaseLike, ini: number, fim: number): Promise<void> {
  const [header, linhas] = await Promise.all([
    cabecalho(ABA_VIDEOS),
    readValuesFresh("principal", ABA_VIDEOS, `A${ini}:ZZ${fim}`),
  ]);
  for (let n = ini; n <= fim; n++) {
    if (n < 2) continue; // linha 1 = cabeçalho
    const row = linhas[n - ini] || [];
    const id = chaveDoVideo(String(row[VIDEOS_IDX_ID_TOPICO] ?? ""), n);
    // A linha mudou de dono (F limpa/trocada, linha apagada na mão etc.):
    // tira do D1 o registro que estava nessa posição com OUTRO id.
    await db.prepare("DELETE FROM videos WHERE linha_planilha = ? AND id_topico <> ?").bind(n, id).run();
    if (linhaEmBranco(row)) {
      await db.prepare("DELETE FROM videos WHERE linha_planilha = ?").bind(n).run();
      continue;
    }
    await buildVideoUpsertStatement(db, linhaPlanilhaParaVideo(header, row, n)).run();
  }
}

async function espelharLinhasComentarios(db: D1DatabaseLike, ini: number, fim: number): Promise<void> {
  const [header, linhas] = await Promise.all([
    cabecalho(ABA_COMENTARIOS_VIDEOS),
    readValuesFresh("principal", ABA_COMENTARIOS_VIDEOS, `A${ini}:ZZ${fim}`),
  ]);
  for (let n = ini; n <= fim; n++) {
    if (n < 2) continue;
    const row = linhas[n - ini] || [];
    if (linhaEmBranco(row)) {
      await db.prepare("DELETE FROM comentarios_videos WHERE linha_planilha = ?").bind(n).run();
      continue;
    }
    await upsertComentario(db, linhaPlanilhaParaComentarioVideo(header, row, n)).run();
  }
}

// ---------------------------------------------------------------------------
// Ressincronização completa (usada depois de deleteRows, no cron e pelos
// endpoints de migração)
// ---------------------------------------------------------------------------
export interface ResultadoSync {
  ok: boolean;
  erro?: string;
  lidas?: number;
  gravadas?: number;
  removidasDoD1?: number;
  falhas?: { rotulo: string; erro: string }[];
}

async function lerAbaInteira(aba: string): Promise<string[][]> {
  const rows = await readValuesFresh("principal", aba, "A:ZZ");
  if (!rows || rows.length < 2) throw new Error(`Aba "${aba}" veio sem linhas de dados — abortado por segurança.`);
  return rows;
}

export async function sincronizarVideosCompleto(rowsPlanilha?: string[][]): Promise<ResultadoSync> {
  const db = getCatalogoDb();
  if (!db) return { ok: false, erro: "CATALOGO_DB indisponível" };
  try {
    const rows = rowsPlanilha ?? (await lerAbaInteira(ABA_VIDEOS));
    const { erros, registros } = validarLinhasVideosPlanilha(rows);
    if (erros.length) return { ok: false, erro: `Pré-checagem falhou, nada gravado: ${erros.join(" | ")}` };
    const { executados, falhas } = await executarEmLotes(
      db,
      registros.map((r) => ({
        statement: buildVideoUpsertStatement(db, r),
        rotulo: `linha ${r.linhaPlanilha} — F=${r.valores.id_topico}`,
      })),
    );
    // Remove do D1 só o que comprovadamente não existe mais na planilha
    // (e só se todas as gravações acima deram certo).
    let removidas = 0;
    if (falhas.length === 0) {
      const idsPlanilha = new Set(registros.map((r) => r.valores.id_topico as string));
      const noD1 = (await db.prepare("SELECT id_topico FROM videos").all<{ id_topico: string }>()).results || [];
      for (const { id_topico } of noD1) {
        if (!idsPlanilha.has(id_topico)) {
          await db.prepare("DELETE FROM videos WHERE id_topico = ?").bind(id_topico).run();
          removidas++;
        }
      }
    }
    return { ok: falhas.length === 0, lidas: registros.length, gravadas: executados, removidasDoD1: removidas, falhas };
  } catch (err) {
    return { ok: false, erro: (err as Error).message };
  }
}

/**
 * Substitui comentarios_videos inteira pelo conteúdo atual da planilha SEM
 * janela com a tabela vazia: grava tudo numa tabela de rascunho e troca as
 * duas num único db.batch (transação do D1) — quem lê nunca vê metade.
 */
export async function sincronizarComentariosCompleto(rowsPlanilha?: string[][]): Promise<ResultadoSync> {
  const db = getCatalogoDb();
  if (!db) return { ok: false, erro: "CATALOGO_DB indisponível" };
  try {
    const rows = rowsPlanilha ?? (await lerAbaInteira(ABA_COMENTARIOS_VIDEOS));
    const { erros, registros } = validarLinhasComentariosVideosPlanilha(rows);
    if (erros.length) return { ok: false, erro: `Pré-checagem falhou, nada gravado: ${erros.join(" | ")}` };

    await db.prepare("DROP TABLE IF EXISTS comentarios_videos_rascunho").run();
    await db.prepare("CREATE TABLE comentarios_videos_rascunho AS SELECT * FROM comentarios_videos WHERE 0").run();
    const insertRascunho = `INSERT INTO comentarios_videos_rascunho
      (linha_planilha, ${COLS_COMENTARIO.join(", ")}, colunas_extra_json, chaves_busca)
      VALUES (?, ${COLS_COMENTARIO.map(() => "?").join(", ")}, ?, ?)`;
    const { executados, falhas } = await executarEmLotes(
      db,
      registros.map((r) => ({
        statement: db
          .prepare(insertRascunho)
          .bind(
            r.linhaPlanilha,
            ...COLS_COMENTARIO.map((c) => r.valores[c] ?? null),
            r.colunasExtraJson,
            chavesBuscaDaLinha(r.valores, r.colunasExtraJson),
          ),
        rotulo: `linha ${r.linhaPlanilha}`,
      })),
    );
    if (falhas.length || executados !== registros.length) {
      return { ok: false, erro: "Rascunho incompleto — tabela real NÃO foi trocada.", falhas, lidas: registros.length, gravadas: executados };
    }
    const cols = ["linha_planilha", ...COLS_COMENTARIO, "colunas_extra_json", "chaves_busca"].join(", ");
    await db.batch([
      db.prepare("DELETE FROM comentarios_videos"),
      db.prepare(`INSERT INTO comentarios_videos (${cols}) SELECT ${cols} FROM comentarios_videos_rascunho`),
    ]);
    await db.prepare("DROP TABLE IF EXISTS comentarios_videos_rascunho").run();
    return { ok: true, lidas: registros.length, gravadas: executados };
  } catch (err) {
    return { ok: false, erro: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Camada 1 — gancho chamado pelo googleSheetsService
// ---------------------------------------------------------------------------
export type TipoEscrita = "update" | "append" | "delete";

export async function aposEscritaNaPlanilha(params: {
  sheetName: string;
  tipo: TipoEscrita;
  /** update: o range A1 escrito; append: linha devolvida pelo Sheets; delete: linhas apagadas */
  range?: string;
  linhas?: number[];
}): Promise<void> {
  const { sheetName, tipo } = params;
  if (!abaEspelhadaNoD1(sheetName)) return;
  const db = getCatalogoDb();
  if (!db) return;
  const ehVideos = sheetName === ABA_VIDEOS;
  try {
    if (tipo === "delete") {
      const r = ehVideos ? await sincronizarVideosCompleto() : await sincronizarComentariosCompleto();
      if (!r.ok) throw new Error(r.erro || "ressincronização completa falhou");
      return;
    }
    let intervalo: [number, number] | null = null;
    if (tipo === "append" && params.linhas?.length) {
      intervalo = [Math.min(...params.linhas), Math.max(...params.linhas)];
    } else if (params.range) {
      intervalo = linhasDoIntervalo(params.range);
    }
    if (!intervalo || intervalo[1] - intervalo[0] + 1 > MAX_LINHAS_ESPELHO_PONTUAL) {
      const r = ehVideos ? await sincronizarVideosCompleto() : await sincronizarComentariosCompleto();
      if (!r.ok) throw new Error(r.erro || "ressincronização completa falhou");
      return;
    }
    if (intervalo[1] < 2) return; // só cabeçalho
    if (ehVideos) await espelharLinhasVideos(db, intervalo[0], intervalo[1]);
    else await espelharLinhasComentarios(db, intervalo[0], intervalo[1]);
  } catch (err) {
    // Nunca derruba a escrita real — a reconciliação do cron corrige.
    console.warn(`[videosD1Sync] Espelho em tempo real falhou (${sheetName}, ${tipo}, ${params.range ?? params.linhas}):`, err);
  }
}

// ---------------------------------------------------------------------------
// Camada 2 — reconciliação (cron)
// ---------------------------------------------------------------------------
export async function reconciliarVideosD1(): Promise<{
  videosOk: boolean;
  comentariosOk: boolean;
  corrigiuVideos?: ResultadoSync;
  corrigiuComentarios?: ResultadoSync;
}> {
  const db = getCatalogoDb();
  if (!db) return { videosOk: false, comentariosOk: false };
  const [rowsVideos, rowsComentarios] = await Promise.all([
    lerAbaInteira(ABA_VIDEOS),
    lerAbaInteira(ABA_COMENTARIOS_VIDEOS),
  ]);
  const [d1Videos, d1Comentarios] = await Promise.all([
    db.prepare("SELECT * FROM videos").all<Record<string, unknown>>(),
    db.prepare("SELECT * FROM comentarios_videos").all<Record<string, unknown>>(),
  ]);
  const relVideos = validarVideos(rowsVideos, d1Videos.results || []);
  const relComentarios = validarComentariosVideos(rowsComentarios, d1Comentarios.results || []);

  const out: Awaited<ReturnType<typeof reconciliarVideosD1>> = {
    videosOk: relVideos.ok,
    comentariosOk: relComentarios.ok,
  };
  if (!relVideos.ok) out.corrigiuVideos = await sincronizarVideosCompleto(rowsVideos);
  if (!relComentarios.ok) out.corrigiuComentarios = await sincronizarComentariosCompleto(rowsComentarios);

  if (!relVideos.ok || !relComentarios.ok) {
    const { registrarLogSistema } = await import("./logSistemaService");
    await registrarLogSistema({
      categoria: out.corrigiuVideos?.ok === false || out.corrigiuComentarios?.ok === false ? "Falha de escrita" : "Ação concluída",
      oQueAconteceu: `Reconciliação D1 (vídeos): planilha e D1 tinham diferença — vídeos ${relVideos.ok ? "ok" : `divergiam (faltando ${relVideos.faltandoNoD1.length}, sobrando ${relVideos.sobrandoNoD1.length}, células diferentes ${relVideos.totalDivergencias})`}, comentários ${relComentarios.ok ? "ok" : `divergiam (faltando ${relComentarios.faltandoNoD1.length}, sobrando ${relComentarios.sobrandoNoD1.length}, células diferentes ${relComentarios.totalDivergencias})`}. Ressincronizado a partir da planilha.`,
      onde: "videosD1Sync.reconciliarVideosD1 (cron)",
      detalheTecnico: JSON.stringify({
        videos: { faltando: relVideos.faltandoNoD1.slice(0, 20), sobrando: relVideos.sobrandoNoD1.slice(0, 20), divergencias: relVideos.divergencias.slice(0, 10) },
        comentarios: { faltando: relComentarios.faltandoNoD1.slice(0, 20), sobrando: relComentarios.sobrandoNoD1.slice(0, 20), divergencias: relComentarios.divergencias.slice(0, 10) },
        resultado: out,
      }).slice(0, 45000),
    }).catch(() => {});
  }
  return out;
}
