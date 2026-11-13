// Tabela D1 dedicada `comentarios_videos` — espelho de "Comentarios_MV"
// (comentários do Fórum de Vídeos). Mesmo princípio de videosDbService.ts:
// toda célula guardada CRUA ("" -> NULL e só isso), nada é descartado.
//
// Layout de Comentarios_MV (DIFERENTE de Comentarios_Musicas — Data e
// Reações estão invertidas): A ID do tópico, B ID do jogador, C Nome do
// jogador, D Comentário, E Data, F Reações (JSON {emoji:[jogadorId,...]}),
// G ID do comentário-pai (replyTo, ver forumController.buildCommentRow).
// No CSV exportado em 2026-11-13 a coluna G nem veio (100% vazia).
//
// Diferenças deliberadas em relação a comentarios_musicas, pra não perder
// dado nenhum:
//   - SEM foreign key pra `videos`: comentário cujo tópico não existe mais
//     na aba de vídeos ("órfão" — 13 no CSV de 2026-11-13, incluindo 4
//     testes de debug com tópico vazio) é migrado do mesmo jeito. A
//     migração de música DESCARTAVA órfãos por causa da FK; aqui não.
//   - `comentario` pode ser NULL (2 linhas reais têm o texto vazio).
//   - `linha_planilha` (UNIQUE) guarda a linha de origem no Sheets — é por
//     ela que a validação confere linha a linha, célula a célula.
//
// Sem ID estável por linha no Sheets, então a migração é DELETE + INSERT
// completo a cada rodada (igual comentarios_musicas).
import { getCatalogoDb, type D1DatabaseLike, type D1PreparedStatement } from "./catalogoDbService";
import { celulaDeD1, celulaParaD1, colunasExtra, linhaEmBranco } from "./videosDbService";
import { normalizeComparison, normalizeText } from "./googleSheetsService";

export { getCatalogoDb };

/** Cabeçalhos A..F exigidos. G (replyTo) é aceito com qualquer cabeçalho, ou ausente. */
export const COMENTARIOS_VIDEOS_COLUNAS: readonly { header: string | null; coluna: string }[] = [
  { header: "ID do tópico", coluna: "video_id_topico" }, // A
  { header: "ID do jogador", coluna: "jogador_id" }, // B
  { header: "Nome do jogador", coluna: "jogador_nome" }, // C
  { header: "Comentário", coluna: "comentario" }, // D
  { header: "Data", coluna: "data_hora" }, // E
  { header: "Reações", coluna: "reacoes_json" }, // F
  { header: null, coluna: "reply_to_planilha" }, // G
];

export const COMENTARIOS_VIDEOS_CREATE_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS comentarios_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    linha_planilha INTEGER UNIQUE,
    video_id_topico TEXT,
    jogador_id TEXT,
    jogador_nome TEXT,
    comentario TEXT,
    data_hora TEXT,
    reacoes_json TEXT,
    reply_to_planilha TEXT,
    reply_to INTEGER REFERENCES comentarios_videos(id) ON DELETE SET NULL,
    colunas_extra_json TEXT,
    chaves_busca TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_comentarios_videos_topico ON comentarios_videos(video_id_topico)",
  "CREATE INDEX IF NOT EXISTS idx_comentarios_videos_jogador ON comentarios_videos(jogador_id)",
];

/**
 * Coluna `chaves_busca` (2026-11-13): todos os valores curtos (1-100
 * caracteres) da linha, já normalizados com o MESMO normalizeComparison do
 * Fórum, no formato "|v1|v2|...|". Serve pra buscar no D1 só os
 * comentários candidatos de UM tópico (em vez da aba inteira) sem mudar o
 * resultado: o filtro do Fórum (comentarioPertenceAoTopico) compara o ID do
 * tópico com qualquer valor curto do registro — essa coluna é exatamente
 * esse conjunto de valores, então "contém o ID" é um superconjunto do que o
 * filtro aceita (o filtro original roda por cima dos candidatos).
 * ALTER pra tabela já existente: ver adminCriarTabelasVideosD1Controller.
 */
export const COMENTARIOS_VIDEOS_ALTER_STATEMENTS: string[] = [
  "ALTER TABLE comentarios_videos ADD COLUMN chaves_busca TEXT",
];

export function chavesBuscaDaLinha(valores: Record<string, string | null>, colunasExtraJson: string | null): string {
  const brutos: string[] = Object.values(valores).filter((v): v is string => v !== null);
  if (colunasExtraJson) {
    try {
      for (const [, , v] of JSON.parse(colunasExtraJson) as [number, string, string][]) brutos.push(v);
    } catch {
      /* ignora extras ilegíveis */
    }
  }
  const chaves = new Set<string>();
  for (const b of brutos) {
    const t = normalizeText(b);
    if (t.length > 0 && t.length <= 100) chaves.add(normalizeComparison(t));
  }
  return `|${[...chaves].join("|")}|`;
}

export interface ComentarioVideoRegistro {
  linhaPlanilha: number;
  valores: Record<string, string | null>;
  colunasExtraJson: string | null;
}

export function linhaPlanilhaParaComentarioVideo(
  header: readonly string[],
  row: readonly unknown[],
  linhaPlanilha: number,
): ComentarioVideoRegistro {
  const valores: Record<string, string | null> = {};
  COMENTARIOS_VIDEOS_COLUNAS.forEach((c, i) => {
    valores[c.coluna] = celulaParaD1(row[i]);
  });
  return {
    linhaPlanilha,
    valores,
    colunasExtraJson: colunasExtra(header, row, COMENTARIOS_VIDEOS_COLUNAS.length),
  };
}

export function comentarioVideoD1ParaCelulas(dbRow: Record<string, unknown>): {
  celulas: string[];
  extras: string | null;
} {
  return {
    celulas: COMENTARIOS_VIDEOS_COLUNAS.map((c) => celulaDeD1(dbRow[c.coluna])),
    extras: (dbRow.colunas_extra_json as string | null) ?? null,
  };
}

/** Só o cabeçalho bloqueia; toda linha não-em-branco vira registro (órfã ou não). */
export function validarLinhasComentariosVideosPlanilha(rows: string[][]): {
  erros: string[];
  registros: ComentarioVideoRegistro[];
  linhasEmBranco: number;
} {
  const erros: string[] = [];
  const header = rows[0] || [];
  COMENTARIOS_VIDEOS_COLUNAS.forEach((c, i) => {
    if (c.header !== null && (header[i] ?? "").trim() !== c.header) {
      erros.push(
        `Cabeçalho da coluna ${String.fromCharCode(65 + i)} de Comentarios_MV é "${header[i] ?? ""}", esperado "${c.header}" — migração abortada.`,
      );
    }
  });
  const registros: ComentarioVideoRegistro[] = [];
  let linhasEmBranco = 0;
  for (let i = 1; i < rows.length; i++) {
    if (linhaEmBranco(rows[i])) {
      linhasEmBranco++;
      continue;
    }
    registros.push(linhaPlanilhaParaComentarioVideo(header, rows[i], i + 1));
  }
  return { erros, registros, linhasEmBranco };
}

const INSERT_SQL = `INSERT INTO comentarios_videos
  (linha_planilha, ${COMENTARIOS_VIDEOS_COLUNAS.map((c) => c.coluna).join(", ")}, colunas_extra_json, chaves_busca)
  VALUES (?, ${COMENTARIOS_VIDEOS_COLUNAS.map(() => "?").join(", ")}, ?, ?)`;

export function buildComentarioVideoInsertStatement(
  db: D1DatabaseLike,
  reg: ComentarioVideoRegistro,
): D1PreparedStatement {
  return db
    .prepare(INSERT_SQL)
    .bind(
      reg.linhaPlanilha,
      ...COMENTARIOS_VIDEOS_COLUNAS.map((c) => reg.valores[c.coluna] ?? null),
      reg.colunasExtraJson,
      chavesBuscaDaLinha(reg.valores, reg.colunasExtraJson),
    );
}
