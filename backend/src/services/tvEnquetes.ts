// Enquetes do chat da Empire TV: tabelas no D1 (só chave primária) + apuração.
import type { D1DatabaseLike } from "./catalogoDbService";

const SQL_TABELA_ENQUETE = `CREATE TABLE IF NOT EXISTS tv_enquete (id TEXT PRIMARY KEY, programa_id TEXT NOT NULL, pergunta TEXT NOT NULL, tipo TEXT NOT NULL CHECK (tipo IN ('unica','multipla')), opcoes TEXT NOT NULL, secreto INTEGER NOT NULL, so_fim INTEGER NOT NULL, encerra_em INTEGER, aberta INTEGER NOT NULL, criada_em INTEGER NOT NULL, encerrada_em INTEGER, criada_por TEXT)`;
const SQL_TABELA_VOTO = `CREATE TABLE IF NOT EXISTS tv_enquete_voto (enquete_id TEXT NOT NULL, jogador_id TEXT NOT NULL, nome TEXT, opcoes TEXT NOT NULL, votado_em INTEGER NOT NULL, PRIMARY KEY (enquete_id, jogador_id)) WITHOUT ROWID`;

// Memo por isolate, chaveado no objeto db.
const tabelasGarantidas = new WeakMap<object, Promise<void>>();

export function garantirTabelasEnquete(db: D1DatabaseLike): Promise<void> {
  let p = tabelasGarantidas.get(db);
  if (!p) {
    p = (async () => {
      await db.prepare(SQL_TABELA_ENQUETE).run();
      await db.prepare(SQL_TABELA_VOTO).run();
    })();
    p.catch(() => tabelasGarantidas.delete(db)); // falhou: tenta de novo na próxima
    tabelasGarantidas.set(db, p);
  }
  return p;
}

export type TipoEnquete = "unica" | "multipla";

/** Contagem por opção, % sobre pessoas e vencedores (empate → vários; sem votos → []). */
export function apurar(
  nOpcoes: number,
  votos: number[][],
): { contagem: number[]; pct: number[]; total: number; vencedores: number[] } {
  const contagem = new Array<number>(nOpcoes).fill(0);
  for (const v of votos) for (const i of v) if (i >= 0 && i < nOpcoes) contagem[i]++;
  const total = votos.length;
  const pct = contagem.map((c) => (total === 0 ? 0 : Math.round((c * 100) / total)));
  const max = Math.max(0, ...contagem);
  const vencedores = max === 0 ? [] : contagem.flatMap((c, i) => (c === max ? [i] : []));
  return { contagem, pct, total, vencedores };
}

export async function criarEnquete(
  db: D1DatabaseLike,
  e: {
    programaId: string;
    pergunta: string;
    tipo: TipoEnquete;
    opcoes: string[];
    secreto: boolean;
    soFim: boolean;
    encerraEmMs: number | null;
    criadaPor: string;
  },
  agoraMs: number,
): Promise<string> {
  const pergunta = String(e.pergunta ?? "").trim();
  if (pergunta.length < 1 || pergunta.length > 140) throw new Error("A pergunta deve ter de 1 a 140 caracteres.");
  if (e.tipo !== "unica" && e.tipo !== "multipla") throw new Error("Tipo de enquete inválido.");
  if (!Array.isArray(e.opcoes)) throw new Error("A enquete precisa de 2 a 10 opções.");
  const opcoes = e.opcoes.map((o) => String(o ?? "").trim());
  if (opcoes.length < 2 || opcoes.length > 10) throw new Error("A enquete precisa de 2 a 10 opções.");
  if (opcoes.some((o) => o.length < 1 || o.length > 60)) throw new Error("Cada opção deve ter de 1 a 60 caracteres.");
  if (new Set(opcoes.map((o) => o.toLowerCase())).size !== opcoes.length) throw new Error("As opções não podem se repetir.");
  if (e.encerraEmMs != null && !(e.encerraEmMs > agoraMs)) throw new Error("O horário de encerramento deve estar no futuro.");
  await garantirTabelasEnquete(db);
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO tv_enquete (id, programa_id, pergunta, tipo, opcoes, secreto, so_fim, encerra_em, aberta, criada_em, encerrada_em, criada_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?)",
    )
    .bind(id, e.programaId, pergunta, e.tipo, JSON.stringify(opcoes), e.secreto ? 1 : 0, e.soFim ? 1 : 0, e.encerraEmMs ?? null, agoraMs, e.criadaPor ?? null)
    .run();
  return id;
}

function lerLista<T>(s: string | null | undefined): T[] {
  try {
    const v = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export async function votar(
  db: D1DatabaseLike,
  enqueteId: string,
  jogadorId: string,
  nome: string,
  opcoes: number[],
  agoraMs: number,
): Promise<"ok" | "encerrada" | "invalida"> {
  await garantirTabelasEnquete(db);
  const r = await db
    .prepare("SELECT tipo, opcoes, aberta, encerra_em FROM tv_enquete WHERE id = ?")
    .bind(enqueteId)
    .all<{ tipo: string; opcoes: string; aberta: number; encerra_em: number | null }>();
  const row = r.results[0];
  if (!row) return "invalida";
  if (row.aberta !== 1) return "encerrada";
  if (row.encerra_em != null && row.encerra_em <= agoraMs) {
    await encerrar(db, enqueteId, agoraMs);
    return "encerrada";
  }
  const n = lerLista<string>(row.opcoes).length;
  if (!Array.isArray(opcoes) || opcoes.some((i) => !Number.isInteger(i) || i < 0 || i >= n)) return "invalida";
  const idx = [...new Set(opcoes)].sort((a, b) => a - b);
  if (idx.length < 1) return "invalida";
  if (row.tipo === "unica" && idx.length !== 1) return "invalida";
  await db
    .prepare(
      "INSERT INTO tv_enquete_voto (enquete_id, jogador_id, nome, opcoes, votado_em) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT (enquete_id, jogador_id) DO UPDATE SET nome = excluded.nome, opcoes = excluded.opcoes, votado_em = excluded.votado_em",
    )
    .bind(enqueteId, jogadorId, nome, JSON.stringify(idx), agoraMs)
    .run();
  return "ok";
}

export async function encerrar(db: D1DatabaseLike, enqueteId: string, agoraMs: number): Promise<boolean> {
  await garantirTabelasEnquete(db);
  const r = await db
    .prepare("UPDATE tv_enquete SET aberta = 0, encerrada_em = ? WHERE id = ? AND aberta = 1")
    .bind(agoraMs, enqueteId)
    .run();
  return ((r as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;
}

export interface EnqueteView {
  id: string;
  pergunta: string;
  tipo: TipoEnquete;
  opcoes: string[];
  secreto: boolean;
  soFim: boolean;
  aberta: boolean;
  encerraEm: number | null;
  criadaEm: number;
  encerradaEm: number | null;
  contagem: number[] | null;
  pct: number[] | null;
  total: number;
  vencedores: number[];
  meuVoto: number[] | null;
}

export async function listarEnquetes(
  db: D1DatabaseLike,
  programaId: string,
  jogadorId: string | null,
  agoraMs: number,
): Promise<EnqueteView[]> {
  await garantirTabelasEnquete(db);
  await db
    .prepare("UPDATE tv_enquete SET aberta = 0, encerrada_em = ? WHERE programa_id = ? AND aberta = 1 AND encerra_em IS NOT NULL AND encerra_em <= ?")
    .bind(agoraMs, programaId, agoraMs)
    .run();
  const r = await db
    .prepare(
      "SELECT id, pergunta, tipo, opcoes, secreto, so_fim, encerra_em, aberta, criada_em, encerrada_em FROM tv_enquete WHERE programa_id = ? ORDER BY aberta DESC, criada_em DESC",
    )
    .bind(programaId)
    .all<{
      id: string; pergunta: string; tipo: TipoEnquete; opcoes: string; secreto: number; so_fim: number;
      encerra_em: number | null; aberta: number; criada_em: number; encerrada_em: number | null;
    }>();
  const out: EnqueteView[] = [];
  for (const e of r.results) {
    const opcoes = lerLista<string>(e.opcoes);
    const v = await db
      .prepare("SELECT jogador_id, opcoes FROM tv_enquete_voto WHERE enquete_id = ?")
      .bind(e.id)
      .all<{ jogador_id: string; opcoes: string }>();
    const votos = v.results.map((x) => lerLista<number>(x.opcoes));
    const ap = apurar(opcoes.length, votos);
    const aberta = e.aberta === 1;
    const soFim = e.so_fim === 1;
    const esconde = soFim && aberta;
    const meu = jogadorId ? v.results.find((x) => x.jogador_id === jogadorId) : undefined;
    out.push({
      id: e.id,
      pergunta: e.pergunta,
      tipo: e.tipo,
      opcoes,
      secreto: e.secreto === 1,
      soFim,
      aberta,
      encerraEm: e.encerra_em,
      criadaEm: e.criada_em,
      encerradaEm: e.encerrada_em,
      contagem: esconde ? null : ap.contagem,
      pct: esconde ? null : ap.pct,
      total: ap.total,
      vencedores: esconde ? [] : ap.vencedores,
      meuVoto: meu ? lerLista<number>(meu.opcoes) : null,
    });
  }
  return out;
}
