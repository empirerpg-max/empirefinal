// Playlists do Empire Play: ids estáveis e catálogo "tocável" (música + clipe)
// ligado às músicas dos charts. Só lê o D1 (musicas, videos Music Video,
// artista_info) — nenhuma leitura de planilha, nenhuma escrita.
//
// `musica` e `clipe` de cada faixa são EXATAMENTE os itens que
// /api/empire-play/musicas e /api/empire-play/videos devolvem (mesmo
// buildCleanItem), então o front toca do mesmo jeito que já toca.
import { buildCleanItem, readMusicasFromD1, type EmpirePlayCleanItem } from "../controllers/empirePlayController";
import { getCatalogoDb } from "./catalogoDbService";
import { linhasParaObjetos, normalizeComparison } from "./googleSheetsService";
import { linhasVideosD1 } from "./videosD1Leitura";
import { ABA_VIDEOS } from "./videosD1Sync";
import {
  buscarNoCatalogo,
  chaveMusica,
  extrairArtistasDoTitulo,
  indexarCatalogo,
  semAcentoMaiusculo,
  type LinhaCatalogo,
  type MusicaCatalogo,
} from "./chartsD1/artistas";
import { carregarFotos, chaveArtistaInfo } from "./chartsD1/repo";

// ---- Ids de playlist ----

export type PlataformaPlaylist = "spotify" | "apple" | "youtube";

export type IdPlaylist =
  | { tipo: "ao-vivo"; plataforma: PlataformaPlaylist }
  | { tipo: "pais"; plataforma: PlataformaPlaylist; pais: string }
  | { tipo: "global100" }
  | { tipo: "parada"; parada: string }
  | { tipo: "genero"; genero: string }
  | { tipo: "hot" };

const PLATAFORMAS: readonly PlataformaPlaylist[] = ["spotify", "apple", "youtube"];
const ehPlataforma = (s: string): s is PlataformaPlaylist => (PLATAFORMAS as readonly string[]).includes(s);

/**
 * País no formato de pais_peso: CAIXA ALTA mantendo os acentos ("AUSTRÁLIA").
 * Comparação com outros nomes de país é feita com semAcentoMaiusculo.
 */
const normalizarPais = (s: string): string => s.trim().replace(/\s+/g, " ").toUpperCase();
/** Gênero como as playlists agrupam: caixa alta sem acento ("Pop" = "POP"). */
const normalizarGenero = (s: string): string => semAcentoMaiusculo(s);

/**
 * "ao-vivo:spotify", "pais:spotify:BRASIL", "semana:global100",
 * "semana:parada:UK", "semana:genero:POP", "semana:hot". Qualquer outra
 * coisa (plataforma desconhecida, parte vazia, partes a mais) → null.
 */
export function parseIdPlaylist(id: string): IdPlaylist | null {
  const partes = String(id ?? "").split(":").map((p) => p.trim());
  const [grupo, a, b] = partes;
  if (partes.some((p) => !p)) return null;
  if (grupo === "ao-vivo" && partes.length === 2 && ehPlataforma(a)) return { tipo: "ao-vivo", plataforma: a };
  if (grupo === "pais" && partes.length === 3 && ehPlataforma(a)) return { tipo: "pais", plataforma: a, pais: normalizarPais(b) };
  if (grupo !== "semana") return null;
  if (partes.length === 2 && a === "global100") return { tipo: "global100" };
  if (partes.length === 2 && a === "hot") return { tipo: "hot" };
  if (partes.length === 3 && a === "parada") return { tipo: "parada", parada: b };
  if (partes.length === 3 && a === "genero") return { tipo: "genero", genero: normalizarGenero(b) };
  return null;
}

export function formatarIdPlaylist(p: IdPlaylist): string {
  switch (p.tipo) {
    case "ao-vivo":
      return `ao-vivo:${p.plataforma}`;
    case "pais":
      return `pais:${p.plataforma}:${normalizarPais(p.pais)}`;
    case "global100":
      return "semana:global100";
    case "parada":
      return `semana:parada:${p.parada.trim()}`;
    case "genero":
      return `semana:genero:${normalizarGenero(p.genero)}`;
    case "hot":
      return "semana:hot";
  }
}

// ---- Catálogo tocável ----

export interface FaixaPlaylist {
  /** codigo_unico do catálogo; sem ele, a identidade do título do chart (chaveMusica). */
  chave: string;
  pos: number;
  valor: string;
  titulo: string;
  artista: string;
  capa_url: string | null;
  tocavel: boolean;
  musica: EmpirePlayCleanItem | null;
  clipe: EmpirePlayCleanItem | null;
}

export interface CatalogoTocavel {
  /** Mesmo índice do cruzamento dos charts (indexarCatalogo/buscarNoCatalogo). */
  indice: Map<string, MusicaCatalogo>;
  /** Item de música por "código de ligação" (codigo_unico, ou um provisório pra quem não tem). */
  musicaPorLigacao: Map<string, EmpirePlayCleanItem>;
  /** Music Video por codigo_unico. */
  clipePorCodigo: Map<string, EmpirePlayCleanItem>;
  /** Foto do artista (artista_info) por nome em CAIXA ALTA. */
  fotos: Map<string, string>;
}

const ehMusicVideo = (item: EmpirePlayCleanItem): boolean =>
  normalizeComparison(item.category || "") === normalizeComparison("Music Video");

/** Prefixo dos códigos provisórios de músicas sem codigo_unico (nunca vira `chave`). */
const SEM_CODIGO = "\u0000sem-codigo:";

/**
 * Função pura: monta o catálogo a partir dos itens já no formato do front
 * (`EmpirePlayCleanItem`). Clipes que não são "Music Video" ou sem código
 * único ficam de fora; com vários clipes pro mesmo código, vence o primeiro
 * que tem vídeo (na ordem recebida).
 */
export function montarCatalogoTocavel(
  musicas: EmpirePlayCleanItem[],
  clipes: EmpirePlayCleanItem[],
  fotos: Map<string, string> = new Map(),
): CatalogoTocavel {
  const musicaPorLigacao = new Map<string, EmpirePlayCleanItem>();
  const linhas: LinhaCatalogo[] = musicas.map((m, i) => {
    const ligacao = (m.codigoUnico || "").trim() || `${SEM_CODIGO}${i}`;
    if (!musicaPorLigacao.has(ligacao)) musicaPorLigacao.set(ligacao, m);
    const feats = m.featArtists || [];
    return {
      titulo: m.title,
      codigo_unico: ligacao,
      artista: m.artist,
      artista_2: feats[0] ?? null,
      artista_3: feats[1] ?? null,
      artista_4: feats[2] ?? null,
      artista_5: feats[3] ?? null,
      artista_6: feats[4] ?? null,
      capa_url: m.coverUrl ?? null,
      genero: m.genero ?? null,
      tipo_single: m.tipoSingle ?? null,
    };
  });

  const clipePorCodigo = new Map<string, EmpirePlayCleanItem>();
  for (const c of clipes) {
    const codigo = (c.codigoUnico || "").trim();
    if (!codigo || !ehMusicVideo(c)) continue;
    const atual = clipePorCodigo.get(codigo);
    if (!atual || (!atual.videoUrl && c.videoUrl)) clipePorCodigo.set(codigo, c);
  }

  return { indice: indexarCatalogo(linhas), musicaPorLigacao, clipePorCodigo, fotos };
}

/** "Artista - Título" do chart → partes (sem " - ", tudo é título). */
function partesDoTituloChart(tituloChart: string): { artista: string; titulo: string } {
  const idx = tituloChart.indexOf(" - ");
  if (idx < 0) return { artista: "", titulo: tituloChart.trim() };
  return { artista: tituloChart.slice(0, idx).trim(), titulo: tituloChart.slice(idx + 3).trim() };
}

/** Liga uma linha de chart ao catálogo (mesmo cruzamento dos charts: buscarNoCatalogo). */
export function ligarFaixa(cat: CatalogoTocavel, tituloChart: string, pos: number, valor: string): FaixaPlaylist {
  const achado = buscarNoCatalogo(tituloChart, cat.indice);
  const musica = (achado && cat.musicaPorLigacao.get(achado.codigoUnico)) || null;
  const codigo = (musica?.codigoUnico || "").trim();
  const clipe = (codigo && cat.clipePorCodigo.get(codigo)) || null;
  const doChart = partesDoTituloChart(tituloChart);
  const artistaPrincipal = musica?.artist || extrairArtistasDoTitulo(tituloChart)[0] || doChart.artista;
  const foto = musica?.artistPhotoUrl || cat.fotos.get(chaveArtistaInfo(artistaPrincipal)) || "";
  return {
    chave: codigo || chaveMusica(tituloChart),
    pos,
    valor,
    titulo: musica?.title ?? doChart.titulo,
    artista: musica ? musica.displayArtists || musica.artist : doChart.artista,
    capa_url: musica?.coverUrl || foto || null,
    tocavel: !!musica?.audioUrl,
    musica,
    clipe,
  };
}

// ---- Carga do D1 (cache de módulo) ----

const TTL_CATALOGO_MS = 15 * 60_000;
// Date.now só decide a expiração, nunca entra no resultado.
let cacheCatalogo: { em: number; valor: Promise<CatalogoTocavel> } | null = null;

export function limparCachePlaylists(): void {
  cacheCatalogo = null;
}

async function lerCatalogoDoD1(): Promise<CatalogoTocavel> {
  const db = getCatalogoDb();
  if (!db) return montarCatalogoTocavel([], []);
  const [registros, linhasClipes, fotos] = await Promise.all([
    readMusicasFromD1(),
    linhasVideosD1("Music Video"),
    carregarFotos(db),
  ]);
  // readMusicasFromD1 engole o erro e devolve null: com D1 presente isso é
  // falha de leitura, e falha não pode ficar 15 min em cache.
  if (!registros) throw new Error("[playlists] falha ao ler `musicas` do D1");
  // Mesmo filtro e mapeamento de /api/empire-play/musicas: pendente nunca entra.
  const musicas = registros
    .filter((rec) => (rec.pendente || "").trim().toLowerCase() !== "sim")
    .map((rec, idx) => buildCleanItem("Musicas", rec, idx));
  // Mesmo mapeamento de /api/empire-play/videos (aba "Music Videos" → "Videos").
  const clipes = linhasParaObjetos(ABA_VIDEOS, linhasClipes ?? []).map((rec, idx) => buildCleanItem("Videos", rec, idx));
  return montarCatalogoTocavel(musicas, clipes, fotos);
}

/** Catálogo tocável com cache de 15 min; chamadas simultâneas dividem a mesma carga; falha é descartada. */
export function carregarCatalogoTocavel(): Promise<CatalogoTocavel> {
  if (cacheCatalogo && Date.now() - cacheCatalogo.em < TTL_CATALOGO_MS) return cacheCatalogo.valor;
  const valor = lerCatalogoDoD1();
  const entrada = { em: Date.now(), valor };
  valor.catch(() => {
    if (cacheCatalogo === entrada) cacheCatalogo = null;
  });
  cacheCatalogo = entrada;
  return valor;
}
