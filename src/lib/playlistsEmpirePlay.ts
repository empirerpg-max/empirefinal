// Cliente da rota /api/empire-play/playlists (índice + playlist por id).
// Tipos espelham backend/src/services/playlistsEmpirePlay.ts.
//
// Igual ao fetchAoVivo (src/lib/charts.ts): busca direto, SEM cache de
// sessão (a tela recarrega a cada 30 s e precisa ver dado novo), e se a
// resposta vier com erro ou vazia devolve o último valor bom daquela URL.

export type PlataformaPlaylist = "spotify" | "apple" | "youtube";

/**
 * Item do catálogo como o backend devolve (EmpirePlayCleanItem). Só os
 * campos que a tela lê estão tipados; o resto passa pelos mappers
 * (toPlayableTrack/toPlayableVideo), que aceitam o objeto bruto.
 */
export interface ItemCatalogoPlaylist {
  id: string;
  type: string;
  title: string;
  artist: string;
  displayArtists?: string;
  coverUrl?: string | null;
  audioUrl?: string | null;
  videoUrl?: string | null;
  artistPhotoUrl?: string | null;
  codigoUnico?: string | null;
  genero?: string | null;
  [campo: string]: unknown;
}

export interface FaixaPlaylist {
  /** codigo_unico do catálogo; sem ele, a identidade do título do chart. */
  chave: string;
  pos: number;
  valor: string;
  titulo: string;
  artista: string;
  capa_url: string | null;
  tocavel: boolean;
  musica: ItemCatalogoPlaylist | null;
  clipe: ItemCatalogoPlaylist | null;
  /** Só nas playlists de gênero: posição da faixa no Global 100. */
  posGlobal?: number;
}

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
  globais: CartaoPlaylist[];
  paises: Record<PlataformaPlaylist, CartaoPlaylist[]>;
  paradas: CartaoPlaylist[];
  generos: CartaoPlaylist[];
}

const ROTA = "/api/empire-play/playlists";

export function indiceVazio(i: IndicePlaylists | null | undefined): boolean {
  if (!i) return true;
  return (
    !i.destaque &&
    !i.globais?.length &&
    !i.paises?.spotify?.length &&
    !i.paises?.apple?.length &&
    !i.paises?.youtube?.length &&
    !i.paradas?.length &&
    !i.generos?.length
  );
}

const ultimoBom = new Map<string, unknown>();

async function buscar<T>(url: string, vazio: (d: T) => boolean): Promise<T> {
  try {
    const r = await fetch(url);
    const corpo = (await r.json().catch(() => null)) as {
      success?: boolean;
      data?: T;
      error?: string;
    } | null;
    if (!r.ok || !corpo?.success || corpo.data == null) {
      if (ultimoBom.has(url)) return ultimoBom.get(url) as T;
      throw new Error(corpo?.error || `HTTP ${r.status}`);
    }
    if (vazio(corpo.data) && ultimoBom.has(url)) return ultimoBom.get(url) as T;
    ultimoBom.set(url, corpo.data);
    return corpo.data;
  } catch (err) {
    if (ultimoBom.has(url)) return ultimoBom.get(url) as T;
    throw err;
  }
}

/** Destaque + prateleiras. */
export function getIndicePlaylists(): Promise<IndicePlaylists> {
  return buscar<IndicePlaylists>(ROTA, indiceVazio);
}

/** Uma playlist pelo id ("ao-vivo:spotify", "pais:apple:BRASIL", "semana:hot"...). */
export function getPlaylist(id: string): Promise<Playlist> {
  return buscar<Playlist>(`${ROTA}?id=${encodeURIComponent(id)}`, (p) => !p.faixas?.length);
}

/** Plataforma de um id de playlist (null nas da semana: Global 100, paradas, gêneros, Hot). */
export function plataformaDoId(id: string): PlataformaPlaylist | null {
  const [grupo, plat] = id.split(":");
  if (
    (grupo === "ao-vivo" || grupo === "pais") &&
    (plat === "spotify" || plat === "apple" || plat === "youtube")
  )
    return plat;
  return null;
}
