// Empire Charts — mesma API (Google Apps Script) que o app externo
// (public/charts-app/) já usava, só que agora chamada direto das telas
// React do PWA, sem passar por um iframe pra um site separado.
const CHARTS_API =
  "https://script.google.com/macros/s/AKfycbyDQK3x0fU5V6qnFgtRyf8IPTNPDm2eeQsvZRwmHnCb_sCKLyc8wuwhuNZxEWjGEiYe/exec";

// Cache em memória por URL — evita refetch repetido ao trocar de aba e
// voltar (mesmo comportamento do app antigo).
const cache = new Map<string, Promise<any>>();
function fetchCached(url: string): Promise<any> {
  if (!cache.has(url)) {
    const p = fetch(url, { redirect: "follow" })
      .then((r) => r.json())
      .catch((err) => {
        cache.delete(url);
        throw err;
      });
    cache.set(url, p);
  }
  return cache.get(url)!;
}

// Os nomes dos campos variam por planilha/fonte (legado) — os componentes
// leem com fallback em cadeia (ex: pos || posicao || p), então aqui é só
// um saco de props solto mesmo.
export type ChartRow = Record<string, any>;

export interface ChartFilters {
  dates: string[];
  styles?: string[];
}

export interface TopArtistCover {
  name?: string;
  img?: string;
  headline?: string;
  editorial?: string;
  author?: string;
  month?: string;
  pts?: string;
  error?: string;
}

export interface ReleaseItem {
  tipo?: string;
  musica?: string;
  titulo?: string;
  t?: string;
  data?: string;
}

export interface BannerN1Item {
  capa?: string;
  tit?: string;
  art?: string;
}

export interface BannerN1s {
  hot100?: BannerN1Item;
  spotify?: BannerN1Item;
  apple?: BannerN1Item;
  youtube?: BannerN1Item;
  sales?: BannerN1Item;
  bb200?: BannerN1Item;
}

export interface RealTimeData {
  spotify?: ChartRow[];
  apple?: ChartRow[];
  youtube?: ChartRow[];
}

export async function getRealTime(): Promise<RealTimeData> {
  return fetchCached(`${CHARTS_API}?action=getRealTime`);
}

export async function getBannerN1s(): Promise<BannerN1s> {
  return fetchCached(`${CHARTS_API}?action=getBannerN1s`);
}

export async function getTopArtistCover(): Promise<TopArtistCover> {
  return fetchCached(`${CHARTS_API}?action=getTopArtistCover`);
}

export async function getReleases(): Promise<ReleaseItem[]> {
  return fetchCached(`${CHARTS_API}?action=getReleases`);
}

export async function getChartFilters(tab: string): Promise<ChartFilters> {
  return fetchCached(`${CHARTS_API}?action=getFilters&tab=${encodeURIComponent(tab)}`);
}

export async function getChartData(tab: string, date: string): Promise<ChartRow[]> {
  return fetchCached(`${CHARTS_API}?action=getChart&tab=${encodeURIComponent(tab)}&date=${encodeURIComponent(date)}`);
}

export async function getMonthlyYears(): Promise<string[]> {
  return fetchCached(`${CHARTS_API}?action=getMonthlyYears`);
}

export async function getMonthlyDates(year: string): Promise<string[]> {
  return fetchCached(`${CHARTS_API}?action=getMonthlyDates&year=${encodeURIComponent(year)}`);
}

export async function getMonthlyArtists(platform: string, month: string, year: string): Promise<string[]> {
  return fetchCached(
    `${CHARTS_API}?action=getArtists&platform=${encodeURIComponent(platform)}&month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`,
  );
}

export async function getMonthlyStats(
  platform: string,
  month: string,
  year: string,
  artist: string,
): Promise<ChartRow[]> {
  return fetchCached(
    `${CHARTS_API}?action=getMonthlyStats&platform=${encodeURIComponent(platform)}&month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}&artist=${encodeURIComponent(artist)}`,
  );
}

// "site\n\n<b>TÍTULO</b>\n\ntexto" → parágrafos estruturados, pro editorial
// da home renderizar sem precisar de dangerouslySetInnerHTML na maior parte.
export interface EditorialLine {
  kind: "site" | "headline" | "para";
  text: string;
}

export function parseEditorial(text: string | undefined): EditorialLine[] {
  if (!text) return [];
  const clean = text.replace(/<(?!b>|\/b>)[^>]+>/gi, "");
  const lines = clean
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((line, i): EditorialLine => {
    if (i === 0) return { kind: "site", text: line };
    const isBold = line.startsWith("<b>") || (line === line.toUpperCase() && line.length < 120);
    if (isBold) return { kind: "headline", text: line.replace(/<\/?b>/g, "") };
    return { kind: "para", text: line };
  });
}
