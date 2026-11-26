// Enquetes do chat da Empire TV: tabelas no D1 (só chave primária) + apuração.
import type { D1DatabaseLike } from "./catalogoDbService";

const SQL_TABELA_ENQUETE = `CREATE TABLE IF NOT EXISTS tv_enquete (programa_id TEXT NOT NULL, id TEXT NOT NULL, pergunta TEXT NOT NULL, tipo TEXT NOT NULL CHECK (tipo IN ('unica','multipla')), opcoes TEXT NOT NULL, secreto INTEGER NOT NULL, so_fim INTEGER NOT NULL, encerra_em INTEGER, aberta INTEGER NOT NULL, criada_em INTEGER NOT NULL, encerrada_em INTEGER, criada_por TEXT, contagem TEXT NOT NULL DEFAULT '', total INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (programa_id, id)) WITHOUT ROWID`;
const SQL_TABELA_VOTO = `CREATE TABLE IF NOT EXISTS tv_enquete_voto (enquete_id TEXT NOT NULL, jogador_id TEXT NOT NULL, nome TEXT, opcoes TEXT NOT NULL, votado_em INTEGER NOT NULL, PRIMARY KEY (enquete_id, jogador_id)) WITHOUT ROWID`;

// Memo por isolate, chaveado no objeto db.
const tabelasGarantidas = new WeakMap<object, Promise<void>>();

function lerLista<T>(s: string | null | undefined): T[] {
  try {
    const v = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

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
      "INSERT INTO tv_enquete (programa_id, id, pergunta, tipo, opcoes, secreto, so_fim, encerra_em, aberta, criada_em, encerrada_em, criada_por, contagem, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?, 0)",
    )
    .bind(e.programaId, id, pergunta, e.tipo, JSON.stringify(opcoes), e.secreto ? 1 : 0, e.soFim ? 1 : 0, e.encerraEmMs ?? null, agoraMs, e.criadaPor ?? null, JSON.stringify(opcoes.map(() => 0)))
    .run();
  return id;
}

export async function votar(
  db: D1DatabaseLike,
  programaId: string,
  enqueteId: string,
  jogadorId: string,
  nome: string,
  opcoes: number[],
  agoraMs: number,
  aoFechar?: (programaId: string, enqueteId: string) => Promise<void>,
): Promise<"ok" | "encerrada" | "invalida"> {
  await garantirTabelasEnquete(db);
  const r = await db
    .prepare("SELECT tipo, opcoes, aberta, encerra_em FROM tv_enquete WHERE programa_id = ? AND id = ?")
    .bind(programaId, enqueteId)
    .all<{ tipo: string; opcoes: string; aberta: number; encerra_em: number | null }>();
  const row = r.results[0];
  if (!row) return "invalida";
  if (row.aberta !== 1) return "encerrada";
  if (row.encerra_em != null && row.encerra_em <= agoraMs) {
    if (await encerrar(db, programaId, enqueteId, agoraMs)) await aoFechar?.(programaId, enqueteId);
    return "encerrada";
  }
  const n = lerLista<string>(row.opcoes).length;
  if (!Array.isArray(opcoes) || opcoes.some((i) => !Number.isInteger(i) || i < 0 || i >= n)) return "invalida";
  const idx = [...new Set(opcoes)].sort((a, b) => a - b);
  if (idx.length < 1) return "invalida";
  if (row.tipo === "unica" && idx.length !== 1) return "invalida";
  // Nome mostrado em "Ver quem votou" (enquete pública): limitado a 60.
  nome = String(nome ?? "").trim().slice(0, 60) || "Anônimo";
  // Uma transação: o contador é ajustado pela diferença entre o voto novo e o
  // voto antigo lido DENTRO da transação (antes do upsert), então dois votos
  // simultâneos nunca contam duas vezes.
  const antigo = (i: number) =>
    `(CASE WHEN EXISTS (SELECT 1 FROM tv_enquete_voto v, json_each(v.opcoes) j WHERE v.enquete_id = ? AND v.jogador_id = ? AND j.value = ${i}) THEN 1 ELSE 0 END)`;
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (let i = 0; i < n; i++) {
    sets.push(`'$[${i}]', json_extract(contagem, '$[${i}]') + ${idx.includes(i) ? 1 : 0} - ${antigo(i)}`);
    binds.push(enqueteId, jogadorId);
  }
  const atualiza = db
    .prepare(
      `UPDATE tv_enquete SET contagem = json_set(contagem, ${sets.join(", ")}), ` +
        "total = total + (CASE WHEN EXISTS (SELECT 1 FROM tv_enquete_voto WHERE enquete_id = ? AND jogador_id = ?) THEN 0 ELSE 1 END) " +
        "WHERE programa_id = ? AND id = ? AND aberta = 1",
    )
    .bind(...binds, enqueteId, jogadorId, programaId, enqueteId);
  const upsert = db
    .prepare(
      "INSERT INTO tv_enquete_voto (enquete_id, jogador_id, nome, opcoes, votado_em) " +
        "SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM tv_enquete WHERE programa_id = ? AND id = ? AND aberta = 1) " +
        "ON CONFLICT (enquete_id, jogador_id) DO UPDATE SET nome = excluded.nome, opcoes = excluded.opcoes, votado_em = excluded.votado_em",
    )
    .bind(enqueteId, jogadorId, nome, JSON.stringify(idx), agoraMs, programaId, enqueteId);
  const res = await db.batch([atualiza, upsert]);
  const mudou = (res[0] as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0;
  return mudou > 0 ? "ok" : "encerrada";
}

export async function encerrar(db: D1DatabaseLike, programaId: string, enqueteId: string, agoraMs: number): Promise<boolean> {
  await garantirTabelasEnquete(db);
  const r = await db
    .prepare("UPDATE tv_enquete SET aberta = 0, encerrada_em = ? WHERE programa_id = ? AND id = ? AND aberta = 1")
    .bind(agoraMs, programaId, enqueteId)
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

/** Voto do jogador em cada enquete: só buscas pela chave primária (enquete_id, jogador_id), em blocos de 90. */
export async function meusVotos(db: D1DatabaseLike, enqueteIds: string[], jogadorId: string): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  for (let k = 0; k < enqueteIds.length; k += 90) {
    const bloco = enqueteIds.slice(k, k + 90);
    const r = await db
      .prepare(`SELECT enquete_id, opcoes FROM tv_enquete_voto WHERE enquete_id IN (${bloco.map(() => "?").join(",")}) AND jogador_id = ?`)
      .bind(...bloco, jogadorId)
      .all<{ enquete_id: string; opcoes: string }>();
    for (const x of r.results) out.set(x.enquete_id, lerLista<number>(x.opcoes));
  }
  return out;
}

/**
 * Lista as enquetes da sala: 1 leitura de tv_enquete (contadores guardados na
 * própria linha) + o voto do jogador por chave primária. Enquetes vencidas são
 * fechadas aqui (o UPDATE só roda quando a leitura mostra alguma aberta já
 * vencida); `aoFechar` roda só para as que ESTA chamada fechou.
 */
export async function listarEnquetes(
  db: D1DatabaseLike,
  programaId: string,
  jogadorId: string | null,
  agoraMs: number,
  aoFechar?: (programaId: string, enqueteId: string) => Promise<void>,
): Promise<EnqueteView[]> {
  await garantirTabelasEnquete(db);
  const r = await db
    .prepare(
      "SELECT id, pergunta, tipo, opcoes, secreto, so_fim, encerra_em, aberta, criada_em, encerrada_em, contagem, total FROM tv_enquete WHERE programa_id = ? ORDER BY aberta DESC, criada_em DESC",
    )
    .bind(programaId)
    .all<{
      id: string; pergunta: string; tipo: TipoEnquete; opcoes: string; secreto: number; so_fim: number;
      encerra_em: number | null; aberta: number; criada_em: number; encerrada_em: number | null; contagem: string; total: number;
    }>();
  // Só escreve quando alguma aberta já venceu (a maioria dos GETs é só leitura).
  // O UPDATE … RETURNING garante que só UM chamador avisa cada fechamento.
  const vencida = (e: { aberta: number; encerra_em: number | null }) =>
    e.aberta === 1 && e.encerra_em != null && e.encerra_em <= agoraMs;
  if (r.results.some(vencida)) {
    const fechadas = await db
      .prepare(
        "UPDATE tv_enquete SET aberta = 0, encerrada_em = ? WHERE programa_id = ? AND aberta = 1 AND encerra_em IS NOT NULL AND encerra_em <= ? RETURNING id",
      )
      .bind(agoraMs, programaId, agoraMs)
      .all<{ id: string }>();
    for (const f of fechadas.results ?? []) await aoFechar?.(programaId, f.id);
    // Reflete o fechamento na lista já lida (fechada aqui ou por outro chamador).
    for (const e of r.results) {
      if (vencida(e)) {
        e.aberta = 0;
        e.encerrada_em = e.encerrada_em ?? agoraMs;
      }
    }
    r.results.sort((a, b) => b.aberta - a.aberta || b.criada_em - a.criada_em);
  }
  const meus = jogadorId ? await meusVotos(db, r.results.map((e) => e.id), jogadorId) : new Map<string, number[]>();
  return r.results.map((e) => {
    const opcoes = lerLista<string>(e.opcoes);
    const contagem = opcoes.map((_, i) => lerLista<number>(e.contagem)[i] ?? 0);
    const total = e.total;
    const pct = contagem.map((c) => (total === 0 ? 0 : Math.round((c * 100) / total)));
    const max = Math.max(0, ...contagem);
    const vencedores = max === 0 ? [] : contagem.flatMap((c, i) => (c === max ? [i] : []));
    const aberta = e.aberta === 1;
    const soFim = e.so_fim === 1;
    const esconde = soFim && aberta;
    return {
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
      contagem: esconde ? null : contagem,
      pct: esconde ? null : pct,
      total,
      vencedores: esconde ? [] : vencedores,
      meuVoto: meus.get(e.id) ?? null,
    };
  });
}

/**
 * Quem votou em cada opção de uma enquete PÚBLICA (secreto = 0), só sob
 * demanda ("Ver quem votou"): 1 leitura da enquete pela chave primária + os
 * votos pelo prefixo da chave (enquete_id). Enquete anônima nunca devolve
 * nomes; com "resultado só no fim", só depois de encerrada.
 */
export async function votantesEnquete(
  db: D1DatabaseLike,
  programaId: string,
  enqueteId: string,
  agoraMs: number,
): Promise<{ status: "ok"; votantes: string[][] } | { status: "inexistente" | "anonima" | "so_fim" }> {
  await garantirTabelasEnquete(db);
  const r = await db
    .prepare("SELECT opcoes, secreto, so_fim, aberta, encerra_em FROM tv_enquete WHERE programa_id = ? AND id = ?")
    .bind(programaId, enqueteId)
    .all<{ opcoes: string; secreto: number; so_fim: number; aberta: number; encerra_em: number | null }>();
  const e = r.results[0];
  if (!e) return { status: "inexistente" };
  if (e.secreto !== 0) return { status: "anonima" };
  const aberta = e.aberta === 1 && !(e.encerra_em != null && e.encerra_em <= agoraMs);
  if (e.so_fim === 1 && aberta) return { status: "so_fim" };
  const n = lerLista<string>(e.opcoes).length;
  const votantes: string[][] = Array.from({ length: n }, () => []);
  const v = await db
    .prepare("SELECT nome, opcoes FROM tv_enquete_voto WHERE enquete_id = ?")
    .bind(enqueteId)
    .all<{ nome: string | null; opcoes: string }>();
  for (const x of v.results) {
    const nome = String(x.nome ?? "").trim().slice(0, 60) || "Anônimo";
    for (const i of lerLista<number>(x.opcoes)) if (Number.isInteger(i) && i >= 0 && i < n) votantes[i].push(nome);
  }
  for (const l of votantes) l.sort((a, b) => a.localeCompare(b, "pt-BR"));
  return { status: "ok", votantes };
}

/** Ids das enquetes ainda abertas de uma sala (programa_id). */
export async function idsEnquetesAbertas(db: D1DatabaseLike, programaId: string): Promise<string[]> {
  await garantirTabelasEnquete(db);
  const r = await db
    .prepare("SELECT id FROM tv_enquete WHERE programa_id = ? AND aberta = 1")
    .bind(programaId)
    .all<{ id: string }>();
  return r.results.map((x) => x.id);
}

/** Resultado completo (sem esconder nada) de uma enquete, para a planilha. */
export async function resultadoEnquete(
  db: D1DatabaseLike,
  programaId: string,
  enqueteId: string,
): Promise<{ pergunta: string; tipo: TipoEnquete; opcoes: string[]; contagem: number[]; pct: number[] } | null> {
  const r = await db
    .prepare("SELECT pergunta, tipo, opcoes, contagem, total FROM tv_enquete WHERE programa_id = ? AND id = ?")
    .bind(programaId, enqueteId)
    .all<{ pergunta: string; tipo: TipoEnquete; opcoes: string; contagem: string; total: number }>();
  const e = r.results[0];
  if (!e) return null;
  const opcoes = lerLista<string>(e.opcoes);
  const contagem = opcoes.map((_, i) => lerLista<number>(e.contagem)[i] ?? 0);
  const pct = contagem.map((c) => (e.total === 0 ? 0 : Math.round((c * 100) / e.total)));
  return { pergunta: e.pergunta, tipo: e.tipo, opcoes, contagem, pct };
}
