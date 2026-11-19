// "Planilha virtual" no D1 — fonte de verdade das abas do catálogo que estão
// "D1 primeiro" (ver docs/superpowers/specs/2026-11-18-catalogo-d1-primeiro-design.md).
//
// Guarda cada linha da aba INTEIRA, posicional: (planilha, aba, linha) ->
// células em JSON, exatamente como o texto foi gravado (sem reformatar —
// número/booleano viram texto com String()). A leitura imita a resposta da
// API do Sheets: células vazias no fim da linha e linhas vazias no fim do
// resultado são aparadas; linha vazia no meio vira [].
//
// As funções que gravam DEVOLVEM statements (não executam), pra entrarem no
// mesmo db.batch do item da fila de backup — a gravação no D1 e o item da
// fila acontecem juntos ou nenhum dos dois.
import { getCatalogoDb, type D1PreparedStatement } from "./catalogoDbService";

export const PLANILHA_VIRTUAL_CREATE_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS planilha_virtual (
    planilha TEXT NOT NULL,
    aba TEXT NOT NULL,
    linha INTEGER NOT NULL,
    celulas_json TEXT NOT NULL,
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (planilha, aba, linha)
  )`,
  `CREATE TABLE IF NOT EXISTS fila_backup_planilha (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    planilha TEXT NOT NULL,
    aba TEXT NOT NULL,
    operacao TEXT NOT NULL CHECK (operacao IN ('update','append','delete','clear')),
    intervalo TEXT,
    valores_json TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    tentativas INTEGER NOT NULL DEFAULT 0,
    ultimo_erro TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_fila_backup_aba ON fila_backup_planilha(planilha, aba, id)",
];

const MAX_COL = 701; // ZZ

export interface IntervaloA1 {
  c1: number;
  r1: number;
  c2: number | null;
  r2: number | null;
}

function colunaParaIndice(letras: string): number {
  let n = 0;
  for (const ch of letras.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function indiceParaColuna(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseCelula(ref: string): { c: number | null; r: number | null } {
  const m = ref.trim().match(/^([A-Za-z]*)(\d*)$/);
  if (!m) throw new Error(`Intervalo A1 inválido: "${ref}"`);
  return { c: m[1] ? colunaParaIndice(m[1]) : null, r: m[2] ? Number(m[2]) : null };
}

/** Colunas 0-based, linhas 1-based; null = aberto. Aceita "Aba!A1:B2" (ignora a aba). */
export function parseA1(range: string): IntervaloA1 {
  const semAba = range.includes("!") ? range.slice(range.lastIndexOf("!") + 1) : range;
  const [a, b] = semAba.split(":");
  const ini = parseCelula(a);
  const fim = b === undefined ? ini : parseCelula(b);
  return {
    c1: ini.c ?? 0,
    r1: ini.r ?? 1,
    c2: fim.c ?? (b === undefined ? ini.c : MAX_COL),
    r2: fim.r ?? (b === undefined ? ini.r : null),
  };
}

function db() {
  const d = getCatalogoDb();
  if (!d) throw new Error("Banco do catálogo (D1) indisponível.");
  return d;
}

function aparar(celulas: string[]): string[] {
  const c = [...celulas];
  while (c.length && (c[c.length - 1] === "" || c[c.length - 1] == null)) c.pop();
  return c;
}

function celulaTexto(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

async function linhasExistentes(
  planilha: string,
  aba: string,
  r1: number,
  r2: number | null,
): Promise<Map<number, string[]>> {
  const res = await db()
    .prepare(
      `SELECT linha, celulas_json FROM planilha_virtual
       WHERE planilha = ? AND aba = ? AND linha >= ? AND linha <= ? ORDER BY linha`,
    )
    .bind(planilha, aba, r1, r2 ?? 2_147_483_647)
    .all<{ linha: number; celulas_json: string }>();
  const mapa = new Map<number, string[]>();
  for (const row of res.results || []) mapa.set(row.linha, JSON.parse(row.celulas_json));
  return mapa;
}

function stmtGravarLinha(planilha: string, aba: string, linha: number, celulas: string[]): D1PreparedStatement {
  const c = aparar(celulas);
  if (c.length === 0) {
    return db()
      .prepare("DELETE FROM planilha_virtual WHERE planilha = ? AND aba = ? AND linha = ?")
      .bind(planilha, aba, linha);
  }
  return db()
    .prepare(
      `INSERT INTO planilha_virtual (planilha, aba, linha, celulas_json, atualizado_em)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(planilha, aba, linha) DO UPDATE SET
         celulas_json = excluded.celulas_json, atualizado_em = excluded.atualizado_em`,
    )
    .bind(planilha, aba, linha, JSON.stringify(c));
}

export async function lerIntervalo(planilha: string, aba: string, range: string): Promise<string[][]> {
  const { c1, r1, c2, r2 } = parseA1(range);
  const mapa = await linhasExistentes(planilha, aba, r1, r2);
  if (mapa.size === 0) return [];
  const ultima = Math.max(...mapa.keys());
  const out: string[][] = [];
  for (let l = r1; l <= ultima; l++) {
    const celulas = mapa.get(l) || [];
    out.push(aparar(celulas.slice(c1, (c2 ?? MAX_COL) + 1)));
  }
  while (out.length && out[out.length - 1].length === 0) out.pop();
  return out;
}

export async function gravarIntervalo(
  planilha: string,
  aba: string,
  range: string,
  valores: unknown[][],
): Promise<D1PreparedStatement[]> {
  const { c1, r1 } = parseA1(range);
  if (valores.length === 0) return [];
  const mapa = await linhasExistentes(planilha, aba, r1, r1 + valores.length - 1);
  return valores.map((linhaValores, i) => {
    const linha = r1 + i;
    const celulas = [...(mapa.get(linha) || [])];
    linhaValores.forEach((v, j) => {
      while (celulas.length < c1 + j) celulas.push("");
      celulas[c1 + j] = celulaTexto(v);
    });
    return stmtGravarLinha(planilha, aba, linha, celulas);
  });
}

export async function limparIntervalo(planilha: string, aba: string, range: string): Promise<D1PreparedStatement[]> {
  const { c1, r1, c2, r2 } = parseA1(range);
  const mapa = await linhasExistentes(planilha, aba, r1, r2);
  const out: D1PreparedStatement[] = [];
  for (const [linha, celulas] of mapa) {
    const novo = [...celulas];
    for (let c = c1; c <= Math.min(c2 ?? MAX_COL, novo.length - 1); c++) novo[c] = "";
    out.push(stmtGravarLinha(planilha, aba, linha, novo));
  }
  return out;
}

export async function proximaLinhaAppend(planilha: string, aba: string): Promise<number> {
  const r = await db()
    .prepare("SELECT max(linha) AS m FROM planilha_virtual WHERE planilha = ? AND aba = ?")
    .bind(planilha, aba)
    .all<{ m: number | null }>();
  return (r.results?.[0]?.m ?? 0) + 1;
}

/** Remove as linhas e desloca as de baixo (mesma semântica do deleteDimension do Sheets). */
export async function removerLinhas(planilha: string, aba: string, linhas1: number[]): Promise<D1PreparedStatement[]> {
  const ordenadas = [...new Set(linhas1)].sort((a, b) => b - a);
  const out: D1PreparedStatement[] = [];
  for (const r of ordenadas) {
    out.push(
      db().prepare("DELETE FROM planilha_virtual WHERE planilha = ? AND aba = ? AND linha = ?").bind(planilha, aba, r),
    );
    // Dois passos pra não colidir com a chave primária no meio do UPDATE.
    out.push(
      db()
        .prepare("UPDATE planilha_virtual SET linha = -(linha - 1) WHERE planilha = ? AND aba = ? AND linha > ?")
        .bind(planilha, aba, r),
    );
    out.push(
      db()
        .prepare("UPDATE planilha_virtual SET linha = -linha WHERE planilha = ? AND aba = ? AND linha < 0")
        .bind(planilha, aba),
    );
  }
  return out;
}

/** Troca o conteúdo inteiro da aba (carga inicial). */
export async function substituirAba(planilha: string, aba: string, linhas: string[][]): Promise<D1PreparedStatement[]> {
  const out: D1PreparedStatement[] = [
    db().prepare("DELETE FROM planilha_virtual WHERE planilha = ? AND aba = ?").bind(planilha, aba),
  ];
  linhas.forEach((celulas, i) => {
    if (aparar(celulas.map(celulaTexto)).length) out.push(stmtGravarLinha(planilha, aba, i + 1, celulas.map(celulaTexto)));
  });
  return out;
}

export function itemFila(
  planilha: string,
  aba: string,
  operacao: "update" | "append" | "delete" | "clear",
  intervalo: string | null,
  valores: unknown,
): D1PreparedStatement {
  return db()
    .prepare("INSERT INTO fila_backup_planilha (planilha, aba, operacao, intervalo, valores_json) VALUES (?, ?, ?, ?, ?)")
    .bind(planilha, aba, operacao, intervalo, valores === undefined ? null : JSON.stringify(valores));
}
