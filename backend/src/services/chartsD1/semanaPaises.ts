// Cálculo da semana inteira por país: camada 1 (regra C, recortes COUNTRIES)
// das 4 plataformas e camada 2 (paradas oficiais), com a semana anterior para `st`.
// Seções 7–11 do spec 2026-11-24-charts-paradas-nacionais-foco-design.
import type { D1DatabaseLike } from "../catalogoDbService";
import { dataBrParaIso } from "./dados";
import { buscarNoCatalogo, semAcentoMaiusculo, type MusicaCatalogo } from "./artistas";
import { carregarFocos, focoVigente, type HistoricoFoco } from "./foco";
import { fmt } from "./formato";
import { rankingsPorPais, valoresPorPais, type EntradaMusica, type Pesos } from "./paises";
import { mapaPaisPorNome, paradasDaSemana, type MusicaSemana, type Plataforma } from "./paradas";
import { REGRAS_PADRAO, parseRegrasSemana, type RegrasSemana } from "./regras";
import { artistaPrincipal, capaDe, consultar, lerArtistas, type LinhaPaisApi } from "./repo";

/** Rótulo do recorte das paradas oficiais na tela. */
export const ROTULO_PARADAS = "PARADAS OFICIAIS";

/** Plataformas com recorte COUNTRIES (Digital Sales entra nas paradas, mas não tem recorte próprio). */
export type PlataformaCountries = "SPOTIFY" | "APPLE MUSIC" | "YOUTUBE";

export interface SemanaPaises {
  countries: Map<PlataformaCountries, LinhaPaisApi[]>;
  /** `pais` = nome da parada; `ordem` e `desc` vêm da parada. */
  paradas: LinhaPaisApi[];
}

const GLOBAL_100 = "BILLBOARD HOT 100";
const PLATAFORMAS: Plataforma[] = ["SPOTIFY", "APPLE MUSIC", "YOUTUBE", "DIGITAL SALES"];
const PLATAFORMAS_COUNTRIES: PlataformaCountries[] = ["SPOTIFY", "APPLE MUSIC", "YOUTUBE"];
/** Base do ACR (streams globais): Digital Sales não conta. */
const PLATAFORMAS_STREAMS: Plataforma[] = ["SPOTIFY", "APPLE MUSIC", "YOUTUBE"];
/** Ordem de preferência para título/artista da música na junção das plataformas. */
const PREFERENCIA_TITULO = [GLOBAL_100, ...PLATAFORMAS];
/**
 * Semanas lidas: d e as 4 anteriores do Global 100. d-1 é a base do `st`, e as
 * paradas de d-1 precisam do próprio ACR (d-2..d-4) para reproduzir o que a
 * semana d-1 mostrou.
 */
const SEMANAS_ANTERIORES = 4;

interface LinhaSemana {
  chart: string;
  data: string;
  titulo: string | null;
  titulo_norm: string;
  valor: number | null;
  artistas: string | null;
  semanas: number | null;
}

/** Música de um chart numa semana (primeira ocorrência do titulo_norm). */
interface Ocorrencia {
  titulo: string;
  artistas: string[];
  art: string;
  valor: number;
  semanas: number;
}

type ChartsDaSemana = Map<string, Map<string, Ocorrencia>>;

/** Agrupa as linhas por data → chart → titulo_norm, mantendo a primeira (melhor posição). */
function agrupar(rows: LinhaSemana[]): Map<string, ChartsDaSemana> {
  const out = new Map<string, ChartsDaSemana>();
  for (const r of rows) {
    if (!r.titulo_norm) continue;
    const porChart = out.get(r.data) ?? out.set(r.data, new Map()).get(r.data)!;
    const porTitulo = porChart.get(r.chart) ?? porChart.set(r.chart, new Map()).get(r.chart)!;
    if (porTitulo.has(r.titulo_norm)) continue;
    const titulo = r.titulo || "";
    const artistas = lerArtistas(r.artistas);
    const valor = Number(r.valor);
    const semanas = Number(r.semanas);
    porTitulo.set(r.titulo_norm, {
      titulo,
      artistas,
      art: artistaPrincipal(artistas, titulo),
      valor: Number.isFinite(valor) ? valor : 0,
      semanas: Number.isFinite(semanas) ? semanas : 0,
    });
  }
  return out;
}

/** Regras gravadas da semana; sem linha (ou inválida) → REGRAS_PADRAO (nunca o chart_config atual). */
function regrasDa(gravadas: Map<string, string>, dataIso: string | undefined): RegrasSemana {
  return (dataIso && parseRegrasSemana(gravadas.get(dataIso))) || REGRAS_PADRAO;
}

/**
 * Calcula a semana `dataBr` inteira: COUNTRIES (Spotify, Apple Music, YouTube)
 * e todas as paradas oficiais. Determinístico: mesma semana, mesmo resultado
 * (sorteio por hash + regras gravadas da semana).
 */
export async function calcularSemanaPaises(
  db: D1DatabaseLike,
  dataBr: string,
  cat: Map<string, MusicaCatalogo>,
  fotos: Map<string, string>,
): Promise<SemanaPaises> {
  const vazio = (): SemanaPaises => ({ countries: new Map(PLATAFORMAS_COUNTRIES.map((p) => [p, []])), paradas: [] });
  const dataIso = dataBrParaIso(dataBr);

  // 1. Semana d + anteriores do Global 100 (chart_datas: lido pela PK, sem varrer chart_semana).
  const anteriores = await consultar<{ data: string }>(
    db,
    "SELECT data FROM chart_datas WHERE chart = ? AND data < ? ORDER BY data DESC LIMIT ?",
    GLOBAL_100,
    dataIso,
    SEMANAS_ANTERIORES,
  );
  const datas = [dataIso, ...anteriores.map((r) => r.data)];

  // 2. Uma consulta para todas as semanas (chart IN + data IN usam o prefixo da PK).
  const charts = [GLOBAL_100, ...PLATAFORMAS];
  const marcas = (n: number) => Array(n).fill("?").join(", ");
  // 3. Em paralelo: pesos, nacionalidades, focos e regras gravadas de d e d-1.
  const [rows, pesosRows, nacRows, focos, regrasRows] = await Promise.all([
    consultar<LinhaSemana>(
      db,
      `SELECT chart, data, titulo, titulo_norm, valor, artistas, semanas FROM chart_semana
       WHERE chart IN (${marcas(charts.length)}) AND data IN (${marcas(datas.length)}) ORDER BY chart, data, pos`,
      ...charts,
      ...datas,
    ),
    consultar<{ plataforma: string; pais: string; peso: number }>(db, "SELECT plataforma, pais, peso FROM pais_peso"),
    consultar<{ nome_upper: string; nacionalidade: string }>(
      db,
      "SELECT nome_upper, nacionalidade FROM artista_info WHERE nacionalidade IS NOT NULL AND nacionalidade != ''",
    ),
    carregarFocos(db),
    consultar<{ data: string; regras: string }>(
      db,
      `SELECT data, regras FROM chart_regras_semana WHERE data IN (${marcas(Math.min(2, datas.length))})`,
      ...datas.slice(0, 2),
    ),
  ]);
  const porData = agrupar(rows);
  const semanaAtual = porData.get(dataIso);
  if (!semanaAtual || !PLATAFORMAS.some((p) => semanaAtual.get(p)?.size)) return vazio();

  // Pesos por plataforma; Digital Sales usa os próprios se houver, senão os do Apple Music.
  const pesosPor = new Map<string, Pesos>();
  for (const p of pesosRows) {
    const plat = String(p.plataforma ?? "").trim().toUpperCase();
    const pais = String(p.pais ?? "").trim().toUpperCase();
    const peso = Number(p.peso);
    if (!plat || !pais || !Number.isFinite(peso)) continue;
    (pesosPor.get(plat) ?? pesosPor.set(plat, new Map()).get(plat)!).set(pais, peso);
  }
  const pesosDe = (p: Plataforma): Pesos =>
    pesosPor.get(p) ?? (p === "DIGITAL SALES" ? pesosPor.get("APPLE MUSIC") : undefined) ?? new Map();
  const paisesExistentes = new Set<string>();
  for (const pesos of pesosPor.values()) for (const pais of pesos.keys()) paisesExistentes.add(pais);
  if (!paisesExistentes.size) return vazio();

  // Nacionalidade e foco casam com o país de pais_peso sem diferenciar acento ("Australia" = "AUSTRÁLIA").
  const paisDePesos = mapaPaisPorNome(paisesExistentes);
  const resolverPais = (nome: string) => {
    const k = semAcentoMaiusculo(nome);
    return paisDePesos.get(k) ?? k;
  };
  const nacionalidade = new Map(nacRows.map((n) => [semAcentoMaiusculo(n.nome_upper), resolverPais(n.nacionalidade)]));

  const regrasRegistradas = new Map(regrasRows.map((r) => [r.data, r.regras]));
  const regras = regrasDa(regrasRegistradas, datas[0]);
  const regrasAnt = regrasDa(regrasRegistradas, datas[1]);

  // Foco resolvido uma vez por título (o mesmo título aparece em várias plataformas).
  const codigos = new Map<string, string | undefined>();
  const codigoDe = (titulo: string) => {
    if (!codigos.has(titulo)) codigos.set(titulo, buscarNoCatalogo(titulo, cat)?.codigoUnico || undefined);
    return codigos.get(titulo);
  };
  const focoDe = (h: HistoricoFoco, titulo: string, data: string): string | null => {
    const f = focoVigente(h, codigoDe(titulo), data);
    return f === null ? null : resolverPais(f);
  };

  /** Músicas de uma plataforma na semana, prontas para a regra C. */
  const entradas = (semana: ChartsDaSemana | undefined, plat: Plataforma, data: string): EntradaMusica[] =>
    [...(semana?.get(plat) ?? new Map<string, Ocorrencia>())].map(([tituloNorm, o]) => {
      const nacs = new Set<string>();
      for (const a of o.artistas) {
        const n = nacionalidade.get(semAcentoMaiusculo(a));
        if (n) nacs.add(n);
      }
      return {
        tituloNorm, titulo: o.titulo, artistaPrincipal: o.art, artistas: o.artistas,
        valor: o.valor, nacionalidades: nacs, foco: focoDe(focos, o.titulo, data),
      };
    });

  /** Streams globais (Spotify + Apple + YouTube) da música numa semana; ausente = 0. */
  const streamsGlobais = (data: string | undefined, tituloNorm: string): number => {
    const semana = data ? porData.get(data) : undefined;
    let s = 0;
    for (const p of PLATAFORMAS_STREAMS) s += semana?.get(p)?.get(tituloNorm)?.valor ?? 0;
    return s;
  };

  /** Camada 1 da semana `datas[i]` + junção das 4 plataformas em MusicaSemana. */
  const calcularSemana = (i: number, r: RegrasSemana) => {
    const data = datas[i];
    const semana = porData.get(data);
    const porPlataforma = new Map<Plataforma, EntradaMusica[]>();
    const valores = new Map<Plataforma, Map<string, Map<string, number>>>();
    for (const p of PLATAFORMAS) {
      const e = entradas(semana, p, data);
      porPlataforma.set(p, e);
      valores.set(p, valoresPorPais(e, pesosDe(p), data, r.paises));
    }
    const titulos = new Set<string>();
    for (const p of PLATAFORMAS) for (const t of semana?.get(p)?.keys() ?? []) titulos.add(t);
    const musicas: MusicaSemana[] = [...titulos].sort().map((tituloNorm) => {
      const base = PREFERENCIA_TITULO.map((c) => semana?.get(c)?.get(tituloNorm)).find(Boolean)!;
      const global = semana?.get(GLOBAL_100)?.get(tituloNorm);
      const totalGlobal: MusicaSemana["totalGlobal"] = {};
      const porPais: MusicaSemana["porPais"] = {};
      let semanasMax = 0;
      for (const p of PLATAFORMAS) {
        const o = semana?.get(p)?.get(tituloNorm);
        if (!o) continue;
        totalGlobal[p] = o.valor;
        porPais[p] = valores.get(p)!.get(tituloNorm) ?? new Map();
        semanasMax = Math.max(semanasMax, o.semanas);
      }
      return {
        tituloNorm,
        titulo: base.titulo,
        artistaPrincipal: base.art,
        semanas: global ? global.semanas : semanasMax,
        totalGlobal,
        porPais,
        streamsGlobaisAnteriores: [1, 2, 3].map((k) => streamsGlobais(datas[i + k], tituloNorm)),
      };
    });
    return { data, porPlataforma, musicas };
  };

  const atual = calcularSemana(0, regras);
  const anterior = datas.length > 1 ? calcularSemana(1, regrasAnt) : null;

  // Capa por título resolvida uma vez (o mesmo título aparece em vários países e paradas).
  const capas = new Map<string, string>();
  const capa = (titulo: string, art: string) => {
    const k = `${titulo}\u0000${art}`;
    if (!capas.has(k)) capas.set(k, capaDe(titulo, art, cat, fotos));
    return capas.get(k)!;
  };

  // COUNTRIES: cada semana com as próprias regras; `st` contra o ranking que d-1 mostrou.
  const countries = new Map<PlataformaCountries, LinhaPaisApi[]>();
  for (const p of PLATAFORMAS_COUNTRIES) {
    const pesos = pesosDe(p);
    const agora = rankingsPorPais(atual.porPlataforma.get(p)!, [], pesos, atual.data, null, regras.paises);
    const antes = anterior
      ? rankingsPorPais(anterior.porPlataforma.get(p)!, [], pesos, anterior.data, null, regrasAnt.paises)
      : new Map<string, { tituloNorm: string; pos: number }[]>();
    const linhas: LinhaPaisApi[] = [];
    for (const [pais, ranking] of agora) {
      const posAntes = new Map((antes.get(pais) ?? []).map((x) => [x.tituloNorm, x.pos]));
      for (const m of ranking) {
        const prev = posAntes.get(m.tituloNorm);
        const st = prev === undefined ? "NEW" : m.pos < prev ? "↑" : m.pos > prev ? "↓" : "=";
        linhas.push({ pais, pos: m.pos, tit: m.titulo, val: fmt(m.val), mes: dataBr, art: m.art, capa: capa(m.titulo, m.art), st });
      }
    }
    countries.set(p, linhas);
  }

  // Paradas oficiais: cada semana com as próprias regras (como em COUNTRIES);
  // `st` compara com a mesma parada (pelo id) como a semana d-1 a mostrou.
  const posAntesPorParada = new Map<string, Map<string, number>>();
  if (anterior) {
    for (const { parada, linhas } of paradasDaSemana(anterior.musicas, [], regrasAnt, paisesExistentes)) {
      posAntesPorParada.set(parada.id, new Map(linhas.map((l) => [l.tituloNorm, l.pos])));
    }
  }
  const paradas: LinhaPaisApi[] = [];
  for (const { parada, linhas } of paradasDaSemana(atual.musicas, [], regras, paisesExistentes)) {
    const posAntes = posAntesPorParada.get(parada.id);
    for (const l of linhas) {
      const prev = posAntes?.get(l.tituloNorm);
      const st = prev === undefined ? "NEW" : l.pos < prev ? "↑" : l.pos > prev ? "↓" : "=";
      paradas.push({
        pais: parada.nome, pos: l.pos, tit: l.titulo, val: fmt(l.val), mes: dataBr, art: l.art,
        capa: capa(l.titulo, l.art), st, ordem: parada.ordem, desc: parada.descricao,
      });
    }
  }
  return { countries, paradas };
}
