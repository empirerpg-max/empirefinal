// Empire Charts — antes chamava um Google Apps Script direto do navegador
// (SpreadsheetApp.getDataRange() escaneando a aba inteira a cada request,
// minutos de latência, sem CDN). Migrado pro próprio Worker
// (backend/src/controllers/chartsController.ts), que lê as mesmas 7
// planilhas via Sheets API — mesmíssimo contrato de query params
// (?action=...), só a base da URL mudou.
const CHARTS_API = "/api/charts";

// Cache em memória por URL — evita refetch repetido ao trocar de aba e
// voltar (mesmo comportamento do app antigo). Nunca guarda um resultado
// vazio/erro: sem essa checagem, uma resposta vazia por instabilidade
// transitória do backend ficava presa em cache pro resto da sessão (sem
// TTL nenhum aqui), e a tela voltava vazia toda vez que era remontada —
// só um reload completo (perdendo esse Map) resolvia de verdade.
const cache = new Map<string, Promise<any>>();
function isEmptyish(data: unknown): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if ("error" in obj) return true;
  }
  return false;
}
function fetchCached(url: string): Promise<any> {
  if (!cache.has(url)) {
    const p = fetch(url, { redirect: "follow" })
      .then((r) => r.json())
      .then((data) => {
        if (isEmptyish(data)) cache.delete(url);
        return data;
      })
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

export interface HOFRun {
  t: string;
  v: string;
}

export interface HOFTrack {
  t: string;
  v: string;
}

export interface HOFProfile {
  name?: string;
  img?: string;
  country?: string;
  style?: string;
  runs?: HOFRun[];
  n1_hot100?: string | number;
  n1_spotify?: string | number;
  n1_youtube?: string | number;
  n1_bb200?: string | number;
  sp?: HOFTrack[];
  am?: HOFTrack[];
  yt?: HOFTrack[];
  alb?: HOFTrack[];
}

// Perfil de Hall of Fame de um artista — pode não existir pra artistas
// ainda sem posições em nenhum chart (retorna sem "name").
export async function getHOFProfile(artist: string): Promise<HOFProfile | null> {
  try {
    const d = await fetchCached(`${CHARTS_API}?action=getHOFProfile&artist=${encodeURIComponent(artist)}`);
    return d && d.name ? d : null;
  } catch {
    return null;
  }
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
