import {
  googleSheetsService,
  normalizeComparison,
  normalizeHeader,
  normalizeText,
  SheetRecord,
} from "../services/googleSheetsService";

export type CatalogKind = "musicas" | "music-videos" | "videos" | "albuns";

export interface CatalogFilters {
  artist?: string;
  month?: string;
  search?: string;
}

export interface CatalogItem {
  id: string;
  type: CatalogKind | "top-playlist";
  sheetName: string;
  title: string;
  artist: string;
  album: string | null;
  cover: string | null;
  link: string | null;
  releaseDate: string | null;
  releaseDateIso: string | null;
  releaseMonth: string | null;
  position: number | null;
  telegramTopicId: string | null;
  fields: SheetRecord;
}

export interface TopPlaylistsResponse {
  spotify: CatalogItem[];
  appleMusic: CatalogItem[];
  youtube: CatalogItem[];
}

// "Videos" não existe mais como aba própria — Vídeos e Music Videos foram
// consolidados em "Music Videos", diferenciados pela coluna "Tipo de vídeo".
const CATALOG_SHEETS: Record<CatalogKind, string> = {
  musicas: "Musicas",
  "music-videos": "Music Videos",
  videos: "Music Videos",
  albuns: "Albuns",
};

const TOP_PLAYLIST_SHEETS = {
  spotify: "Top_50_Spotify",
  appleMusic: "Top_Songs_Apple_Music",
  youtube: "Top_Videos_YT",
} as const;

function getValue(record: SheetRecord, aliases: string[]): string | null {
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const value = record[normalizedAlias];
    if (normalizeText(value)) {
      return normalizeText(value);
    }
  }
  return null;
}

function parseDateToIso(value: string | null): string | null {
  if (!value) return null;

  const ddmmyyyy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const yyyymmdd = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (yyyymmdd) {
    return `${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function extractReleaseMonth(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const [year, month] = isoDate.split("-");
  return `${month}/${year}`;
}

function matchesMonth(isoDate: string | null, requestedMonth?: string): boolean {
  if (!requestedMonth) return true;
  if (!isoDate) return false;

  const filter = requestedMonth.trim();
  const [year, month] = isoDate.split("-");
  const mmYyyy = `${month}/${year}`;
  const yyyyMm = `${year}-${month}`;

  return (
    filter === mmYyyy || filter === yyyyMm || filter === `${month}-${year}` || filter === month
  );
}

function buildCatalogItem(
  kind: CatalogKind | "top-playlist",
  sheetName: string,
  record: SheetRecord,
  index: number,
): CatalogItem {
  const title =
    getValue(record, [
      "nome_da_musica",
      "nome_do_video",
      "nome_do_album",
      "nome",
      "titulo",
      "titulo_do_video",
      "titulo_do_album",
    ]) || "";

  const artist =
    getValue(record, ["act_principal", "artista", "nome_do_criador", "nome_do_artista"]) || "";

  const album = getValue(record, ["album", "nome_do_album", "album_nome"]);
  const cover = getValue(record, [
    "capa_da_musica",
    "capa_do_album",
    "thumb",
    "capa",
    "thumbnail_url",
  ]);
  const link = getValue(record, ["link_do_audio", "link_audio", "link", "telegram_file_url"]);
  const releaseDate = getValue(record, ["data_de_lancamento", "data_lancamento", "data"]);
  const releaseDateIso = parseDateToIso(releaseDate);
  const positionValue = getValue(record, ["posicao", "posição"]);
  const parsedPosition =
    positionValue && !Number.isNaN(Number(positionValue)) ? Number(positionValue) : null;
  const telegramTopicId = getValue(record, ["id_do_topico", "telegram_topic_id"]);

  return {
    id: `${sheetName}:${telegramTopicId || title || index + 1}`,
    type: kind,
    sheetName,
    title,
    artist,
    album,
    cover,
    link,
    releaseDate,
    releaseDateIso,
    releaseMonth: extractReleaseMonth(releaseDateIso),
    position: parsedPosition,
    telegramTopicId,
    fields: record,
  };
}

function compareCatalogItems(a: CatalogItem, b: CatalogItem): number {
  if (a.releaseDateIso && b.releaseDateIso) {
    return b.releaseDateIso.localeCompare(a.releaseDateIso);
  }

  if (a.position !== null && b.position !== null) {
    return a.position - b.position;
  }

  return a.title.localeCompare(b.title, "pt-BR");
}

function matchesFilters(item: CatalogItem, filters: CatalogFilters): boolean {
  const normalizedArtist = normalizeComparison(filters.artist);
  const normalizedSearch = normalizeComparison(filters.search);
  const haystack = normalizeComparison(
    [item.title, item.artist, item.album, Object.values(item.fields).join(" ")]
      .filter(Boolean)
      .join(" "),
  );

  if (normalizedArtist) {
    const artistField = normalizeComparison(item.artist);
    if (!artistField.includes(normalizedArtist)) {
      return false;
    }
  }

  if (!matchesMonth(item.releaseDateIso, filters.month)) {
    return false;
  }

  if (normalizedSearch && !haystack.includes(normalizedSearch)) {
    return false;
  }

  return true;
}

export async function getTopPlaylists(): Promise<TopPlaylistsResponse> {
  const [spotifyRows, appleMusicRows, youtubeRows] = await Promise.all([
    googleSheetsService.principal.readSheetObjects(TOP_PLAYLIST_SHEETS.spotify),
    googleSheetsService.principal.readSheetObjects(TOP_PLAYLIST_SHEETS.appleMusic),
    googleSheetsService.principal.readSheetObjects(TOP_PLAYLIST_SHEETS.youtube),
  ]);

  return {
    spotify: spotifyRows
      .map((record, index) =>
        buildCatalogItem("top-playlist", TOP_PLAYLIST_SHEETS.spotify, record, index),
      )
      .sort(compareCatalogItems),
    appleMusic: appleMusicRows
      .map((record, index) =>
        buildCatalogItem("top-playlist", TOP_PLAYLIST_SHEETS.appleMusic, record, index),
      )
      .sort(compareCatalogItems),
    youtube: youtubeRows
      .map((record, index) =>
        buildCatalogItem("top-playlist", TOP_PLAYLIST_SHEETS.youtube, record, index),
      )
      .sort(compareCatalogItems),
  };
}

export async function getRecentReleases(limit = 30): Promise<CatalogItem[]> {
  const records = await googleSheetsService.principal.readSheetObjects(CATALOG_SHEETS.musicas);

  return records
    .map((record, index) => buildCatalogItem("musicas", CATALOG_SHEETS.musicas, record, index))
    .filter((item) => item.releaseDateIso)
    .sort(compareCatalogItems)
    .slice(0, limit);
}

export async function getCatalog(
  kind: CatalogKind,
  filters: CatalogFilters,
): Promise<CatalogItem[]> {
  const sheetName = CATALOG_SHEETS[kind];
  const records = await googleSheetsService.principal.readSheetObjects(sheetName);

  return records
    .map((record, index) => buildCatalogItem(kind, sheetName, record, index))
    .filter((item) => matchesFilters(item, filters))
    .sort(compareCatalogItems);
}

// Controller HTTP helpers
export async function getTopPlaylistsController(): Promise<Response> {
  try {
    const data = await getTopPlaylists();
    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao buscar top playlists.";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

export async function getLancamentosController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "30", 10)));

  try {
    const data = await getRecentReleases(limit);
    return new Response(JSON.stringify({ success: true, data, meta: { limit } }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao buscar lançamentos.";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

export async function getCatalogKindController(
  kind: CatalogKind,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const filters: CatalogFilters = {
    artist: url.searchParams.get("artist") || undefined,
    month: url.searchParams.get("mes") || undefined,
    search: url.searchParams.get("q") || url.searchParams.get("search") || undefined,
  };

  try {
    const data = await getCatalog(kind, filters);
    return new Response(
      JSON.stringify({ success: true, data, meta: { total: data.length, filters } }),
      {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : `Erro ao buscar catálogo: ${kind}.`;
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
