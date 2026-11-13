import {
  googleSheetsService,
  linhasParaObjetos,
  normalizeComparison,
  readValuesFresh,
  type SheetRecord,
} from "../services/googleSheetsService";
import {
  comentariosPorTopicoD1Ativo,
  definirComentariosPorTopicoD1,
  definirLeituraVideosD1,
  leituraVideosD1Ativa,
  linhasComentariosVideosD1,
  linhasComentariosVideosDoTopicoD1,
  linhasVideosD1,
} from "../services/videosD1Leitura";
import { comentarioPertenceAoTopico, objetosComRowIndex } from "./empirePlayController";
import { type D1DatabaseLike } from "../services/catalogoDbService";
import { getCatalogoDb, VIDEOS_CREATE_STATEMENTS } from "../services/videosDbService";
import { COMENTARIOS_VIDEOS_ALTER_STATEMENTS, COMENTARIOS_VIDEOS_CREATE_STATEMENTS } from "../services/comentariosVideosDbService";
import { sincronizarVideosCompleto, sincronizarComentariosCompleto } from "../services/videosD1Sync";
import {
  validarVideos,
  validarComentariosVideos,
  listarComentariosOrfaos,
} from "../services/videosD1Validacao";

// Migração "Music Videos" + "Comentarios_MV" (Sheets) -> D1 (`videos` +
// `comentarios_videos`). Ver videosDbService.ts / comentariosVideosDbService.ts
// pro schema e pras regras de "nenhum dado perdido". Ordem de uso (todas
// GET, via .github/workflows/admin-call.yml):
//   1. /api/empire-play/admin/criar-tabelas-videos-d1      (idempotente)
//   2. /api/empire-play/admin/migrar-videos-d1             (upsert, idempotente)
//   3. /api/empire-play/admin/migrar-comentarios-videos-d1 (DELETE+INSERT)
//   4. /api/empire-play/admin/validar-videos-d1            (só leitura)
// Os passos 2 e 3 já devolvem a validação célula a célula no fim da
// própria resposta; o 4 pode ser rodado a qualquer momento depois.
//
// Nesta fase NADA no app lê dessas tabelas — Sheets continua sendo a única
// fonte do catálogo e do Fórum de vídeos.

const SHEET_VIDEOS = "Music Videos";
const SHEET_COMENTARIOS = "Comentarios_MV";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function semBinding(): Response {
  return json({ success: false, error: "Binding CATALOGO_DB não disponível neste ambiente." }, 500);
}

/**
 * Lê a aba inteira (A:ZZ, pra pegar qualquer coluna nova). NUNCA engole
 * erro devolvendo [] — uma leitura falha que parecesse "aba vazia" faria a
 * migração de comentários apagar o D1 e não reinserir nada.
 */
async function lerAba(nome: string): Promise<string[][]> {
  const rows = await readValuesFresh("principal", nome, "A:ZZ");
  if (!rows || rows.length < 2) {
    throw new Error(`Aba "${nome}" veio sem nenhuma linha de dados — abortado por segurança.`);
  }
  return rows;
}

async function lerD1(db: D1DatabaseLike, tabela: "videos" | "comentarios_videos") {
  const r = await db.prepare(`SELECT * FROM ${tabela}`).all<Record<string, unknown>>();
  return r.results || [];
}

export async function adminCriarTabelasVideosD1Controller(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) return semBinding();
  const executadas: string[] = [];
  const falhas: { statement: string; erro: string }[] = [];
  for (const statement of [...VIDEOS_CREATE_STATEMENTS, ...COMENTARIOS_VIDEOS_CREATE_STATEMENTS]) {
    try {
      await db.prepare(statement).run();
      executadas.push(statement.split("\n")[0].trim());
    } catch (err) {
      falhas.push({ statement: statement.split("\n")[0].trim(), erro: (err as Error).message });
    }
  }
  // Colunas adicionadas depois da criação (idempotente: "já existe" não é erro).
  const jaExistiam: string[] = [];
  for (const statement of COMENTARIOS_VIDEOS_ALTER_STATEMENTS) {
    try {
      await db.prepare(statement).run();
      executadas.push(statement);
    } catch (err) {
      const msg = (err as Error).message;
      if (/duplicate column/i.test(msg)) jaExistiam.push(statement);
      else falhas.push({ statement, erro: msg });
    }
  }
  return json({ success: falhas.length === 0, executadas, jaExistiam, falhas }, falhas.length ? 500 : 200);
}

export async function adminMigrarVideosD1Controller(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) return semBinding();
  try {
    const rows = await lerAba(SHEET_VIDEOS);
    const r = await sincronizarVideosCompleto(rows);
    const validacao = validarVideos(rows, await lerD1(db, "videos"));
    return json({ success: r.ok && validacao.ok, ...r, validacao }, r.erro ? 409 : 200);
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
}

export async function adminMigrarComentariosVideosD1Controller(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) return semBinding();
  try {
    const rows = await lerAba(SHEET_COMENTARIOS);
    // Troca atômica via tabela de rascunho (ver videosD1Sync.ts) — a tabela
    // real nunca fica vazia nem pela metade, nem se algo falhar no meio.
    const r = await sincronizarComentariosCompleto(rows);
    const validacao = validarComentariosVideos(rows, await lerD1(db, "comentarios_videos"));
    const rowsVideos = await googleSheetsService.principal.readValues(SHEET_VIDEOS, "A:ZZ").catch(() => null);
    return json(
      {
        success: r.ok && validacao.ok,
        ...r,
        validacao,
        orfaos: rowsVideos ? listarComentariosOrfaos(rowsVideos, rows) : "não foi possível ler Music Videos",
      },
      r.erro ? 409 : 200,
    );
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
}

export async function adminValidarVideosD1Controller(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) return semBinding();
  try {
    const [rowsVideos, rowsComentarios] = await Promise.all([lerAba(SHEET_VIDEOS), lerAba(SHEET_COMENTARIOS)]);
    const [d1Videos, d1Comentarios] = await Promise.all([lerD1(db, "videos"), lerD1(db, "comentarios_videos")]);
    const videos = validarVideos(rowsVideos, d1Videos);
    const comentarios = validarComentariosVideos(rowsComentarios, d1Comentarios);
    return json({
      success: videos.ok && comentarios.ok,
      videos,
      comentarios,
      orfaos: listarComentariosOrfaos(rowsVideos, rowsComentarios),
    });
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
}

// ---------------------------------------------------------------------------
// Fase 3 — leitura pelo D1 (ver videosD1Leitura.ts)
// ---------------------------------------------------------------------------

/**
 * Compara, em produção, os objetos que o app monta lendo da PLANILHA com os
 * que monta lendo do D1 — com o mesmo código de conversão
 * (linhasParaObjetos / objetosComRowIndex). Só leitura. É o "pode ligar?".
 *
 * GET /api/empire-play/admin/comparar-leitura-videos-d1
 */
export async function adminCompararLeituraVideosD1Controller(): Promise<Response> {
  try {
    const [planVideos, planComentarios, d1Videos, d1Comentarios] = await Promise.all([
      readValuesFresh("principal", SHEET_VIDEOS, "A:ZZ"),
      readValuesFresh("principal", SHEET_COMENTARIOS, "A:ZZ"),
      linhasVideosD1(),
      linhasComentariosVideosD1(),
    ]);
    if (!d1Videos || !d1Comentarios) return json({ success: false, error: "D1 vazio ou indisponível." }, 500);

    const comparar = (a: unknown[], b: unknown[]) => {
      const diferencas: { indice: number; planilha: unknown; d1: unknown }[] = [];
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) {
        if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
          if (diferencas.length < 10) diferencas.push({ indice: i, planilha: a[i] ?? null, d1: b[i] ?? null });
          else break;
        }
      }
      return { iguais: diferencas.length === 0, planilha: a.length, d1: b.length, diferencas };
    };
    const videos = comparar(linhasParaObjetos(SHEET_VIDEOS, planVideos), linhasParaObjetos(SHEET_VIDEOS, d1Videos));
    const comentarios = comparar(
      objetosComRowIndex(SHEET_COMENTARIOS, planComentarios),
      objetosComRowIndex(SHEET_COMENTARIOS, d1Comentarios),
    );
    return json({
      success: videos.iguais && comentarios.iguais,
      leituraD1Ativa: await leituraVideosD1Ativa(),
      videos,
      comentarios,
    });
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
}

/**
 * Liga/desliga a leitura do catálogo/Fórum de vídeos pelo D1 (sem deploy).
 * Ligar exige a comparação acima dar idêntica NA HORA — senão recusa.
 *
 * GET /api/empire-play/admin/leitura-videos-d1            -> estado atual
 * GET /api/empire-play/admin/leitura-videos-d1?ativar=1   -> liga (se idêntico)
 * GET /api/empire-play/admin/leitura-videos-d1?ativar=0   -> desliga (volta pra planilha)
 */
export async function adminLeituraVideosD1Controller(request: Request): Promise<Response> {
  const ativar = new URL(request.url).searchParams.get("ativar");
  if (ativar === "0") {
    const ok = await definirLeituraVideosD1(false);
    return json({ success: ok, leituraD1Ativa: false });
  }
  if (ativar === "1") {
    const comparacao = await (await adminCompararLeituraVideosD1Controller()).json();
    if (!(comparacao as { success?: boolean }).success) {
      return json({ success: false, mensagem: "Planilha e D1 não estão idênticos — NÃO liguei.", comparacao }, 409);
    }
    const ok = await definirLeituraVideosD1(true);
    return json({ success: ok, leituraD1Ativa: ok, comparacao });
  }
  return json({ success: true, leituraD1Ativa: await leituraVideosD1Ativa() });
}

// ---------------------------------------------------------------------------
// Fase 3b — comentários do Fórum buscados só pro tópico aberto
// ---------------------------------------------------------------------------

/**
 * Pra CADA vídeo de "Music Videos", compara os comentários que o Fórum
 * mostraria lendo a aba inteira com os que mostra buscando no D1 só os
 * candidatos do tópico — mesmo filtro (comentarioPertenceAoTopico), mesmas
 * chaves. Testa o ID real do vídeo e também o ID provisório por posição
 * ("videos_idxN", que links antigos ainda usam). Só leitura.
 * Também lista os casos em que o comentário só entra no tópico porque o
 * NÚMERO DA LINHA dele na planilha é igual ao ID do tópico (comportamento
 * herdado do filtro original, reproduzido de propósito pra troca ser
 * idêntica — ver resposta da sessão de 2026-11-13).
 *
 * GET /api/empire-play/admin/comparar-comentarios-por-topico-d1
 */
export async function adminCompararComentariosPorTopicoD1Controller(): Promise<Response> {
  try {
    const [planVideos, d1Comentarios] = await Promise.all([
      readValuesFresh("principal", SHEET_VIDEOS, "A:ZZ"),
      linhasComentariosVideosD1(),
    ]);
    if (!d1Comentarios) return json({ success: false, error: "D1 vazio ou indisponível." }, 500);
    const comRow = (lista: { rec: SheetRecord; rowIndex: number }[]) =>
      lista.map(({ rec, rowIndex }) => ({ ...rec, __rowIndex: String(rowIndex) }) as SheetRecord);
    const todos = comRow(objetosComRowIndex(SHEET_COMENTARIOS, d1Comentarios));
    const videos = linhasParaObjetos(SHEET_VIDEOS, planVideos);

    let topicosTestados = 0;
    let comentariosConferidos = 0;
    const diferencas: unknown[] = [];
    const casosPorNumeroDaLinha: { topico: string; linhaDoComentario: string; topicoDoComentario: string }[] = [];

    for (let idx = 0; idx < videos.length; idx++) {
      const v = videos[idx];
      const id = v["message_thread_id"] || "";
      const titulo = v["titulo_do_topico"] || "";
      const normId = normalizeComparison(id);
      const normTitulo = normalizeComparison(titulo);
      // ID real, "videos_<ID>" (id do item no catálogo) e o provisório por posição
      for (const busca of [normId, normalizeComparison(`videos_${id}`), normalizeComparison(`videos_idx${idx + 1}`)]) {
        if (!busca) continue;
        topicosTestados++;
        const esperado = todos.filter((r) => comentarioPertenceAoTopico(r, normId, busca, normTitulo));
        const linhas = await linhasComentariosVideosDoTopicoD1([...new Set([busca, normId].filter(Boolean))]);
        if (!linhas) return json({ success: false, error: "Busca por tópico indisponível (chaves_busca incompleta?)." }, 409);
        const obtido = comRow(objetosComRowIndex(SHEET_COMENTARIOS, linhas)).filter((r) =>
          comentarioPertenceAoTopico(r, normId, busca, normTitulo),
        );
        comentariosConferidos += esperado.length;
        if (JSON.stringify(esperado) !== JSON.stringify(obtido) && diferencas.length < 10) {
          diferencas.push({ topico: id, busca, esperado: esperado.length, obtido: obtido.length });
        }
        if (busca === normId) {
          for (const r of esperado) {
            const top = normalizeComparison(r["id_do_topico"] || "");
            if (top !== normId && r.__rowIndex === normId) {
              casosPorNumeroDaLinha.push({ topico: id, linhaDoComentario: r.__rowIndex, topicoDoComentario: r["id_do_topico"] || "" });
            }
          }
        }
      }
    }
    return json({
      success: diferencas.length === 0,
      buscaPorTopicoAtiva: await comentariosPorTopicoD1Ativo(),
      topicosTestados,
      comentariosConferidos,
      diferencas,
      casosPorNumeroDaLinha,
    });
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
}

/**
 * GET /api/empire-play/admin/comentarios-por-topico-d1            -> estado
 * GET /api/empire-play/admin/comentarios-por-topico-d1?ativar=1   -> liga (só se a comparação der idêntica)
 * GET /api/empire-play/admin/comentarios-por-topico-d1?ativar=0   -> desliga (volta a ler a aba inteira)
 */
export async function adminComentariosPorTopicoD1Controller(request: Request): Promise<Response> {
  const ativar = new URL(request.url).searchParams.get("ativar");
  if (ativar === "0") return json({ success: await definirComentariosPorTopicoD1(false), buscaPorTopicoAtiva: false });
  if (ativar === "1") {
    const comparacao = (await (await adminCompararComentariosPorTopicoD1Controller()).json()) as { success?: boolean };
    if (!comparacao.success) {
      return json({ success: false, mensagem: "Resultados diferentes — NÃO liguei.", comparacao }, 409);
    }
    const ok = await definirComentariosPorTopicoD1(true);
    return json({ success: ok, buscaPorTopicoAtiva: ok, comparacao });
  }
  return json({ success: true, buscaPorTopicoAtiva: await comentariosPorTopicoD1Ativo() });
}
