// Distribuição de um chart global por país (regra B).
/** País → fração do chart global (ex.: 0.072 = 7,2%). */
export type Pesos = Map<string, number>;

/**
 * Regra B: w[c] = pb[c] + (c ∈ nacionalidades ? bonus : 0);
 * resto = max(0, 1 − Σpb); share[c] = w[c] / (Σw + resto).
 * Só considera os países presentes em `pesos`.
 */
export function fatiasPorPais(pesos: Pesos, nacionalidades: Set<string>, bonus: number): Map<string, number> {
  let somaPb = 0;
  let somaW = 0;
  const w = new Map<string, number>();
  for (const [pais, pb] of pesos) {
    const v = pb + (nacionalidades.has(pais) ? bonus : 0);
    w.set(pais, v);
    somaPb += pb;
    somaW += v;
  }
  const resto = Math.max(0, 1 - somaPb);
  const divisor = somaW + resto;
  const shares = new Map<string, number>();
  for (const [pais, v] of w) shares.set(pais, divisor > 0 ? v / divisor : 0);
  return shares;
}

export interface MusicaParaPais {
  tituloNorm: string;
  titulo: string;
  artistaPrincipal: string;
  valor: number;
  nacionalidades: Set<string>;
}

export function rankingPais(
  musicas: MusicaParaPais[],
  pesos: Pesos,
  pais: string,
  bonus: number,
  top: number,
): { pos: number; tituloNorm: string; titulo: string; art: string; val: number }[] {
  return musicas
    .map((m) => ({
      tituloNorm: m.tituloNorm,
      titulo: m.titulo,
      art: m.artistaPrincipal,
      val: Math.round(m.valor * (fatiasPorPais(pesos, m.nacionalidades, bonus).get(pais) ?? 0)),
    }))
    .sort((a, b) => b.val - a.val || (a.tituloNorm < b.tituloNorm ? -1 : a.tituloNorm > b.tituloNorm ? 1 : 0))
    .slice(0, top)
    .map((m, i) => ({ pos: i + 1, ...m }));
}
