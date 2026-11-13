// Tabela D1 dedicada `videos` — espelho da aba "Music Videos" (que guarda
// TODOS os tipos de vídeo: Music Video, Live, Lyric Video etc.). Mesma
// reestruturação "uma tabela por tipo" da música (musicasDbService.ts),
// mesmo binding CATALOGO_DB.
//
// Regra principal desta migração (pedido explícito do usuário em
// 2026-11-13: "não posso perder nenhum dado"): TODA célula da planilha é
// guardada CRUA, exatamente como o Sheets devolve (FORMATTED_VALUE) — sem
// trim, sem normalizar, sem converter número/data. Só a string vazia vira
// NULL (e volta a ser "" na leitura). Colunas "derivadas" (data ISO, média
// numérica) são ADICIONAIS, nunca substituem a crua. Qualquer coluna que
// aparecer na planilha depois de U vai inteira pra `colunas_extra_json`,
// com o nome do cabeçalho — nada fica pra trás se a aba ganhar coluna.
//
// PK = "message_thread_id" (coluna F), que é o "ID do tópico" do vídeo
// (Comentarios_MV!A aponta pra ele). Confirmado no CSV exportado em
// 2026-11-13: 282 vídeos, F preenchida em 100% e sem nenhuma repetição.
// "Código único" (U) NÃO serve de PK: vídeo copia o código da música
// vinculada, e a mesma música tem vários vídeos (EMP424 aparece 5x).
// A migração aborta SEM gravar nada se encontrar F vazia/repetida (ver
// validarLinhasVideosPlanilha) — um upsert por PK repetida colapsaria duas
// linhas em uma, ou seja, perderia dado em silêncio.
import { getCatalogoDb, type D1DatabaseLike, type D1PreparedStatement } from "./catalogoDbService";

export { getCatalogoDb };

/**
 * Cabeçalho exato de "Music Videos" (A..U) confirmado no CSV de 2026-11-13,
 * na ordem das colunas, com a coluna D1 correspondente. A migração confere
 * o cabeçalho da planilha AO VIVO contra isso antes de gravar — se alguém
 * inserir/mover uma coluna, aborta em vez de gravar dado na coluna errada.
 * Atenção: "ID da mensagem" aparece DUAS vezes (C = original, L = duplicada).
 */
export const VIDEOS_COLUNAS: readonly { header: string; coluna: string }[] = [
  { header: "ID do usuário", coluna: "id_usuario" }, // A
  { header: "Título do tópico", coluna: "titulo_topico" }, // B
  { header: "ID da mensagem", coluna: "id_mensagem" }, // C (original do Telegram)
  { header: "chat_id", coluna: "chat_id" }, // D
  { header: "chat_id_interno", coluna: "chat_id_interno" }, // E
  { header: "message_thread_id", coluna: "id_topico" }, // F — PK
  { header: "Link direto (t.me)", coluna: "link_direto" }, // G
  { header: "Tipo de vídeo", coluna: "tipo_video" }, // H
  { header: "Descrição", coluna: "descricao" }, // I
  { header: "Data do envio", coluna: "data_envio" }, // J
  { header: "fonte", coluna: "fonte" }, // K
  { header: "ID da mensagem", coluna: "id_mensagem_duplicada" }, // L
  { header: "Link do vídeo", coluna: "link_video" }, // M
  { header: "Likes por jogador", coluna: "likes_por_jogador" }, // N
  { header: "Média Likes", coluna: "media_likes" }, // O (texto cru)
  { header: "Nome original nos charts", coluna: "nome_original_charts" }, // P
  { header: "ID da mensagem (reconvertido)", coluna: "id_mensagem_reconvertido" }, // Q
  { header: "Status da reconversão", coluna: "status_reconversao" }, // R
  { header: "Reportado em", coluna: "reportado_em" }, // S
  { header: "Thumb", coluna: "thumb_url" }, // T
  { header: "Código único", coluna: "codigo_unico" }, // U
];

export const VIDEOS_IDX_ID_TOPICO = 5; // F

export const VIDEOS_CREATE_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS videos (
    id_topico TEXT PRIMARY KEY,
    id_usuario TEXT,
    titulo_topico TEXT,
    id_mensagem TEXT,
    chat_id TEXT,
    chat_id_interno TEXT,
    link_direto TEXT,
    tipo_video TEXT,
    descricao TEXT,
    data_envio TEXT,
    fonte TEXT,
    id_mensagem_duplicada TEXT,
    link_video TEXT,
    likes_por_jogador TEXT,
    media_likes TEXT,
    nome_original_charts TEXT,
    id_mensagem_reconvertido TEXT,
    status_reconversao TEXT,
    reportado_em TEXT,
    thumb_url TEXT,
    codigo_unico TEXT,
    colunas_extra_json TEXT,
    data_envio_iso TEXT,
    media_likes_num REAL,
    linha_planilha INTEGER,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_videos_codigo_unico ON videos(codigo_unico)",
  "CREATE INDEX IF NOT EXISTS idx_videos_data ON videos(data_envio_iso)",
  "CREATE INDEX IF NOT EXISTS idx_videos_tipo ON videos(tipo_video)",
];

/** Célula crua: "" vira NULL, qualquer outra coisa (até só espaço) fica igual. */
export function celulaParaD1(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s === "" ? null : s;
}

/** Inverso de celulaParaD1 — o que a planilha mostraria pra esse valor. */
export function celulaDeD1(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v);
}

/** "DD/MM/AAAA[ HH:MM:SS]" -> "AAAA-MM-DD" (só pra ordenar; a crua fica em data_envio). */
export function dataBrParaIso(v: string | null): string | null {
  if (!v) return null;
  const m = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function numeroOuNull(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v.trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export interface VideoRegistro {
  linhaPlanilha: number;
  /** valores crus por coluna D1 (VIDEOS_COLUNAS), já com "" -> null */
  valores: Record<string, string | null>;
  colunasExtraJson: string | null;
}

/** Linha "em branco" = nenhuma célula com conteúdo (nem espaço). Não é dado. */
export function linhaEmBranco(row: readonly unknown[] | undefined): boolean {
  return !row || !row.some((c) => c !== undefined && c !== null && String(c) !== "");
}

/**
 * Colunas além das conhecidas (índice >= `qtdConhecidas`) com conteúdo —
 * guardadas como [[índice, cabeçalho, valor], ...] pra nunca perder nada.
 */
export function colunasExtra(
  header: readonly string[],
  row: readonly unknown[],
  qtdConhecidas: number,
): string | null {
  const extras: [number, string, string][] = [];
  for (let i = qtdConhecidas; i < row.length; i++) {
    const v = celulaParaD1(row[i]);
    if (v !== null) extras.push([i, header[i] ?? "", v]);
  }
  return extras.length ? JSON.stringify(extras) : null;
}

export function linhaPlanilhaParaVideo(
  header: readonly string[],
  row: readonly unknown[],
  linhaPlanilha: number,
): VideoRegistro {
  const valores: Record<string, string | null> = {};
  VIDEOS_COLUNAS.forEach((c, i) => {
    valores[c.coluna] = celulaParaD1(row[i]);
  });
  return { linhaPlanilha, valores, colunasExtraJson: colunasExtra(header, row, VIDEOS_COLUNAS.length) };
}

/** Reconstrói a linha como a planilha mostraria (A..U + extras), pra validação. */
export function videoD1ParaCelulas(dbRow: Record<string, unknown>): { celulas: string[]; extras: string | null } {
  return {
    celulas: VIDEOS_COLUNAS.map((c) => celulaDeD1(dbRow[c.coluna])),
    extras: (dbRow.colunas_extra_json as string | null) ?? null,
  };
}

/**
 * Checagens que BLOQUEIAM a migração (nada é gravado se houver qualquer
 * erro): cabeçalho diferente do esperado, linha com dado mas sem ID do
 * tópico (F), ID do tópico repetido.
 */
export function validarLinhasVideosPlanilha(rows: string[][]): {
  erros: string[];
  registros: VideoRegistro[];
  linhasEmBranco: number;
} {
  const erros: string[] = [];
  const header = rows[0] || [];
  VIDEOS_COLUNAS.forEach((c, i) => {
    if ((header[i] ?? "").trim() !== c.header) {
      erros.push(
        `Cabeçalho da coluna ${String.fromCharCode(65 + i)} é "${header[i] ?? ""}", esperado "${c.header}" — colunas mudaram, migração abortada pra não gravar dado na coluna errada.`,
      );
    }
  });

  const registros: VideoRegistro[] = [];
  const vistos = new Map<string, number>();
  let linhasEmBranco = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (linhaEmBranco(row)) {
      linhasEmBranco++;
      continue;
    }
    const linha = i + 1;
    const reg = linhaPlanilhaParaVideo(header, row, linha);
    const id = reg.valores.id_topico;
    if (id === null || id.trim() === "") {
      erros.push(`Linha ${linha}: tem dado mas "message_thread_id" (F) está vazio — sem chave pra gravar.`);
      continue;
    }
    const anterior = vistos.get(id);
    if (anterior !== undefined) {
      erros.push(`Linha ${linha}: "message_thread_id" ${id} repetido (já usado na linha ${anterior}).`);
      continue;
    }
    vistos.set(id, linha);
    registros.push(reg);
  }
  return { erros, registros, linhasEmBranco };
}

const COLUNAS_UPSERT = [
  ...VIDEOS_COLUNAS.map((c) => c.coluna),
  "colunas_extra_json",
  "data_envio_iso",
  "media_likes_num",
  "linha_planilha",
];

const VIDEOS_UPSERT_SQL = `INSERT INTO videos (${COLUNAS_UPSERT.join(", ")}, atualizado_em)
  VALUES (${COLUNAS_UPSERT.map(() => "?").join(", ")}, datetime('now'))
  ON CONFLICT(id_topico) DO UPDATE SET
    ${COLUNAS_UPSERT.filter((c) => c !== "id_topico")
      .map((c) => `${c} = excluded.${c}`)
      .join(",\n    ")},
    atualizado_em = datetime('now')`;

export function buildVideoUpsertStatement(db: D1DatabaseLike, reg: VideoRegistro): D1PreparedStatement {
  const v = reg.valores;
  return db
    .prepare(VIDEOS_UPSERT_SQL)
    .bind(
      ...VIDEOS_COLUNAS.map((c) => v[c.coluna] ?? null),
      reg.colunasExtraJson,
      dataBrParaIso(v.data_envio ?? null),
      numeroOuNull(v.media_likes ?? null),
      reg.linhaPlanilha,
    );
}
