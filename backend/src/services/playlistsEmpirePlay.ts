// Playlists do Empire Play: ids estáveis e catálogo "tocável" (música + clipe)
// ligado às músicas dos charts. Só lê o D1 (musicas, videos Music Video,
// artista_info) — nenhuma leitura de planilha, nenhuma escrita.
//
// `musica` e `clipe` de cada faixa são EXATAMENTE os itens que
// /api/empire-play/musicas e /api/empire-play/videos devolvem (mesmo
// buildCleanItem), então o front toca do mesmo jeito que já toca.
import {
  buildCleanItem,
  musicaD1RowToSheetRecord,
  readMusicasFromD1,
  type EmpirePlayCleanItem,
  type MusicaD1Row,
} from "../controllers/empirePlayController";
import { fetchRTBruto, fetchRTPaises, semanaParaPlaylists } from "../controllers/chartsController";
import { getCatalogoDb, type D1DatabaseLike } from "./catalogoDbService";
import { fixImg, fmt } from "./chartsD1/formato";
import type { LinhaAoVivoPais } from "./chartsD1/aoVivoPaises";
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
import { carregarFotos, chaveArtistaInfo, type LinhaPaisApi } from "./chartsD1/repo";

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
  /** Só nas playlists de gênero: posição da faixa no Global 100 (`pos` é a posição no gênero). */
  posGlobal?: number;
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
 * Ordem estável (codigo_unico, título, artista, id): os empates "o primeiro
 * vence" (índice dos charts, clipe por código) não dependem da ordem em que
 * o D1 devolve as linhas.
 */
const chaveOrdem = (i: EmpirePlayCleanItem): string[] => [(i.codigoUnico || "").trim(), i.title, i.artist, i.id];
function ordenarEstavel(itens: EmpirePlayCleanItem[]): EmpirePlayCleanItem[] {
  return [...itens].sort((a, b) => {
    const ka = chaveOrdem(a);
    const kb = chaveOrdem(b);
    for (let k = 0; k < ka.length; k++) {
      if (ka[k] !== kb[k]) return ka[k] < kb[k] ? -1 : 1;
    }
    return 0;
  });
}

/**
 * Função pura: monta o catálogo a partir dos itens já no formato do front
 * (`EmpirePlayCleanItem`). Clipes que não são "Music Video" ou sem código
 * único ficam de fora; com vários clipes pro mesmo código, vence o primeiro
 * que tem vídeo (na ordem estável de ordenarEstavel, nunca na recebida).
 */
export function montarCatalogoTocavel(
  musicas: EmpirePlayCleanItem[],
  clipes: EmpirePlayCleanItem[],
  fotos: Map<string, string> = new Map(),
): CatalogoTocavel {
  const musicaPorLigacao = new Map<string, EmpirePlayCleanItem>();
  const linhas: LinhaCatalogo[] = ordenarEstavel(musicas).map((m, i) => {
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
  for (const c of ordenarEstavel(clipes)) {
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

function musicaDoChart(cat: CatalogoTocavel, tituloChart: string): EmpirePlayCleanItem | null {
  const achado = buscarNoCatalogo(tituloChart, cat.indice);
  return (achado && cat.musicaPorLigacao.get(achado.codigoUnico)) || null;
}

/** `chave` que ligarFaixa daria a essa linha de chart (sem montar a faixa). */
export function chaveDaFaixa(cat: CatalogoTocavel, tituloChart: string): string {
  return (musicaDoChart(cat, tituloChart)?.codigoUnico || "").trim() || chaveMusica(tituloChart);
}

/** Liga uma linha de chart ao catálogo (mesmo cruzamento dos charts: buscarNoCatalogo). */
export function ligarFaixa(cat: CatalogoTocavel, tituloChart: string, pos: number, valor: string): FaixaPlaylist {
  const musica = musicaDoChart(cat, tituloChart);
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
let cacheHot: { em: number; valor: Promise<EmpirePlayCleanItem[]> } | null = null;

export function limparCachePlaylists(): void {
  cacheCatalogo = null;
  cacheHot = null;
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

// ---- Hot: lançamentos recentes do D1 ----

const TTL_HOT_MS = 5 * 60_000;
const LIMITE_HOT = 30;

async function lerHotDoD1(db: D1DatabaseLike): Promise<EmpirePlayCleanItem[]> {
  // Usa idx_musicas_data; sem data nunca entra; desempate pela chave (determinístico).
  const r = await db
    .prepare(
      `SELECT * FROM musicas
       WHERE COALESCE(pendente, 0) = 0 AND data_lancamento_iso IS NOT NULL AND data_lancamento_iso <> ''
       ORDER BY data_lancamento_iso DESC, chave
       LIMIT ?`,
    )
    .bind(LIMITE_HOT)
    .all<MusicaD1Row>();
  // Mesmo mapeamento de /api/empire-play/musicas (buildCleanItem da aba "Musicas").
  return (r?.results || []).map((row, idx) => buildCleanItem("Musicas", musicaD1RowToSheetRecord(row), idx));
}

/** 30 lançamentos mais recentes do D1 (sem pendentes), cache de 5 min; sem D1 → vazio; falha não fica em cache. */
export function carregarHot(db: D1DatabaseLike | undefined = getCatalogoDb()): Promise<EmpirePlayCleanItem[]> {
  if (!db) return Promise.resolve([]);
  if (cacheHot && Date.now() - cacheHot.em < TTL_HOT_MS) return cacheHot.valor;
  const valor = lerHotDoD1(db);
  const entrada = { em: Date.now(), valor };
  valor.catch(() => {
    if (cacheHot === entrada) cacheHot = null;
  });
  cacheHot = entrada;
  return valor;
}

// ---- Montar cada playlist ----

export interface Playlist {
  id: string;
  titulo: string;
  subtitulo: string;
  plataforma: PlataformaPlaylist | null;
  aoVivo: boolean;
  /** Capa da faixa #1 (catálogo; senão foto do artista; senão capa do chart). */
  capa_url: string | null;
  faixas: FaixaPlaylist[];
}

/** Item da EM Alta como o chartsController devolve (fetchRTBruto). */
export interface ItemEmAltaPlaylist {
  t: string;
  n: number;
  s?: string;
  p?: string;
  c?: string;
}

export interface SemanaPlaylists {
  /** Global 100 da semana mais recente, na ordem do chart; `valor` já formatado. */
  global100: { titulo: string; valor: string }[];
  /** Paradas oficiais da mesma semana: `pais` = nome da parada. */
  paradas: LinhaPaisApi[];
  /** Último chart semanal global de cada plataforma (título + posição): base da subida do destaque. */
  plataformas: Record<PlataformaPlaylist, { titulo: string; pos: number }[]>;
  /** Recorte por país (COUNTRIES) da semana mais recente, por plataforma: base da subida dos países. */
  paises: Record<PlataformaPlaylist, LinhaPaisApi[]>;
}

/** Fontes das playlists, injetáveis (testes usam falsas; a real é fontesReais). */
export interface FontesPlaylists {
  emAlta(): Promise<Record<PlataformaPlaylist, ItemEmAltaPlaylist[]>>;
  aoVivoPaises(): Promise<Record<PlataformaPlaylist, LinhaAoVivoPais[]>>;
  semana(): Promise<SemanaPlaylists>;
  hot(): Promise<EmpirePlayCleanItem[]>;
  catalogo(): Promise<CatalogoTocavel>;
}

/** Fontes reais: os mesmos caches do /api/charts (EM Alta 30 s, semana) + D1 (catálogo 15 min, Hot 5 min). */
export function fontesReais(db: D1DatabaseLike | undefined = getCatalogoDb()): FontesPlaylists {
  return {
    emAlta: () => fetchRTBruto(),
    aoVivoPaises: () => fetchRTPaises(),
    semana: () => semanaParaPlaylists(),
    hot: () => carregarHot(db),
    catalogo: () => carregarCatalogoTocavel(),
  };
}

const NOME_PLATAFORMA: Record<PlataformaPlaylist, string> = { spotify: "Spotify", apple: "Apple Music", youtube: "YouTube" };
const TITULO_AO_VIVO: Record<PlataformaPlaylist, string> = {
  spotify: "Top 100 Spotify Global",
  apple: "Top 100 Apple Music",
  youtube: "Top 100 YouTube Hits",
};
const SUB_AO_VIVO = "Ao vivo · atualiza a cada 30 s";
const SUB_SEMANA = "Da semana · fecha quinta";
const SUB_HOT = "Lançamentos recentes";
const LIMITE_AO_VIVO = 100;
const LIMITE_PAIS = 50;

const CONECTIVOS = new Set(["de", "do", "da", "dos", "das", "e"]);
/**
 * "REINO UNIDO" → "Reino Unido"; "COREIA DO SUL" → "Coreia do Sul"; "R&B" → "R&B".
 * Com `siglas` (padrão), um nome de UMA palavra toda em caixa alta com até 3
 * letras fica como está ("EUA", "UK"). Só vale pra palavra sozinha: em
 * pais_peso tudo é caixa alta, e "COREIA DO SUL" tem que virar "Coreia do Sul".
 */
export function emTitulo(s: string, { siglas = true }: { siglas?: boolean } = {}): string {
  const palavras = String(s ?? "").trim().split(/\s+/).filter(Boolean);
  return palavras
    .map((original, i) => {
      const w = original.toLocaleLowerCase("pt-BR");
      if (i > 0 && CONECTIVOS.has(w)) return w;
      const letras = original.replace(/[^\p{L}]/gu, "");
      if (siglas && palavras.length === 1 && letras.length > 0 && letras.length <= 3 && original === original.toLocaleUpperCase("pt-BR")) return original;
      return w.replace(/(^|[-&'/])(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase("pt-BR"));
    })
    .join(" ");
}

/** Faixa de chart com a capa do próprio chart como último recurso. */
function faixaDoChart(cat: CatalogoTocavel, titulo: string, pos: number, valor: string, capaChart?: string): FaixaPlaylist {
  const f = ligarFaixa(cat, titulo, pos, valor);
  return f.capa_url ? f : { ...f, capa_url: fixImg(capaChart) || null };
}

function faixaDoItem(cat: CatalogoTocavel, item: EmpirePlayCleanItem, pos: number): FaixaPlaylist {
  const codigo = (item.codigoUnico || "").trim();
  return {
    chave: codigo || item.id,
    pos,
    valor: "",
    titulo: item.title,
    artista: item.displayArtists || item.artist,
    capa_url: item.coverUrl || item.artistPhotoUrl || cat.fotos.get(chaveArtistaInfo(item.artist)) || null,
    tocavel: !!item.audioUrl,
    musica: item,
    clipe: (codigo && cat.clipePorCodigo.get(codigo)) || null,
  };
}

const porPos = <T extends { pos: number }>(l: T[]): T[] => [...l].sort((a, b) => a.pos - b.pos);

function playlist(
  id: IdPlaylist,
  titulo: string,
  subtitulo: string,
  faixas: FaixaPlaylist[],
  plataforma: PlataformaPlaylist | null = null,
): Playlist {
  return {
    id: formatarIdPlaylist(id),
    titulo,
    subtitulo,
    plataforma,
    aoVivo: plataforma !== null,
    capa_url: faixas[0]?.capa_url ?? null,
    faixas,
  };
}

// Construtores puros (dados já carregados). O índice passa só a 1ª linha
// para montar o cartão: mesmo título/subtítulo/capa da playlist inteira.

function playlistAoVivo(plataforma: PlataformaPlaylist, itens: ItemEmAltaPlaylist[], cat: CatalogoTocavel): Playlist {
  const faixas = itens.slice(0, LIMITE_AO_VIVO).map((i, k) => faixaDoChart(cat, i.t, k + 1, fmt(i.n), i.c));
  return playlist({ tipo: "ao-vivo", plataforma }, TITULO_AO_VIVO[plataforma], SUB_AO_VIVO, faixas, plataforma);
}

const tituloPais = (pais: string): string => `Top 50 ${emTitulo(pais)}`;

/** `linhas` já do país e em ordem de posição (não vazia). */
function playlistPais(id: IdPlaylist & { tipo: "pais" }, linhas: LinhaAoVivoPais[], cat: CatalogoTocavel): Playlist {
  // id como foi pedido; o título usa a grafia de pais_peso (com acento).
  const faixas = linhas.slice(0, LIMITE_PAIS).map((l) => faixaDoChart(cat, l.t, l.pos, l.s, l.c));
  return playlist(id, tituloPais(linhas[0].pais), `${NOME_PLATAFORMA[id.plataforma]} · ao vivo`, faixas, id.plataforma);
}

function playlistGlobal100(global100: SemanaPlaylists["global100"], cat: CatalogoTocavel): Playlist {
  const faixas = global100.map((l, k) => faixaDoChart(cat, l.titulo, k + 1, l.valor));
  return playlist({ tipo: "global100" }, "Global 100", SUB_SEMANA, faixas);
}

/** `linhas` já da parada e em ordem de posição (não vazia). */
function playlistParada(id: IdPlaylist & { tipo: "parada" }, linhas: LinhaPaisApi[], cat: CatalogoTocavel): Playlist {
  const faixas = linhas.map((l) => faixaDoChart(cat, l.tit, l.pos, l.val, l.capa));
  return playlist(id, linhas[0].pais, SUB_SEMANA, faixas);
}

/**
 * Faixas do Global 100 por gênero (caixa alta sem acento), na ordem do chart.
 * Faixa sem catálogo fica fora; `pos` = posição no gênero (1..N),
 * `posGlobal` = posição no Global 100.
 */
function faixasPorGenero(global100: SemanaPlaylists["global100"], cat: CatalogoTocavel): Map<string, FaixaPlaylist[]> {
  const porGenero = new Map<string, FaixaPlaylist[]>();
  global100.forEach((l, k) => {
    const f = faixaDoChart(cat, l.titulo, k + 1, l.valor);
    const genero = f.musica ? normalizarGenero(f.musica.genero || "") : "";
    if (!genero) return;
    const lista = porGenero.get(genero) ?? [];
    lista.push({ ...f, pos: lista.length + 1, posGlobal: f.pos });
    porGenero.set(genero, lista);
  });
  return porGenero;
}

function playlistGenero(genero: string, faixas: FaixaPlaylist[]): Playlist {
  const nome = emTitulo(faixas[0].musica!.genero || genero, { siglas: false });
  return playlist({ tipo: "genero", genero }, `Top ${nome}`, SUB_SEMANA, faixas);
}

function playlistHot(itens: EmpirePlayCleanItem[], cat: CatalogoTocavel): Playlist {
  return playlist({ tipo: "hot" }, "Hot", SUB_HOT, itens.map((item, k) => faixaDoItem(cat, item, k + 1)));
}

/** Agrupa por nome (sem acento/caixa), na ordem da 1ª aparição. */
function agruparPorNome<T extends { pais: string }>(linhas: T[]): T[][] {
  const grupos = new Map<string, T[]>();
  for (const l of linhas) {
    const k = semAcentoMaiusculo(l.pais);
    const g = grupos.get(k);
    if (g) g.push(l);
    else grupos.set(k, [l]);
  }
  return [...grupos.values()];
}

/**
 * Monta uma playlist pelo id. `null` quando o país/parada/gênero não existe
 * (ou não tem nenhuma faixa). Determinístico: mesmas fontes → mesma resposta.
 */
export async function montarPlaylist(id: IdPlaylist, fontes: FontesPlaylists): Promise<Playlist | null> {
  switch (id.tipo) {
    case "ao-vivo": {
      const [emAlta, cat] = await Promise.all([fontes.emAlta(), fontes.catalogo()]);
      return playlistAoVivo(id.plataforma, emAlta[id.plataforma] ?? [], cat);
    }
    case "pais": {
      const [porPais, cat] = await Promise.all([fontes.aoVivoPaises(), fontes.catalogo()]);
      const alvo = semAcentoMaiusculo(id.pais);
      const linhas = porPos((porPais[id.plataforma] ?? []).filter((l) => semAcentoMaiusculo(l.pais) === alvo));
      return linhas.length ? playlistPais(id, linhas, cat) : null;
    }
    case "global100": {
      const [semana, cat] = await Promise.all([fontes.semana(), fontes.catalogo()]);
      return playlistGlobal100(semana.global100, cat);
    }
    case "parada": {
      const [semana, cat] = await Promise.all([fontes.semana(), fontes.catalogo()]);
      const alvo = semAcentoMaiusculo(id.parada);
      const linhas = porPos(semana.paradas.filter((l) => semAcentoMaiusculo(l.pais) === alvo));
      return linhas.length ? playlistParada(id, linhas, cat) : null;
    }
    case "genero": {
      const [semana, cat] = await Promise.all([fontes.semana(), fontes.catalogo()]);
      const genero = normalizarGenero(id.genero);
      const faixas = faixasPorGenero(semana.global100, cat).get(genero);
      return faixas?.length ? playlistGenero(genero, faixas) : null;
    }
    case "hot": {
      const [itens, cat] = await Promise.all([fontes.hot(), fontes.catalogo()]);
      return playlistHot(itens, cat);
    }
  }
}

// ---- Índice: destaque + prateleiras ----

export interface CartaoPlaylist {
  id: string;
  titulo: string;
  subtitulo: string;
  capa_url: string | null;
  aoVivo: boolean;
}

export interface DestaquePlaylists {
  id: string;
  titulo: string;
  /** "Artista - Título" da #1 ao vivo. */
  musica: string;
  /** Posições que a #1 ao vivo subiu desde o último chart semanal. */
  subiu: number;
  /** Valor ao vivo da #1, formatado. */
  valor: string;
  capa_url: string | null;
}

export interface IndicePlaylists {
  destaque: DestaquePlaylists | null;
  /** 3 ao vivo + Global 100 (só as que têm faixas). */
  globais: CartaoPlaylist[];
  /** Top 50 por país, na ordem do peso (ordem de fontes.aoVivoPaises). */
  paises: Record<PlataformaPlaylist, CartaoPlaylist[]>;
  /** Paradas oficiais pela `ordem` (empate pelo nome). */
  paradas: CartaoPlaylist[];
  /** Gêneros com ≥ MIN_FAIXAS_GENERO faixas no Global 100 (mais faixas primeiro, empate pelo nome) + Hot no fim. */
  generos: CartaoPlaylist[];
}

const MIN_FAIXAS_GENERO = 10;

/** Cartão de uma playlist; null se ela não tem faixas (prateleira não mostra playlist vazia). */
function cartao(p: Playlist): CartaoPlaylist | null {
  if (!p.faixas.length) return null;
  return { id: p.id, titulo: p.titulo, subtitulo: p.subtitulo, capa_url: p.capa_url, aoVivo: p.aoVivo };
}
const naoNulos = <T>(l: (T | null)[]): T[] => l.filter((x): x is T => x !== null);
const numero = (s: string): number => Number(String(s ?? "").replace(/[^\d]/g, "")) || 0;
const comparar = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface CandidatoDestaque extends DestaquePlaylists {
  valorNum: number;
}

/**
 * Subida da faixa #1 ao vivo: posição da mesma música (`chave`) no chart
 * semanal − 1; fora do chart semanal conta como (tamanho + 1) − 1.
 */
function subida(chave: string, semanal: { titulo: string; pos: number }[], chaveDe: (t: string) => string): number {
  const achada = semanal.find((l) => chaveDe(l.titulo) === chave);
  return (achada ? achada.pos : semanal.length + 1) - 1;
}

function candidato(p: Playlist, subiu: number, valorNum: number): CandidatoDestaque {
  const f = p.faixas[0];
  return {
    id: p.id,
    titulo: p.titulo,
    musica: f.artista ? `${f.artista} - ${f.titulo}` : f.titulo,
    subiu,
    valor: f.valor,
    capa_url: p.capa_url,
    valorNum,
  };
}

/**
 * Índice das playlists. Determinístico: mesmas fontes → mesmo índice.
 * Cartões só leem a #1 de cada playlist (o índice é recalculado a cada 30 s).
 */
export async function montarIndice(fontes: FontesPlaylists): Promise<IndicePlaylists> {
  const [emAlta, porPais, semana, hot, cat] = await Promise.all([
    fontes.emAlta(),
    fontes.aoVivoPaises(),
    fontes.semana(),
    fontes.hot(),
    fontes.catalogo(),
  ]);
  // O mesmo título aparece em muitos países: liga ao catálogo uma vez só.
  const chaves = new Map<string, string>();
  const chaveDe = (t: string): string => {
    let c = chaves.get(t);
    if (c === undefined) chaves.set(t, (c = chaveDaFaixa(cat, t)));
    return c;
  };

  const candidatos: CandidatoDestaque[] = [];
  const globais: (CartaoPlaylist | null)[] = [];
  const paises = {} as Record<PlataformaPlaylist, CartaoPlaylist[]>;
  for (const plat of PLATAFORMAS) {
    const itens = emAlta[plat] ?? [];
    const p = playlistAoVivo(plat, itens.slice(0, 1), cat);
    globais.push(cartao(p));
    if (p.faixas.length) candidatos.push(candidato(p, subida(p.faixas[0].chave, semana.plataformas?.[plat] ?? [], chaveDe), itens[0].n));

    const semanaPorPais = new Map(
      agruparPorNome(semana.paises?.[plat] ?? []).map((g) => [semAcentoMaiusculo(g[0].pais), porPos(g)]),
    );
    paises[plat] = agruparPorNome(porPais[plat] ?? []).map((g) => {
      const linhas = porPos(g);
      const pl = playlistPais({ tipo: "pais", plataforma: plat, pais: linhas[0].pais }, linhas.slice(0, 1), cat);
      const semanal = (semanaPorPais.get(semAcentoMaiusculo(linhas[0].pais)) ?? []).map((l) => ({ titulo: l.tit, pos: l.pos }));
      candidatos.push(candidato(pl, subida(pl.faixas[0].chave, semanal, chaveDe), numero(linhas[0].s)));
      return cartao(pl)!;
    });
  }
  globais.push(cartao(playlistGlobal100(semana.global100.slice(0, 1), cat)));

  const paradas = agruparPorNome(semana.paradas)
    .map((g) => porPos(g))
    .sort((a, b) => (a[0].ordem ?? Infinity) - (b[0].ordem ?? Infinity) || comparar(a[0].pais, b[0].pais))
    .map((linhas) => cartao(playlistParada({ tipo: "parada", parada: linhas[0].pais }, linhas.slice(0, 1), cat)));

  const generos = [...faixasPorGenero(semana.global100, cat)]
    .filter(([, faixas]) => faixas.length >= MIN_FAIXAS_GENERO)
    .sort((a, b) => b[1].length - a[1].length || comparar(a[0], b[0]))
    .map(([genero, faixas]) => cartao(playlistGenero(genero, faixas)));
  generos.push(cartao(playlistHot(hot.slice(0, 1), cat)));

  // Maior subida; empate: maior valor ao vivo, depois id. Ninguém subiu → Spotify Global.
  candidatos.sort((a, b) => b.subiu - a.subiu || b.valorNum - a.valorNum || comparar(a.id, b.id));
  const melhor = candidatos[0]?.subiu > 0 ? candidatos[0] : candidatos.find((c) => c.id === "ao-vivo:spotify");
  const destaque: DestaquePlaylists | null = melhor
    ? { id: melhor.id, titulo: melhor.titulo, musica: melhor.musica, subiu: melhor.subiu, valor: melhor.valor, capa_url: melhor.capa_url }
    : null;

  return { destaque, globais: naoNulos(globais), paises, paradas: naoNulos(paradas), generos: naoNulos(generos) };
}
