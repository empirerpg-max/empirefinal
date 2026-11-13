import { googleSheetsService, readValuesFresh } from "../services/googleSheetsService";
import { type D1DatabaseLike } from "../services/catalogoDbService";
import { getCatalogoDb, VIDEOS_CREATE_STATEMENTS } from "../services/videosDbService";
import { COMENTARIOS_VIDEOS_CREATE_STATEMENTS } from "../services/comentariosVideosDbService";
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
  return json({ success: falhas.length === 0, executadas, falhas }, falhas.length ? 500 : 200);
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
