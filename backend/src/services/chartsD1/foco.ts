// Histórico de "foco" (país-alvo) do lançamento de cada música.
import type { D1DatabaseLike } from "../catalogoDbService";

export const FOCO_SCHEMA: string[] = [
  "CREATE TABLE IF NOT EXISTS musica_foco (codigo_unico TEXT NOT NULL, pais TEXT NOT NULL, desde TEXT NOT NULL, por_admin INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (codigo_unico, desde))",
];

/** codigo_unico → focos ordenados por `desde` ascendente. */
export type HistoricoFoco = Map<string, { pais: string; desde: string }[]>;

export function indexarFocos(rows: { codigo_unico: string; pais: string; desde: string }[]): HistoricoFoco {
  const h: HistoricoFoco = new Map();
  for (const r of rows) {
    const lista = h.get(r.codigo_unico) ?? [];
    lista.push({ pais: r.pais, desde: r.desde });
    h.set(r.codigo_unico, lista);
  }
  for (const lista of h.values()) lista.sort((a, b) => (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0));
  return h;
}

/**
 * Foco vigente na semana `dataIso`: a linha de maior `desde` estritamente
 * anterior a `dataIso` (mudança só vale para semanas seguintes). "GLOBAL" = sem foco.
 */
export function focoVigente(h: HistoricoFoco, codigoUnico: string | undefined, dataIso: string): string | null {
  if (!codigoUnico) return null;
  const lista = h.get(codigoUnico);
  if (!lista) return null;
  let pais: string | null = null;
  for (const f of lista) {
    if (f.desde < dataIso) pais = f.pais;
    else break;
  }
  return pais === null || pais === "GLOBAL" ? null : pais;
}

export async function carregarFocos(db: D1DatabaseLike): Promise<HistoricoFoco> {
  try {
    const r = await db.prepare("SELECT codigo_unico, pais, desde FROM musica_foco").all<{ codigo_unico: string; pais: string; desde: string }>();
    return indexarFocos(r.results);
  } catch (e) {
    // Tabela ainda não existe → sem focos (esperado); outras falhas ficam no log.
    if (!/no such table/i.test(e instanceof Error ? e.message : String(e))) {
      console.warn("[charts-d1] falha ao ler musica_foco; seguindo sem focos:", e);
    }
    return new Map();
  }
}
