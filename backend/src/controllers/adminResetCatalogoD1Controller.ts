import { getCatalogoDb } from "../services/catalogoDbService";

// Reset completo do D1 "empire-hub-catalogo" (DROP + recriação do schema) —
// pedido explícito do usuário em 2026-10-14 pra recomeçar a migração do
// zero após decidir refazer a estrutura, mesmo com Músicas/Vídeos já
// auditados 100% (coluna-por-coluna, zero gaps). D1 aqui é só um espelho
// best-effort do Sheets (nunca a fonte de verdade — Catálogo/Fórum
// continuam lendo do Sheets direto), então apagar tudo não derruba nenhuma
// funcionalidade em produção; só esvazia o espelho pra remigrar.
//
// DROP TABLE IF EXISTS + CREATE TABLE direto do schema (mesmo DDL de
// d1/schema.sql, mantido em sincronia manual — ver esse arquivo pra
// referência/comentários completos de cada coluna). Idempotente: pode
// rodar de novo sem erro mesmo se já estiver vazio.
const RESET_STATEMENTS: string[] = [
  "DROP TABLE IF EXISTS reacao",
  "DROP TABLE IF EXISTS comentario",
  "DROP TABLE IF EXISTS midia",
  `CREATE TABLE midia (
    id TEXT PRIMARY KEY,
    tipo TEXT NOT NULL CHECK (tipo IN ('musica', 'video', 'album')),
    titulo TEXT NOT NULL,
    artista TEXT NOT NULL,
    feat_artistas TEXT,
    album_id TEXT REFERENCES midia(id),
    capa_url TEXT,
    audio_url TEXT,
    video_url TEXT,
    video_source TEXT,
    letra TEXT,
    letra_sincronizada TEXT,
    data_lancamento TEXT,
    data_lancamento_iso TEXT,
    codigo_unico TEXT,
    metacritic_avg REAL,
    descricao TEXT,
    categoria TEXT,
    genero TEXT,
    track_order INTEGER,
    pendente INTEGER NOT NULL DEFAULT 0,
    weeks INTEGER,
    weeks_video INTEGER,
    id_criador TEXT,
    comentarios_para TEXT,
    metacritic_por_jogador TEXT,
    reportado_incorreto INTEGER NOT NULL DEFAULT 0,
    album_id_2 TEXT REFERENCES midia(id),
    album_id_3 TEXT REFERENCES midia(id),
    album_id_4 TEXT REFERENCES midia(id),
    album_id_5 TEXT REFERENCES midia(id),
    likes_por_jogador TEXT,
    media_likes REAL,
    nome_original_charts TEXT,
    thumb_url TEXT,
    encarte_url TEXT,
    tipo_album TEXT,
    shop_url TEXT,
    loja_info TEXT,
    arte_extra_url TEXT,
    tipo_single TEXT,
    tipo_musica TEXT,
    reportado_em TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX idx_midia_tipo ON midia(tipo)",
  "CREATE INDEX idx_midia_album ON midia(album_id)",
  "CREATE INDEX idx_midia_data ON midia(data_lancamento_iso)",
  "CREATE INDEX idx_midia_codigo_unico ON midia(codigo_unico)",
  `CREATE TABLE comentario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    midia_id TEXT NOT NULL REFERENCES midia(id) ON DELETE CASCADE,
    jogador_id TEXT NOT NULL,
    jogador_nome TEXT NOT NULL,
    texto TEXT NOT NULL,
    nota INTEGER,
    reply_to INTEGER REFERENCES comentario(id) ON DELETE SET NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX idx_comentario_midia ON comentario(midia_id)",
  "CREATE INDEX idx_comentario_jogador ON comentario(jogador_id)",
  "CREATE INDEX idx_comentario_reply_to ON comentario(reply_to)",
  `CREATE TABLE reacao (
    comentario_id INTEGER NOT NULL REFERENCES comentario(id) ON DELETE CASCADE,
    jogador_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (comentario_id, jogador_id, emoji)
  )`,
  "CREATE INDEX idx_reacao_comentario ON reacao(comentario_id)",
];

export async function adminResetCatalogoD1Controller(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) {
    return new Response(
      JSON.stringify({ success: false, error: "Binding CATALOGO_DB não disponível neste ambiente." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const executadas: string[] = [];
  const falhas: { statement: string; erro: string }[] = [];

  // Sequencial, não batch — DROP/CREATE em ordem importa (FK em comentario
  // referencia midia, reacao referencia comentario) e cada statement DDL é
  // independente o bastante pra reportar falha individual sem travar o
  // resto.
  for (const statement of RESET_STATEMENTS) {
    try {
      await db.prepare(statement).run();
      executadas.push(statement.split("\n")[0].trim());
    } catch (err) {
      falhas.push({
        statement: statement.split("\n")[0].trim(),
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return new Response(
    JSON.stringify(
      {
        success: falhas.length === 0,
        mensagem:
          falhas.length === 0
            ? "D1 'empire-hub-catalogo' resetado: tabelas recriadas vazias."
            : "Reset parcial — ver 'falhas'.",
        executadas,
        falhas,
      },
      null,
      2,
    ),
    { status: falhas.length === 0 ? 200 : 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
