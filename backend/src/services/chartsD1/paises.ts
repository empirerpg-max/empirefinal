// Distribuição de um chart global por país (regra C): cada música leva
// pb[c] + bônus de nacionalidade/foco (sorteio determinístico por semana,
// limitado a bonus_teto) com variação por país; o resto (1 − Σpb) fica fora.
// Usado pelo cálculo da semana inteira (semanaPaises.ts).
import type { RegraPaises } from "./regras";
import { sorteio01 } from "./sorteio";
/** País → fração do chart global (ex.: 0.072 = 7,2%). */
export type Pesos = Map<string, number>;

export type Posicao = { pos: number; tituloNorm: string; titulo: string; art: string; val: number };

/** Música de uma semana, com o foco já resolvido ("GLOBAL" vira null). */
export interface EntradaMusica {
  tituloNorm: string;
  titulo: string;
  artistaPrincipal: string;
  artistas: string[];
  valor: number;
  nacionalidades: Set<string>;
  /** País de foco já resolvido para o nome de pais_peso, ou null. */
  foco: string | null;
}

/**
 * Regra C: w[c] = (pb[c] + min(pb[c] × mult, bonus_teto)) × var[c];
 * resto = max(0, 1 − Σpb); share[c] = w[c] / (Σw + resto).
 * O sorteio não depende da plataforma (mesma música, mesmo "humor" em todas).
 * Nacionalidade e foco nunca somam no mesmo país.
 */
export function fatiasRegraC(
  pesos: Pesos,
  m: Pick<EntradaMusica, "tituloNorm" | "nacionalidades" | "foco">,
  dataIso: string,
  r: RegraPaises,
): Map<string, number> {
  // Ordem fixa dos países: o resultado não depende da ordem de inserção dos pesos.
  const paises = [...pesos.keys()].sort();
  let somaPb = 0;
  let somaW = 0;
  const w = new Map<string, number>();
  for (const pais of paises) {
    const pb = pesos.get(pais)!;
    const chave = (k: string) => `${dataIso}|${m.tituloNorm}|${pais}|${k}`;
    let mult = 0;
    if (m.nacionalidades.has(pais)) mult = r.nac_min + sorteio01(chave("nac")) * (r.nac_max - r.nac_min);
    else if (m.foco !== null && m.foco === pais) mult = r.foco_min + sorteio01(chave("foco")) * (r.foco_max - r.foco_min);
    const bonus = Math.min(pb * mult, r.bonus_teto);
    const variacao = 1 + r.variacao * (2 * sorteio01(chave("var")) - 1);
    const v = (pb + bonus) * variacao;
    w.set(pais, v);
    somaPb += pb;
    somaW += v;
  }
  const divisor = somaW + Math.max(0, 1 - somaPb);
  const shares = new Map<string, number>();
  for (const [pais, v] of w) shares.set(pais, divisor > 0 ? v / divisor : 0);
  return shares;
}

/** valor × fatia de cada país, por música (sem arredondar). */
export function valoresPorPais(
  musicas: EntradaMusica[],
  pesos: Pesos,
  dataIso: string,
  r: RegraPaises,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const m of musicas) {
    const por = new Map<string, number>();
    for (const [pais, share] of fatiasRegraC(pesos, m, dataIso, r)) por.set(pais, m.valor * share);
    out.set(m.tituloNorm, por);
  }
  return out;
}

type PosicaoSt = Posicao & { st: "↑" | "↓" | "=" | "NEW" };

/** Top `top` de um país a partir dos valores brutos já calculados. */
function topDoPais(musicas: EntradaMusica[], valores: Map<string, Map<string, number>>, pais: string, top: number): Posicao[] {
  // Ordena pelo valor sem arredondar (países pequenos arredondariam tudo igual).
  return musicas
    .map((m) => ({ tituloNorm: m.tituloNorm, titulo: m.titulo, art: m.artistaPrincipal, bruto: valores.get(m.tituloNorm)?.get(pais) ?? 0 }))
    .sort((a, b) => b.bruto - a.bruto || (a.tituloNorm < b.tituloNorm ? -1 : a.tituloNorm > b.tituloNorm ? 1 : 0))
    .slice(0, top)
    .map(({ bruto, ...x }, i) => ({ pos: i + 1, ...x, val: Math.round(bruto) }));
}

/**
 * Ranking de cada país de `pesos` (Top `r.top_pais`), com `st` contra o
 * mesmo país na semana anterior (calculada com `dataIsoAnterior`).
 */
export function rankingsPorPais(
  atual: EntradaMusica[],
  anterior: EntradaMusica[],
  pesos: Pesos,
  dataIsoAtual: string,
  dataIsoAnterior: string | null,
  r: RegraPaises,
): Map<string, PosicaoSt[]> {
  const vAtual = valoresPorPais(atual, pesos, dataIsoAtual, r);
  const vAnterior = dataIsoAnterior === null ? new Map<string, Map<string, number>>() : valoresPorPais(anterior, pesos, dataIsoAnterior, r);
  const musicasAnt = dataIsoAnterior === null ? [] : anterior;
  const out = new Map<string, PosicaoSt[]>();
  for (const pais of pesos.keys()) {
    const antes = new Map(topDoPais(musicasAnt, vAnterior, pais, r.top_pais).map((x) => [x.tituloNorm, x.pos]));
    out.set(
      pais,
      topDoPais(atual, vAtual, pais, r.top_pais).map((x) => {
        const a = antes.get(x.tituloNorm);
        return { ...x, st: a === undefined ? "NEW" : x.pos < a ? "↑" : x.pos > a ? "↓" : "=" } as PosicaoSt;
      }),
    );
  }
  return out;
}
