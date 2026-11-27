// Medição de uso (Empire Hub): contadores por dia no D1, sem dado pessoal além
// do id do jogador (usado só para contar pessoas distintas).
import type { D1DatabaseLike } from "./catalogoDbService";

export type EventoUso = { evento: "tela" | "acao" | "caminho"; alvo: string; n: number };
export type LoteUso = {
  versao: "anterior" | "beta";
  aparelho: "celular" | "tablet" | "computador";
  eventos: EventoUso[];
  telas?: string[];
};
export type ResumoUso = {
  jogadores: number;
  telas: { alvo: string; n: number; jogadores: number }[];
  acoes: { alvo: string; n: number }[];
  caminhos: { alvo: string; n: number }[];
  porAparelho: { aparelho: string; n: number }[];
};

const MAX_EVENTOS = 200;
const MAX_TELAS = 50;
// Lote sem sessão válida (qualquer um pode mandar): teto bem menor.
const MAX_EVENTOS_SEM_SESSAO = 20;
const MAX_TELAS_SEM_SESSAO = 10;
const MAX_ALVO = 120;
const MAX_N = 1000;
const EVENTOS_POR_INSTRUCAO = 16; // 16 x 6 = 96 parâmetros
const TELAS_POR_INSTRUCAO = 33; // 33 x 3 = 99 parâmetros
const EVENTOS = ["tela", "acao", "caminho"];
const VERSOES = ["anterior", "beta"];
const APARELHOS = ["celular", "tablet", "computador"];

/** Dia UTC "YYYY-MM-DD". */
export function diaUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const SQL_TABELAS = [
  `CREATE TABLE IF NOT EXISTS uso_diario (dia TEXT NOT NULL, versao TEXT NOT NULL, aparelho TEXT NOT NULL, evento TEXT NOT NULL, alvo TEXT NOT NULL, contagem INTEGER NOT NULL, PRIMARY KEY (dia, versao, aparelho, evento, alvo)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS uso_jogador_dia (dia TEXT NOT NULL, jogador TEXT NOT NULL, versao TEXT NOT NULL, PRIMARY KEY (dia, jogador)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS uso_jogador_tela_dia (dia TEXT NOT NULL, tela TEXT NOT NULL, jogador TEXT NOT NULL, PRIMARY KEY (dia, tela, jogador)) WITHOUT ROWID`,
];

// Memo por isolate, chaveado no objeto db (cada banco falso de teste é novo).
const tabelasGarantidas = new WeakMap<object, Promise<void>>();

export function garantirTabelasUso(db: D1DatabaseLike): Promise<void> {
  let p = tabelasGarantidas.get(db);
  if (!p) {
    p = db.batch(SQL_TABELAS.map((s) => db.prepare(s))).then(() => undefined);
    p.catch(() => tabelasGarantidas.delete(db)); // falhou: tenta de novo na próxima
    tabelasGarantidas.set(db, p);
  }
  return p;
}

// Formato dos alvos que o app manda (src/lib/uso/coletor.ts); o resto é descartado,
// para ninguém pôr texto arbitrário na tela admin com um POST feito à mão.
// Tela: id da rota (começa por "/") + " › aba" opcional; sem "←" (separador do caminho).
const TELA_RE = /^\/[^\u0000-\u001f\u007f←]*$/;
// Ação HTTP: "/api" + segmentos já normalizados (palavra de rota ou ":id").
const ACAO_API_RE = /^\/api(\/([a-z]+(-[a-z]+){0,3}|:id)?)*$/;
// Ações que não são HTTP (usoGlobal()?.acao(...)): toda nova precisa entrar aqui.
const ACOES_ESPECIAIS = ["buscar", "tocar_musica"];
const SEP_CAMINHO = " ← ";

const telaValida = (t: string) => TELA_RE.test(t);
const acaoValida = (a: string) => ACOES_ESPECIAIS.includes(a) || ACAO_API_RE.test(a);
function alvoValido(evento: EventoUso["evento"], alvo: string): boolean {
  if (evento === "tela") return telaValida(alvo);
  if (evento === "acao") return acaoValida(alvo);
  const i = alvo.indexOf(SEP_CAMINHO);
  return i > 0 && acaoValida(alvo.slice(0, i)) && telaValida(alvo.slice(i + SEP_CAMINHO.length));
}

/**
 * Valida e corta o corpo bruto de um lote; devolve null se não houver lote válido.
 * `comSessao`: o lote veio com sessão válida (tetos 200/50); sem sessão, 20/10.
 */
export function limparLote(bruto: unknown, { comSessao = false }: { comSessao?: boolean } = {}): LoteUso | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  if (typeof b.versao !== "string" || !VERSOES.includes(b.versao)) return null;
  if (typeof b.aparelho !== "string" || !APARELHOS.includes(b.aparelho)) return null;
  if (!Array.isArray(b.eventos)) return null;
  const maxEventos = comSessao ? MAX_EVENTOS : MAX_EVENTOS_SEM_SESSAO;
  const maxTelas = comSessao ? MAX_TELAS : MAX_TELAS_SEM_SESSAO;
  const eventos: EventoUso[] = [];
  for (const e of b.eventos) {
    if (eventos.length >= maxEventos) break;
    if (!e || typeof e !== "object") continue;
    const { evento, alvo, n } = e as Record<string, unknown>;
    if (typeof evento !== "string" || !EVENTOS.includes(evento)) continue;
    if (typeof alvo !== "string" || alvo.length === 0) continue;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 1) continue;
    const a = alvo.slice(0, MAX_ALVO);
    if (!alvoValido(evento as EventoUso["evento"], a)) continue;
    eventos.push({ evento: evento as EventoUso["evento"], alvo: a, n: Math.min(MAX_N, Math.floor(n)) });
  }
  const lote: LoteUso = { versao: b.versao as LoteUso["versao"], aparelho: b.aparelho as LoteUso["aparelho"], eventos };
  if (Array.isArray(b.telas)) {
    const telas = new Set<string>();
    for (const t of b.telas) {
      if (telas.size >= maxTelas) break;
      if (typeof t !== "string" || t.length === 0) continue;
      const a = t.slice(0, MAX_ALVO);
      if (telaValida(a)) telas.add(a);
    }
    lote.telas = [...telas];
  }
  return lote;
}

/** Soma o lote no dia de `agoraMs`: no máximo uma instrução por chave, num único batch. */
export async function gravarLoteUso(
  db: D1DatabaseLike,
  lote: LoteUso,
  jogadorId: string | null,
  agoraMs: number,
): Promise<{ gravadas: number }> {
  const dia = diaUTC(agoraMs);
  const somas = new Map<string, { evento: string; alvo: string; n: number }>();
  for (const e of lote.eventos) {
    const chave = `${e.evento}\u0000${e.alvo}`;
    const atual = somas.get(chave);
    if (atual) atual.n += e.n;
    else somas.set(chave, { evento: e.evento, alvo: e.alvo, n: e.n });
  }
  // D1 limita 100 parâmetros por consulta e 50 consultas por invocação:
  // várias linhas por instrução (6 parâmetros por evento, 3 por tela).
  const stmts: ReturnType<D1DatabaseLike["prepare"]>[] = [];
  const linhasEv = [...somas.values()];
  for (let i = 0; i < linhasEv.length; i += EVENTOS_POR_INSTRUCAO) {
    const grupo = linhasEv.slice(i, i + EVENTOS_POR_INSTRUCAO);
    stmts.push(
      db
        .prepare(
          "INSERT INTO uso_diario (dia, versao, aparelho, evento, alvo, contagem) VALUES " +
            grupo.map(() => "(?, ?, ?, ?, ?, ?)").join(", ") +
            " ON CONFLICT (dia, versao, aparelho, evento, alvo) DO UPDATE SET contagem = contagem + excluded.contagem",
        )
        .bind(...grupo.flatMap((g) => [dia, lote.versao, lote.aparelho, g.evento, g.alvo, g.n])),
    );
  }
  const jogador = typeof jogadorId === "string" && jogadorId.trim() !== "" ? jogadorId : null;
  if (jogador !== null) {
    stmts.push(
      db.prepare("INSERT OR IGNORE INTO uso_jogador_dia (dia, jogador, versao) VALUES (?, ?, ?)").bind(dia, jogador, lote.versao),
    );
    const telas = [...new Set(lote.telas ?? [])];
    for (let i = 0; i < telas.length; i += TELAS_POR_INSTRUCAO) {
      const grupo = telas.slice(i, i + TELAS_POR_INSTRUCAO);
      stmts.push(
        db
          .prepare("INSERT OR IGNORE INTO uso_jogador_tela_dia (dia, tela, jogador) VALUES " + grupo.map(() => "(?, ?, ?)").join(", "))
          .bind(...grupo.flatMap((t) => [dia, t, jogador])),
      );
    }
  }
  if (stmts.length === 0) return { gravadas: 0 };
  await db.batch(stmts);
  return { gravadas: stmts.length };
}

/**
 * Resumo do período [deDia, ateDia] (inclusive); lê só pela chave que começa por dia.
 * 3 consultas: uma varredura de `uso_diario` (eventos e aparelho saem da mesma,
 * somados aqui), jogadores distintos e jogadores distintos por tela.
 */
export async function resumoUso(db: D1DatabaseLike, deDia: string, ateDia: string): Promise<ResumoUso> {
  const [eventos, jog, telaJog] = await Promise.all([
    db
      .prepare(
        "SELECT aparelho, evento, alvo, SUM(contagem) AS n FROM uso_diario WHERE dia BETWEEN ? AND ? GROUP BY aparelho, evento, alvo",
      )
      .bind(deDia, ateDia)
      .all(),
    db.prepare("SELECT COUNT(DISTINCT jogador) AS n FROM uso_jogador_dia WHERE dia BETWEEN ? AND ?").bind(deDia, ateDia)
      .all(),
    db
      .prepare("SELECT tela, COUNT(DISTINCT jogador) AS n FROM uso_jogador_tela_dia WHERE dia BETWEEN ? AND ? GROUP BY tela")
      .bind(deDia, ateDia)
      .all(),
  ]);
  const jogadoresPorTela = new Map<string, number>();
  for (const r of (telaJog.results ?? []) as { tela: string; n: number }[]) jogadoresPorTela.set(r.tela, r.n);
  const porEvento = { tela: new Map<string, number>(), acao: new Map<string, number>(), caminho: new Map<string, number>() };
  const porAparelho = new Map<string, number>();
  for (const r of (eventos.results ?? []) as { aparelho: string; evento: string; alvo: string; n: number }[]) {
    const n = Number(r.n) || 0;
    porAparelho.set(r.aparelho, (porAparelho.get(r.aparelho) ?? 0) + n);
    const m = porEvento[r.evento as keyof typeof porEvento];
    if (m) m.set(r.alvo, (m.get(r.alvo) ?? 0) + n);
  }
  const porN = <T extends { n: number }>(xs: T[]) => xs.sort((a, b) => b.n - a.n);
  const lista = (m: Map<string, number>) => porN([...m].map(([alvo, n]) => ({ alvo, n })));
  return {
    jogadores: ((jog.results ?? []) as { n: number }[])[0]?.n ?? 0,
    telas: lista(porEvento.tela).map((t) => ({ ...t, jogadores: jogadoresPorTela.get(t.alvo) ?? 0 })),
    acoes: lista(porEvento.acao),
    caminhos: lista(porEvento.caminho),
    porAparelho: porN([...porAparelho].map(([aparelho, n]) => ({ aparelho, n }))),
  };
}

/** Apaga os dias anteriores a `antesDoDia` nas 3 tabelas; devolve quantas linhas. */
export async function apagarUsoAntigo(db: D1DatabaseLike, antesDoDia: string): Promise<number> {
  const rs = await db.batch(
    ["uso_diario", "uso_jogador_dia", "uso_jogador_tela_dia"].map((t) =>
      db.prepare(`DELETE FROM ${t} WHERE dia < ?`).bind(antesDoDia),
    ),
  );
  return rs.reduce((s, r) => s + ((r as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0), 0);
}
