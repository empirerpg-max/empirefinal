// Beta test (Empire Hub): escolha de versão por jogador e reportes, no D1.
import type { D1DatabaseLike } from "./catalogoDbService";
import type { MotivoVolta, Versao } from "../../../src/lib/beta/regras";

export type StatusReporte = "novo" | "visto" | "resolvido";
export type NovoReporte = {
  jogadorId: string;
  usuario: string;
  versao: Versao;
  tela: string;
  rota: string;
  texto: string;
  motivo: MotivoVolta | null;
  printUrl: string;
  tecnico: string;
};
export type Reporte = NovoReporte & { id: string; status: StatusReporte; criadoEm: number };

const MAX_TEXTO = 2000;
const MAX_TECNICO = 4000;
const MAX_REPORTES_DIA = 10;
const STATUS: readonly string[] = ["novo", "visto", "resolvido"];

const SQL_TABELAS = [
  `CREATE TABLE IF NOT EXISTS beta_jogador (jogador_id TEXT PRIMARY KEY, versao TEXT, boas_vindas_em INTEGER, atualizado_em INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS beta_reporte (id TEXT PRIMARY KEY, jogador_id TEXT NOT NULL, usuario TEXT NOT NULL, versao TEXT NOT NULL, tela TEXT NOT NULL, rota TEXT NOT NULL, texto TEXT NOT NULL, motivo TEXT, print_url TEXT NOT NULL DEFAULT '', tecnico TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'novo', criado_em INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS beta_reporte_status_data ON beta_reporte (status, criado_em DESC)`,
  `CREATE INDEX IF NOT EXISTS beta_reporte_jogador_data ON beta_reporte (jogador_id, criado_em)`,
];

// Memo por isolate, chaveado no objeto db (cada banco falso de teste é novo).
const tabelasGarantidas = new WeakMap<object, Promise<void>>();

export function garantirTabelasBeta(db: D1DatabaseLike): Promise<void> {
  let p = tabelasGarantidas.get(db);
  if (!p) {
    p = db.batch(SQL_TABELAS.map((s) => db.prepare(s))).then(() => undefined);
    p.catch(() => tabelasGarantidas.delete(db)); // falhou: tenta de novo na próxima
    tabelasGarantidas.set(db, p);
  }
  return p;
}

export async function lerEscolha(
  db: D1DatabaseLike,
  jogadorId: string,
): Promise<{ versao: Versao | null; boasVindasEm: number | null }> {
  await garantirTabelasBeta(db);
  // .all() + [0]: o tipo local do D1 não tem .first() (o D1 real e o falso têm .all()).
  const { results } = await db
    .prepare("SELECT versao, boas_vindas_em FROM beta_jogador WHERE jogador_id = ?")
    .bind(jogadorId)
    .all<{ versao: string | null; boas_vindas_em: number | null }>();
  const l = results[0];
  const versao = l?.versao === "beta" || l?.versao === "anterior" ? l.versao : null;
  return { versao, boasVindasEm: l?.boas_vindas_em ?? null };
}

export async function gravarEscolha(db: D1DatabaseLike, jogadorId: string, versao: Versao, agora: number): Promise<void> {
  await garantirTabelasBeta(db);
  await db
    .prepare(
      "INSERT INTO beta_jogador (jogador_id, versao, atualizado_em) VALUES (?, ?, ?) ON CONFLICT(jogador_id) DO UPDATE SET versao = excluded.versao, atualizado_em = excluded.atualizado_em",
    )
    .bind(jogadorId, versao, agora)
    .run();
}

export async function marcarBoasVindas(db: D1DatabaseLike, jogadorId: string, agora: number): Promise<void> {
  await garantirTabelasBeta(db);
  await db
    .prepare(
      "INSERT INTO beta_jogador (jogador_id, boas_vindas_em, atualizado_em) VALUES (?, ?, ?) ON CONFLICT(jogador_id) DO UPDATE SET boas_vindas_em = excluded.boas_vindas_em, atualizado_em = excluded.atualizado_em",
    )
    .bind(jogadorId, agora, agora)
    .run();
}

// Sufixo de 3 dígitos: contador por isolate (começa aleatório), então ids do mesmo ms nunca repetem aqui.
let sufixoId = Math.floor(Math.random() * 1000);
function novoIdReporte(): string {
  sufixoId = (sufixoId + 1) % 1000;
  return `R${Date.now()}${String(sufixoId).padStart(3, "0")}`;
}

export async function criarReporte(
  db: D1DatabaseLike,
  r: NovoReporte,
  agora: number,
): Promise<{ id: string } | { erro: "limite" }> {
  await garantirTabelasBeta(db);
  const inicioDia = Math.floor(agora / 86_400_000) * 86_400_000; // meia-noite UTC
  const { results: contagem } = await db
    .prepare("SELECT COUNT(*) AS n FROM beta_reporte WHERE jogador_id = ? AND criado_em >= ?")
    .bind(r.jogadorId, inicioDia)
    .all<{ n: number }>();
  if ((contagem[0]?.n ?? 0) >= MAX_REPORTES_DIA) return { erro: "limite" };
  // Colisão de id (outro isolate no mesmo ms com o mesmo sufixo): tenta de novo com outro sufixo.
  for (let tentativa = 0; ; tentativa++) {
    const id = novoIdReporte();
    try {
      await db
        .prepare(
          "INSERT INTO beta_reporte (id, jogador_id, usuario, versao, tela, rota, texto, motivo, print_url, tecnico, status, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'novo', ?)",
        )
        .bind(id, r.jogadorId, r.usuario, r.versao, r.tela, r.rota, r.texto.slice(0, MAX_TEXTO), r.motivo, r.printUrl, r.tecnico.slice(0, MAX_TECNICO), agora)
        .run();
      return { id };
    } catch (e) {
      if (tentativa >= 4) throw e;
    }
  }
}

export async function listarReportes(
  db: D1DatabaseLike,
  f: { status?: StatusReporte; limite: number; antesDe?: number },
): Promise<Reporte[]> {
  await garantirTabelasBeta(db);
  const onde: string[] = [];
  const params: unknown[] = [];
  if (f.status) { onde.push("status = ?"); params.push(f.status); }
  if (f.antesDe !== undefined) { onde.push("criado_em < ?"); params.push(f.antesDe); }
  const sql = `SELECT * FROM beta_reporte${onde.length ? " WHERE " + onde.join(" AND ") : ""} ORDER BY criado_em DESC LIMIT ?`;
  const { results } = await db.prepare(sql).bind(...params, f.limite).all();
  return (results as any[]).map((l) => ({
    id: l.id,
    jogadorId: l.jogador_id,
    usuario: l.usuario,
    versao: l.versao,
    tela: l.tela,
    rota: l.rota,
    texto: l.texto,
    motivo: l.motivo ?? null,
    printUrl: l.print_url,
    tecnico: l.tecnico,
    status: l.status,
    criadoEm: l.criado_em,
  }));
}

export async function mudarStatusReporte(db: D1DatabaseLike, id: string, status: StatusReporte): Promise<boolean> {
  if (!STATUS.includes(status)) return false;
  await garantirTabelasBeta(db);
  // meta.changes vem do D1 real (e do falso), mas não está no tipo local D1Result.
  const r = await db.prepare("UPDATE beta_reporte SET status = ? WHERE id = ?").bind(status, id).run();
  const meta = "meta" in r ? (r.meta as { changes?: number } | undefined) : undefined;
  return (meta?.changes ?? 0) > 0;
}
