// Gravação dos charts semanais no D1: tabelas, histórico por música e
// ingestão de uma semana da aba DADOS (enviada pelo Google, nunca lida daqui).
import type { D1DatabaseLike, D1PreparedStatement } from "../catalogoDbService";
import { CHARTS, type ChartId, type LinhaDados } from "./tipos";
import { parseLinhaDados, parseNumeroBR, validarSemana } from "./dados";
import { calcularMovimento, type HistoricoMusica, type Movimento } from "./movimento";
import { chaveMusica, indexarCatalogo, resolverArtistas, type LinhaCatalogo, type MusicaCatalogo } from "./artistas";

// Idempotente — roda no começo de cada ingestão (padrão do projeto).
export const CHARTS_D1_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS chart_semana (
    chart TEXT NOT NULL,
    data TEXT NOT NULL,
    pos INTEGER NOT NULL,
    titulo TEXT,
    titulo_norm TEXT, -- chaveMusica(titulo): identidade da música no chart
    valor INTEGER,
    valor_total INTEGER,
    artistas TEXT,
    fonte_artistas TEXT,
    status TEXT,
    pos_anterior INTEGER,
    peak INTEGER,
    semanas INTEGER,
    semanas_n1 INTEGER,
    PRIMARY KEY (chart, data, pos)
  )`,
  // Único índice extra (cada índice encarece as ~500 escritas semanais).
  "CREATE INDEX IF NOT EXISTS ix_chart_norm ON chart_semana(chart, titulo_norm)",
  `CREATE TABLE IF NOT EXISTS pais_peso (
    plataforma TEXT NOT NULL,
    pais TEXT NOT NULL,
    peso REAL,
    PRIMARY KEY (plataforma, pais)
  )`,
  "CREATE TABLE IF NOT EXISTS chart_config (chave TEXT PRIMARY KEY, valor TEXT)",
  "INSERT OR IGNORE INTO chart_config (chave, valor) VALUES ('bonus_nacionalidade', '0.20'), ('top_pais', '50')",
  `CREATE TABLE IF NOT EXISTS artista_info (
    nome_upper TEXT PRIMARY KEY,
    nome TEXT,
    nacionalidade TEXT,
    foto TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS chart_ingestao (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT,
    modo TEXT,
    linhas INTEGER,
    ok INTEGER,
    mensagem TEXT,
    criado_em TEXT DEFAULT (datetime('now'))
  )`,
];

export interface LinhaCalculada {
  chart: ChartId;
  dataIso: string;
  pos: number;
  titulo: string;
  tituloNorm: string;
  valor: number;
  valorTotal: number | null;
  artistas: string[];
  fonteArtistas: string;
  movimento: Movimento;
}

export interface PayloadIngestao {
  linhas: string[][];
  /** [nome, nacionalidade, foto] (INFOS ACTS). */
  artistas?: string[][];
  /** Linhas do CSV PAÍSES E PESOS: [país, spotify, apple music, youtube] em "7,20%". */
  pesos?: string[][];
  modo?: "semanal" | "historico";
}

export type ResultadoIngestao = { ok: true; data: string; linhas: number } | { ok: false; erros: string[] };

// D1 aceita no máximo 100 parâmetros por query: INSERTs de várias linhas
// são fatiados pra caber nesse limite (menos statements no batch).
const MAX_PARAMS_D1 = 100;

function insertsEmLotes(
  db: D1DatabaseLike,
  prefixo: string,
  linhas: unknown[][],
  sufixo = "",
): D1PreparedStatement[] {
  if (!linhas.length) return [];
  const colunas = linhas[0].length;
  const porLote = Math.max(1, Math.floor(MAX_PARAMS_D1 / colunas));
  const tupla = `(${Array(colunas).fill("?").join(", ")})`;
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < linhas.length; i += porLote) {
    const lote = linhas.slice(i, i + porLote);
    const sql = `${prefixo} VALUES ${lote.map(() => tupla).join(", ")}${sufixo ? ` ${sufixo}` : ""}`;
    stmts.push(db.prepare(sql).bind(...lote.flat()));
  }
  return stmts;
}

const INSERT_CHART_SEMANA = `INSERT INTO chart_semana
  (chart, data, pos, titulo, titulo_norm, valor, valor_total, artistas, fonte_artistas,
   status, pos_anterior, peak, semanas, semanas_n1)`;

function insertsChartSemana(db: D1DatabaseLike, dataIso: string, linhas: LinhaCalculada[]): D1PreparedStatement[] {
  return insertsEmLotes(
    db,
    INSERT_CHART_SEMANA,
    linhas.map((l) => [
      l.chart, dataIso, l.pos, l.titulo, l.tituloNorm, l.valor, l.valorTotal,
      JSON.stringify(l.artistas), l.fonteArtistas,
      l.movimento.status, l.movimento.posAnterior, l.movimento.peak, l.movimento.semanas, l.movimento.semanasN1,
    ]),
  );
}

/**
 * Histórico de cada música do chart ANTES de `dataIso` (2 queries): agregado
 * de todas as semanas anteriores + posição na semana imediatamente anterior.
 */
export async function historicoAntesDe(db: D1DatabaseLike, chart: ChartId, dataIso: string): Promise<Map<string, HistoricoMusica>> {
  const agregado = await db
    .prepare(
      `SELECT titulo_norm, MIN(pos) AS peak, COUNT(DISTINCT data) AS semanas, SUM(pos = 1) AS n1
       FROM chart_semana WHERE chart = ? AND data < ? GROUP BY titulo_norm`,
    )
    .bind(chart, dataIso)
    .all<{ titulo_norm: string; peak: number; semanas: number; n1: number }>();
  const anterior = await db
    .prepare(
      `SELECT titulo_norm, MIN(pos) AS pos FROM chart_semana
       WHERE chart = ? AND data = (SELECT MAX(data) FROM chart_semana WHERE chart = ? AND data < ?)
       GROUP BY titulo_norm`,
    )
    .bind(chart, chart, dataIso)
    .all<{ titulo_norm: string; pos: number }>();
  const posAnterior = new Map(anterior.results.map((r) => [r.titulo_norm, r.pos]));
  const hist = new Map<string, HistoricoMusica>();
  for (const r of agregado.results) {
    hist.set(r.titulo_norm, {
      tituloNorm: r.titulo_norm,
      posAnterior: posAnterior.get(r.titulo_norm) ?? null,
      peak: r.peak,
      semanas: r.semanas,
      semanasN1: r.n1,
    });
  }
  return hist;
}

/** Substitui a semana inteira (todos os charts da data) num único batch — tudo ou nada. */
export async function gravarSemana(db: D1DatabaseLike, dataIso: string, linhas: LinhaCalculada[]): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM chart_semana WHERE data = ?").bind(dataIso),
    ...insertsChartSemana(db, dataIso, linhas),
  ]);
}

/** "7,20%" → 0.072; vazio/ilegível → null. */
function parsePercentual(s: string): number | null {
  const n = parseNumeroBR((s ?? "").replace("%", ""));
  return n === null ? null : Math.round(n * 1e4) / 1e6;
}

const PLATAFORMAS_PESO = ["SPOTIFY", "APPLE MUSIC", "YOUTUBE"] as const;

async function gravarArtistasEPesos(db: D1DatabaseLike, artistas: string[][], pesos: string[][]): Promise<void> {
  const linhasArtistas: unknown[][] = [];
  const texto = (v: unknown) => String(v ?? "").trim();
  for (const [nome, nacionalidade, foto] of artistas) {
    const n = texto(nome);
    // Nacionalidade em CAIXA ALTA pra casar com os nomes de pais_peso ("AUSTRÁLIA").
    if (n) linhasArtistas.push([n.toUpperCase(), n, texto(nacionalidade).toUpperCase(), texto(foto)]);
  }
  const linhasPesos: unknown[][] = [];
  for (const p of pesos) {
    const pais = texto(p[0]).toUpperCase();
    if (!pais) continue;
    PLATAFORMAS_PESO.forEach((plataforma, i) => {
      const peso = parsePercentual(texto(p[i + 1]));
      if (peso !== null) linhasPesos.push([plataforma, pais, peso]);
    });
  }
  const stmts = [
    ...insertsEmLotes(
      db,
      "INSERT INTO artista_info (nome_upper, nome, nacionalidade, foto)",
      linhasArtistas,
      "ON CONFLICT(nome_upper) DO UPDATE SET nome = excluded.nome, nacionalidade = excluded.nacionalidade, foto = excluded.foto",
    ),
    ...insertsEmLotes(
      db,
      "INSERT INTO pais_peso (plataforma, pais, peso)",
      linhasPesos,
      "ON CONFLICT(plataforma, pais) DO UPDATE SET peso = excluded.peso",
    ),
  ];
  if (stmts.length) await db.batch(stmts);
}

const CATALOGO_SQL =
  "SELECT titulo, artista, artista_2, artista_3, artista_4, artista_5, artista_6, capa_url, genero, tipo_single FROM musicas";

async function carregarCatalogo(db: D1DatabaseLike): Promise<Map<string, MusicaCatalogo>> {
  try {
    return indexarCatalogo((await db.prepare(CATALOGO_SQL).all<LinhaCatalogo>()).results);
  } catch (e) {
    // Tabela musicas ainda não existe nesse banco → catálogo vazio (esperado).
    // Qualquer outra falha também segue com catálogo vazio (a semana ainda é
    // gravada, só sem artistas do catálogo), mas fica no log.
    if (!/no such table/i.test(e instanceof Error ? e.message : String(e))) {
      console.warn("[charts-d1] falha ao ler catálogo musicas; seguindo sem catálogo:", e);
    }
    return new Map();
  }
}

async function carregarConhecidos(db: D1DatabaseLike): Promise<Set<string>> {
  const r = await db.prepare("SELECT nome_upper FROM artista_info").all<{ nome_upper: string }>();
  return new Set(r.results.map((x) => x.nome_upper));
}

/** Movimento de cada linha de um chart contra o histórico antes da data. */
async function calcularChart(
  db: D1DatabaseLike,
  chart: ChartId,
  dataIso: string,
  linhas: Omit<LinhaCalculada, "movimento">[],
): Promise<LinhaCalculada[]> {
  const hist = await historicoAntesDe(db, chart, dataIso);
  return linhas.map((l) => ({ ...l, movimento: calcularMovimento(l.pos, hist.get(l.tituloNorm)) }));
}

/** Recalcula status/peak/semanas da semana seguinte de cada chart (reenvio de semana antiga). */
async function recalcularSemanaSeguinte(db: D1DatabaseLike, charts: ChartId[], dataIso: string): Promise<void> {
  const seguintes = await db
    .prepare("SELECT chart, MIN(data) AS data FROM chart_semana WHERE data > ? GROUP BY chart")
    .bind(dataIso)
    .all<{ chart: ChartId; data: string }>();
  const stmts: D1PreparedStatement[] = [];
  for (const { chart, data } of seguintes.results) {
    if (!charts.includes(chart)) continue;
    const rows = await db
      .prepare(
        `SELECT pos, titulo, titulo_norm, valor, valor_total, artistas, fonte_artistas
         FROM chart_semana WHERE chart = ? AND data = ? ORDER BY pos`,
      )
      .bind(chart, data)
      .all<{ pos: number; titulo: string; titulo_norm: string; valor: number; valor_total: number | null; artistas: string; fonte_artistas: string }>();
    const linhas = await calcularChart(
      db,
      chart,
      data,
      rows.results.map((r) => ({
        chart,
        dataIso: data,
        pos: r.pos,
        titulo: r.titulo,
        tituloNorm: chaveMusica(r.titulo),
        valor: r.valor,
        valorTotal: r.valor_total,
        artistas: JSON.parse(r.artistas || "[]"),
        fonteArtistas: r.fonte_artistas,
      })),
    );
    stmts.push(db.prepare("DELETE FROM chart_semana WHERE chart = ? AND data = ?").bind(chart, data), ...insertsChartSemana(db, data, linhas));
  }
  if (stmts.length) await db.batch(stmts);
}

async function registrarIngestao(
  db: D1DatabaseLike,
  dataIso: string | null,
  modo: string,
  linhas: number,
  ok: boolean,
  mensagem: string,
): Promise<void> {
  await db
    .prepare("INSERT INTO chart_ingestao (data, modo, linhas, ok, mensagem) VALUES (?, ?, ?, ?, ?)")
    .bind(dataIso, modo, linhas, ok ? 1 : 0, mensagem)
    .run();
}

const MAX_ERROS = 50;
const limitarErros = (erros: string[]) =>
  erros.length > MAX_ERROS ? [...erros.slice(0, MAX_ERROS), `... e mais ${erros.length - MAX_ERROS} erro(s)`] : erros;

/**
 * Parse + validação das linhas cruas. Semanal: estrito (validarSemana e
 * PONTOS/VENDAS obrigatório). Histórico: ignora iTUNES, deduplica
 * (chart, data, pos) mantendo a primeira e só anota anomalias.
 */
function prepararLinhas(
  cruas: string[][],
  modo: "semanal" | "historico",
): { ok: true; dataIso: string; linhas: LinhaDados[]; anomalias: string[] } | { ok: false; erros: string[] } {
  const erros: string[] = [];
  const anomalias: string[] = [];
  const linhas: LinhaDados[] = [];
  const vistos = new Set<string>();
  let invalidas = 0;
  let itunes = 0;
  let duplicadas = 0;

  cruas.forEach((crua, i) => {
    const cols = (Array.isArray(crua) ? crua : []).map((v) => String(v ?? ""));
    const l = parseLinhaDados(cols);
    if (!l) {
      if (modo === "semanal") erros.push(`linha ${i + 1}: chart, data ou posição ausente/inválida`);
      else invalidas++;
      return;
    }
    if (modo === "semanal") {
      // parseLinhaDados transforma valor vazio em 0 — no envio semanal isso é erro.
      if (parseNumeroBR(cols[4] ?? "") === null) erros.push(`linha ${i + 1} (${l.chart} #${l.pos}): PONTOS/VENDAS vazio ou ilegível`);
      linhas.push(l);
      return;
    }
    if (l.chart.toUpperCase() === "ITUNES") { itunes++; return; }
    const chave = `${l.chart}|${l.dataIso}|${l.pos}`;
    if (vistos.has(chave)) { duplicadas++; return; }
    vistos.add(chave);
    linhas.push(l);
  });

  if (modo === "semanal") {
    const v = validarSemana(linhas);
    if (!v.ok) erros.push(...v.erros);
    if (!v.ok || erros.length) return { ok: false, erros: limitarErros(erros) };
    return { ok: true, dataIso: v.dataIso, linhas, anomalias };
  }

  const datas = [...new Set(linhas.map((l) => l.dataIso))];
  if (datas.length !== 1) erros.push(`esperada uma única data, encontradas ${datas.length}: ${datas.join(", ") || "nenhuma"}`);
  const conhecidos = new Set<string>(CHARTS);
  for (const c of new Set(linhas.map((l) => l.chart))) if (!conhecidos.has(c)) erros.push(`chart desconhecido: ${c}`);
  if (erros.length) return { ok: false, erros: limitarErros(erros) };

  if (duplicadas) anomalias.push(`${duplicadas} linha(s) duplicada(s) descartada(s)`);
  if (itunes) anomalias.push(`${itunes} linha(s) de iTUNES ignorada(s)`);
  if (invalidas) anomalias.push(`${invalidas} linha(s) inválida(s) ignorada(s)`);
  for (const c of CHARTS) {
    const ord = linhas.filter((l) => l.chart === c).map((l) => l.pos).sort((a, b) => a - b);
    if (ord.length && ord.some((p, i) => p !== i + 1)) anomalias.push(`${c}: ${ord.length} linha(s), posições não contíguas`);
  }
  return { ok: true, dataIso: datas[0], linhas, anomalias };
}

/** Ingere uma semana: valida, atualiza artistas/pesos, calcula movimento, grava e recalcula a seguinte. */
export async function ingerirSemana(db: D1DatabaseLike, payload: PayloadIngestao): Promise<ResultadoIngestao> {
  const modo = payload.modo === "historico" ? "historico" : "semanal";
  await db.batch(CHARTS_D1_SCHEMA.map((sql) => db.prepare(sql)));

  const cruas = Array.isArray(payload.linhas) ? payload.linhas : [];
  const prep = prepararLinhas(cruas, modo);
  if (!prep.ok) {
    await registrarIngestao(db, null, modo, cruas.length, false, prep.erros.join("; "));
    return prep;
  }

  // Antes de resolver: o filtro de artistas do título usa artista_info.
  await gravarArtistasEPesos(db, payload.artistas ?? [], payload.pesos ?? []);
  const [cat, conhecidos] = await Promise.all([carregarCatalogo(db), carregarConhecidos(db)]);

  const charts = CHARTS.filter((c) => prep.linhas.some((l) => l.chart === c));
  const calculadas: LinhaCalculada[] = [];
  for (const chart of charts) {
    const base = prep.linhas
      .filter((l) => l.chart === chart)
      .map((l) => {
        const r = resolverArtistas(l, cat, conhecidos);
        return {
          chart,
          dataIso: prep.dataIso,
          pos: l.pos,
          titulo: l.titulo,
          tituloNorm: chaveMusica(l.titulo),
          valor: l.valor,
          valorTotal: l.valorTotal,
          artistas: r.artistas,
          fonteArtistas: r.fonte,
        };
      });
    calculadas.push(...(await calcularChart(db, chart, prep.dataIso, base)));
  }

  await gravarSemana(db, prep.dataIso, calculadas);
  await recalcularSemanaSeguinte(db, charts, prep.dataIso);
  await registrarIngestao(db, prep.dataIso, modo, calculadas.length, true, prep.anomalias.join("; ") || "ok");
  return { ok: true, data: prep.dataIso, linhas: calculadas.length };
}
