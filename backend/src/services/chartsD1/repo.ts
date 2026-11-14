// Gravação dos charts semanais no D1: tabelas, histórico por música e
// ingestão de uma semana da aba DADOS (enviada pelo Google, nunca lida daqui).
import type { D1DatabaseLike, D1PreparedStatement } from "../catalogoDbService";
import { CHARTS, type ChartId, type LinhaDados } from "./tipos";
import { dataBrParaIso, dataIsoParaBr, parseLinhaDados, parseNumeroBR, validarSemana } from "./dados";
import { calcularMovimento, type HistoricoMusica, type Movimento } from "./movimento";
import {
  buscarNoCatalogo, chaveMusica, extrairArtistasDoTitulo, indexarCatalogo, resolverArtistas,
  type LinhaCatalogo, type MusicaCatalogo,
} from "./artistas";
import { rankingsDaSemana, type MusicaParaPais, type Pesos } from "./paises";
import { fixImg, fmt } from "./formato";

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

export async function carregarCatalogo(db: D1DatabaseLike): Promise<Map<string, MusicaCatalogo>> {
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

// ---- Leitura (/api/charts) ----

/** Banco sem as tabelas dos charts (nenhuma ingestão ainda) → leitura vazia, não erro. */
async function consultar<T>(db: D1DatabaseLike, sql: string, ...params: unknown[]): Promise<T[]> {
  try {
    return (await db.prepare(sql).bind(...params).all<T>()).results;
  } catch (e) {
    if (/no such table/i.test(e instanceof Error ? e.message : String(e))) return [];
    throw e;
  }
}

/** Fotos de artista_info por nome em CAIXA ALTA (fallback de capa). */
export async function carregarFotos(db: D1DatabaseLike): Promise<Map<string, string>> {
  const rows = await consultar<{ nome_upper: string; foto: string }>(
    db,
    "SELECT nome_upper, foto FROM artista_info WHERE foto IS NOT NULL AND foto != ''",
  );
  return new Map(rows.map((r) => [r.nome_upper, r.foto]));
}

const lerArtistas = (json: string | null): string[] => {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.map((a) => String(a ?? "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
};

/** Primeiro artista gravado; sem nenhum, o principal do "Artista - Título". */
const artistaPrincipal = (artistas: string[], titulo: string): string =>
  artistas[0] || extrairArtistasDoTitulo(titulo)[0] || "";

/** Capa: catálogo (single vence álbum) → foto do artista principal → "". */
const capaDe = (titulo: string, art: string, cat: Map<string, MusicaCatalogo>, fotos: Map<string, string>): string =>
  fixImg(buscarNoCatalogo(titulo, cat)?.capa) || fixImg(fotos.get(art.trim().toUpperCase())) || "";

/** Há pesos de país pra plataforma? Sem eles, COUNTRIES segue da planilha. */
export async function temPesosPais(db: D1DatabaseLike, plataforma: ChartId): Promise<boolean> {
  return (await consultar(db, "SELECT 1 FROM pais_peso WHERE plataforma = ? LIMIT 1", plataforma)).length > 0;
}

/** Datas com dados no chart, `dd/mm/aaaa`, mais recente primeiro. Vazio → fallback pra planilha. */
export async function datasDoChart(db: D1DatabaseLike, chart: ChartId): Promise<string[]> {
  const rows = await consultar<{ data: string }>(
    db,
    "SELECT DISTINCT data FROM chart_semana WHERE chart = ? ORDER BY data DESC",
    chart,
  );
  return rows.map((r) => dataIsoParaBr(r.data));
}

/** Datas ISO distintas já gravadas (qualquer chart), mais antiga primeiro. Usado pela carga inicial pra pular semanas prontas. */
export async function datasCarregadas(db: D1DatabaseLike): Promise<string[]> {
  const rows = await consultar<{ data: string }>(db, "SELECT DISTINCT data FROM chart_semana ORDER BY data");
  return rows.map((r) => r.data);
}

/** Gêneros (catálogo) das músicas que já passaram pelo chart, ordenados. */
export async function generosDoChart(db: D1DatabaseLike, chart: ChartId, cat: Map<string, MusicaCatalogo>): Promise<string[]> {
  const rows = await consultar<{ titulo: string }>(db, "SELECT DISTINCT titulo FROM chart_semana WHERE chart = ?", chart);
  const generos = new Set<string>();
  for (const r of rows) {
    const g = buscarNoCatalogo(r.titulo || "", cat)?.genero;
    if (g) generos.add(g);
  }
  return [...generos].sort();
}

export interface LinhaChartApi {
  pos: number;
  tit: string;
  val: string;
  valTotal: string;
  art: string;
  st: string;
  capa: string;
  style: string;
}

/** Linhas de um chart numa semana, no contrato de `getChart`. `estilo` vazio = todos. */
export async function linhasDoChart(
  db: D1DatabaseLike,
  chart: ChartId,
  dataBr: string,
  estilo: string,
  cat: Map<string, MusicaCatalogo>,
  fotos: Map<string, string>,
): Promise<LinhaChartApi[]> {
  const dataIso = dataBrParaIso(dataBr);
  const [rows, somas] = await Promise.all([
    consultar<{ pos: number; titulo: string; titulo_norm: string; valor: number; valor_total: number | null; artistas: string; status: string }>(
      db,
      `SELECT pos, titulo, titulo_norm, valor, valor_total, artistas, status
       FROM chart_semana WHERE chart = ? AND data = ? ORDER BY pos`,
      chart,
      dataIso,
    ),
    // Acumulado de cada música da semana no chart, até a data (inclusive).
    consultar<{ titulo_norm: string; total: number }>(
      db,
      `SELECT titulo_norm, SUM(valor) AS total FROM chart_semana
       WHERE chart = ? AND data <= ?
         AND titulo_norm IN (SELECT titulo_norm FROM chart_semana WHERE chart = ? AND data = ?)
       GROUP BY titulo_norm`,
      chart,
      dataIso,
      chart,
      dataIso,
    ),
  ]);
  const acumulado = new Map(somas.map((s) => [s.titulo_norm, s.total]));
  const linhas = rows.map((r) => {
    const titulo = r.titulo || "";
    const art = artistaPrincipal(lerArtistas(r.artistas), titulo);
    return {
      pos: r.pos,
      tit: titulo,
      val: fmt(r.valor),
      valTotal: fmt(r.valor_total ?? acumulado.get(r.titulo_norm) ?? r.valor),
      art,
      st: r.status || "NEW",
      capa: capaDe(titulo, art, cat, fotos),
      style: buscarNoCatalogo(titulo, cat)?.genero ?? "",
    };
  });
  return estilo ? linhas.filter((l) => l.style === estilo) : linhas;
}

export interface LinhaPaisApi {
  pais: string;
  pos: number;
  tit: string;
  val: string;
  mes: string;
  art: string;
  capa: string;
  st: string;
}

const numeroConfig = (v: string | undefined, padrao: number): number => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : padrao;
};

/**
 * Ranking de cada país de `pais_peso` (regra B + bônus de nacionalidade) na
 * semana; `st` compara com o ranking do mesmo país na semana anterior do chart.
 * `mes` leva a data da semana (`dd/mm/aaaa`), que o front exibe como vier.
 */
export async function linhasPaises(
  db: D1DatabaseLike,
  plataforma: ChartId,
  dataBr: string,
  cat: Map<string, MusicaCatalogo>,
  fotos: Map<string, string>,
): Promise<LinhaPaisApi[]> {
  const dataIso = dataBrParaIso(dataBr);
  const [pesosRows, cfgRows, nacRows, anteriorRows] = await Promise.all([
    consultar<{ pais: string; peso: number }>(
      db,
      "SELECT pais, peso FROM pais_peso WHERE plataforma = ? ORDER BY peso DESC, pais",
      plataforma,
    ),
    consultar<{ chave: string; valor: string }>(db, "SELECT chave, valor FROM chart_config"),
    consultar<{ nome_upper: string; nacionalidade: string }>(
      db,
      "SELECT nome_upper, nacionalidade FROM artista_info WHERE nacionalidade IS NOT NULL AND nacionalidade != ''",
    ),
    consultar<{ data: string | null }>(db, "SELECT MAX(data) AS data FROM chart_semana WHERE chart = ? AND data < ?", plataforma, dataIso),
  ]);
  const pesos: Pesos = new Map(pesosRows.map((p) => [p.pais.trim().toUpperCase(), p.peso]));
  if (!pesos.size) return [];
  const cfg = new Map(cfgRows.map((c) => [c.chave, c.valor]));
  const bonus = numeroConfig(cfg.get("bonus_nacionalidade"), 0.2);
  const top = numeroConfig(cfg.get("top_pais"), 50);
  const nacionalidade = new Map(nacRows.map((n) => [n.nome_upper.trim().toUpperCase(), n.nacionalidade.trim().toUpperCase()]));

  const musicasDaSemana = async (iso: string): Promise<MusicaParaPais[]> => {
    const rows = await consultar<{ titulo: string; titulo_norm: string; valor: number; artistas: string }>(
      db,
      "SELECT titulo, titulo_norm, valor, artistas FROM chart_semana WHERE chart = ? AND data = ? ORDER BY pos",
      plataforma,
      iso,
    );
    return rows.map((r) => {
      const artistas = lerArtistas(r.artistas);
      const nacs = new Set<string>();
      for (const a of artistas) {
        const n = nacionalidade.get(a.toUpperCase());
        if (n) nacs.add(n);
      }
      return {
        tituloNorm: r.titulo_norm,
        titulo: r.titulo || "",
        artistaPrincipal: artistaPrincipal(artistas, r.titulo || ""),
        valor: r.valor ?? 0,
        nacionalidades: nacs,
      };
    });
  };
  const anteriorIso = anteriorRows[0]?.data ?? null;
  const [atual, anterior] = await Promise.all([
    musicasDaSemana(dataIso),
    anteriorIso ? musicasDaSemana(anteriorIso) : Promise.resolve([] as MusicaParaPais[]),
  ]);
  if (!atual.length) return [];

  // Capa por título resolvida uma vez (o mesmo título aparece em vários países).
  const capas = new Map<string, string>();
  const capa = (titulo: string, art: string) => {
    const k = `${titulo}\u0000${art}`;
    if (!capas.has(k)) capas.set(k, capaDe(titulo, art, cat, fotos));
    return capas.get(k)!;
  };
  const linhas: LinhaPaisApi[] = [];
  for (const [pais, ranking] of rankingsDaSemana(atual, anterior, pesos, bonus, top)) {
    for (const m of ranking) {
      linhas.push({ pais, pos: m.pos, tit: m.titulo, val: fmt(m.val), mes: dataBr, art: m.art, capa: capa(m.titulo, m.art), st: m.st });
    }
  }
  return linhas;
}

/** #1 da semana mais recente do chart (banners da Início); null sem dados. */
export async function numero1DaUltimaSemana(
  db: D1DatabaseLike,
  chart: ChartId,
  cat: Map<string, MusicaCatalogo>,
  fotos: Map<string, string>,
): Promise<{ tit: string; art: string; capa: string } | null> {
  const [r] = await consultar<{ titulo: string; artistas: string }>(
    db,
    `SELECT titulo, artistas FROM chart_semana
     WHERE chart = ? AND data = (SELECT MAX(data) FROM chart_semana WHERE chart = ?)
     ORDER BY pos LIMIT 1`,
    chart,
    chart,
  );
  if (!r) return null;
  const tit = r.titulo || "";
  const art = artistaPrincipal(lerArtistas(r.artistas), tit);
  return { tit, art, capa: capaDe(tit, art, cat, fotos) };
}

export interface ItemHOF {
  t: string;
  v: string;
}

export interface PerfilHOFD1 {
  n1_hot100: string;
  n1_spotify: string;
  n1_youtube: string;
  sp: ItemHOF[];
  am: ItemHOF[];
  yt: ItemHOF[];
  runs: ItemHOF[];
}

export const CHARTS_HOF: ChartId[] = ["BILLBOARD HOT 100", "SPOTIFY", "APPLE MUSIC", "YOUTUBE"];

/**
 * Parte dos charts semanais no Hall of Fame: por chart, cada música (chaveMusica)
 * em que o artista está entre os `artistas` gravados vira `{t, v}` com as
 * posições em ordem cronológica ("32 - 50 - 1"); n1_* = músicas distintas que
 * chegaram ao #1. `runs` = Hot 100 (mesmo papel das colunas de runs da planilha).
 */
export async function perfilHOF(db: D1DatabaseLike, artista: string): Promise<PerfilHOFD1> {
  const alvo = artista.trim().toUpperCase();
  const porChart = new Map<string, Map<string, { t: string; posicoes: number[] }>>(CHARTS_HOF.map((c) => [c, new Map()]));
  if (alvo) {
    // LIKE só pré-filtra (ignora caixa só em ASCII); o filtro exato é no JSON abaixo.
    const padrao = `%${artista.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await consultar<{ chart: string; pos: number; titulo: string; titulo_norm: string; artistas: string }>(
      db,
      `SELECT chart, pos, titulo, titulo_norm, artistas FROM chart_semana
       WHERE chart IN (${CHARTS_HOF.map(() => "?").join(", ")}) AND artistas LIKE ? ESCAPE '\\'
       ORDER BY data, pos`,
      ...CHARTS_HOF,
      padrao,
    );
    for (const r of rows) {
      if (!lerArtistas(r.artistas).some((a) => a.toUpperCase() === alvo)) continue;
      const musicas = porChart.get(r.chart)!;
      const m = musicas.get(r.titulo_norm) ?? { t: r.titulo || "", posicoes: [] };
      m.t = r.titulo || m.t; // grafia mais recente
      m.posicoes.push(r.pos);
      musicas.set(r.titulo_norm, m);
    }
  }
  // Melhor pico primeiro, depois mais semanas (mesma ordem que a tela usa nos runs).
  const itens = (chart: ChartId) =>
    [...porChart.get(chart)!.values()]
      .map((m) => ({ ...m, peak: Math.min(...m.posicoes) }))
      .sort((a, b) => a.peak - b.peak || b.posicoes.length - a.posicoes.length || a.t.localeCompare(b.t));
  const lista = (chart: ChartId): ItemHOF[] => itens(chart).map((m) => ({ t: m.t, v: m.posicoes.join(" - ") }));
  const n1 = (chart: ChartId) => String(itens(chart).filter((m) => m.peak === 1).length);
  return {
    n1_hot100: n1("BILLBOARD HOT 100"),
    n1_spotify: n1("SPOTIFY"),
    n1_youtube: n1("YOUTUBE"),
    sp: lista("SPOTIFY"),
    am: lista("APPLE MUSIC"),
    yt: lista("YOUTUBE"),
    runs: lista("BILLBOARD HOT 100"),
  };
}
