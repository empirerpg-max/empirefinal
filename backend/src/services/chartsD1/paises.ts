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

export type Posicao = { pos: number; tituloNorm: string; titulo: string; art: string; val: number };

/** Música com a fatia de cada país já calculada (fatiasPorPais uma vez por música/semana). */
export interface MusicaComFatias {
  tituloNorm: string;
  titulo: string;
  art: string;
  valor: number;
  fatias: Map<string, number>;
}

export function comFatias(musicas: MusicaParaPais[], pesos: Pesos, bonus: number): MusicaComFatias[] {
  return musicas.map((m) => ({
    tituloNorm: m.tituloNorm,
    titulo: m.titulo,
    art: m.artistaPrincipal,
    valor: m.valor,
    fatias: fatiasPorPais(pesos, m.nacionalidades, bonus),
  }));
}

/** Top `top` de um país a partir das fatias pré-calculadas. */
export function rankingPaisComFatias(musicas: MusicaComFatias[], pais: string, top: number): Posicao[] {
  // Ordena pelo valor sem arredondar: em país de peso pequeno quase tudo
  // arredonda pro mesmo inteiro e o ranking viraria ordem alfabética.
  return musicas
    .map((m) => ({ tituloNorm: m.tituloNorm, titulo: m.titulo, art: m.art, bruto: m.valor * (m.fatias.get(pais) ?? 0) }))
    .sort((a, b) => b.bruto - a.bruto || (a.tituloNorm < b.tituloNorm ? -1 : a.tituloNorm > b.tituloNorm ? 1 : 0))
    .slice(0, top)
    .map(({ bruto, ...m }, i) => ({ pos: i + 1, ...m, val: Math.round(bruto) }));
}

export function rankingPais(
  musicas: MusicaParaPais[],
  pesos: Pesos,
  pais: string,
  bonus: number,
  top: number,
): Posicao[] {
  return rankingPaisComFatias(comFatias(musicas, pesos, bonus), pais, top);
}

/**
 * Ranking de cada país de `pesos` na semana, com `st` contra o ranking do
 * mesmo país na semana anterior (↑/↓/=/NEW). Fatias calculadas uma vez por
 * música e semana (não por país): O(músicas × países), não países².
 */
export function rankingsDaSemana(
  atual: MusicaParaPais[],
  anterior: MusicaParaPais[],
  pesos: Pesos,
  bonus: number,
  top: number,
): Map<string, (Posicao & { st: "↑" | "↓" | "=" | "NEW" })[]> {
  const fAtual = comFatias(atual, pesos, bonus);
  const fAnterior = comFatias(anterior, pesos, bonus);
  const out = new Map<string, (Posicao & { st: "↑" | "↓" | "=" | "NEW" })[]>();
  for (const pais of pesos.keys()) {
    const antes = new Map(rankingPaisComFatias(fAnterior, pais, top).map((m) => [m.tituloNorm, m.pos]));
    out.set(
      pais,
      rankingPaisComFatias(fAtual, pais, top).map((m) => {
        const a = antes.get(m.tituloNorm);
        return { ...m, st: a === undefined ? "NEW" : m.pos < a ? "↑" : m.pos > a ? "↓" : "=" };
      }),
    );
  }
  return out;
}
