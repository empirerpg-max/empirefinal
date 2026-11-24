// Ranking "ao vivo" por país (regra C aplicada aos streams do dia). Função
// pura: sem Math.random nem relógio — o sorteio vem de `dataIso` (mesma
// fatia durante a semana, não depende da plataforma).
import type { RegraPaises } from "./regras";
import { chaveMusica } from "./artistas";
import { valoresPorPais, type EntradaMusica, type Pesos } from "./paises";

export interface ItemAoVivo {
  t: string;
  /** Streams ao vivo. */
  n: number;
  /** Capa. */
  c: string;
  artistas: string[];
  nacionalidades: Set<string>;
  foco: string | null;
}

export interface LinhaAoVivoPais {
  pais: string;
  pos: number;
  t: string;
  /** Valor formatado pt-BR. */
  s: string;
  c: string;
  art: string;
}

/** Artista principal: primeiro da lista ou a parte antes de " - " no título. */
function artistaDe(i: ItemAoVivo): string {
  return i.artistas[0] ?? i.t.split(" - ")[0] ?? "";
}

export function rankingAoVivoPorPais(
  itens: ItemAoVivo[],
  pesos: Pesos,
  dataIso: string,
  r: RegraPaises,
): LinhaAoVivoPais[] {
  const musicas: EntradaMusica[] = itens.map((i) => ({
    // Mesma identidade usada em titulo_norm do chart_semana.
    tituloNorm: chaveMusica(i.t),
    titulo: i.t,
    artistaPrincipal: artistaDe(i),
    artistas: i.artistas,
    valor: Number.isFinite(i.n) ? i.n : 0,
    nacionalidades: i.nacionalidades,
    foco: i.foco,
  }));
  const valores = valoresPorPais(musicas, pesos, dataIso, r);
  // Países por peso desc, empate por nome.
  const paises = [...pesos.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([p]) => p);
  const capaPorChave = new Map<string, string>();
  for (const i of itens) if (!capaPorChave.has(chaveMusica(i.t))) capaPorChave.set(chaveMusica(i.t), i.c);
  const out: LinhaAoVivoPais[] = [];
  for (const pais of paises) {
    musicas
      .map((m) => ({ m, bruto: valores.get(m.tituloNorm)?.get(pais) ?? 0 }))
      .sort((a, b) => b.bruto - a.bruto || (a.m.tituloNorm < b.m.tituloNorm ? -1 : a.m.tituloNorm > b.m.tituloNorm ? 1 : 0))
      .slice(0, r.top_pais)
      .forEach(({ m, bruto }, idx) => {
        out.push({
          pais,
          pos: idx + 1,
          t: m.titulo,
          s: Math.round(bruto).toLocaleString("pt-BR"),
          c: capaPorChave.get(m.tituloNorm) ?? "",
          art: m.artistaPrincipal,
        });
      });
  }
  return out;
}
