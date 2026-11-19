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

interface ItemFila {
  id: number;
  planilha: string;
  aba: string;
  operacao: "update" | "append" | "delete" | "clear";
  intervalo: string | null;
  valores_json: string | null;
}

export interface ResultadoDespacho {
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

async function enviarGrupo(grupo: ItemFila[]): Promise<void> {
  const primeiro = grupo[0];
  if (primeiro.operacao === "delete") {
    const linhas = JSON.parse(primeiro.valores_json || "[]") as number[];
    await deleteRowsDireto(primeiro.planilha, primeiro.aba, linhas);
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

export async function despacharFila(opts: { maxItens?: number } = {}): Promise<ResultadoDespacho> {
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
  const r = await db()
    .prepare("SELECT aba, count(*) AS pendentes, min(criado_em) AS maisAntigo FROM fila_backup_planilha GROUP BY aba ORDER BY aba")
    .all<{ aba: string; pendentes: number; maisAntigo: string | null }>();
  return r.results || [];
}
