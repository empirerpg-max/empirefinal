// Porteiro do catálogo "D1 primeiro" (spec docs/superpowers/specs/2026-11-18-catalogo-d1-primeiro-design.md).
//
// Para as abas ligadas (chave `d1primeiro:<aba>` = "on" no KV FLAGS), o
// googleSheetsService desvia leituras e gravações para cá: a planilha
// virtual no D1 é a fonte de verdade e cada gravação entra, no MESMO
// db.batch, num item da fila de backup que o cron grava depois na planilha
// real (despachanteFilaBackup.ts).
//
// Estados: "off" (comportamento antigo, planilha real), "carregando"
// (carga inicial em andamento: gravações recusadas por alguns segundos,
// leituras seguem na planilha real) e "on".
import { getCatalogoDb } from "./catalogoDbService";
import {
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

export type EstadoAba = "off" | "carregando" | "on";

export const MENSAGEM_MANUTENCAO = "Catálogo em manutenção por alguns segundos. Tente de novo.";

interface FlagsKvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}
function flagsKv(): FlagsKvLike | undefined {
  return (globalThis as Record<string, unknown>).__FLAGS_KV__ as FlagsKvLike | undefined;
}

const chave = (aba: string) => `d1primeiro:${aba}`;
const cacheEstado = new Map<string, { estado: EstadoAba; ate: number }>();
const CACHE_MS = 30_000;

export function abaDoPorteiro(spreadsheetId: string, aba: string): boolean {
  return spreadsheetId === PLANILHA_PRINCIPAL_ID && ABAS_DO_PORTEIRO.has(aba);
}

export async function estadoAba(spreadsheetId: string, aba: string): Promise<EstadoAba> {
  if (!abaDoPorteiro(spreadsheetId, aba)) return "off";
  const c = cacheEstado.get(aba);
  if (c && c.ate > Date.now()) return c.estado;
  const kv = flagsKv();
  const bruto = kv ? await kv.get(chave(aba)).catch(() => null) : null;
  const estado: EstadoAba = bruto === "on" || bruto === "carregando" ? bruto : "off";
  cacheEstado.set(aba, { estado, ate: Date.now() + CACHE_MS });
  return estado;
}

export async function definirEstadoAba(aba: string, estado: EstadoAba): Promise<boolean> {
  const kv = flagsKv();
  if (!kv) return false;
  await kv.put(chave(aba), estado);
  cacheEstado.set(aba, { estado, ate: Date.now() + CACHE_MS });
  return true;
}

function db() {
  const d = getCatalogoDb();
  if (!d) throw new Error("Banco do catálogo (D1) indisponível.");
  return d;
}

export function lerD1(spreadsheetId: string, aba: string, range = "A:ZZ"): Promise<string[][]> {
  return lerIntervalo(spreadsheetId, aba, range);
}

export async function gravarD1(spreadsheetId: string, aba: string, range: string, valores: unknown[][]): Promise<void> {
  const stmts = await gravarIntervalo(spreadsheetId, aba, range, valores);
  await db().batch([...stmts, itemFila(spreadsheetId, aba, "update", range, valores)]);
}

/** Acrescenta depois da última linha (qualquer célula) e devolve a linha gravada. */
export async function appendD1(spreadsheetId: string, aba: string, valores: unknown[], range = "A:ZZ"): Promise<number> {
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
    await d
      .prepare("SELECT intervalo FROM fila_backup_planilha WHERE id = ?")
      .bind(idFila)
      .all<{ intervalo: string }>()
  ).results?.[0];
  if (!item) throw new Error("Não consegui confirmar a linha gravada no D1.");
  return parseA1(item.intervalo).r1;
}

export async function removerD1(spreadsheetId: string, aba: string, linhas1: number[]): Promise<void> {
  const stmts = await removerLinhas(spreadsheetId, aba, linhas1);
  const ordenadas = [...new Set(linhas1)].sort((a, b) => b - a);
  await db().batch([...stmts, itemFila(spreadsheetId, aba, "delete", null, ordenadas)]);
}

export async function limparD1(spreadsheetId: string, aba: string, range: string): Promise<void> {
  const stmts = await limparIntervalo(spreadsheetId, aba, range);
  await db().batch([...stmts, itemFila(spreadsheetId, aba, "clear", range, null)]);
}
