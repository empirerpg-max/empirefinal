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
  // Junta itens da mesma música (mesma chaveMusica, identidade de titulo_norm):
  // soma os streams (inválido = 0), mantém o primeiro título/capa/foco não nulo
  // e une artistas e nacionalidades.
  const porChave = new Map<string, ItemAoVivo>();
  for (const i of itens) {
    const chave = chaveMusica(i.t);
    const n = Number.isFinite(i.n) ? i.n : 0;
    const ex = porChave.get(chave);
    if (!ex) {
      porChave.set(chave, { ...i, n, artistas: [...new Set(i.artistas)], nacionalidades: new Set(i.nacionalidades) });
      continue;
    }
    ex.n += n;
    for (const a of i.artistas) if (!ex.artistas.includes(a)) ex.artistas.push(a);
    for (const nac of i.nacionalidades) ex.nacionalidades.add(nac);
    if (ex.foco === null) ex.foco = i.foco;
  }
  const musicas: EntradaMusica[] = [];
  const capaPorChave = new Map<string, string>();
  for (const [chave, i] of porChave) {
    capaPorChave.set(chave, i.c);
    musicas.push({
      // Mesma identidade usada em titulo_norm do chart_semana.
      tituloNorm: chave,
      titulo: i.t,
      artistaPrincipal: artistaDe(i),
      artistas: i.artistas,
      valor: i.n,
      nacionalidades: i.nacionalidades,
      foco: i.foco,
    });
  }
  const valores = valoresPorPais(musicas, pesos, dataIso, r);
  // Países por peso desc, empate por nome.
  const porNome = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const paises = [...pesos.entries()]
    .sort((a, b) => b[1] - a[1] || porNome(a[0], b[0]))
    .map(([p]) => p);
  const out: LinhaAoVivoPais[] = [];
  for (const pais of paises) {
    musicas
      .map((m) => ({ m, bruto: valores.get(m.tituloNorm)?.get(pais) ?? 0 }))
      .sort((a, b) => b.bruto - a.bruto || porNome(a.m.tituloNorm, b.m.tituloNorm))
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
