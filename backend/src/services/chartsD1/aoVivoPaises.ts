// Ranking "ao vivo" por país (regra C aplicada aos streams do dia). Função
// pura: sem Math.random nem relógio — o sorteio vem de `dataIso` (mesma
// fatia durante a semana, não depende da plataforma).
import type { D1DatabaseLike } from "../catalogoDbService";
import { regrasDeConfig, type RegraPaises } from "./regras";
import { buscarNoCatalogo, chaveMusica, extrairArtistasDoTitulo, semAcentoMaiusculo, type MusicaCatalogo } from "./artistas";
import { carregarFocos, focoVigente, type HistoricoFoco } from "./foco";
import { consultar } from "./repo";
import { agruparPesos, criarResolvedorPais, paisesDePesos } from "./semanaPaises";
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

// ───────────── Carregador (D1 + EM Alta) ─────────────

export type PlataformaAoVivo = "spotify" | "apple" | "youtube";

/** Item cru do EM Alta: título, streams do dia e capa. */
export interface ItemEmAlta {
  t: string;
  n: number;
  c: string;
}

/** Nome da plataforma em `pais_peso`. */
const PLATAFORMA_PESO: Record<PlataformaAoVivo, string> = { spotify: "SPOTIFY", apple: "APPLE MUSIC", youtube: "YOUTUBE" };
const PLATAFORMAS_AO_VIVO = Object.keys(PLATAFORMA_PESO) as PlataformaAoVivo[];
const GLOBAL_100 = "BILLBOARD HOT 100";
// 15 min: referências mudam pouco (pesos, nacionalidades, focos, config) e são lidas a cada recálculo do ao vivo.
const TTL_REFERENCIAS_MS = 15 * 60 * 1000;

/** ISO (YYYY-MM-DD) + 7 dias, em UTC: a data do próximo chart. */
export function proximaDataChart(ultimaIso: string): string {
  const d = new Date(`${ultimaIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

interface Referencias {
  proximaData: string | null;
  pesosPor: Map<string, Map<string, number>>;
  /** nome (sem acento/caixa) → país já resolvido para pais_peso; "" quando sem nacionalidade. */
  artistasInfo: Map<string, string>;
  focos: HistoricoFoco;
  regras: RegraPaises;
  resolverPais: (nome: string) => string;
}

// Cache de módulo: Date.now só decide a expiração, nunca entra no cálculo.
let cacheReferencias: { em: number; refs: Promise<Referencias> } | null = null;

export function limparCacheAoVivoPaises(): void {
  cacheReferencias = null;
}

async function carregarReferencias(db: D1DatabaseLike): Promise<Referencias> {
  const [datas, pesosRows, artistasRows, focos, cfgRows] = await Promise.all([
    consultar<{ data: string | null }>(db, "SELECT MAX(data) AS data FROM chart_datas WHERE chart = ?", GLOBAL_100),
    consultar<{ plataforma: string; pais: string; peso: number }>(db, "SELECT plataforma, pais, peso FROM pais_peso"),
    consultar<{ nome_upper: string; nacionalidade: string | null }>(db, "SELECT nome_upper, nacionalidade FROM artista_info"),
    carregarFocos(db),
    consultar<{ chave: string; valor: string }>(db, "SELECT chave, valor FROM chart_config"),
  ]);
  const ultima = datas[0]?.data ?? null;
  const pesosPor = agruparPesos(pesosRows);
  const resolverPais = criarResolvedorPais(paisesDePesos(pesosPor));
  const artistasInfo = new Map(
    artistasRows.map((a) => [semAcentoMaiusculo(a.nome_upper), a.nacionalidade ? resolverPais(a.nacionalidade) : ""]),
  );
  return {
    proximaData: ultima ? proximaDataChart(ultima) : null,
    pesosPor,
    artistasInfo,
    focos,
    regras: regrasDeConfig(new Map(cfgRows.map((r) => [r.chave, r.valor]))).paises,
    resolverPais,
  };
}

// Promessa em cache: chamadas simultâneas dividem a mesma carga; se falhar, descarta.
function referencias(db: D1DatabaseLike): Promise<Referencias> {
  if (cacheReferencias && Date.now() - cacheReferencias.em < TTL_REFERENCIAS_MS) return cacheReferencias.refs;
  const refs = carregarReferencias(db);
  const entrada = { em: Date.now(), refs };
  refs.catch(() => {
    if (cacheReferencias === entrada) cacheReferencias = null;
  });
  cacheReferencias = entrada;
  return refs;
}

/**
 * Ranking ao vivo por país das 3 plataformas do EM Alta. Sem chart ou sem pesos
 * da plataforma → lista vazia dela; erro de D1 → tudo vazio (com aviso).
 * O sorteio usa a data do PRÓXIMO chart (nunca o relógio): estável na semana.
 */
export async function calcularAoVivoPaises(
  db: D1DatabaseLike,
  emAlta: Record<PlataformaAoVivo, ItemEmAlta[]>,
  cat: Map<string, MusicaCatalogo>,
): Promise<Record<PlataformaAoVivo, LinhaAoVivoPais[]>> {
  const saida: Record<PlataformaAoVivo, LinhaAoVivoPais[]> = { spotify: [], apple: [], youtube: [] };
  try {
    const ref = await referencias(db);
    if (!ref.proximaData) return saida;
    const proximaData = ref.proximaData;
    for (const plat of PLATAFORMAS_AO_VIVO) {
      const pesos = ref.pesosPor.get(PLATAFORMA_PESO[plat]);
      if (!pesos?.size || !emAlta[plat]?.length) continue;
      const itens: ItemAoVivo[] = emAlta[plat].map((i) => {
        const achada = buscarNoCatalogo(i.t, cat);
        // Sem catálogo: artistas do título, só os conhecidos em artista_info.
        const artistas = achada
          ? achada.artistas
          : extrairArtistasDoTitulo(i.t).filter((a) => ref.artistasInfo.has(semAcentoMaiusculo(a)));
        const nacionalidades = new Set<string>();
        for (const a of artistas) {
          const n = ref.artistasInfo.get(semAcentoMaiusculo(a));
          if (n) nacionalidades.add(n);
        }
        const f = focoVigente(ref.focos, achada?.codigoUnico || undefined, proximaData);
        return { t: i.t, n: i.n, c: i.c, artistas, nacionalidades, foco: f === null ? null : ref.resolverPais(f) };
      });
      saida[plat] = rankingAoVivoPorPais(itens, pesos, proximaData, ref.regras);
    }
    return saida;
  } catch (e) {
    console.warn("[charts-d1] falha ao calcular ao vivo por país; seguindo sem ele:", e);
    return { spotify: [], apple: [], youtube: [] };
  }
}
