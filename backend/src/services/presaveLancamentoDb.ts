// Estado do lançamento em passos do pre-save — D1 (design:
// docs/superpowers/specs/2026-11-23-presave-lancamento-em-passos-design.md).
//
// Uma linha em `presave_lancamentos` por campanha que chegou ao dia D, e uma
// linha em `presave_lancamento_passos` por passo (álbum, cada subpasso de
// faixa, vínculos, tracklist, extra, bônus, fechar). O D1 é a fonte de
// verdade de "o que já foi gravado": nunca depende do Google Sheets
// (que é justamente o que falha no meio do lançamento).
import { getCatalogoDb, type D1DatabaseLike } from "./catalogoDbService";
import { normalizeComparison } from "./googleSheetsService";

export type EstadoPasso = "pendente" | "feito" | "falhou" | "travado";
export const MAX_TENTATIVAS = 6;

export interface PassoNovo {
  passo: string;
  ordem: number;
  procurarAntes: boolean;
  estado?: "pendente" | "feito";
  resultado?: Record<string, unknown> | null;
}

export interface Passo {
  campanhaId: string;
  passo: string;
  ordem: number;
  estado: EstadoPasso;
  tentativas: number;
  procurarAntes: boolean;
  resultado: Record<string, unknown> | null;
  ultimoErro: string | null;
  atualizadoEm: string;
}

export interface Lancamento {
  campanhaId: string;
  albumTitulo: string;
  albumTopicId: string;
  completo: boolean;
}

let tabelasGarantidas = false;

/** Só pra testes (cada teste instala um D1 falso novo). */
export function __resetTabelasGarantidas(): void {
  tabelasGarantidas = false;
}

function exigirDb(): D1DatabaseLike {
  const db = getCatalogoDb();
  if (!db) throw new Error("[presaveLancamentoDb] Binding CATALOGO_DB indisponível.");
  return db;
}

async function garantirTabelas(db: D1DatabaseLike): Promise<void> {
  if (tabelasGarantidas) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS presave_lancamentos (
        campanha_id TEXT PRIMARY KEY,
        album_titulo TEXT NOT NULL,
        album_topic_id TEXT NOT NULL,
        completo INTEGER NOT NULL DEFAULT 0,
        criado_em TEXT DEFAULT (datetime('now'))
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS presave_lancamento_passos (
        campanha_id TEXT NOT NULL,
        passo TEXT NOT NULL,
        ordem INTEGER NOT NULL,
        estado TEXT NOT NULL,
        tentativas INTEGER NOT NULL DEFAULT 0,
        procurar_antes INTEGER NOT NULL DEFAULT 0,
        resultado_json TEXT,
        ultimo_erro TEXT,
        atualizado_em TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (campanha_id, passo)
      )`,
    )
    .run();
  tabelasGarantidas = true;
}

async function db(): Promise<D1DatabaseLike> {
  const d = exigirDb();
  await garantirTabelas(d);
  return d;
}

/** false se a campanha já tinha lançamento (nada é alterado nesse caso). */
export async function criarLancamento(
  l: Omit<Lancamento, "completo">,
  passos: PassoNovo[],
): Promise<boolean> {
  const d = await db();
  const existe = await d
    .prepare(`SELECT campanha_id FROM presave_lancamentos WHERE campanha_id = ?`)
    .bind(l.campanhaId)
    .all();
  if ((existe.results?.length || 0) > 0) return false;
  const statements = [
    d
      .prepare(
        `INSERT INTO presave_lancamentos (campanha_id, album_titulo, album_topic_id, completo) VALUES (?, ?, ?, 0)`,
      )
      .bind(l.campanhaId, l.albumTitulo, l.albumTopicId),
    ...passos.map((p) =>
      d
        .prepare(
          `INSERT INTO presave_lancamento_passos (campanha_id, passo, ordem, estado, tentativas, procurar_antes, resultado_json, atualizado_em)
           VALUES (?, ?, ?, ?, 0, ?, ?, datetime('now'))`,
        )
        .bind(
          l.campanhaId,
          p.passo,
          p.ordem,
          p.estado || "pendente",
          p.procurarAntes ? 1 : 0,
          p.resultado ? JSON.stringify(p.resultado) : null,
        ),
    ),
  ];
  await d.batch(statements);
  return true;
}

function linhaParaPasso(r: Record<string, unknown>): Passo {
  let resultado: Record<string, unknown> | null = null;
  if (typeof r.resultado_json === "string" && r.resultado_json) {
    try {
      resultado = JSON.parse(r.resultado_json);
    } catch {
      resultado = null;
    }
  }
  return {
    campanhaId: String(r.campanha_id),
    passo: String(r.passo),
    ordem: Number(r.ordem),
    estado: String(r.estado) as EstadoPasso,
    tentativas: Number(r.tentativas) || 0,
    procurarAntes: Number(r.procurar_antes) === 1,
    resultado,
    ultimoErro: (r.ultimo_erro as string | null) ?? null,
    atualizadoEm: String(r.atualizado_em ?? ""),
  };
}

export async function listarPassos(campanhaId: string): Promise<Passo[]> {
  const d = await db();
  const res = await d
    .prepare(`SELECT * FROM presave_lancamento_passos WHERE campanha_id = ? ORDER BY ordem`)
    .bind(campanhaId)
    .all();
  return ((res.results || []) as Record<string, unknown>[]).map(linhaParaPasso);
}

export async function marcarFeito(
  campanhaId: string,
  passo: string,
  resultado: Record<string, unknown>,
): Promise<void> {
  const d = await db();
  await d
    .prepare(
      `UPDATE presave_lancamento_passos SET estado = 'feito', resultado_json = ?, ultimo_erro = NULL, atualizado_em = datetime('now')
       WHERE campanha_id = ? AND passo = ?`,
    )
    .bind(JSON.stringify(resultado), campanhaId, passo)
    .run();
}

/** Incrementa tentativas e liga "procurar antes de gravar". "travado" ao chegar em MAX_TENTATIVAS. */
export async function registrarFalha(campanhaId: string, passo: string, erro: string): Promise<EstadoPasso> {
  const d = await db();
  const atual = await d
    .prepare(`SELECT tentativas FROM presave_lancamento_passos WHERE campanha_id = ? AND passo = ?`)
    .bind(campanhaId, passo)
    .all();
  const tentativas = (Number((atual.results?.[0] as Record<string, unknown> | undefined)?.tentativas) || 0) + 1;
  const estado: EstadoPasso = tentativas >= MAX_TENTATIVAS ? "travado" : "falhou";
  await d
    .prepare(
      `UPDATE presave_lancamento_passos SET estado = ?, tentativas = ?, procurar_antes = 1, ultimo_erro = ?, atualizado_em = datetime('now')
       WHERE campanha_id = ? AND passo = ?`,
    )
    .bind(estado, tentativas, erro.slice(0, 1000), campanhaId, passo)
    .run();
  return estado;
}

function linhaParaLancamento(r: Record<string, unknown>): Lancamento {
  return {
    campanhaId: String(r.campanha_id),
    albumTitulo: String(r.album_titulo),
    albumTopicId: String(r.album_topic_id),
    completo: Number(r.completo) === 1,
  };
}

export async function lancamentosIncompletos(): Promise<Lancamento[]> {
  const d = await db();
  const res = await d
    .prepare(`SELECT * FROM presave_lancamentos WHERE completo = 0 ORDER BY criado_em, campanha_id`)
    .all();
  return ((res.results || []) as Record<string, unknown>[]).map(linhaParaLancamento);
}

export async function obterLancamento(campanhaId: string): Promise<Lancamento | null> {
  const d = await db();
  const res = await d
    .prepare(`SELECT * FROM presave_lancamentos WHERE campanha_id = ?`)
    .bind(campanhaId)
    .all();
  const r = res.results?.[0] as Record<string, unknown> | undefined;
  return r ? linhaParaLancamento(r) : null;
}

/** campanhaId do lançamento ainda incompleto desse álbum, ou null. */
export async function lancamentoEmAndamentoPorAlbum(albumTitulo: string): Promise<string | null> {
  const alvo = normalizeComparison(albumTitulo);
  if (!alvo) return null;
  const achado = (await lancamentosIncompletos()).find((l) => normalizeComparison(l.albumTitulo) === alvo);
  return achado ? achado.campanhaId : null;
}

/** falhou/travado → pendente (tentativas=0, procurar_antes=1) e reabre o lançamento. Devolve quantos passos reabriu. */
export async function reabrirPassos(campanhaId: string): Promise<number> {
  const d = await db();
  const res = await d
    .prepare(
      `UPDATE presave_lancamento_passos SET estado = 'pendente', tentativas = 0, procurar_antes = 1, atualizado_em = datetime('now')
       WHERE campanha_id = ? AND estado IN ('falhou', 'travado')`,
    )
    .bind(campanhaId)
    .run();
  await d.prepare(`UPDATE presave_lancamentos SET completo = 0 WHERE campanha_id = ?`).bind(campanhaId).run();
  return Number((res as { meta?: { changes?: number } }).meta?.changes) || 0;
}

export async function marcarCompleto(campanhaId: string): Promise<void> {
  const d = await db();
  await d.prepare(`UPDATE presave_lancamentos SET completo = 1 WHERE campanha_id = ?`).bind(campanhaId).run();
}
