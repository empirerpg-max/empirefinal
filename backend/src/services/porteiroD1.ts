// Porteiro do catálogo "D1 primeiro" (spec docs/superpowers/specs/2026-11-18-catalogo-d1-primeiro-design.md).
//
// Para as abas ligadas, o googleSheetsService desvia leituras e gravações
// para cá: a planilha virtual no D1 é a fonte de verdade e cada gravação
// entra, no MESMO db.batch, num item da fila de backup que o cron grava
// depois na planilha real (despachanteFilaBackup.ts).
//
// Estados (tabela catalogo_estado_aba, no próprio D1 — consistente na hora
// em todo lugar, ao contrário do KV, que pode levar ~60 s para propagar):
//   "off"        comportamento antigo: tudo na planilha real.
//   "carregando" carga inicial: gravações RECUSADAS, leituras na planilha real.
//   "on"         tudo no D1, planilha vira backup.
//   "pausado"    desligando: gravações RECUSADAS, leituras no D1.
// "carregando" e "pausado" expiram em 5 min (pedido do admin interrompido
// no meio): carregando -> off (a carga não terminou, o D1 não manda);
// pausado -> on (o D1 continua sendo a verdade).
import { getCatalogoDb, type D1DatabaseLike } from "./catalogoDbService";
import {
  PLANILHA_VIRTUAL_CREATE_STATEMENTS,
  ehConflitoDeLinha,
  gravarIntervalo,
  indiceParaColuna,
  itemFila,
  lerIntervalo,
  limparIntervalo,
  parseA1,
  removerLinhas,
} from "./planilhaVirtualD1";

export const PLANILHA_PRINCIPAL_ID = "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo";

export const ABAS_D1_PRIMEIRO_FASE1 = ["Music Videos", "Comentarios_MV", "VIDEOS_PENDENTES_EMPIRE_TV"] as const;
const ABAS_DO_PORTEIRO: ReadonlySet<string> = new Set<string>(ABAS_D1_PRIMEIRO_FASE1);

export type EstadoAba = "off" | "carregando" | "on" | "pausado";

export const MENSAGEM_MANUTENCAO = "Catálogo em manutenção por alguns segundos. Tente de novo.";

const EXPIRA_TRANSICAO_MS = 5 * 60 * 1000;
const CACHE_MS = 30_000;

const PORTEIRO_CREATE_STATEMENTS = [
  ...PLANILHA_VIRTUAL_CREATE_STATEMENTS,
  `CREATE TABLE IF NOT EXISTS catalogo_estado_aba (
    aba TEXT PRIMARY KEY,
    estado TEXT NOT NULL,
    atualizado_em_ms INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS despachante_lock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    ate_ms INTEGER NOT NULL
  )`,
];

function db(): D1DatabaseLike {
  const d = getCatalogoDb();
  if (!d) throw new Error("Banco do catálogo (D1) indisponível.");
  return d;
}

// Por banco (cada teste/isolate tem o seu): tabelas já criadas e cache de estado.
const tabelasProntas = new WeakMap<object, Promise<void>>();
const cachesEstado = new WeakMap<object, Map<string, { estado: EstadoAba; ate: number }>>();

/** Cria (se faltar) as tabelas do catálogo "D1 primeiro". Idempotente. */
export function garantirTabelas(): Promise<void> {
  const d = db();
  let p = tabelasProntas.get(d);
  if (!p) {
    p = d
      .batch(PORTEIRO_CREATE_STATEMENTS.map((s) => d.prepare(s)))
      .then(() => undefined)
      .catch((err) => {
        tabelasProntas.delete(d);
        throw err;
      });
    tabelasProntas.set(d, p);
  }
  return p;
}

function cacheDoBanco(): Map<string, { estado: EstadoAba; ate: number }> | undefined {
  const d = getCatalogoDb();
  if (!d) return undefined;
  let c = cachesEstado.get(d);
  if (!c) cachesEstado.set(d, (c = new Map()));
  return c;
}

// Último estado visto por aba, de qualquer banco — usado só se o D1 falhar.
const ultimoEstadoVisto = new Map<string, EstadoAba>();

export function limparCacheEstado(): void {
  cacheDoBanco()?.clear();
  ultimoEstadoVisto.clear();
}

export function abaDoPorteiro(spreadsheetId: string, aba: string): boolean {
  return spreadsheetId === PLANILHA_PRINCIPAL_ID && ABAS_DO_PORTEIRO.has(aba);
}

function aplicarExpiracao(estado: string, atualizadoEmMs: number): EstadoAba {
  const velho = Date.now() - atualizadoEmMs > EXPIRA_TRANSICAO_MS;
  if (estado === "carregando") return velho ? "off" : "carregando";
  if (estado === "pausado") return velho ? "on" : "pausado";
  return estado === "on" ? "on" : "off";
}

/** Estado lido direto do D1, sem cache (para decisões de admin). */
export async function estadoAbaSemCache(aba: string): Promise<EstadoAba> {
  await garantirTabelas();
  const r = await db()
    .prepare("SELECT estado, atualizado_em_ms FROM catalogo_estado_aba WHERE aba = ?")
    .bind(aba)
    .all<{ estado: string; atualizado_em_ms: number }>();
  const row = r.results?.[0];
  const estado = row ? aplicarExpiracao(row.estado, row.atualizado_em_ms) : "off";
  cacheDoBanco()?.set(aba, { estado, ate: Date.now() + CACHE_MS });
  ultimoEstadoVisto.set(aba, estado);
  return estado;
}

/**
 * Estado da aba (cache de 30 s). Nunca "abre" para a planilha por erro: se o
 * D1 falhar, usa o último estado conhecido; sem nenhum, lança.
 */
export async function estadoAba(spreadsheetId: string, aba: string): Promise<EstadoAba> {
  if (!abaDoPorteiro(spreadsheetId, aba)) return "off";
  const c = cacheDoBanco()?.get(aba);
  if (c && c.ate > Date.now()) return c.estado;
  try {
    return await estadoAbaSemCache(aba);
  } catch (err) {
    const conhecido = c?.estado ?? ultimoEstadoVisto.get(aba);
    if (conhecido) return conhecido;
    throw err;
  }
}

export async function definirEstadoAba(aba: string, estado: EstadoAba): Promise<boolean> {
  await garantirTabelas();
  await db()
    .prepare(
      `INSERT INTO catalogo_estado_aba (aba, estado, atualizado_em_ms) VALUES (?, ?, ?)
       ON CONFLICT(aba) DO UPDATE SET estado = excluded.estado, atualizado_em_ms = excluded.atualizado_em_ms`,
    )
    .bind(aba, estado, Date.now())
    .run();
  cacheDoBanco()?.set(aba, { estado, ate: Date.now() + CACHE_MS });
  ultimoEstadoVisto.set(aba, estado);
  return true;
}

export async function lerD1(spreadsheetId: string, aba: string, range = "A:ZZ"): Promise<string[][]> {
  await garantirTabelas();
  return lerIntervalo(spreadsheetId, aba, range);
}

/** Repete a leitura+gravação quando outra gravação mexeu na mesma linha no meio (revisão C1). */
async function comNovaTentativa(fn: () => Promise<void>): Promise<void> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await fn();
    } catch (err) {
      if (!ehConflitoDeLinha(err) || tentativa >= 6) throw err;
      await new Promise((r) => setTimeout(r, 5 * tentativa));
    }
  }
}

export async function gravarD1(spreadsheetId: string, aba: string, range: string, valores: unknown[][]): Promise<void> {
  await garantirTabelas();
  await comNovaTentativa(async () => {
    const stmts = await gravarIntervalo(spreadsheetId, aba, range, valores);
    await db().batch([...stmts, itemFila(spreadsheetId, aba, "update", range, valores)]);
  });
}

/** Acrescenta depois da última linha (qualquer célula) e devolve a linha gravada. */
export async function appendD1(spreadsheetId: string, aba: string, valores: unknown[], range = "A:ZZ"): Promise<number> {
  await garantirTabelas();
  const { c1 } = parseA1(range);
  const celulas = [...Array(c1).fill(""), ...valores.map((v) => (v === null || v === undefined ? "" : String(v)))];
  const colIni = indiceParaColuna(c1);
  const colFim = indiceParaColuna(c1 + Math.max(valores.length, 1) - 1);
  const d = db();
  const res = await d.batch([
    d
      .prepare(
        `INSERT INTO planilha_virtual (planilha, aba, linha, celulas_json, atualizado_em)
         SELECT ?, ?, coalesce(max(linha), 0) + 1, ?, datetime('now')
         FROM planilha_virtual WHERE planilha = ? AND aba = ?`,
      )
      .bind(spreadsheetId, aba, JSON.stringify(celulas), spreadsheetId, aba),
    d
      .prepare(
        `INSERT INTO fila_backup_planilha (planilha, aba, operacao, intervalo, valores_json)
         SELECT ?, ?, 'append', ? || max(linha) || ':' || ? || max(linha), ?
         FROM planilha_virtual WHERE planilha = ? AND aba = ?`,
      )
      .bind(spreadsheetId, aba, colIni, colFim, JSON.stringify([valores]), spreadsheetId, aba),
  ]);
  const idFila = (res[1] as { meta?: { last_row_id?: number } })?.meta?.last_row_id;
  const item = (
    await d.prepare("SELECT intervalo FROM fila_backup_planilha WHERE id = ?").bind(idFila).all<{ intervalo: string }>()
  ).results?.[0];
  if (!item) throw new Error("Não consegui confirmar a linha gravada no D1.");
  return parseA1(item.intervalo).r1;
}

/**
 * Remove linhas no D1. O item da fila leva a FOTO de cada linha apagada
 * ({ linha, celulas }) — o despachante só apaga na planilha real a linha que
 * ainda estiver igual à foto, então reenviar o mesmo item nunca apaga a
 * linha errada (revisão I4).
 */
export async function removerD1(spreadsheetId: string, aba: string, linhas1: number[]): Promise<void> {
  await garantirTabelas();
  const ordenadas = [...new Set(linhas1)].sort((a, b) => b - a);
  const fotos: { linha: number; celulas: string[] }[] = [];
  for (const linha of ordenadas) {
    fotos.push({ linha, celulas: (await lerIntervalo(spreadsheetId, aba, `A${linha}:ZZ${linha}`))[0] ?? [] });
  }
  const stmts = await removerLinhas(spreadsheetId, aba, ordenadas);
  await db().batch([...stmts, itemFila(spreadsheetId, aba, "delete", null, fotos)]);
}

export async function limparD1(spreadsheetId: string, aba: string, range: string): Promise<void> {
  await garantirTabelas();
  await comNovaTentativa(async () => {
    const stmts = await limparIntervalo(spreadsheetId, aba, range);
    await db().batch([...stmts, itemFila(spreadsheetId, aba, "clear", range, null)]);
  });
}
