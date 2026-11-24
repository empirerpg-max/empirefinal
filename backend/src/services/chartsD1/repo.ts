// Gravação dos charts semanais no D1: tabelas, histórico por música e
// ingestão de uma semana da aba DADOS (enviada pelo Google, nunca lida daqui).
import type { D1DatabaseLike, D1PreparedStatement } from "../catalogoDbService";
import { CHARTS, type ChartId, type LinhaDados } from "./tipos";
import { dataBrParaIso, dataIsoParaBr, parseLinhaDados, parseNumeroBR, validarSemana } from "./dados";
import { calcularMovimento, type HistoricoMusica, type Movimento } from "./movimento";
import {
  buscarNoCatalogo, chaveMusica, extrairArtistasDoTitulo, indexarCatalogo, resolverArtistas, semAcentoMaiusculo,
  type LinhaCatalogo, type MusicaCatalogo,
} from "./artistas";
import { rankingsDaSemana, type MusicaParaPais, type Pesos } from "./paises";
import { fixImg, fmt } from "./formato";
import { regrasDeConfig } from "./regras";
import { FOCO_SCHEMA } from "./foco";

// Idempotente — roda no começo de cada ingestão (padrão do projeto).
// Plano grátis do D1: cada linha e cada entrada de índice gravada conta no
// limite diário de escritas, e cada linha percorrida conta nas leituras —
// por isso as tabelas são WITHOUT ROWID (sem a cópia extra do rowid) e as
// leituras da tela vêm de tabelas derivadas pequenas (chart_datas,
// chart_artista_musica) e de colunas gravadas na ingestão (genero,
// valor_acumulado), nunca de varrer o histórico.
export const CHARTS_D1_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS chart_semana (
    chart TEXT NOT NULL,
    data TEXT NOT NULL,
    pos INTEGER NOT NULL,
    titulo TEXT,
    titulo_norm TEXT, -- chaveMusica(titulo): identidade da música no chart
    valor INTEGER,
    valor_total INTEGER,
    valor_acumulado INTEGER, -- valor_total da planilha ou acumulado anterior da música + valor
    artistas TEXT,
    fonte_artistas TEXT,
    genero TEXT, -- do catálogo musicas, resolvido na ingestão
    status TEXT,
    pos_anterior INTEGER,
    peak INTEGER,
    semanas INTEGER,
    semanas_n1 INTEGER,
    PRIMARY KEY (chart, data, pos)
  ) WITHOUT ROWID`,
  // Único índice extra (cada índice encarece as ~500 escritas semanais).
  // Sem rowid, o índice já carrega (data, pos) da PK.
  "CREATE INDEX IF NOT EXISTS ix_chart_norm ON chart_semana(chart, titulo_norm)",
  // Datas de cada chart (filtro de datas da tela e carga inicial) sem varrer chart_semana.
  `CREATE TABLE IF NOT EXISTS chart_datas (
    chart TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (chart, data)
  ) WITHOUT ROWID`,
  // Hall of Fame: uma linha por artista × chart × música, lida só pela PK.
  `CREATE TABLE IF NOT EXISTS chart_artista_musica (
    artista_key TEXT NOT NULL, -- semAcentoMaiusculo(nome)
    chart TEXT NOT NULL,
    titulo_norm TEXT NOT NULL,
    titulo TEXT,
    peak INTEGER,
    semanas_n1 INTEGER,
    run TEXT, -- posições em ordem cronológica, "32 - 50 - 1"
    PRIMARY KEY (artista_key, chart, titulo_norm)
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS pais_peso (
    plataforma TEXT NOT NULL,
    pais TEXT NOT NULL,
    peso REAL,
    PRIMARY KEY (plataforma, pais)
  )`,
  "CREATE TABLE IF NOT EXISTS chart_config (chave TEXT PRIMARY KEY, valor TEXT)",
  // charts_d1_ativo: a tela só lê do D1 depois da carga inicial completa ('1').
  `INSERT OR IGNORE INTO chart_config (chave, valor) VALUES
    ('bonus_nacionalidade', '0.20'), ('top_pais', '50'), ('charts_d1_ativo', '0')`,
  `CREATE TABLE IF NOT EXISTS artista_info (
    nome_upper TEXT PRIMARY KEY,
    nome TEXT,
    nacionalidade TEXT,
    foto TEXT,
    genero TEXT -- gênero do artista (INFOS ACTS): fallback quando a música não tem gênero no catálogo
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
  // Regras das paradas por país congeladas na ingestão de cada semana (1 escrita/semana).
  // Semana sem linha usa REGRAS_PADRAO (versão 1, fixa no código).
  "CREATE TABLE IF NOT EXISTS chart_regras_semana (data TEXT PRIMARY KEY, versao INTEGER NOT NULL, regras TEXT NOT NULL)",
  ...FOCO_SCHEMA,
];

/**
 * Migrações de bancos já criados (CREATE TABLE IF NOT EXISTS não adiciona
 * coluna nova em tabela existente). Cada uma roda sozinha, fora de batch,
 * e "duplicate column" (já aplicada) é ignorado.
 */
export const CHARTS_D1_MIGRACOES: string[] = ["ALTER TABLE artista_info ADD COLUMN genero TEXT"];

/** Cria as tabelas (se faltarem) e aplica as migrações idempotentes. */
export async function garantirSchemaCharts(db: D1DatabaseLike): Promise<void> {
  await db.batch(CHARTS_D1_SCHEMA.map((sql) => db.prepare(sql)));
  for (const sql of CHARTS_D1_MIGRACOES) {
    try {
      await db.prepare(sql).run();
    } catch (e) {
      if (!/duplicate column/i.test(e instanceof Error ? e.message : String(e))) throw e;
    }
  }
}

/** Chave de artista_info.nome_upper: nome sem espaços nas pontas, em CAIXA ALTA. */
export const chaveArtistaInfo = (nome: string): string => String(nome ?? "").trim().toUpperCase();

/** Charts que alimentam o Hall of Fame (chart_artista_musica). */
export const CHARTS_HOF: ChartId[] = ["BILLBOARD HOT 100", "SPOTIFY", "APPLE MUSIC", "YOUTUBE"];

export interface LinhaCalculada {
  chart: ChartId;
  dataIso: string;
  pos: number;
  titulo: string;
  tituloNorm: string;
  valor: number;
  valorTotal: number | null;
  valorAcumulado: number;
  artistas: string[];
  fonteArtistas: string;
  genero: string;
  movimento: Movimento;
}

type LinhaBase = Omit<LinhaCalculada, "movimento" | "valorAcumulado">;

export interface PayloadIngestao {
  linhas?: string[][];
  /** [nome, nacionalidade, foto, genero?] (INFOS ACTS). */
  artistas?: string[][];
  /** Linhas do CSV PAÍSES E PESOS: [país, spotify, apple music, youtube] em "7,20%". */
  pesos?: string[][];
  modo?: "semanal" | "historico";
  /** Libera a leitura do D1 na tela (fim da carga inicial). Sozinho, sem linhas, é válido. */
  ativar?: boolean;
}

export type ResultadoIngestao =
  | { ok: true; data: string; linhas: number }
  | { ok: true; ativo: true }
  | { ok: false; erros: string[] };

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
  (chart, data, pos, titulo, titulo_norm, valor, valor_total, valor_acumulado, artistas, fonte_artistas, genero,
   status, pos_anterior, peak, semanas, semanas_n1)`;

function insertsChartSemana(db: D1DatabaseLike, dataIso: string, linhas: LinhaCalculada[]): D1PreparedStatement[] {
  return insertsEmLotes(
    db,
    INSERT_CHART_SEMANA,
    linhas.map((l) => [
      l.chart, dataIso, l.pos, l.titulo, l.tituloNorm, l.valor, l.valorTotal, l.valorAcumulado,
      JSON.stringify(l.artistas), l.fonteArtistas, l.genero || null,
      l.movimento.status, l.movimento.posAnterior, l.movimento.peak, l.movimento.semanas, l.movimento.semanasN1,
    ]),
  );
}

/** Linha de chart_semana de uma música, lida pelo índice ix_chart_norm. */
interface LinhaHistorico {
  data: string;
  pos: number;
  titulo: string;
  titulo_norm: string;
  artistas: string;
  valor_acumulado: number | null;
}

// Cabe no limite de parâmetros junto com `chart` e `data`.
const TITULOS_POR_CONSULTA = MAX_PARAMS_D1 - 2;

/**
 * Linhas das músicas `titulos` no chart antes (`<`) ou depois (`>`) de
 * `dataIso`. Lê só o histórico dessas músicas (índice ix_chart_norm), nunca o
 * chart inteiro: o custo não cresce com o número de semanas gravadas.
 */
async function linhasDasMusicas(
  db: D1DatabaseLike,
  chart: ChartId,
  titulos: Iterable<string>,
  comparacao: "<" | ">",
  dataIso: string,
): Promise<LinhaHistorico[]> {
  const unicos = [...new Set(titulos)];
  const out: LinhaHistorico[] = [];
  for (let i = 0; i < unicos.length; i += TITULOS_POR_CONSULTA) {
    const lote = unicos.slice(i, i + TITULOS_POR_CONSULTA);
    const r = await db
      .prepare(
        `SELECT data, pos, titulo, titulo_norm, artistas, valor_acumulado
         FROM chart_semana INDEXED BY ix_chart_norm
         WHERE chart = ? AND titulo_norm IN (${lote.map(() => "?").join(", ")}) AND data ${comparacao} ?`,
      )
      .bind(chart, ...lote, dataIso)
      .all<LinhaHistorico>();
    out.push(...r.results);
  }
  return out;
}

/** Semana do chart imediatamente antes/depois de `dataIso` (pela PK); null se não houver. */
async function semanaVizinha(db: D1DatabaseLike, chart: ChartId, dataIso: string, lado: "anterior" | "seguinte"): Promise<string | null> {
  const sql = lado === "anterior"
    ? "SELECT MAX(data) AS data FROM chart_semana WHERE chart = ? AND data < ?"
    : "SELECT MIN(data) AS data FROM chart_semana WHERE chart = ? AND data > ?";
  const r = await db.prepare(sql).bind(chart, dataIso).all<{ data: string | null }>();
  return r.results[0]?.data ?? null;
}

/** Agrega as linhas anteriores de cada música: movimento + último acumulado. */
function resumirHistorico(
  antes: LinhaHistorico[],
  semanaAnterior: string | null,
): { hist: Map<string, HistoricoMusica>; acumulado: Map<string, number | null> } {
  const agg = new Map<string, { peak: number; datas: Set<string>; n1: number; posAnterior: number | null; ultima: string; acumulado: number | null }>();
  for (const r of antes) {
    let a = agg.get(r.titulo_norm);
    if (!a) {
      a = { peak: r.pos, datas: new Set(), n1: 0, posAnterior: null, ultima: "", acumulado: null };
      agg.set(r.titulo_norm, a);
    }
    a.peak = Math.min(a.peak, r.pos);
    a.datas.add(r.data);
    if (r.pos === 1) a.n1++;
    if (r.data === semanaAnterior) a.posAnterior = a.posAnterior === null ? r.pos : Math.min(a.posAnterior, r.pos);
    if (r.data > a.ultima) {
      a.ultima = r.data;
      a.acumulado = r.valor_acumulado;
    }
  }
  const hist = new Map<string, HistoricoMusica>();
  const acumulado = new Map<string, number | null>();
  for (const [tituloNorm, a] of agg) {
    hist.set(tituloNorm, { tituloNorm, posAnterior: a.posAnterior, peak: a.peak, semanas: a.datas.size, semanasN1: a.n1 });
    acumulado.set(tituloNorm, a.acumulado);
  }
  return { hist, acumulado };
}

/** Histórico de cada música de `titulos` no chart ANTES de `dataIso`. */
export async function historicoAntesDe(
  db: D1DatabaseLike,
  chart: ChartId,
  dataIso: string,
  titulos: string[],
): Promise<Map<string, HistoricoMusica>> {
  const anterior = await semanaVizinha(db, chart, dataIso, "anterior");
  return resumirHistorico(await linhasDasMusicas(db, chart, titulos, "<", dataIso), anterior).hist;
}

/**
 * Movimento e acumulado de cada linha da semana contra o histórico das
 * músicas dela (mais `outrosTitulos`, cujo histórico também é devolvido).
 */
async function calcularChart(
  db: D1DatabaseLike,
  chart: ChartId,
  dataIso: string,
  linhas: LinhaBase[],
  outrosTitulos: string[] = [],
): Promise<{ calculadas: LinhaCalculada[]; antes: LinhaHistorico[] }> {
  const anterior = await semanaVizinha(db, chart, dataIso, "anterior");
  const antes = await linhasDasMusicas(db, chart, [...linhas.map((l) => l.tituloNorm), ...outrosTitulos], "<", dataIso);
  const { hist, acumulado } = resumirHistorico(antes, anterior);
  const calculadas = linhas.map((l) => ({
    ...l,
    valorAcumulado: l.valorTotal ?? (acumulado.get(l.tituloNorm) ?? 0) + l.valor,
    movimento: calcularMovimento(l.pos, hist.get(l.tituloNorm)),
  }));
  return { calculadas, antes };
}

/** Upsert/remoção em chart_artista_musica das músicas tocadas pela semana gravada. */
function statementsArtistaMusica(
  db: D1DatabaseLike,
  chart: ChartId,
  /** Todas as linhas atuais (antes + semana nova + depois) das músicas afetadas. */
  linhas: { data: string; pos: number; titulo: string; titulo_norm: string; artistas: string[] }[],
  /** Linhas da semana substituída (artistas que podem ter saído). */
  substituidas: { titulo_norm: string; artistas: string[] }[],
): D1PreparedStatement[] {
  const ordenadas = [...linhas].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.pos - b.pos));
  const porChave = new Map<string, { key: string; tituloNorm: string; titulo: string; posicoes: number[] }>();
  for (const l of ordenadas) {
    for (const key of new Set(l.artistas.map(semAcentoMaiusculo).filter(Boolean))) {
      const k = `${key}\u0000${l.titulo_norm}`;
      const m = porChave.get(k) ?? { key, tituloNorm: l.titulo_norm, titulo: "", posicoes: [] };
      m.titulo = l.titulo || m.titulo; // grafia mais recente
      m.posicoes.push(l.pos);
      porChave.set(k, m);
    }
  }
  const remover: unknown[][] = [];
  const vistos = new Set<string>();
  for (const s of substituidas) {
    for (const key of s.artistas.map(semAcentoMaiusculo).filter(Boolean)) {
      const k = `${key}\u0000${s.titulo_norm}`;
      if (porChave.has(k) || vistos.has(k)) continue;
      vistos.add(k);
      remover.push([key, chart, s.titulo_norm]);
    }
  }
  return [
    ...remover.map((r) =>
      db.prepare("DELETE FROM chart_artista_musica WHERE artista_key = ? AND chart = ? AND titulo_norm = ?").bind(...r),
    ),
    ...insertsEmLotes(
      db,
      "INSERT INTO chart_artista_musica (artista_key, chart, titulo_norm, titulo, peak, semanas_n1, run)",
      [...porChave.values()].map((m) => [
        m.key, chart, m.tituloNorm, m.titulo, Math.min(...m.posicoes), m.posicoes.filter((p) => p === 1).length, m.posicoes.join(" - "),
      ]),
      "ON CONFLICT(artista_key, chart, titulo_norm) DO UPDATE SET titulo = excluded.titulo, peak = excluded.peak, semanas_n1 = excluded.semanas_n1, run = excluded.run",
    ),
  ];
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
  for (const [nome, nacionalidade, foto, genero] of artistas) {
    const n = texto(nome);
    // Nacionalidade em CAIXA ALTA pra casar com os nomes de pais_peso ("AUSTRÁLIA").
    // Gênero vazio (ou placeholder "-") vira NULL e não apaga um gênero já gravado (ver o upsert).
    const g = texto(genero).replace(/^[-—]+$/, "");
    if (n) linhasArtistas.push([chaveArtistaInfo(n), n, texto(nacionalidade).toUpperCase(), texto(foto), g || null]);
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
      "INSERT INTO artista_info (nome_upper, nome, nacionalidade, foto, genero)",
      linhasArtistas,
      "ON CONFLICT(nome_upper) DO UPDATE SET nome = excluded.nome, nacionalidade = excluded.nacionalidade, foto = excluded.foto, " +
        "genero = COALESCE(NULLIF(excluded.genero, ''), artista_info.genero)",
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
  "SELECT titulo, codigo_unico, artista, artista_2, artista_3, artista_4, artista_5, artista_6, capa_url, genero, tipo_single FROM musicas";

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

/**
 * Recalcula status/peak/semanas/acumulado da semana seguinte de cada chart
 * (reenvio de semana antiga). Só a seguinte: as posições não mudam, então
 * chart_artista_musica não é tocada aqui.
 */
async function recalcularSemanaSeguinte(db: D1DatabaseLike, charts: ChartId[], dataIso: string): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  for (const chart of charts) {
    const data = await semanaVizinha(db, chart, dataIso, "seguinte");
    if (!data) continue;
    const rows = await db
      .prepare(
        `SELECT pos, titulo, valor, valor_total, artistas, fonte_artistas, genero
         FROM chart_semana WHERE chart = ? AND data = ? ORDER BY pos`,
      )
      .bind(chart, data)
      .all<{ pos: number; titulo: string; valor: number; valor_total: number | null; artistas: string; fonte_artistas: string; genero: string | null }>();
    const { calculadas } = await calcularChart(
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
        artistas: lerArtistas(r.artistas),
        fonteArtistas: r.fonte_artistas,
        genero: r.genero ?? "",
      })),
    );
    stmts.push(db.prepare("DELETE FROM chart_semana WHERE chart = ? AND data = ?").bind(chart, data), ...insertsChartSemana(db, data, calculadas));
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

/**
 * Grava as regras das paradas por país da semana a partir do chart_config
 * atual. OR IGNORE: um reenvio da semana mantém as regras gravadas antes, então
 * mudar o chart_config só afeta semanas futuras.
 */
async function congelarRegrasDaSemana(db: D1DatabaseLike, dataIso: string): Promise<void> {
  const cfg = await db.prepare("SELECT chave, valor FROM chart_config").all<{ chave: string; valor: string }>();
  const regras = regrasDeConfig(new Map(cfg.results.map((c) => [c.chave, String(c.valor ?? "")])));
  await db
    .prepare("INSERT OR IGNORE INTO chart_regras_semana (data, versao, regras) VALUES (?, 1, ?)")
    .bind(dataIso, JSON.stringify(regras))
    .run();
}

/** Libera a leitura do D1 na tela (chart_config.charts_d1_ativo = '1'). */
async function ativarLeitura(db: D1DatabaseLike): Promise<void> {
  await db.prepare("UPDATE chart_config SET valor = '1' WHERE chave = 'charts_d1_ativo'").run();
}

/** A tela pode ler os charts do D1? Só depois da carga inicial completa (ou sem tabelas: não). */
export async function chartsD1Ativo(db: D1DatabaseLike): Promise<boolean> {
  const [r] = await consultar<{ valor: string }>(db, "SELECT valor FROM chart_config WHERE chave = 'charts_d1_ativo'");
  return String(r?.valor ?? "").trim() === "1";
}

/**
 * Ingere uma semana: valida, atualiza artistas/pesos, calcula movimento,
 * grava (semana + datas + HOF num batch só) e recalcula a seguinte.
 * `{ ativar: true }` sem linhas só libera a leitura do D1.
 */
export async function ingerirSemana(db: D1DatabaseLike, payload: PayloadIngestao): Promise<ResultadoIngestao> {
  const modo = payload.modo === "historico" ? "historico" : "semanal";
  await garantirSchemaCharts(db);

  const cruas = Array.isArray(payload.linhas) ? payload.linhas : [];
  if (payload.ativar === true && !cruas.length) {
    await ativarLeitura(db);
    await registrarIngestao(db, null, "ativacao", 0, true, "leitura do D1 ativada");
    return { ok: true, ativo: true };
  }
  const prep = prepararLinhas(cruas, modo);
  if (!prep.ok) {
    await registrarIngestao(db, null, modo, cruas.length, false, prep.erros.join("; "));
    return prep;
  }
  const dataIso = prep.dataIso;

  // Antes de resolver: o filtro de artistas do título usa artista_info.
  await gravarArtistasEPesos(db, payload.artistas ?? [], payload.pesos ?? []);
  const [cat, conhecidos] = await Promise.all([carregarCatalogo(db), carregarConhecidos(db)]);

  // Semana já gravada nessa data (reenvio): será substituída inteira (todos os charts).
  const substituidas = await db
    .prepare(
      `SELECT chart, titulo_norm, artistas FROM chart_semana
       WHERE chart IN (${CHARTS.map(() => "?").join(", ")}) AND data = ?`,
    )
    .bind(...CHARTS, dataIso)
    .all<{ chart: ChartId; titulo_norm: string; artistas: string }>();

  const charts = CHARTS.filter(
    (c) => prep.linhas.some((l) => l.chart === c) || substituidas.results.some((r) => r.chart === c),
  );
  const calculadas: LinhaCalculada[] = [];
  const hof: D1PreparedStatement[] = [];
  for (const chart of charts) {
    const base: LinhaBase[] = prep.linhas
      .filter((l) => l.chart === chart)
      .map((l) => {
        const r = resolverArtistas(l, cat, conhecidos);
        return {
          chart,
          dataIso,
          pos: l.pos,
          titulo: l.titulo,
          tituloNorm: chaveMusica(l.titulo),
          valor: l.valor,
          valorTotal: l.valorTotal,
          artistas: r.artistas,
          fonteArtistas: r.fonte,
          genero: buscarNoCatalogo(l.titulo, cat)?.genero ?? "",
        };
      });
    const antigas = substituidas.results
      .filter((r) => r.chart === chart)
      .map((r) => ({ titulo_norm: r.titulo_norm, artistas: lerArtistas(r.artistas) }));
    const { calculadas: doChart, antes } = await calcularChart(db, chart, dataIso, base, antigas.map((a) => a.titulo_norm));
    calculadas.push(...doChart);

    if (!CHARTS_HOF.includes(chart)) continue;
    // Run completa de cada música tocada: antes + semana nova + depois (só
    // existe "depois" quando chega uma semana antiga fora de ordem).
    const titulos = new Set([...doChart.map((l) => l.tituloNorm), ...antigas.map((a) => a.titulo_norm)]);
    const depois = (await semanaVizinha(db, chart, dataIso, "seguinte"))
      ? await linhasDasMusicas(db, chart, titulos, ">", dataIso)
      : [];
    hof.push(
      ...statementsArtistaMusica(
        db,
        chart,
        [
          ...[...antes, ...depois].map((r) => ({ ...r, artistas: lerArtistas(r.artistas) })),
          ...doChart.map((l) => ({ data: dataIso, pos: l.pos, titulo: l.titulo, titulo_norm: l.tituloNorm, artistas: l.artistas })),
        ],
        antigas,
      ),
    );
  }

  const chartsGravados = CHARTS.filter((c) => calculadas.some((l) => l.chart === c));
  // Tudo ou nada: a semana, as datas e o HOF entram juntos.
  await db.batch([
    db.prepare(`DELETE FROM chart_semana WHERE chart IN (${CHARTS.map(() => "?").join(", ")}) AND data = ?`).bind(...CHARTS, dataIso),
    db.prepare(`DELETE FROM chart_datas WHERE chart IN (${CHARTS.map(() => "?").join(", ")}) AND data = ?`).bind(...CHARTS, dataIso),
    ...insertsChartSemana(db, dataIso, calculadas),
    ...insertsEmLotes(db, "INSERT INTO chart_datas (chart, data)", chartsGravados.map((c) => [c, dataIso])),
    ...hof,
  ]);
  await recalcularSemanaSeguinte(db, charts, dataIso);
  await congelarRegrasDaSemana(db, dataIso);
  if (payload.ativar === true) await ativarLeitura(db);
  await registrarIngestao(db, dataIso, modo, calculadas.length, true, prep.anomalias.join("; ") || "ok");
  return { ok: true, data: dataIso, linhas: calculadas.length };
}

// ---- Leitura (/api/charts) ----

/** Banco sem as tabelas dos charts (nenhuma ingestão ainda) → leitura vazia, não erro. */
export async function consultar<T>(db: D1DatabaseLike, sql: string, ...params: unknown[]): Promise<T[]> {
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

/**
 * Gênero de cada artista (artista_info.genero, da INFOS ACTS) por nome_upper.
 * Banco anterior à coluna genero (migração ainda não rodou) → mapa vazio.
 */
export async function carregarGenerosArtistas(db: D1DatabaseLike): Promise<Map<string, string>> {
  try {
    const rows = await consultar<{ nome_upper: string; genero: string }>(
      db,
      "SELECT nome_upper, genero FROM artista_info WHERE genero IS NOT NULL AND genero != ''",
    );
    return new Map(rows.map((r) => [r.nome_upper, String(r.genero).trim()]));
  } catch (e) {
    if (/no such column/i.test(e instanceof Error ? e.message : String(e))) return new Map();
    throw e;
  }
}

/**
 * Gênero efetivo da linha, resolvido na LEITURA (gênero de artista preenchido
 * depois vale também pras semanas antigas): o da música (catálogo, gravado na
 * ingestão) vence; sem ele, o do artista principal em artista_info.
 */
const generoEfetivo = (generoMusica: string | null, art: string, generosArtistas: Map<string, string>): string =>
  (generoMusica ?? "").trim() || generosArtistas.get(chaveArtistaInfo(art)) || "";

export const lerArtistas = (json: string | null): string[] => {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.map((a) => String(a ?? "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
};

/** Primeiro artista gravado; sem nenhum, o principal do "Artista - Título". */
export const artistaPrincipal = (artistas: string[], titulo: string): string =>
  artistas[0] || extrairArtistasDoTitulo(titulo)[0] || "";

/** Capa: catálogo (single vence álbum) → foto do artista principal → "". */
export const capaDe = (titulo: string, art: string, cat: Map<string, MusicaCatalogo>, fotos: Map<string, string>): string =>
  fixImg(buscarNoCatalogo(titulo, cat)?.capa) || fixImg(fotos.get(art.trim().toUpperCase())) || "";

/** Há pesos de país pra plataforma? Sem eles, COUNTRIES segue da planilha. */
export async function temPesosPais(db: D1DatabaseLike, plataforma: ChartId): Promise<boolean> {
  return (await consultar(db, "SELECT 1 FROM pais_peso WHERE plataforma = ? LIMIT 1", plataforma)).length > 0;
}

/** Datas com dados no chart, `dd/mm/aaaa`, mais recente primeiro. Vazio → fallback pra planilha. */
export async function datasDoChart(db: D1DatabaseLike, chart: ChartId): Promise<string[]> {
  const rows = await consultar<{ data: string }>(
    db,
    "SELECT data FROM chart_datas WHERE chart = ? ORDER BY data DESC",
    chart,
  );
  return rows.map((r) => dataIsoParaBr(r.data));
}

/** Datas ISO distintas já gravadas (qualquer chart), mais antiga primeiro. Usado pela carga inicial pra pular semanas prontas. */
export async function datasCarregadas(db: D1DatabaseLike): Promise<string[]> {
  const rows = await consultar<{ data: string }>(db, "SELECT DISTINCT data FROM chart_datas ORDER BY data");
  return rows.map((r) => r.data);
}

/**
 * Gêneros efetivos (música → artista principal, ver generoEfetivo) da semana
 * `dataBr` do chart — sem data, a mais recente. Lista só o que a semana tem
 * (100 linhas pela PK), não o histórico inteiro. `generosArtistas` vem do
 * cache do controller; sem ele, é lido aqui.
 */
export async function generosDoChart(
  db: D1DatabaseLike,
  chart: ChartId,
  dataBr?: string,
  generosArtistas?: Map<string, string>,
): Promise<string[]> {
  const rows = await consultar<{ titulo: string; artistas: string; genero: string | null }>(
    db,
    `SELECT titulo, artistas, genero FROM chart_semana
     WHERE chart = ? AND data = COALESCE(?, (SELECT MAX(data) FROM chart_datas WHERE chart = ?))`,
    chart,
    dataBr ? dataBrParaIso(dataBr) : null,
    chart,
  );
  if (!rows.length) return [];
  const porArtista = generosArtistas ?? (await carregarGenerosArtistas(db));
  const generos = new Set<string>();
  for (const r of rows) {
    const g = generoEfetivo(r.genero, artistaPrincipal(lerArtistas(r.artistas), r.titulo || ""), porArtista);
    if (g) generos.add(g);
  }
  return [...generos].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
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
  generosArtistas?: Map<string, string>,
): Promise<LinhaChartApi[]> {
  // Acumulado e gênero da música já vêm gravados: só as 100 linhas da semana
  // (PK). O gênero do artista (fallback) vem do mapa de artista_info.
  const rows = await consultar<{
    pos: number; titulo: string; valor: number; valor_total: number | null; valor_acumulado: number | null;
    artistas: string; status: string; genero: string | null;
  }>(
    db,
    `SELECT pos, titulo, valor, valor_total, valor_acumulado, artistas, status, genero
     FROM chart_semana WHERE chart = ? AND data = ? ORDER BY pos`,
    chart,
    dataBrParaIso(dataBr),
  );
  const porArtista = rows.length ? (generosArtistas ?? (await carregarGenerosArtistas(db))) : new Map<string, string>();
  const linhas = rows.map((r) => {
    const titulo = r.titulo || "";
    const art = artistaPrincipal(lerArtistas(r.artistas), titulo);
    return {
      pos: r.pos,
      tit: titulo,
      val: fmt(r.valor),
      valTotal: fmt(r.valor_acumulado ?? r.valor_total ?? r.valor),
      art,
      st: r.status || "NEW",
      capa: capaDe(titulo, art, cat, fotos),
      style: generoEfetivo(r.genero, art, porArtista),
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
  /** Só nas paradas oficiais: ordem no seletor e descrição da metodologia. */
  ordem?: number;
  desc?: string;
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
  // Nacionalidade casa com o país de pais_peso sem diferenciar acento ("Australia" = "AUSTRÁLIA").
  const paisDePesos = new Map([...pesos.keys()].map((p) => [semAcentoMaiusculo(p), p]));
  const cfg = new Map(cfgRows.map((c) => [c.chave, c.valor]));
  const bonus = numeroConfig(cfg.get("bonus_nacionalidade"), 0.2);
  const top = numeroConfig(cfg.get("top_pais"), 50);
  const nacionalidade = new Map(
    nacRows.map((n) => {
      const pais = semAcentoMaiusculo(n.nacionalidade);
      return [semAcentoMaiusculo(n.nome_upper), paisDePesos.get(pais) ?? pais];
    }),
  );

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
        const n = nacionalidade.get(semAcentoMaiusculo(a));
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

/**
 * Parte dos charts semanais no Hall of Fame, lida de chart_artista_musica
 * pela PK (artista sem acento, CAIXA ALTA). sp/am/yt: `{t, v}` com o pico
 * ("1"), que é o que cabe no layout; `runs` (Hot 100) leva as posições em
 * ordem cronológica ("32 - 50 - 1"), como as colunas de runs da planilha.
 * n1_* = músicas distintas que chegaram ao #1.
 */
export async function perfilHOF(db: D1DatabaseLike, artista: string): Promise<PerfilHOFD1> {
  const key = semAcentoMaiusculo(artista);
  const rows = key
    ? await consultar<{ chart: string; titulo: string; peak: number; run: string }>(
        db,
        "SELECT chart, titulo, peak, run FROM chart_artista_musica WHERE artista_key = ?",
        key,
      )
    : [];
  // Melhor pico primeiro, depois mais semanas (mesma ordem que a tela usa nos runs).
  const itens = (chart: ChartId) =>
    rows
      .filter((r) => r.chart === chart)
      .map((r) => ({ t: r.titulo || "", peak: r.peak, run: r.run || "", semanas: (r.run || "").split(" - ").length }))
      .sort((a, b) => a.peak - b.peak || b.semanas - a.semanas || a.t.localeCompare(b.t));
  const picos = (chart: ChartId): ItemHOF[] => itens(chart).map((m) => ({ t: m.t, v: String(m.peak) }));
  const n1 = (chart: ChartId) => String(itens(chart).filter((m) => m.peak === 1).length);
  return {
    n1_hot100: n1("BILLBOARD HOT 100"),
    n1_spotify: n1("SPOTIFY"),
    n1_youtube: n1("YOUTUBE"),
    sp: picos("SPOTIFY"),
    am: picos("APPLE MUSIC"),
    yt: picos("YOUTUBE"),
    runs: itens("BILLBOARD HOT 100").map((m) => ({ t: m.t, v: m.run })),
  };
}
