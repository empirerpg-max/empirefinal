// Presença por minuto (Empire TV): cálculo puro + persistência no D1 (tv_presenca).
import type { D1DatabaseLike } from "./catalogoDbService";

const MIN_MS = 60_000;
const IDADE_MAX_MS = 6 * 3600_000; // ignora idades acima de 6 h
const BURACO_MAX_MIN = 2; // buraco de até 2 min entre presentes conta como presença

/** Ordena e remove repetidos. */
function ordenarUnicos(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

/** Converte idades (ms atrás) em minutos Unix pelo relógio do servidor. */
export function minutosDeIdades(agoraMs: number, idadesMs: number[]): number[] {
  const out: number[] = [];
  for (const idade of idadesMs) {
    if (!Number.isFinite(idade) || idade < 0 || idade > IDADE_MAX_MS) continue;
    out.push(Math.floor((agoraMs - idade) / MIN_MS));
  }
  return ordenarUnicos(out);
}

/** União ordenada, sem repetição. */
export function unirMinutos(...listas: number[][]): number[] {
  return ordenarUnicos(listas.flat());
}

/** Texto "29000000,29000001". */
export function codificarMinutos(m: number[]): string {
  return ordenarUnicos(m).join(",");
}

/** Lê o texto de codificarMinutos; ignora lixo. */
export function lerMinutos(s: string | null): number[] {
  if (!s) return [];
  const out: number[] = [];
  for (const parte of s.split(",")) {
    const t = parte.trim();
    if (!/^\d+$/.test(t)) continue;
    out.push(Number(t));
  }
  return ordenarUnicos(out);
}

/** Presença dentro de [inicio, fim) em minutos inteiros, preenchendo buracos de até 2 min. */
export function calcularPresenca(
  minutos: number[],
  inicioMs: number,
  fimMs: number,
): { minutosPresentes: number; duracaoMin: number; pct: number; entrouMs: number | null; saiuMs: number | null } {
  // Janela em minutos inteiros: do minuto que contém o início até o minuto que
  // contém fim-1ms (transmissões começam no meio do minuto).
  const iniMin = Math.floor(inicioMs / MIN_MS);
  const fimMin = Math.floor((fimMs - 1) / MIN_MS);
  const duracaoMin = Math.max(1, fimMin - iniMin + 1);
  const dentro = ordenarUnicos(minutos).filter((m) => m >= iniMin && m <= fimMin);
  if (dentro.length === 0) {
    return { minutosPresentes: 0, duracaoMin, pct: 0, entrouMs: null, saiuMs: null };
  }
  let presentes = dentro.length;
  for (let i = 1; i < dentro.length; i++) {
    const buraco = dentro[i] - dentro[i - 1] - 1;
    if (buraco > 0 && buraco <= BURACO_MAX_MIN) presentes += buraco;
  }
  const pct = Math.min(100, Math.round((presentes / duracaoMin) * 100));
  return {
    minutosPresentes: presentes,
    duracaoMin,
    pct,
    entrouMs: dentro[0] * MIN_MS,
    saiuMs: dentro[dentro.length - 1] * MIN_MS,
  };
}

// ---- D1: tv_presenca (uma linha por pessoa por segmento; só a chave primária) ----

const SQL_TABELA_PRESENCA = `CREATE TABLE IF NOT EXISTS tv_presenca (programa_id TEXT NOT NULL, jogador_id TEXT NOT NULL, nome TEXT, minutos TEXT NOT NULL, atualizado_em INTEGER NOT NULL, PRIMARY KEY (programa_id, jogador_id)) WITHOUT ROWID`;

// Memo por isolate, chaveado no objeto db (cada banco falso de teste é novo).
const tabelaGarantida = new WeakMap<object, Promise<void>>();

export function garantirTabelaPresenca(db: D1DatabaseLike): Promise<void> {
  let p = tabelaGarantida.get(db);
  if (!p) {
    p = db.prepare(SQL_TABELA_PRESENCA).run().then(() => undefined);
    p.catch(() => tabelaGarantida.delete(db)); // falhou: tenta de novo na próxima
    tabelaGarantida.set(db, p);
  }
  return p;
}

/** 1 leitura + no máximo 1 escrita; só grava se houver minuto novo. */
export async function gravarMinutosPresenca(
  db: D1DatabaseLike,
  p: { programaId: string; jogadorId: string; nome: string; minutos: number[] },
  agoraMs: number,
): Promise<"gravado" | "sem-novidade"> {
  const r = await db
    .prepare("SELECT minutos FROM tv_presenca WHERE programa_id = ? AND jogador_id = ?")
    .bind(p.programaId, p.jogadorId)
    .all<{ minutos: string }>();
  const atuais = lerMinutos(r.results[0]?.minutos ?? null);
  const novos = unirMinutos(atuais, p.minutos);
  if (r.results.length > 0 && novos.length === atuais.length) return "sem-novidade";
  if (novos.length === 0) return "sem-novidade";
  await db
    .prepare(
      "INSERT INTO tv_presenca (programa_id, jogador_id, nome, minutos, atualizado_em) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT (programa_id, jogador_id) DO UPDATE SET nome = excluded.nome, minutos = excluded.minutos, atualizado_em = excluded.atualizado_em",
    )
    .bind(p.programaId, p.jogadorId, p.nome, codificarMinutos(novos), agoraMs)
    .run();
  return "gravado";
}

/** Une as linhas de cada pessoa em todos os segmentos (lida pela chave primária). */
export async function lerPresencaGrupo(
  db: D1DatabaseLike,
  rowIds: string[],
): Promise<Map<string, { nome: string; minutos: number[] }>> {
  const out = new Map<string, { nome: string; minutos: number[] }>();
  if (rowIds.length === 0) return out;
  const marcas = rowIds.map(() => "?").join(",");
  const r = await db
    .prepare(`SELECT jogador_id, nome, minutos FROM tv_presenca WHERE programa_id IN (${marcas})`)
    .bind(...rowIds)
    .all<{ jogador_id: string; nome: string | null; minutos: string }>();
  for (const row of r.results) {
    const ant = out.get(row.jogador_id);
    out.set(row.jogador_id, {
      nome: row.nome || ant?.nome || "",
      minutos: unirMinutos(ant?.minutos ?? [], lerMinutos(row.minutos)),
    });
  }
  return out;
}

/** Apaga linhas com atualizado_em < antesDeMs; devolve quantas. */
export async function apagarPresencaAntiga(db: D1DatabaseLike, antesDeMs: number): Promise<number> {
  const r = await db.prepare("DELETE FROM tv_presenca WHERE atualizado_em < ?").bind(antesDeMs).run();
  return (r as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0;
}
