// Busca rápida do cabeçalho (2026-11-14) — parte pura: filtra o índice
// compacto (ver buscaController.ts) e agrupa por tipo.
// Spec: docs/superpowers/specs/2026-11-14-busca-rapida-design.md
import { normalizeComparison } from "./googleSheetsService";

export type GrupoBusca = "musicas" | "videos" | "albuns" | "artistas";
export const ORDEM_GRUPOS: GrupoBusca[] = ["musicas", "videos", "albuns", "artistas"];

export interface ItemBusca {
  grupo: GrupoBusca;
  id: string;
  titulo: string;
  subtitulo: string;
  capa?: string;
  link: string;
  dataIso?: string;
  /** Normalizado: título + artistas, separados por " | ". */
  termos: string;
}
export type ItemResultado = Omit<ItemBusca, "termos">;
export interface GrupoResultado {
  grupo: GrupoBusca;
  total: number;
  itens: ItemResultado[];
}

export const TERMO_MINIMO = 2;

export function termosDeBusca(...partes: (string | undefined)[]): string {
  return partes
    .filter((p): p is string => !!p && !!p.trim())
    .map((p) => normalizeComparison(p))
    .join(" | ");
}

export function buscarNoIndice(
  indice: ItemBusca[],
  q: string,
  opcoes: { limitePorGrupo?: number; grupo?: GrupoBusca } = {},
): { grupos: GrupoResultado[] } {
  const termo = normalizeComparison(q || "");
  if (termo.length < TERMO_MINIMO) return { grupos: [] };
  const limite = opcoes.limitePorGrupo ?? 5;
  const comecaCom = (i: ItemBusca) =>
    normalizeComparison(i.titulo).startsWith(termo) || i.termos.split(" | ").some((t) => t.startsWith(termo));
  const grupos: GrupoResultado[] = [];
  for (const grupo of ORDEM_GRUPOS) {
    if (opcoes.grupo && opcoes.grupo !== grupo) continue;
    const achados = indice
      .filter((i) => i.grupo === grupo && i.termos.includes(termo))
      .map((i) => ({ i, comeca: comecaCom(i) }))
      .sort((a, b) => {
        if (a.comeca !== b.comeca) return a.comeca ? -1 : 1;
        const da = a.i.dataIso || "";
        const db = b.i.dataIso || "";
        if (!da !== !db) return da ? -1 : 1;
        return db.localeCompare(da);
      });
    if (!achados.length) continue;
    grupos.push({
      grupo,
      total: achados.length,
      itens: achados.slice(0, limite).map(({ i }) => {
        const { termos: _t, ...resto } = i;
        return resto;
      }),
    });
  }
  return { grupos };
}
