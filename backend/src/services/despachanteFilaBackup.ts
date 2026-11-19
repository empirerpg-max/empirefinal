// Despachante da fila de backup D1 -> planilha real (catálogo "D1 primeiro",
// spec docs/superpowers/specs/2026-11-18-catalogo-d1-primeiro-design.md §3).
//
// Roda no cron de 10 min (src/server.ts) e pela rota admin
// POST /api/admin/fila-backup/despachar. Grava os itens EM ORDEM, por aba:
// updates/appends seguidos viram um values:batchUpdate só (append já guarda
// o intervalo exato da linha gravada no D1 — nunca "primeira linha livre");
// delete/clear são enviados sozinhos, na posição em que estão.
//
// Limite do Google (cota) -> para tudo e tenta no próximo ciclo, sem perder
// nada. Erro permanente numa aba -> registra no item e no log do sistema,
// para só aquela aba e segue com as outras.
import { getCatalogoDb } from "./catalogoDbService";
import { deleteRowsDireto, googleDireto, type GoogleSheetMatrix } from "./googleSheetsService";
import { registrarLogSistema } from "./logSistemaService";
import { parseA1 } from "./planilhaVirtualD1";
import { garantirTabelas } from "./porteiroD1";

interface ItemFila {
  id: number;
  planilha: string;
  aba: string;
  operacao: "update" | "append" | "delete" | "clear";
  intervalo: string | null;
  valores_json: string | null;
}

export interface ResultadoDespacho {
  /** true = outra execução estava em andamento; esta não fez nada. */
  ocupado?: boolean;
  gravados: number;
  pendentes: number;
  parouPorLimite: boolean;
  erros: { id: number; erro: string }[];
}

const ehLimite = (msg: string) => /quota exceeded|rate limit|429|resource_exhausted|requests per minute/i.test(msg);

function db() {
  const d = getCatalogoDb();
  if (!d) throw new Error("Banco do catálogo (D1) indisponível.");
  return d;
}

async function apagarItens(ids: number[]): Promise<void> {
  if (!ids.length) return;
  await db().batch(ids.map((id) => db().prepare("DELETE FROM fila_backup_planilha WHERE id = ?").bind(id)));
}

async function marcarErro(ids: number[], erro: string): Promise<void> {
  if (!ids.length) return;
  await db().batch(
    ids.map((id) =>
      db().prepare("UPDATE fila_backup_planilha SET tentativas = tentativas + 1, ultimo_erro = ? WHERE id = ?").bind(erro.slice(0, 1000), id),
    ),
  );
}

const aparar = (r: unknown[] | undefined) => {
  const c = (r || []).map((v) => (v == null ? "" : String(v)));
  while (c.length && c[c.length - 1] === "") c.pop();
  return c;
};

/**
 * Apaga na planilha real só as linhas que ainda estão iguais à foto tirada
 * no D1 — reenviar o mesmo item (falha depois de apagar, execução repetida)
 * nunca apaga a linha errada (revisão I4).
 */
async function apagarLinhasConferidas(item: ItemFila): Promise<void> {
  const fotos = JSON.parse(item.valores_json || "[]") as ({ linha: number; celulas: string[] } | number)[];
  const reais = await googleDireto.readValuesFresh(item.planilha, item.aba);
  const linhas = fotos
    .filter((f) => typeof f === "number" || JSON.stringify(aparar(reais[f.linha - 1])) === JSON.stringify(aparar(f.celulas)))
    .map((f) => (typeof f === "number" ? f : f.linha));
  if (linhas.length) await deleteRowsDireto(item.planilha, item.aba, linhas);
}

async function enviarGrupo(grupo: ItemFila[]): Promise<void> {
  const primeiro = grupo[0];
  if (primeiro.operacao === "delete") {
    await apagarLinhasConferidas(primeiro);
  } else if (primeiro.operacao === "clear") {
    await googleDireto.limparLancando(primeiro.planilha, primeiro.aba, primeiro.intervalo || "A:ZZ");
  } else {
    await googleDireto.loteLancando(
      primeiro.planilha,
      grupo.map((i) => ({
        sheetName: i.aba,
        range: i.intervalo || "A1",
        values: JSON.parse(i.valores_json || "[]") as GoogleSheetMatrix,
      })),
    );
  }
}

/** Agrupa itens consecutivos de update/append; delete/clear ficam sozinhos. */
function agrupar(itens: ItemFila[]): ItemFila[][] {
  const grupos: ItemFila[][] = [];
  for (const item of itens) {
    const ultimo = grupos[grupos.length - 1];
    const juntavel = item.operacao === "update" || item.operacao === "append";
    if (juntavel && ultimo && (ultimo[0].operacao === "update" || ultimo[0].operacao === "append")) ultimo.push(item);
    else grupos.push([item]);
  }
  return grupos;
}

const TRAVA_MS = 5 * 60 * 1000;

/** Uma execução por vez (cron x botão do admin). Devolve o "dono" da trava ou null. */
async function pegarTrava(): Promise<number | null> {
  const agora = Date.now();
  const dono = agora + TRAVA_MS + Math.floor(Math.random() * 1000);
  await db()
    .prepare(
      `INSERT INTO despachante_lock (id, ate_ms) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET ate_ms = excluded.ate_ms WHERE despachante_lock.ate_ms < ?`,
    )
    .bind(dono, agora)
    .run();
  const r = await db().prepare("SELECT ate_ms FROM despachante_lock WHERE id = 1").all<{ ate_ms: number }>();
  return r.results?.[0]?.ate_ms === dono ? dono : null;
}

async function soltarTrava(dono: number): Promise<void> {
  await db().prepare("UPDATE despachante_lock SET ate_ms = 0 WHERE id = 1 AND ate_ms = ?").bind(dono).run();
}

/** Garante que a aba existe na planilha real e tem linhas suficientes para os itens (revisão I3). */
async function prepararAba(lista: ItemFila[]): Promise<void> {
  const { planilha, aba } = lista[0];
  await googleDireto.ensureSheetTab(planilha, aba);
  let maior = 0;
  for (const i of lista) {
    if ((i.operacao === "update" || i.operacao === "append") && i.intervalo) {
      const { r1 } = parseA1(i.intervalo);
      const linhas = (JSON.parse(i.valores_json || "[]") as unknown[]).length || 1;
      maior = Math.max(maior, r1 + linhas - 1);
    }
  }
  if (maior > 0) await googleDireto.ensureRowCapacity(planilha, aba, maior);
}

export async function despacharFila(opts: { maxItens?: number } = {}): Promise<ResultadoDespacho> {
  await garantirTabelas();
  const dono = await pegarTrava();
  if (dono === null) return { ocupado: true, gravados: 0, pendentes: 0, parouPorLimite: false, erros: [] };
  try {
    return await despacharComTrava(opts);
  } finally {
    await soltarTrava(dono);
  }
}

async function despacharComTrava(opts: { maxItens?: number }): Promise<ResultadoDespacho> {
  const maxItens = opts.maxItens ?? 200;
  const itens = ((await db().prepare("SELECT id, planilha, aba, operacao, intervalo, valores_json FROM fila_backup_planilha ORDER BY id LIMIT ?").bind(maxItens).all<ItemFila>()).results || []);
  const porAba = new Map<string, ItemFila[]>();
  for (const i of itens) {
    const k = `${i.planilha}::${i.aba}`;
    if (!porAba.has(k)) porAba.set(k, []);
    porAba.get(k)!.push(i);
  }

  const resultado: ResultadoDespacho = { gravados: 0, pendentes: 0, parouPorLimite: false, erros: [] };
  abas: for (const lista of porAba.values()) {
    try {
      await prepararAba(lista);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await marcarErro([lista[0].id], msg);
      if (ehLimite(msg)) {
        resultado.parouPorLimite = true;
        break abas;
      }
      resultado.erros.push({ id: lista[0].id, erro: msg });
      continue abas;
    }
    for (const grupo of agrupar(lista)) {
      const ids = grupo.map((i) => i.id);
      try {
        await enviarGrupo(grupo);
        await apagarItens(ids);
        resultado.gravados += ids.length;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await marcarErro(ids, msg);
        if (ehLimite(msg)) {
          resultado.parouPorLimite = true;
          break abas;
        }
        resultado.erros.push({ id: ids[0], erro: msg });
        await registrarLogSistema({
          categoria: "Erro do app",
          oQueAconteceu: `Não consegui copiar para a planilha (backup) a alteração #${ids[0]} da aba "${grupo[0].aba}": ${msg}. O app continua funcionando pelo D1; a cópia fica na fila.`,
          onde: "despacharFila",
        }).catch(() => {});
        continue abas;
      }
    }
  }
  const restante = await db().prepare("SELECT count(*) AS n FROM fila_backup_planilha").all<{ n: number }>();
  resultado.pendentes = restante.results?.[0]?.n ?? 0;
  return resultado;
}

export async function statusFila(): Promise<{ aba: string; pendentes: number; maisAntigo: string | null }[]> {
  await garantirTabelas();
  const r = await db()
    .prepare("SELECT aba, count(*) AS pendentes, min(criado_em) AS maisAntigo FROM fila_backup_planilha GROUP BY aba ORDER BY aba")
    .all<{ aba: string; pendentes: number; maisAntigo: string | null }>();
  return r.results || [];
}
