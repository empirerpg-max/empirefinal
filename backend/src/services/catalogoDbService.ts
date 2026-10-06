// Acesso ao banco D1 "empire-hub-catalogo" (Fase 1 da migração Google
// Sheets -> D1, ver d1/schema.sql). O binding (CATALOGO_DB) é exposto em
// globalThis por src/server.ts (injectRuntimeEnv), mesmo padrão já usado
// pro KV FLAGS — assim qualquer controller usa sem precisar receber `env`
// explicitamente em cada chamada.
//
// IMPORTANTE: nesta fase, o D1 é um espelho EM PARALELO do Sheets, nunca a
// fonte de verdade — toda gravação aqui é "melhor esforço" (best-effort):
// nunca lança erro pro caller, nunca bloqueia nem atrasa a resposta real
// (que continua vindo do Sheets). Se o D1 falhar, só loga aviso e segue.

interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export function getCatalogoDb(): D1DatabaseLike | undefined {
  return (globalThis as Record<string, unknown>).__CATALOGO_DB__ as D1DatabaseLike | undefined;
}

const MIDIA_UPSERT_SQL = `INSERT INTO midia (
    id, tipo, titulo, artista, feat_artistas, album_id, capa_url, audio_url,
    video_url, video_source, letra, letra_sincronizada, data_lancamento,
    data_lancamento_iso, codigo_unico, metacritic_avg, descricao, categoria,
    genero, track_order, pendente, atualizado_em
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET
    tipo = excluded.tipo, titulo = excluded.titulo, artista = excluded.artista,
    feat_artistas = excluded.feat_artistas, album_id = excluded.album_id,
    capa_url = excluded.capa_url, audio_url = excluded.audio_url,
    video_url = excluded.video_url, video_source = excluded.video_source,
    letra = excluded.letra, letra_sincronizada = excluded.letra_sincronizada,
    data_lancamento = excluded.data_lancamento, data_lancamento_iso = excluded.data_lancamento_iso,
    codigo_unico = excluded.codigo_unico, metacritic_avg = excluded.metacritic_avg,
    descricao = excluded.descricao, categoria = excluded.categoria, genero = excluded.genero,
    track_order = excluded.track_order, pendente = excluded.pendente,
    atualizado_em = datetime('now')`;

/**
 * Monta (sem executar) a declaração de upsert de mídia — usado tanto pelo
 * upsertMidiaD1 (uma linha, tempo real) quanto pela migração em lote
 * (centenas de linhas via db.batch(), uma viagem de rede só em vez de uma
 * por linha — é isso que evita o timeout que a migração em lote tomou
 * fazendo uma gravação de cada vez).
 */
export function buildMidiaUpsertStatement(db: D1DatabaseLike, item: MidiaUpsert): D1PreparedStatement {
  return db.prepare(MIDIA_UPSERT_SQL).bind(
    item.id,
    item.tipo,
    item.titulo,
    item.artista,
    item.featArtistas && item.featArtistas.length ? JSON.stringify(item.featArtistas) : null,
    item.albumId ?? null,
    item.capaUrl ?? null,
    item.audioUrl ?? null,
    item.videoUrl ?? null,
    item.videoSource ?? null,
    item.letra ?? null,
    item.letraSincronizada ?? null,
    item.dataLancamento ?? null,
    item.dataLancamentoIso ?? null,
    item.codigoUnico ?? null,
    item.metacriticAvg ?? null,
    item.descricao ?? null,
    item.categoria ?? null,
    item.genero ?? null,
    item.trackOrder ?? null,
    item.pendente ? 1 : 0,
  );
}

const COMENTARIO_INSERT_SQL = `INSERT INTO comentario (midia_id, jogador_id, jogador_nome, texto, nota, reply_to)
  VALUES (?, ?, ?, ?, ?, ?)`;

export function buildComentarioInsertStatement(db: D1DatabaseLike, c: ComentarioInsert): D1PreparedStatement {
  return db
    .prepare(COMENTARIO_INSERT_SQL)
    .bind(c.midiaId, c.jogadorId, c.jogadorNome, c.texto, c.nota ?? null, c.replyTo ?? null);
}

/**
 * Executa um lote de declarações já montadas em pedaços de até `tamanho`
 * (db.batch tem limite prático de tamanho de payload — pedaços menores
 * evitam estourar isso em tabelas grandes) — usado só pela migração em
 * lote; gravação em tempo real (upsertMidiaD1/insertComentarioD1) continua
 * uma de cada vez, que é rápido o bastante pra uma linha só.
 */
export async function executarEmLotes(
  db: D1DatabaseLike,
  statements: D1PreparedStatement[],
  tamanho = 50,
): Promise<number> {
  let executados = 0;
  for (let i = 0; i < statements.length; i += tamanho) {
    const pedaco = statements.slice(i, i + tamanho);
    try {
      await db.batch(pedaco);
      executados += pedaco.length;
    } catch (err) {
      console.warn(`[catalogoDbService] Falha num lote de ${pedaco.length} (ignorado):`, err);
    }
  }
  return executados;
}

export interface MidiaUpsert {
  id: string;
  tipo: "musica" | "video" | "album";
  titulo: string;
  artista: string;
  featArtistas?: string[];
  albumId?: string | null;
  capaUrl?: string | null;
  audioUrl?: string | null;
  videoUrl?: string | null;
  videoSource?: string | null;
  letra?: string | null;
  letraSincronizada?: string | null;
  dataLancamento?: string | null;
  dataLancamentoIso?: string | null;
  codigoUnico?: string | null;
  metacriticAvg?: number | null;
  descricao?: string | null;
  categoria?: string | null;
  genero?: string | null;
  trackOrder?: number | null;
  pendente?: boolean;
}

/**
 * Grava (insere ou atualiza) uma linha de mídia no D1 — espelho em
 * paralelo do que acabou de ser gravado no Sheets. Nunca lança: falha aqui
 * nunca pode derrubar o fluxo real (que já terminou com sucesso no Sheets
 * antes desta chamada).
 */
export async function upsertMidiaD1(item: MidiaUpsert): Promise<void> {
  const db = getCatalogoDb();
  if (!db) return;
  try {
    await buildMidiaUpsertStatement(db, item).run();
  } catch (err) {
    console.warn("[catalogoDbService] Falha ao gravar mídia no D1 (ignorado):", err);
  }
}

export interface ComentarioInsert {
  midiaId: string;
  jogadorId: string;
  jogadorNome: string;
  texto: string;
  nota?: number | null;
  replyTo?: number | null;
}

/**
 * Espelha um comentário recém-gravado no Sheets pro D1. Só funciona se a
 * mídia já existir na tabela `midia` (FK) — se a mídia ainda não foi
 * migrada/espelhada, ignora silenciosamente (o Sheets continua sendo a
 * fonte de verdade enquanto a Fase 1 não migrar o histórico completo).
 */
export async function insertComentarioD1(c: ComentarioInsert): Promise<void> {
  const db = getCatalogoDb();
  if (!db) return;
  try {
    await buildComentarioInsertStatement(db, c).run();
  } catch (err) {
    console.warn("[catalogoDbService] Falha ao gravar comentário no D1 (ignorado):", err);
  }
}
