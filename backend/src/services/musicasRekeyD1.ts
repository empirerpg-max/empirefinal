// Correção da tabela `musicas` (2026-11-17): a chave deixa de ser o Código
// único (que se repete entre versões da mesma música e fazia uma versão
// apagar a outra) e passa a ser a identidade da música (ver chaveMusica).
//
// 1) migrarChaveMusicas: recria `musicas` com a coluna `chave` e
//    `comentarios_musicas` SEM a foreign key pra musicas(codigo_unico) — com
//    ela, recriar `musicas` apagaria em cascata todos os comentários. Tudo
//    numa transação só (db.batch), com backup das duas tabelas antes.
// 2) restaurarMusicasDaPlanilha: insere as versões que faltam (lidas da aba
//    "Musicas"), sem tocar em nenhuma música que já está no D1.
import { type D1DatabaseLike } from "./catalogoDbService";
import { MUSICAS_CREATE_STATEMENTS, buildMusicaUpsertStatement, chaveMusica } from "./musicasDbService";
import { normalizeComparison, normalizeText, readValuesFresh } from "./googleSheetsService";
import { lerExtrasMusicas, musicaDaLinhaPlanilha } from "../controllers/adminMigrarMusicasD1Controller";

const COLUNAS_MUSICAS = [
  "codigo_unico", "id_topico", "titulo", "artista", "artista_2", "artista_3", "artista_4", "artista_5", "artista_6",
  "album", "album_2", "album_3", "album_4", "album_5", "capa_url", "audio_url", "letra", "letra_sincronizada",
  "genero", "tipo_single", "tipo_musica", "data_lancamento", "data_lancamento_iso", "weeks", "weeks_video",
  "ordem", "id_criador", "comentarios_para", "metacritic_por_jogador", "metacritic_media", "pendente",
  "reportado_incorreto", "shop_json", "loja_info", "arte_extra_json", "criado_em", "atualizado_em",
].join(", ");
const COLUNAS_COMENTARIOS = "id, musica_id, jogador_id, jogador_nome, comentario, reacoes_json, data_hora, reply_to, criado_em";
export const SUFIXO_BACKUP = "20261117";

async function colunas(db: D1DatabaseLike, tabela: string): Promise<string[]> {
  const r = await db.prepare(`SELECT name FROM pragma_table_info('${tabela}')`).all<{ name: string }>();
  return (r.results || []).map((c) => c.name);
}

export async function contagens(db: D1DatabaseLike): Promise<{ musicas: number; comentarios: number }> {
  const r = await db
    .prepare("SELECT (SELECT count(*) FROM musicas) AS m, (SELECT count(*) FROM comentarios_musicas) AS c")
    .all<{ m: number; c: number }>();
  return { musicas: Number(r.results?.[0]?.m ?? 0), comentarios: Number(r.results?.[0]?.c ?? 0) };
}

export async function migrarChaveMusicas(db: D1DatabaseLike): Promise<{
  jaMigrada: boolean;
  antes: { musicas: number; comentarios: number };
  depois: { musicas: number; comentarios: number };
}> {
  const antes = await contagens(db);
  if ((await colunas(db, "musicas")).includes("chave")) return { jaMigrada: true, antes, depois: antes };

  const criarMusicasNovo = MUSICAS_CREATE_STATEMENTS[0].replace(
    "CREATE TABLE IF NOT EXISTS musicas (",
    "CREATE TABLE musicas_novo (",
  );
  const chaveSql = `CASE WHEN coalesce(trim(id_topico), '') <> '' THEN 't:' || trim(id_topico)
    ELSE 'c:' || trim(coalesce(codigo_unico, '')) || '|' || trim(titulo) END`;
  await db.batch([
    db.prepare("PRAGMA defer_foreign_keys = ON"),
    db.prepare(`CREATE TABLE IF NOT EXISTS bkp_musicas_${SUFIXO_BACKUP} AS SELECT * FROM musicas`),
    db.prepare(`CREATE TABLE IF NOT EXISTS bkp_comentarios_musicas_${SUFIXO_BACKUP} AS SELECT * FROM comentarios_musicas`),
    // comentários primeiro: sem a FK, nada mais depende de musicas(codigo_unico)
    db.prepare(`CREATE TABLE comentarios_musicas_novo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      musica_id TEXT NOT NULL,
      jogador_id TEXT,
      jogador_nome TEXT,
      comentario TEXT NOT NULL,
      reacoes_json TEXT,
      data_hora TEXT,
      reply_to INTEGER REFERENCES comentarios_musicas_novo(id) ON DELETE SET NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`INSERT INTO comentarios_musicas_novo (${COLUNAS_COMENTARIOS}) SELECT ${COLUNAS_COMENTARIOS} FROM comentarios_musicas ORDER BY id`),
    db.prepare("DROP TABLE comentarios_musicas"),
    db.prepare("ALTER TABLE comentarios_musicas_novo RENAME TO comentarios_musicas"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_comentarios_musicas_musica ON comentarios_musicas(musica_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_comentarios_musicas_jogador ON comentarios_musicas(jogador_id)"),
    // músicas com a chave nova
    db.prepare(criarMusicasNovo),
    db.prepare(`INSERT INTO musicas_novo (chave, ${COLUNAS_MUSICAS}) SELECT ${chaveSql}, ${COLUNAS_MUSICAS} FROM musicas`),
    db.prepare("DROP TABLE musicas"),
    db.prepare("ALTER TABLE musicas_novo RENAME TO musicas"),
    ...MUSICAS_CREATE_STATEMENTS.slice(1).map((s) => db.prepare(s)),
  ]);
  const depois = await contagens(db);
  return { jaMigrada: false, antes, depois };
}

export interface ResultadoRestauracao {
  linhasComMusica: number;
  jaNoD1: number;
  restauradas: { linha: number; titulo: string; codigo: string; idTopico: string }[];
  promovidas: { linha: number; titulo: string; idTopico: string }[];
  ignoradas: { linha: number; motivo: string }[];
  faltandoDepois: number;
}

/** Título sem o "Artista - " do começo, normalizado (o D1 às vezes guarda sem o prefixo). */
export function tituloBase(t: string): string {
  const n = normalizeComparison(t);
  const i = n.indexOf(" - ");
  return i >= 0 ? n.slice(i + 3) : n;
}

type LinhaD1 = { chave: string; codigo_unico: string | null; id_topico: string | null; titulo: string };

/**
 * Insere as músicas da planilha que não têm linha no D1. Nunca altera
 * músicas existentes — única exceção: faixa que no D1 ainda está sem tópico
 * e na planilha já ganhou tópico é PROMOVIDA (recebe o tópico/chave), em vez
 * de virar uma linha duplicada.
 */
export async function restaurarMusicasDaPlanilha(db: D1DatabaseLike, confirmar: boolean): Promise<ResultadoRestauracao> {
  const [rows, extras, existentes] = await Promise.all([
    readValuesFresh("principal", "Musicas", "A:AE"),
    lerExtrasMusicas(),
    db.prepare("SELECT chave, codigo_unico, id_topico, titulo FROM musicas").all<LinhaD1>(),
  ]);
  const d1 = existentes.results || [];
  const chaves = new Set(d1.map((r) => r.chave));
  // Faixas sem tópico no D1, por código -> [{chave, título base}]
  const semTopico = new Map<string, { chave: string; base: string }[]>();
  for (const r of d1) {
    if ((r.id_topico || "").trim()) continue;
    const k = normalizeComparison(r.codigo_unico || "");
    (semTopico.get(k) || semTopico.set(k, []).get(k)!).push({ chave: r.chave, base: tituloBase(r.titulo) });
  }
  const acharSemTopico = (codigo: string, titulo: string) =>
    (semTopico.get(normalizeComparison(codigo)) || []).find((x) => x.base === tituloBase(titulo) && chaves.has(x.chave));

  const out: ResultadoRestauracao = { linhasComMusica: 0, jaNoD1: 0, restauradas: [], promovidas: [], ignoradas: [], faltandoDepois: 0 };
  const statements = [];
  const chavesEsperadas: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const titulo = normalizeText(r[7]);
    if (!titulo) {
      if (r.some((c) => normalizeText(c))) out.ignoradas.push({ linha: i + 1, motivo: "sem título (coluna H)" });
      continue;
    }
    out.linhasComMusica++;
    const m = musicaDaLinhaPlanilha(r, extras.get(normalizeComparison(normalizeText(r[25]))));
    const chave = chaveMusica(m.idTopico, m.codigoUnico, m.titulo);
    if (chaves.has(chave)) {
      out.jaNoD1++;
      chavesEsperadas.push(chave);
      continue;
    }
    const pendenteNoD1 = acharSemTopico(m.codigoUnico, m.titulo);
    if (pendenteNoD1 && !m.idTopico) {
      out.jaNoD1++; // mesma faixa, título gravado sem o "Artista - " no D1
      chavesEsperadas.push(pendenteNoD1.chave);
      continue;
    }
    if (pendenteNoD1 && m.idTopico) {
      chaves.delete(pendenteNoD1.chave);
      chaves.add(chave);
      chavesEsperadas.push(chave);
      out.promovidas.push({ linha: i + 1, titulo, idTopico: m.idTopico });
      statements.push(
        db.prepare("UPDATE musicas SET chave = ?, id_topico = ? WHERE chave = ? AND NOT EXISTS (SELECT 1 FROM musicas WHERE chave = ?)")
          .bind(chave, m.idTopico, pendenteNoD1.chave, chave),
      );
      continue;
    }
    chaves.add(chave); // linhas repetidas na planilha viram uma só
    chavesEsperadas.push(chave);
    out.restauradas.push({ linha: i + 1, titulo, codigo: m.codigoUnico, idTopico: m.idTopico || "" });
    // Chave ausente no D1 (conferido acima) -> o upsert vira inserção.
    statements.push(buildMusicaUpsertStatement(db, m));
  }
  if (confirmar && statements.length) {
    for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
    const depois = new Set(((await db.prepare("SELECT chave FROM musicas").all<{ chave: string }>()).results || []).map((r) => r.chave));
    out.faltandoDepois = chavesEsperadas.filter((k) => !depois.has(k)).length;
  }
  return out;
}
