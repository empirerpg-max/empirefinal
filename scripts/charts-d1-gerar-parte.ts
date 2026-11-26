// Carga inicial dos charts no D1 via GitHub Action (charts-d1-carga.yml):
// o Worker não é alcançável de onde a carga roda, então o histórico é
// calculado aqui, num SQLite em memória (mesma ingestão do app, modo
// "historico", igual ao --local de charts-d1-carga-inicial.ts), e sai como
// SQL puro pra `wrangler d1 execute --remote --file`.
//
// Cada execução gera UMA parte: as semanas que faltam no D1 remoto, da mais
// antiga pra mais nova, semana inteira por vez, até --limite linhas de
// chart_semana (D1 grátis: 100k escritas/dia divididas com o app). Quando não
// falta nenhuma semana, a parte seguinte (dia próprio) grava
// chart_artista_musica inteira e liga a leitura do D1 (charts_d1_ativo = '1').
//
//   bun scripts/charts-d1-gerar-parte.ts --dados scripts/fixtures/charts-d1-dados.csv.gz \
//     --pesos scripts/fixtures/charts-d1-pesos.csv --carregadas carregadas.json \
//     [--ativo ativo.json] [--catalogo musicas.sql] [--limite 25000] --saida parte.sql
//
// --carregadas / --ativo: saída JSON de `wrangler d1 execute ... --json --command`
// (arquivo ausente, vazio ou com erro = nada carregado / leitura desligada).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { lerCsv } from "./charts-d1-carga-inicial";
import { criarD1Sqlite, type D1Sqlite } from "./charts-d1-sqlite";
import { CHARTS_D1_SCHEMA, SQL_REGRAVAR_DATAS_CHARTS, ingerirSemana } from "../backend/src/services/chartsD1/repo";
import { dataBrParaIso } from "../backend/src/services/chartsD1/dados";
import { MUSICAS_CREATE_STATEMENTS } from "../backend/src/services/musicasDbService";

/** Linhas de chart_semana por parte (padrão). */
export const LIMITE_PADRAO = 25000;
/** D1 recusa statement acima de 100 KB; folga pros INSERTs multi-linha. */
const MAX_BYTES_STATEMENT = 90_000;

// ---- SQL literal ----

/** Valor → literal SQL (strings com aspas duplicadas, NULL, números, blobs). */
export function literalSql(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString("hex")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * INSERTs multi-linha com valores inline, cada statement abaixo de `maxBytes`.
 * `prefixo` = "INSERT INTO tabela (a, b)".
 */
export function insertsMultiLinha(prefixo: string, linhas: unknown[][], maxBytes = MAX_BYTES_STATEMENT): string[] {
  const out: string[] = [];
  let atual: string[] = [];
  let tamanho = 0;
  const fecha = () => {
    if (atual.length) out.push(`${prefixo} VALUES\n${atual.join(",\n")}`);
    atual = [];
    tamanho = 0;
  };
  for (const l of linhas) {
    const tupla = `(${l.map(literalSql).join(", ")})`;
    const bytes = Buffer.byteLength(tupla) + 2;
    if (atual.length && Buffer.byteLength(prefixo) + 10 + tamanho + bytes > maxBytes) fecha();
    atual.push(tupla);
    tamanho += bytes;
  }
  fecha();
  return out;
}

/** Junta statements num arquivo pro `wrangler d1 execute --file` (sem transação: o D1 não aceita BEGIN/COMMIT). */
export function montarArquivoSql(statements: string[]): string {
  return statements.length ? statements.map((s) => `${s.trim()};`).join("\n") + "\n" : "";
}

// ---- Saída JSON do wrangler ----

/** Linhas de `results` da saída `--json` do wrangler; null se não der pra ler (erro, vazio, ausente). */
export function lerResultadoWrangler(texto: string | undefined): Record<string, unknown>[] | null {
  if (!texto?.trim()) return null;
  let j: unknown;
  try {
    j = JSON.parse(texto);
  } catch {
    return null;
  }
  const blocos = Array.isArray(j) ? j : [j];
  const linhas: Record<string, unknown>[] = [];
  for (const b of blocos) {
    if (!b || typeof b !== "object") return null;
    const r = (b as { results?: unknown; success?: unknown }).results;
    if ((b as { success?: unknown }).success === false || !Array.isArray(r)) return null;
    linhas.push(...(r as Record<string, unknown>[]));
  }
  return linhas;
}

/** Datas ISO já no D1 remoto (`SELECT data FROM chart_datas`). Ilegível = nenhuma. */
export function lerDatasCarregadas(texto: string | undefined): Set<string> {
  return new Set((lerResultadoWrangler(texto) ?? []).map((r) => String(r.data ?? "")).filter(Boolean));
}

/** Valor de charts_d1_ativo no D1 remoto; null se ilegível/ausente. */
export function lerAtivo(texto: string | undefined): string | null {
  const r = lerResultadoWrangler(texto);
  return r?.[0]?.valor == null ? null : String(r[0].valor).trim();
}

// ---- Banco local ----

/**
 * Importa o dump de `wrangler d1 export --table musicas --no-schema`. Se o
 * D1 tiver colunas a mais que o DDL do repo, cria as que faltarem e tenta de novo.
 */
export function importarCatalogo(db: D1Sqlite, sql: string): void {
  // Transação própria do dump (se vier) conflitaria com o SAVEPOINT abaixo.
  sql = sql.replace(/^\s*(BEGIN( TRANSACTION)?|COMMIT|END( TRANSACTION)?)\s*;\s*$/gim, "");
  for (let tentativa = 0; tentativa < 100; tentativa++) {
    try {
      db.exec(`SAVEPOINT catalogo;\n${sql}\n;RELEASE catalogo;`);
      return;
    } catch (e) {
      try { db.exec("ROLLBACK TO catalogo; RELEASE catalogo;"); } catch { /* nada aberto */ }
      const m = /table "?musicas"? has no column named "?(\w+)"?/i.exec(e instanceof Error ? e.message : String(e));
      if (!m) throw e;
      db.exec(`ALTER TABLE musicas ADD COLUMN "${m[1]}"`);
    }
  }
  throw new Error("catálogo: colunas demais faltando no DDL de musicas");
}

/** Lê CSV puro ou .gz. */
export function lerArquivoCsv(caminho: string): string[][] {
  const buf = readFileSync(caminho);
  return lerCsv((caminho.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8"));
}

/**
 * Monta o banco local com o histórico inteiro: schema, catálogo (opcional)
 * e todas as semanas em ordem cronológica (pesos no primeiro envio).
 */
export async function montarBancoLocal(dados: string[][], pesos: string[][], catalogoSql?: string): Promise<{ db: D1Sqlite; erros: string[] }> {
  const db = criarD1Sqlite(":memory:");
  for (const s of [...CHARTS_D1_SCHEMA, ...MUSICAS_CREATE_STATEMENTS]) db.exec(s);
  if (catalogoSql?.trim()) importarCatalogo(db, catalogoSql);
  const porData = new Map<string, string[][]>();
  for (const l of dados) {
    const data = (l[1] ?? "").trim();
    if (!(l[0] ?? "").trim() || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(data)) continue; // cabeçalho, vazias e lixo
    const iso = dataBrParaIso(data);
    (porData.get(iso) ?? porData.set(iso, []).get(iso)!).push(l);
  }
  const erros: string[] = [];
  let primeiro = true;
  for (const data of [...porData.keys()].sort()) {
    const r = await ingerirSemana(db, { linhas: porData.get(data)!, modo: "historico", ...(primeiro ? { pesos } : {}) });
    if (r.ok) primeiro = false;
    else erros.push(`${data}: ${"erros" in r ? (r.erros ?? []).join("; ") : "falhou"}`);
  }
  return { db, erros };
}

// ---- Geração da parte ----

export interface Parte {
  statements: string[];
  /** Datas (ISO) gravadas nesta parte. */
  datas: string[];
  /** Linhas de chart_semana gravadas nesta parte. */
  linhas: number;
  /** Linhas de chart_artista_musica (só na parte de ativação). */
  linhasArtista: number;
  ativacao: boolean;
  /** Semanas que continuam pendentes depois desta parte. */
  restantes: number;
  /** Escritas estimadas no D1 (linha + índice; DDL/IGNORE já existentes não contam). */
  escritas: number;
  /** Motivo de não gravar nada (vazio quando há SQL). */
  nada: string;
}

async function todas<T>(db: D1Sqlite, sql: string, ...params: unknown[]): Promise<T[]> {
  return (await db.prepare(sql).bind(...params).all<T>()).results;
}

async function colunas(db: D1Sqlite, tabela: string): Promise<string[]> {
  return (await todas<{ name: string }>(db, `PRAGMA table_info(${tabela})`)).map((c) => c.name);
}

/** Linhas inteiras (todas as colunas, na ordem do schema) de uma tabela do banco local. */
async function linhasDe(db: D1Sqlite, tabela: string, cols: string[], onde = "", ...params: unknown[]): Promise<unknown[][]> {
  const rows = await todas<Record<string, unknown>>(db, `SELECT ${cols.join(", ")} FROM ${tabela} ${onde}`, ...params);
  return rows.map((r) => cols.map((c) => r[c]));
}

/**
 * Gera a próxima parte a partir do banco local completo e do estado remoto.
 * Ordem por semana: apaga, grava chart_semana e só depois chart_datas — se a
 * execução parar no meio, a semana sem chart_datas continua "pendente" e é
 * regravada inteira na próxima parte.
 */
export async function gerarParte(
  db: D1Sqlite,
  opts: { carregadas: Set<string>; ativoRemoto: string | null; limite: number },
): Promise<Parte> {
  const parte: Parte = { statements: [], datas: [], linhas: 0, linhasArtista: 0, ativacao: false, restantes: 0, escritas: 0, nada: "" };
  // Leitura já ligada: a carga acabou e o envio semanal é quem grava; nunca sobrescreve.
  if (opts.ativoRemoto === "1") return { ...parte, nada: "leitura do D1 já ativada (carga concluída)" };

  const porData = await todas<{ data: string; n: number }>(db, "SELECT data, COUNT(*) AS n FROM chart_semana GROUP BY data ORDER BY data");
  const pendentes = porData.filter((d) => !opts.carregadas.has(d.data));
  const escolhidas: typeof pendentes = [];
  for (const d of pendentes) {
    if (parte.linhas + d.n > opts.limite) break; // nunca parte uma semana
    escolhidas.push(d);
    parte.linhas += d.n;
  }
  if (pendentes.length && !escolhidas.length) {
    return { ...parte, restantes: pendentes.length, nada: `a semana ${pendentes[0].data} tem ${pendentes[0].n} linhas, mais que o limite ${opts.limite}` };
  }
  parte.restantes = pendentes.length - escolhidas.length;

  // Sempre: schema, pesos e seeds (idempotentes).
  const pesos = await linhasDe(db, "pais_peso", await colunas(db, "pais_peso"), "ORDER BY plataforma, pais");
  const fixos = [
    ...CHARTS_D1_SCHEMA,
    ...insertsMultiLinha(`INSERT OR REPLACE INTO pais_peso (${(await colunas(db, "pais_peso")).join(", ")})`, pesos),
  ];

  if (escolhidas.length) {
    const colsSemana = await colunas(db, "chart_semana");
    const colsDatas = await colunas(db, "chart_datas");
    parte.statements.push(...fixos);
    let nDatas = 0;
    for (const { data } of escolhidas) {
      const semana = await linhasDe(db, "chart_semana", colsSemana, "WHERE data = ? ORDER BY chart, pos", data);
      const datas = await linhasDe(db, "chart_datas", colsDatas, "WHERE data = ? ORDER BY chart", data);
      nDatas += datas.length;
      parte.statements.push(
        `DELETE FROM chart_semana WHERE data = ${literalSql(data)}`,
        `DELETE FROM chart_datas WHERE data = ${literalSql(data)}`,
        ...insertsMultiLinha(`INSERT INTO chart_semana (${colsSemana.join(", ")})`, semana),
        ...insertsMultiLinha(`INSERT INTO chart_datas (${colsDatas.join(", ")})`, datas),
      );
      parte.datas.push(data);
    }
    // Lista pronta de datas por chart (chart_config "datas:<CHART>", lida pela tela).
    parte.statements.push(SQL_REGRAVAR_DATAS_CHARTS);
    parte.escritas = parte.linhas * 2 + nDatas + pesos.length; // chart_semana: linha + ix_chart_norm
    return parte;
  }

  // Nenhuma semana pendente: Hall of Fame inteiro e ligar a leitura (dia próprio).
  const colsArt = await colunas(db, "chart_artista_musica");
  const art = await linhasDe(db, "chart_artista_musica", colsArt, "ORDER BY artista_key, chart, titulo_norm");
  parte.statements.push(
    ...fixos,
    "DELETE FROM chart_artista_musica",
    ...insertsMultiLinha(`INSERT INTO chart_artista_musica (${colsArt.join(", ")})`, art),
    "UPDATE chart_config SET valor = '1' WHERE chave = 'charts_d1_ativo'",
  );
  parte.ativacao = true;
  parte.linhasArtista = art.length;
  parte.escritas = art.length + pesos.length + 1;
  return parte;
}

// ---- CLI ----

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const lerSeExiste = (p: string | undefined) => (p && existsSync(p) ? readFileSync(p, "utf8") : undefined);

async function principal() {
  const dadosPath = arg("dados");
  const pesosPath = arg("pesos");
  const saida = arg("saida");
  const limite = Number(arg("limite") ?? LIMITE_PADRAO);
  if (!dadosPath || !pesosPath || !saida || !arg("carregadas") || !(limite > 0)) {
    console.error(`Uso: bun scripts/charts-d1-gerar-parte.ts --dados <DADOS.csv[.gz]> --pesos <PESOS.csv> --carregadas <carregadas.json> [--ativo <ativo.json>] [--catalogo <musicas.sql>] [--limite ${LIMITE_PADRAO}] --saida <parte.sql>`);
    process.exit(1);
  }
  const dados = lerArquivoCsv(dadosPath);
  const pesos = lerArquivoCsv(pesosPath).slice(1).filter((p) => (p[0] ?? "").trim());
  const catalogo = lerSeExiste(arg("catalogo"));
  if (arg("catalogo") && catalogo === undefined) console.warn(`AVISO: catálogo ${arg("catalogo")} não encontrado; seguindo sem catálogo.`);

  const t0 = Date.now();
  const { db, erros } = await montarBancoLocal(dados, pesos, catalogo);
  const nMusicas = catalogo ? (await todas<{ n: number }>(db, "SELECT COUNT(*) AS n FROM musicas"))[0].n : 0;
  console.log(`Banco local: histórico inteiro calculado em ${((Date.now() - t0) / 1000).toFixed(1)}s (catálogo: ${nMusicas} músicas).`);
  for (const e of erros) console.error(`ERRO semana recusada ${e}`);

  const carregadas = lerDatasCarregadas(lerSeExiste(arg("carregadas")));
  const ativo = lerAtivo(lerSeExiste(arg("ativo")));
  console.log(`D1 remoto: ${carregadas.size} data(s) já gravada(s); charts_d1_ativo = ${ativo ?? "(sem leitura)"}.`);

  const parte = await gerarParte(db, { carregadas, ativoRemoto: ativo, limite });
  const sql = montarArquivoSql(parte.statements);
  writeFileSync(saida, sql);
  if (!parte.statements.length) {
    console.log(`nada a fazer${parte.nada ? `: ${parte.nada}` : ""}`);
    if (parte.restantes) process.exitCode = 1; // semana maior que o limite: precisa de ação
  } else if (parte.ativacao) {
    console.log(`Parte de ATIVAÇÃO: ${parte.linhasArtista} linhas de chart_artista_musica + charts_d1_ativo = '1'.`);
  } else {
    console.log(`Parte: ${parte.datas.length} semana(s) (${parte.datas[0]} a ${parte.datas.at(-1)}), ${parte.linhas} linhas de chart_semana.`);
    console.log(parte.restantes ? `Faltam ${parte.restantes} semana(s) depois desta parte.` : "Última parte de semanas; a próxima execução grava o Hall of Fame e ativa a leitura.");
  }
  if (sql) console.log(`Arquivo ${saida}: ${parte.statements.length} statements, ${(Buffer.byteLength(sql) / 1024 / 1024).toFixed(2)} MB, ~${parte.escritas} escritas estimadas no D1.`);
  if (erros.length) process.exitCode = 1;
}

if (import.meta.main) await principal();
