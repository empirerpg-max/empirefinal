// Paradas oficiais por país (camada 2): funções puras, sem I/O nem aleatoriedade.
// Metodologia na seção 8 do spec 2026-11-24-charts-paradas-nacionais-foco-design.
import type { Parada, RegrasSemana } from "./regras";
import type { Posicao } from "./paises";
import { semAcentoMaiusculo } from "./artistas";

export type Plataforma = "SPOTIFY" | "APPLE MUSIC" | "YOUTUBE" | "DIGITAL SALES";

export interface MusicaSemana {
  tituloNorm: string;
  titulo: string;
  artistaPrincipal: string;
  /** Semanas no Global 100 se estiver lá; senão o maior entre as plataformas. */
  semanas: number;
  totalGlobal: Partial<Record<Plataforma, number>>;
  porPais: Partial<Record<Plataforma, Map<string, number>>>;
  /** [d-1, d-2, d-3]: streams globais Spotify + Apple + YouTube; ausente = 0. */
  streamsGlobaisAnteriores: number[];
}

export type Fontes = { vendas: number; pagos: number; gratis_audio: number; gratis_video: number };
export type LinhaParada = Posicao & { st: "↑" | "↓" | "=" | "NEW" };

/**
 * Nome normalizado (sem acento/caixa) → nome como está em pais_peso. Duas grafias da mesma
 * chave: vale a primeira em ordem alfabética (determinístico, independe da ordem de entrada).
 */
export function mapaPaisPorNome(nomes: Iterable<string>): Map<string, string> {
  const porNorm = new Map<string, string>();
  for (const nome of [...nomes].sort()) {
    const k = semAcentoMaiusculo(nome);
    if (!porNorm.has(k)) porNorm.set(k, nome);
  }
  return porNorm;
}

/** Primeiro alias da parada presente em pais_peso (sem acento/caixa); devolve o nome como está lá. */
export function resolverPaisParada(p: Parada, paisesExistentes: Set<string>): string | null {
  const porNorm = mapaPaisPorNome(paisesExistentes);
  for (const alias of p.paises ?? []) {
    const achou = porNorm.get(semAcentoMaiusculo(alias));
    if (achou !== undefined) return achou;
  }
  return null;
}

/** Valor de uma plataforma no país (ou no mundo, se pais === null); ausente = 0. */
function valor(m: MusicaSemana, plat: Plataforma, pais: string | null): number {
  const v = pais === null ? m.totalGlobal[plat] : m.porPais[plat]?.get(pais);
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Fontes da música no país: vendas, pagos (Apple + fração paga do Spotify), grátis áudio e vídeo. */
export function fontes(m: MusicaSemana, pais: string | null, fracaoPaga: number): Fontes {
  const spotify = valor(m, "SPOTIFY", pais);
  // Grátis = Spotify − parte paga (subtração evita o ruído de (1 − fração) em ponto flutuante).
  const spotifyPago = fracaoPaga * spotify;
  return {
    vendas: valor(m, "DIGITAL SALES", pais),
    pagos: valor(m, "APPLE MUSIC", pais) + spotifyPago,
    gratis_audio: spotify - spotifyPago,
    gratis_video: valor(m, "YOUTUBE", pais),
  };
}

// Divisão por taxa: taxa 0 (ou inválida) = fonte não conta.
const porTaxa = (x: number, taxa: number) => (taxa > 0 ? x / taxa : 0);

/** Pontos da parada: unidades (taxas dividem) ou receita (preços multiplicam). */
export function pontos(f: Fontes, p: Pick<Parada, "tipo" | "a" | "tp" | "tga" | "tgv">): number {
  if (p.tipo === "receita") {
    return p.a * f.vendas + p.tp * f.pagos + p.tga * f.gratis_audio + p.tgv * f.gratis_video;
  }
  return p.a * f.vendas + porTaxa(f.pagos, p.tp) + porTaxa(f.gratis_audio, p.tga) + porTaxa(f.gratis_video, p.tgv);
}

/** ACR: música antiga (semanas > acr.semanas) que caiu em cada uma das `quedas` últimas semanas. */
export function emAcr(m: MusicaSemana, totalAtual: number, acr: NonNullable<Parada["acr"]>): boolean {
  if (!(m.semanas > acr.semanas)) return false;
  const ant = m.streamsGlobaisAnteriores ?? [];
  if (ant.length < acr.quedas) return false;
  // Sequência atual, d-1, d-2...: cada uma tem que ser menor que a anterior no tempo.
  const seq = [totalAtual, ...ant.slice(0, acr.quedas)];
  for (let i = 0; i < seq.length - 1; i++) {
    if (!(seq[i] < seq[i + 1])) return false;
  }
  return true;
}

/** Streams globais da semana (Spotify + Apple + YouTube), base do ACR. */
function streamsGlobais(m: MusicaSemana): number {
  return valor(m, "SPOTIFY", null) + valor(m, "APPLE MUSIC", null) + valor(m, "YOUTUBE", null);
}

/** Soma de todas as plataformas no mundo (desempate). */
function somaGlobal(m: MusicaSemana): number {
  let s = 0;
  for (const v of Object.values(m.totalGlobal)) if (typeof v === "number" && Number.isFinite(v)) s += v;
  return s;
}

/** Calcula uma parada para o país já resolvido. */
export function calcularParada(musicas: MusicaSemana[], p: Parada, pais: string, fracaoPaga: number): Posicao[] {
  const pontuadas = musicas.map((m) => {
    let pts: number;
    if (p.tipo === "excl") {
      // Mundo menos o país (Global Excl. US).
      pts = pontos(fontes(m, null, fracaoPaga), p) - pontos(fontes(m, pais, fracaoPaga), p);
    } else {
      const taxas = p.acr && emAcr(m, streamsGlobais(m), p.acr)
        ? { tipo: p.tipo, a: p.a, tp: p.acr.tp, tga: p.acr.tga, tgv: p.acr.tgv }
        : p;
      pts = pontos(fontes(m, pais, fracaoPaga), taxas);
    }
    return { m, pts, soma: somaGlobal(m) };
  });

  // Ordena sem arredondar; desempate pelo total global, depois título.
  pontuadas.sort((x, y) =>
    y.pts - x.pts || y.soma - x.soma ||
    (x.m.tituloNorm < y.m.tituloNorm ? -1 : x.m.tituloNorm > y.m.tituloNorm ? 1 : 0));

  // Máximo por artista principal: só as N de maior pontuação entram.
  let lista = pontuadas;
  const max = p.max_por_artista;
  if (typeof max === "number" && max > 0) {
    const cont = new Map<string, number>();
    lista = lista.filter(({ m }) => {
      const k = semAcentoMaiusculo(m.artistaPrincipal);
      const n = (cont.get(k) ?? 0) + 1;
      cont.set(k, n);
      return n <= max;
    });
  }

  // max_por_artista já rodou: as posições provisórias da recorrência vêm da lista depois desse filtro.
  // Recorrência: posições provisórias calculadas uma vez (sem cálculo em cadeia).
  const rec = p.recorrencia;
  if (rec && rec.length > 0) {
    lista = lista.filter(({ m }, i) => {
      const pos = i + 1;
      return !rec.some((r) => m.semanas >= r.semanas && pos > r.pos);
    });
  }

  return lista.slice(0, p.top).map(({ m, pts }, i) => ({
    pos: i + 1, tituloNorm: m.tituloNorm, titulo: m.titulo, art: m.artistaPrincipal, val: Math.round(pts),
  }));
}

/** Todas as paradas da semana (ordem do seletor), com `st` contra a semana anterior. */
export function paradasDaSemana(
  atual: MusicaSemana[], anterior: MusicaSemana[], regras: RegrasSemana, paisesExistentes: Set<string>,
): { parada: Parada; linhas: LinhaParada[] }[] {
  const fracao = regras.paises.fracao_paga_spotify;
  const paradas = [...regras.paradas].sort((x, y) => x.ordem - y.ordem);
  const saida: { parada: Parada; linhas: LinhaParada[] }[] = [];
  for (const parada of paradas) {
    const pais = resolverPaisParada(parada, paisesExistentes);
    if (pais === null) continue;
    const antes = new Map(calcularParada(anterior, parada, pais, fracao).map((x) => [x.tituloNorm, x.pos]));
    const linhas = calcularParada(atual, parada, pais, fracao).map((x): LinhaParada => {
      const prev = antes.get(x.tituloNorm);
      const st = prev === undefined ? "NEW" : x.pos < prev ? "↑" : x.pos > prev ? "↓" : "=";
      return { ...x, st };
    });
    saida.push({ parada, linhas });
  }
  return saida;
}
