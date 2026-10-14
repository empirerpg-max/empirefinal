// Tabela D1 dedicada `comentarios_musicas` — 2ª leva da reestruturação por
// tipo (musicas.ts já migrada). Layout real confirmado em
// forumController.ts (buildCommentRow): A ID do tópico, B ID do jogador,
// C Nome do jogador, D Comentário, E Reações (JSON {emoji:[jogadorId,...]}),
// F Data/Hora, G ID do comentário-pai (replyTo). O TSV exportado pelo
// usuário (2026-10-14) só tinha A-E preenchidas — F/G vieram vazias pra
// TODAS as ~1127 linhas históricas (replyTo é recente, nunca usado até
// agora; Data também nunca foi gravada nos comentários antigos) — migrado
// como está, sem inventar valor.
//
// Sem ID estável vindo do Sheets por linha (synthetic id hoje é só a
// POSIÇÃO na planilha, igual ao "bug estrutural" já documentado alhures) —
// migração é DELETE+INSERT completo a cada rodada, não upsert por linha.
import { getCatalogoDb, type D1DatabaseLike, type D1PreparedStatement } from "./catalogoDbService";

export { getCatalogoDb };

export const COMENTARIOS_MUSICAS_CREATE_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS comentarios_musicas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    musica_id TEXT NOT NULL REFERENCES musicas(codigo_unico) ON DELETE CASCADE,
    jogador_id TEXT,
    jogador_nome TEXT,
    comentario TEXT NOT NULL,
    reacoes_json TEXT,
    data_hora TEXT,
    reply_to INTEGER REFERENCES comentarios_musicas(id) ON DELETE SET NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_comentarios_musicas_musica ON comentarios_musicas(musica_id)",
  "CREATE INDEX IF NOT EXISTS idx_comentarios_musicas_jogador ON comentarios_musicas(jogador_id)",
];

const INSERT_SQL = `INSERT INTO comentarios_musicas
  (musica_id, jogador_id, jogador_nome, comentario, reacoes_json, data_hora, reply_to)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;

export interface ComentarioMusicaInsert {
  musicaId: string;
  jogadorId: string | null;
  jogadorNome: string | null;
  comentario: string;
  reacoesJson: string | null;
  dataHora: string | null;
  replyTo: number | null;
}

export function buildComentarioMusicaInsertStatement(
  db: D1DatabaseLike,
  c: ComentarioMusicaInsert,
): D1PreparedStatement {
  return db
    .prepare(INSERT_SQL)
    .bind(c.musicaId, c.jogadorId, c.jogadorNome, c.comentario, c.reacoesJson, c.dataHora, c.replyTo);
}
