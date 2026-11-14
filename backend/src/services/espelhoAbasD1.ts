// Espelho GENÉRICO de abas da planilha no D1 — migração dos ÁLBUNS
// (2026-11-14): "Albuns", "Extra_Albuns" e "Comentarios_Albuns".
//
// Em vez de uma tabela com uma coluna por campo (como vídeos), cada linha da
// aba é guardada INTEIRA: as células exatamente como a API do Sheets devolve
// (FORMATTED_VALUE, com as vazias do fim cortadas), em JSON, na mesma
// posição (linha) da planilha — inclusive o cabeçalho (linha 1), colunas sem
// título e linhas em branco no meio. Não existe campo que "não coube": a
// cópia é sem perda por construção, e a validação compara linha a linha.
//
// Colunas extraídas (só pra busca rápida, nunca fonte de verdade):
//   chave  — "ID do tópico" (Albuns B / Comentarios_Albuns A) ou o
//            "Código único" (Extra_Albuns A);
//   codigo — "Código único" (Albuns L) — PODE repetir (versões do mesmo
//            álbum), por isso nada aqui é UNIQUE além de (aba, linha);
//   chaves_busca — "|v1|v2|": valores curtos normalizados da linha, pra
//            achar só os comentários de um tópico (mesma regra de vídeos).
//
// Sincronização: as abas são pequenas (centenas de linhas), então qualquer
// escrita relê a aba inteira (sem cache) e troca o conteúdo no D1 de forma
// atômica (rascunho + db.batch). O cron compara planilha x D1 e corrige.
import { getCatalogoDb } from "./catalogoDbService";
import { normalizeComparison, normalizeText, readValuesFresh } from "./googleSheetsService";

export const ABAS_ALBUM = ["Albuns", "Extra_Albuns", "Comentarios_Albuns"] as const;
export type AbaEspelhada = (typeof ABAS_ALBUM)[number];

/** Índices (0 = coluna A) usados pra extrair chave/código de cada aba. */
const CONFIG: Record<AbaEspelhada, { chave: number; codigo: number | null; busca: boolean }> = {
  Albuns: { chave: 1, codigo: 11, busca: false },
  Extra_Albuns: { chave: 0, codigo: 0, busca: false },
  Comentarios_Albuns: { chave: 0, codigo: null, busca: true },
};

export function ehAbaEspelhada(aba: string): aba is AbaEspelhada {
  return (ABAS_ALBUM as readonly string[]).includes(aba);
}

export const ESPELHO_CREATE_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS abas_espelho (
    aba TEXT NOT NULL,
    linha INTEGER NOT NULL,
    celulas_json TEXT NOT NULL,
    chave TEXT,
    codigo TEXT,
    chaves_busca TEXT,
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (aba, linha)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_abas_espelho_chave ON abas_espelho(aba, chave)",
  "CREATE INDEX IF NOT EXISTS idx_abas_espelho_codigo ON abas_espelho(aba, codigo)",
];

/** Igual à API do Sheets: células vazias do FIM da linha não vêm. */
export function cortarFim(celulas: string[]): string[] {
  const c = celulas.map((v) => (v == null ? "" : String(v)));
  while (c.length && c[c.length - 1] === "") c.pop();
  return c;
}

export function chavesBuscaDeCelulas(celulas: string[]): string {
  const chaves = new Set<string>();
  for (const b of celulas) {
    const t = normalizeText(b);
    if (t.length > 0 && t.length <= 100) chaves.add(normalizeComparison(t));
  }
  return `|${[...chaves].join("|")}|`;
}

function registroDaLinha(aba: AbaEspelhada, linha: number, celulasBrutas: string[]) {
  const celulas = cortarFim(celulasBrutas);
  const cfg = CONFIG[aba];
  const pegar = (i: number | null) => (i === null ? null : (celulas[i] ?? "").trim() || null);
  return {
    linha,
    celulas_json: JSON.stringify(celulas),
    chave: linha === 1 ? null : pegar(cfg.chave),
    codigo: linha === 1 ? null : pegar(cfg.codigo),
    chaves_busca: cfg.busca && linha > 1 ? chavesBuscaDeCelulas(celulas) : null,
  };
}

const INSERT = `INSERT INTO abas_espelho (aba, linha, celulas_json, chave, codigo, chaves_busca) VALUES (?, ?, ?, ?, ?, ?)`;
const PREFIXO_RASCUNHO = "__rascunho__";
const TAM_LOTE = 50;

export interface ResultadoSyncAba {
  ok: boolean;
  aba: string;
  linhas: number;
  erro?: string;
}

export async function lerAbaDaPlanilha(aba: AbaEspelhada): Promise<string[][]> {
  return readValuesFresh("principal", aba, "A:ZZ");
}

/**
 * Substitui o conteúdo da aba no D1 pelo da planilha, de forma atômica: grava
 * tudo num rascunho (em lotes) e só então, numa transação única (db.batch),
 * apaga a versão antiga e promove o rascunho. Se qualquer passo falhar antes
 * da troca, a versão antiga continua intacta.
 */
export async function sincronizarAba(aba: AbaEspelhada, linhasPlanilha?: string[][]): Promise<ResultadoSyncAba> {
  const db = getCatalogoDb();
  if (!db) return { ok: false, aba, linhas: 0, erro: "sem D1" };
  try {
    const rows = linhasPlanilha ?? (await lerAbaDaPlanilha(aba));
    if (!rows.length || !rows[0]?.length) return { ok: false, aba, linhas: 0, erro: "planilha veio vazia — não troquei nada" };
    const rascunho = PREFIXO_RASCUNHO + aba;
    await db.prepare("DELETE FROM abas_espelho WHERE aba = ?").bind(rascunho).run();
    const regs = rows.map((r, i) => registroDaLinha(aba, i + 1, r || []));
    for (let i = 0; i < regs.length; i += TAM_LOTE) {
      const lote = regs.slice(i, i + TAM_LOTE).map((r) =>
        db.prepare(INSERT).bind(rascunho, r.linha, r.celulas_json, r.chave, r.codigo, r.chaves_busca),
      );
      const res = await db.batch(lote);
      if (res.some((x) => (x as { success?: boolean })?.success === false)) throw new Error("falha gravando rascunho");
    }
    const conf = await db
      .prepare("SELECT count(*) AS n FROM abas_espelho WHERE aba = ?")
      .bind(rascunho)
      .all<{ n: number }>();
    if (Number(conf.results?.[0]?.n) !== regs.length) throw new Error("rascunho incompleto");
    const troca = await db.batch([
      db.prepare("DELETE FROM abas_espelho WHERE aba = ?").bind(aba),
      db.prepare("UPDATE abas_espelho SET aba = ?, atualizado_em = datetime('now') WHERE aba = ?").bind(aba, rascunho),
    ]);
    if (troca.some((x) => (x as { success?: boolean })?.success === false)) throw new Error("falha na troca");
    return { ok: true, aba, linhas: regs.length };
  } catch (err) {
    return { ok: false, aba, linhas: 0, erro: (err as Error).message };
  }
}

/** Linhas da aba remontadas do D1, como a API do Sheets devolveria. null = D1 indisponível/vazio. */
export async function linhasDaAbaD1(aba: AbaEspelhada): Promise<string[][] | null> {
  const db = getCatalogoDb();
  if (!db) return null;
  const r = await db
    .prepare("SELECT linha, celulas_json FROM abas_espelho WHERE aba = ? ORDER BY linha")
    .bind(aba)
    .all<{ linha: number; celulas_json: string }>();
  return montar(r.results || []);
}

function montar(regs: { linha: number; celulas_json: string }[]): string[][] | null {
  if (!regs.length || regs[0].linha !== 1) return null;
  const out: string[][] = [];
  for (const r of regs) {
    while (out.length < r.linha - 1) out.push([]);
    out[r.linha - 1] = JSON.parse(r.celulas_json) as string[];
  }
  return out;
}

/** Cabeçalho + só as linhas cuja chave (ID do tópico) é uma das dadas. */
export async function linhasPorChaveD1(aba: AbaEspelhada, chaves: string[]): Promise<string[][] | null> {
  const db = getCatalogoDb();
  const ks = [...new Set(chaves.filter(Boolean))];
  if (!db || !ks.length) return null;
  const r = await db
    .prepare(
      `SELECT linha, celulas_json FROM abas_espelho WHERE aba = ? AND (linha = 1 OR chave IN (${ks.map(() => "?").join(",")})) ORDER BY linha`,
    )
    .bind(aba, ...ks)
    .all<{ linha: number; celulas_json: string }>();
  return montar(r.results || []);
}

/** Cabeçalho + só as linhas candidatas (contêm um dos valores, normalizados) — superconjunto pro filtro do Fórum. */
export async function linhasPorBuscaD1(aba: AbaEspelhada, valoresNormalizados: string[]): Promise<string[][] | null> {
  const db = getCatalogoDb();
  const vs = [...new Set(valoresNormalizados)];
  if (!db || !vs.length || vs.some((v) => !v)) return null;
  const cond = vs.map(() => "instr(chaves_busca, ?) > 0").join(" OR ");
  const r = await db
    .prepare(`SELECT linha, celulas_json FROM abas_espelho WHERE aba = ? AND (linha = 1 OR ${cond}) ORDER BY linha`)
    .bind(aba, ...vs.map((v) => `|${v}|`))
    .all<{ linha: number; celulas_json: string }>();
  return montar(r.results || []);
}

export interface RelatorioAba {
  aba: string;
  ok: boolean;
  linhasPlanilha: number;
  linhasD1: number;
  faltandoNoD1: number[];
  sobrandoNoD1: number[];
  diferentes: number[];
}

/** Compara planilha x D1 linha a linha (todas as células, inclusive cabeçalho). */
export function compararAba(aba: string, planilha: string[][], d1: { linha: number; celulas_json: string }[]): RelatorioAba {
  const p = new Map<number, string>();
  planilha.forEach((r, i) => p.set(i + 1, JSON.stringify(cortarFim(r || []))));
  const d = new Map<number, string>(d1.map((r) => [Number(r.linha), r.celulas_json]));
  const faltandoNoD1: number[] = [];
  const diferentes: number[] = [];
  for (const [linha, json] of p) {
    if (!d.has(linha)) faltandoNoD1.push(linha);
    else if (d.get(linha) !== json) diferentes.push(linha);
  }
  const sobrandoNoD1 = [...d.keys()].filter((l) => !p.has(l));
  return {
    aba,
    ok: !faltandoNoD1.length && !sobrandoNoD1.length && !diferentes.length,
    linhasPlanilha: p.size,
    linhasD1: d.size,
    faltandoNoD1,
    sobrandoNoD1,
    diferentes,
  };
}

export async function validarAba(aba: AbaEspelhada, linhasPlanilha?: string[][]): Promise<RelatorioAba> {
  const db = getCatalogoDb();
  const planilha = linhasPlanilha ?? (await lerAbaDaPlanilha(aba));
  const d1 = db
    ? (
        await db
          .prepare("SELECT linha, celulas_json FROM abas_espelho WHERE aba = ?")
          .bind(aba)
          .all<{ linha: number; celulas_json: string }>()
      ).results || []
    : [];
  return compararAba(aba, planilha, d1);
}

/** Hook de googleSheetsService: depois de QUALQUER escrita numa aba espelhada, ressincroniza ela. */
export async function aposEscritaEmAbaEspelhada(aba: string): Promise<void> {
  if (!ehAbaEspelhada(aba)) return;
  const r = await sincronizarAba(aba);
  if (!r.ok) console.warn(`[espelhoAbasD1] espelho de "${aba}" falhou (o cron corrige):`, r.erro);
}

/** Cron: compara cada aba de álbum com o D1 e ressincroniza a que divergir. */
export async function reconciliarAbasEspelho(): Promise<{ aba: string; ok: boolean; corrigiu?: ResultadoSyncAba }[]> {
  const out: { aba: string; ok: boolean; corrigiu?: ResultadoSyncAba; rel?: RelatorioAba }[] = [];
  for (const aba of ABAS_ALBUM) {
    const planilha = await lerAbaDaPlanilha(aba);
    const rel = await validarAba(aba, planilha);
    if (rel.ok) {
      out.push({ aba, ok: true });
      continue;
    }
    const corrigiu = await sincronizarAba(aba, planilha);
    out.push({ aba, ok: false, corrigiu, rel });
  }
  const divergentes = out.filter((o) => !o.ok);
  if (divergentes.length) {
    const { registrarLogSistema } = await import("./logSistemaService");
    await registrarLogSistema({
      categoria: divergentes.some((d) => d.corrigiu?.ok === false) ? "Falha de escrita" : "Ação concluída",
      oQueAconteceu: `Reconciliação D1 (álbuns): ${divergentes
        .map((d) => `"${d.aba}" divergia (faltando ${d.rel?.faltandoNoD1.length}, sobrando ${d.rel?.sobrandoNoD1.length}, diferentes ${d.rel?.diferentes.length})`)
        .join("; ")}. Ressincronizado a partir da planilha.`,
      onde: "espelhoAbasD1.reconciliarAbasEspelho (cron)",
      detalheTecnico: JSON.stringify(divergentes).slice(0, 45000),
    }).catch(() => {});
  }
  return out.map(({ aba, ok, corrigiu }) => ({ aba, ok, corrigiu }));
}
