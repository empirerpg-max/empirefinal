import { googleSheetsService } from "../services/googleSheetsService";

// Empire Charts — migrado do Apps Script (script.google.com/macros/.../exec)
// que servia isso antes. Mesma lógica, linha por linha, só trocando
// SpreadsheetApp.getDataRange().getDisplayValues() (lento, sem streaming,
// escaneia a aba inteira toda vez, cache de 10min no CacheService que não
// ajudava em nada fora da janela) por leitura direta via Sheets API
// (googleSheetsService), como o resto do app já faz. As 7 planilhas abaixo
// são as mesmas do Apps Script original (const IDS) — nada a ver com
// registrosCharts/edicaoCharts.

type Row = string[];

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function jsonErr(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// Mesma lógica do fmt() original: "-"/vazio → "0", senão número formatado
// pt-BR (separador de milhar).
function fmt(v: unknown): string {
  const s = String(v ?? "");
  if (!s || s === "-") return "0";
  const n = Number(s.replace(/[^\d]/g, ""));
  return n.toLocaleString("pt-BR");
}

// Mesma lógica do fixImg() original: extrai o ID do Drive de dentro de
// qualquer formato de link (uc?id=, /file/d/.../view, thumbnail?id=, etc)
// e devolve um link de thumbnail padronizado. O frontend já sabe rotear
// qualquer link drive.google.com pelo proxy autenticado (resolveImg).
function fixImg(u: unknown): string {
  const s = String(u ?? "");
  if (!s || s === "-") return "https://via.placeholder.com/400";
  const m = s.match(/[-\w]{25,}/);
  return m ? `https://drive.google.com/thumbnail?id=${m[0]}&sz=s1000` : s;
}

async function readSheet(spreadsheetKey: keyof typeof googleSheetsService, sheetName: string): Promise<Row[]> {
  const svc = googleSheetsService[spreadsheetKey] as { readValues: (s: string) => Promise<Row[]> };
  const rows = await svc.readValues(sheetName).catch(() => []);
  return rows || [];
}

// ---- FILTROS ----
async function fetchF(tab: string): Promise<{ dates: string[]; styles: string[] }> {
  const isA = tab === "DADOS ÁLBUNS";
  const isC = tab.includes("COUNTRIES");
  const key = isA ? "chartsAlbums" : isC ? "chartsCountries" : "chartsBase";
  const data = await readSheet(key, tab);
  if (data.length === 0) return { dates: [], styles: [] };

  if (isC) {
    // COUNTRIES: A=País, B=Posição, C=Chart, D=Música, E=Streams, F=Mês, G=Artista, H=Capa
    const months = [...new Set(data.slice(1).map((r) => r[5]).filter(Boolean))];
    return { dates: months.reverse(), styles: [] };
  }

  const dates = [...new Set(data.slice(1).map((r) => r[1]).filter(Boolean))].reverse();
  // ÁLBUNS: coluna de gênero é a L (índice 11) — usar a E (índice 4, valor
  // semanal) aqui juntava números de pontuação como se fossem "estilos".
  const styles = isA
    ? [...new Set(data.slice(1).map((r) => r[11]).filter(Boolean))].sort()
    : [...new Set(data.slice(1).map((r) => r[17]).filter(Boolean))].sort();
  return { dates, styles };
}

// ---- CHART ----
async function fetchC(tab: string, date: string, style: string): Promise<unknown[]> {
  const isA = tab === "DADOS ÁLBUNS";
  const isC = tab.includes("COUNTRIES");
  const key = isA ? "chartsAlbums" : isC ? "chartsCountries" : "chartsBase";
  const data = await readSheet(key, tab);
  if (data.length === 0) return [];

  if (isC) {
    const chartName = tab.replace(" COUNTRIES", "");
    return data
      .slice(1)
      .filter((r) => r[5] === date && (r[2] || "").toUpperCase().includes(chartName.split(" ")[0]))
      .map((r) => ({
        pais: r[0],
        pos: r[1],
        tit: r[3],
        val: fmt(r[4]),
        mes: r[5],
        art: r[6],
        capa: fixImg(r[7]),
      }));
  }

  return data
    .slice(1)
    .filter((r) => r[1] == date && (style ? (isA ? r[11] == style : r[17] == style) : true))
    .map((r) =>
      isA
        ? {
            pos: r[2],
            tit: r[3],
            val: fmt(r[4]),
            valTotal: fmt(r[5]),
            st: r[7],
            capa: fixImg(r[10]),
            art: r[12],
            style: r[11],
          }
        : {
            pos: r[2],
            tit: r[3],
            val: fmt(r[4]),
            valTotal: fmt(r[5]),
            art: r[7],
            st: r[13],
            capa: fixImg(r[15]),
            style: r[17],
          },
    );
}

// ---- REAL TIME ----
async function fetchRT(): Promise<{ spotify: unknown[]; apple: unknown[]; youtube: unknown[] }> {
  const data = await readSheet("chartsRealtime", "EM Alta");
  const out: { spotify: unknown[]; apple: unknown[]; youtube: unknown[] } = { spotify: [], apple: [], youtube: [] };
  data.slice(1).forEach((r) => {
    if (!r[1]) return;
    const item = { t: r[1], s: fmt(r[3]), p: r[5], c: fixImg(r[6]) };
    const plat = (r[4] || "").toLowerCase();
    if (plat.includes("spotify")) out.spotify.push(item);
    else if (plat.includes("apple")) out.apple.push(item);
    else out.youtube.push(item);
  });
  return out;
}

// ---- HOF LIST / PROFILE ----
async function fetchHOFList(): Promise<unknown[]> {
  const data = await readSheet("chartsBase", "HALL_OF_FAME_DB");
  return data
    .slice(1)
    .map((r) => ({ name: r[0], img: fixImg(r[1]), country: r[2], style: r[3] }))
    .filter((a) => a.name !== "");
}

function parseHOFList(str: string | undefined): { t: string; v: string }[] {
  if (!str || str === "-") return [];
  return str.split(",").map((item) => {
    const parts = item.split("|");
    return { t: parts[0], v: parts[1] };
  });
}

async function fetchHOFProfile(artist: string): Promise<unknown> {
  const data = await readSheet("chartsBase", "HALL_OF_FAME_DB");
  const r = data.find((row) => (row[0] || "").trim().toUpperCase() === artist.trim().toUpperCase());
  if (!r) return {};
  return {
    name: r[0],
    img: fixImg(r[1]),
    country: r[2],
    style: r[3],
    n1_hot100: r[4],
    n1_spotify: r[5],
    n1_youtube: r[6],
    n1_bb200: r[7],
    yt: parseHOFList(r[8]),
    sp: parseHOFList(r[9]),
    am: parseHOFList(r[10]),
    alb: parseHOFList(r[11]),
    runs: parseHOFList(r[12]),
  };
}

// ---- MONTHLY STATS ----
async function fetchM(p: string, m: string, a: string, y: string): Promise<unknown[]> {
  const [rows, top] = await Promise.all([
    readSheet("chartsMonthly", "RESUMO MENSAL"),
    readSheet("chartsMonthly", "TOP 50 ARTISTAS"),
  ]);
  const res: { n: string; m: unknown[]; rank: string; ov?: string; capa?: string; bio?: string } = {
    n: a,
    m: [],
    rank: "-",
  };
  const rnk = top.find((r) => r[0] == y && r[1] == m && r[2] == p && r[4] == a);
  if (rnk) res.rank = rnk[3];
  rows.forEach((r) => {
    if (r[0] == y && r[1] == m && r[2] == p && r[3] == a) {
      res.ov = fmt(r[6]);
      res.capa = fixImg(r[7]);
      res.bio = r[10];
      res.m.push({ t: r[4], s: fmt(r[5]), c: fixImg(r[8]) });
    }
  });
  return [res];
}

async function fetchMY(): Promise<string[]> {
  const data = await readSheet("chartsMonthly", "RESUMO MENSAL");
  return [...new Set(data.slice(1).map((r) => r[0]).filter(Boolean))].reverse();
}

async function fetchMD(y: string): Promise<string[]> {
  const data = await readSheet("chartsMonthly", "RESUMO MENSAL");
  return [
    ...new Set(
      data
        .slice(1)
        .filter((r) => r[0] == y)
        .map((r) => r[1]),
    ),
  ].reverse();
}

async function fetchA(p: string, m: string, y: string): Promise<string[]> {
  const data = await readSheet("chartsMonthly", "RESUMO MENSAL");
  return [
    ...new Set(
      data
        .slice(1)
        .filter((r) => r[2] == p && r[1] == m && r[0] == y)
        .map((r) => r[3]),
    ),
  ].sort();
}

// ---- BANNER: #1 de cada plataforma na semana mais recente ----
function parseDateBR(s: string | undefined): Date {
  if (!s) return new Date(0);
  const p = s.split("/");
  if (p.length === 3) return new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]));
  return new Date(s);
}

function latestRow(rows: Row[]): Row | undefined {
  const valid = rows.filter((r) => r[1] && r[2]);
  let latestDate = new Date(0);
  valid.forEach((r) => {
    const d = parseDateBR(r[1]);
    if (d > latestDate) latestDate = d;
  });
  const latest = valid.filter((r) => parseDateBR(r[1]).getTime() === latestDate.getTime());
  latest.sort((a, b) => Number(a[2]) - Number(b[2]));
  return latest[0];
}

async function fetchBannerN1s(): Promise<Record<string, unknown>> {
  const platforms: { key: string; tab: string }[] = [
    { key: "hot100", tab: "BILLBOARD HOT 100" },
    { key: "spotify", tab: "SPOTIFY" },
    { key: "apple", tab: "APPLE MUSIC" },
    { key: "youtube", tab: "YOUTUBE" },
    { key: "sales", tab: "DIGITAL SALES" },
  ];
  const result: Record<string, unknown> = {};

  await Promise.all(
    platforms.map(async ({ key, tab }) => {
      const data = await readSheet("chartsBase", tab);
      if (data.length === 0) return;
      const row = latestRow(data.slice(1));
      if (row) {
        result[key] = { tit: row[3] || "", art: row[7] || "", capa: fixImg(row[15] || row[16] || "") };
      }
    }),
  );

  try {
    const data = await readSheet("chartsAlbums", "DADOS ÁLBUNS");
    if (data.length > 0) {
      const row = latestRow(data.slice(1));
      if (row) {
        result["bb200"] = { tit: row[3] || "", art: row[11] || "", capa: fixImg(row[10] || "") };
      }
    }
  } catch {
    // silencioso — mesmo comportamento do original (try/catch por seção)
  }

  return result;
}

// ---- HOME COVER: artista #1 do mês mais recente ----
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

async function fetchTopArtistCover(): Promise<Record<string, unknown>> {
  const data = await readSheet("chartsTop50", "TOP_50_ARTISTAS_MENSAL");
  if (data.length === 0) return {};

  const rows = data.slice(1).filter((r) => r[0] && r[1] && (r[2] || "").toString().trim() === "1");
  if (rows.length === 0) return {};

  rows.sort((a, b) => {
    const yearDiff = Number(b[0]) - Number(a[0]);
    if (yearDiff !== 0) return yearDiff;
    const mi = MESES.indexOf((b[1] || "").trim());
    const mj = MESES.indexOf((a[1] || "").trim());
    return (mi < 0 ? 0 : mi) - (mj < 0 ? 0 : mj);
  });

  const r = rows[0];
  return {
    name: r[3] || "",
    pts: fmt(r[4]),
    month: `${r[1]} ${r[0]}`,
    author: r[5] || "",
    headline: r[6] || "",
    bio: r[7] || "",
    editorial: r[9] || "",
    img: fixImg(r[12] || ""),
  };
}

// ---- LANÇAMENTOS ----
async function fetchReleases(): Promise<unknown[]> {
  const data = await readSheet("chartsReleases", "LANÇAMENTOS");
  if (data.length === 0) return [];
  return data
    .slice(2)
    .filter((r) => r[0] && r[1])
    .map((r) => ({ data: r[0], musica: r[1], tipo: r[2] || "" }))
    .reverse();
}

/**
 * GET /api/charts?action=<action>&...
 * Mesmo contrato de query params que o Apps Script antigo servia — o
 * frontend (src/lib/charts.ts) só trocou a base da URL, nada mais.
 */
export async function chartsApiController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const p = url.searchParams;
  const action = p.get("action") || "";

  try {
    switch (action) {
      case "getRealTime":
        return jsonOk(await fetchRT());
      case "getFilters":
        return jsonOk(await fetchF(p.get("tab") || ""));
      case "getChart":
        return jsonOk(await fetchC(p.get("tab") || "", p.get("date") || "", p.get("style") || ""));
      case "getMonthlyStats":
        return jsonOk(
          await fetchM(p.get("platform") || "", p.get("month") || "", p.get("artist") || "", p.get("year") || ""),
        );
      case "getMonthlyYears":
        return jsonOk(await fetchMY());
      case "getMonthlyDates":
        return jsonOk(await fetchMD(p.get("year") || ""));
      case "getArtists":
        return jsonOk(await fetchA(p.get("platform") || "", p.get("month") || "", p.get("year") || ""));
      case "getHOFList":
        return jsonOk(await fetchHOFList());
      case "getHOFProfile":
        return jsonOk(await fetchHOFProfile(p.get("artist") || ""));
      case "getBannerN1s":
        return jsonOk(await fetchBannerN1s());
      case "getTopArtistCover":
        return jsonOk(await fetchTopArtistCover());
      case "getReleases":
        return jsonOk(await fetchReleases());
      default:
        return jsonErr(`Ação desconhecida: ${action}`);
    }
  } catch (err: any) {
    console.error("[chartsApiController] Erro:", err);
    return jsonErr(err.message || "Erro ao carregar Charts.");
  }
}
