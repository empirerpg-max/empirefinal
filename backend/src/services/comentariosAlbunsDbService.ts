// Tabela D1 dedicada `comentarios_albuns` — mesma ideia de
// comentariosMusicasDbService.ts (caminho rápido de leitura pra fórum), mas
// SEM tabela "albuns" no D1 pra servir de FK (álbum nunca foi migrado pro
// D1, só música) — por isso a chave aqui é direto o "ID do tópico" (coluna A
// de Comentarios_Albuns, já estável), não um "código único" resolvido via
// outra tabela.
import { getCatalogoDb, type D1DatabaseLike, type D1PreparedStatement } from "./catalogoDbService";

export { getCatalogoDb };

export const COMENTARIOS_ALBUNS_CREATE_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS comentarios_albuns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_topic_id TEXT NOT NULL,
    jogador_id TEXT,
    jogador_nome TEXT,
    comentario TEXT NOT NULL,
    reacoes_json TEXT,
    data_hora TEXT,
    reply_to INTEGER REFERENCES comentarios_albuns(id) ON DELETE SET NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_comentarios_albuns_topico ON comentarios_albuns(album_topic_id)",
];

const INSERT_SQL = `INSERT INTO comentarios_albuns
  (album_topic_id, jogador_id, jogador_nome, comentario, reacoes_json, data_hora, reply_to)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;

export interface ComentarioAlbumInsert {
  albumTopicId: string;
  jogadorId: string | null;
  jogadorNome: string | null;
  comentario: string;
  reacoesJson: string | null;
  dataHora: string | null;
  replyTo: number | null;
}

export function buildComentarioAlbumInsertStatement(
  db: D1DatabaseLike,
  c: ComentarioAlbumInsert,
): D1PreparedStatement {
  return db
    .prepare(INSERT_SQL)
    .bind(c.albumTopicId, c.jogadorId, c.jogadorNome, c.comentario, c.reacoesJson, c.dataHora, c.replyTo);
}
