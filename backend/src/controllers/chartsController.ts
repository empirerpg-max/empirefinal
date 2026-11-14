import { googleSheetsService } from "../services/googleSheetsService";
import { normalizarTitulo, type MusicaCatalogo } from "../services/chartsD1/artistas";
import { fixImg, fmt } from "../services/chartsD1/formato";
import { getCatalogoDb, type D1DatabaseLike } from "../services/catalogoDbService";
import { CHARTS, CHARTS_COM_PAIS, type ChartId } from "../services/chartsD1/tipos";
import {
  CHARTS_HOF, carregarCatalogo, carregarFotos, datasDoChart, generosDoChart, linhasDoChart, linhasPaises,
  numero1DaUltimaSemana, perfilHOF, temPesosPais,
} from "../services/chartsD1/repo";

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

async function readSheet(spreadsheetKey: keyof typeof googleSheetsService, sheetName: string): Promise<Row[]> {
  const svc = googleSheetsService[spreadsheetKey] as { readValues: (s: string) => Promise<Row[]> };
  const rows = await svc.readValues(sheetName).catch(() => []);
  return rows || [];
}

// ---- D1 (5 charts semanais + COUNTRIES) ----
// Se o chart já tem semanas no D1, a leitura vem de lá; senão (corte ainda
// não carregado, banco ausente ou erro) segue o caminho da planilha abaixo.
// Datas por chart e catálogo/fotos ficam em cache por isolate com o mesmo
// TTL das respostas (limparCacheCharts zera tudo após uma ingestão).
interface ReferenciasD1 {
  cat: Map<string, MusicaCatalogo>;
  fotos: Map<string, string>;
}
const datasD1Cache = new Map<ChartId, { valor: Promise<string[]>; expiresAt: number }>();
let referenciasD1Cache: { valor: Promise<ReferenciasD1>; expiresAt: number } | null = null;

function datasD1(db: D1DatabaseLike, chart: ChartId): Promise<string[]> {
  const c = datasD1Cache.get(chart);
  if (c && c.expiresAt > Date.now()) return c.valor;
  const valor = datasDoChart(db, chart);
  const entrada = { valor, expiresAt: Date.now() + CHARTS_RESPONSE_CACHE_TTL_MS };
  valor.catch(() => {
    if (datasD1Cache.get(chart) === entrada) datasD1Cache.delete(chart);
  });
  datasD1Cache.set(chart, entrada);
  return valor;
}

function referenciasD1(db: D1DatabaseLike): Promise<ReferenciasD1> {
  if (referenciasD1Cache && referenciasD1Cache.expiresAt > Date.now()) return referenciasD1Cache.valor;
  const valor = Promise.all([carregarCatalogo(db), carregarFotos(db)]).then(([cat, fotos]) => ({ cat, fotos }));
  const entrada = { valor, expiresAt: Date.now() + CHARTS_RESPONSE_CACHE_TTL_MS };
  valor.catch(() => {
    if (referenciasD1Cache === entrada) referenciasD1Cache = null;
  });
  referenciasD1Cache = entrada;
  return valor;
}

/** Aba de /api/charts → chart do D1 ("SPOTIFY COUNTRIES" → SPOTIFY + países); null se não migrada. */
function chartD1DaAba(tab: string): { chart: ChartId; paises: boolean } | null {
  if ((CHARTS as string[]).includes(tab)) return { chart: tab as ChartId, paises: false };
  const base = tab.endsWith(" COUNTRIES") ? tab.slice(0, -" COUNTRIES".length) : "";
  if ((CHARTS_COM_PAIS as string[]).includes(base)) return { chart: base as ChartId, paises: true };
  return null;
}

/** Roda `ler` no D1 se o chart tem dados lá; `undefined` (inclusive vindo de `ler`) = usar a planilha. */
async function viaD1<T>(
  chart: ChartId,
  ler: (db: D1DatabaseLike, datas: string[]) => Promise<T | undefined>,
): Promise<T | undefined> {
  const db = getCatalogoDb();
  if (!db) return undefined;
  try {
    const datas = await datasD1(db, chart);
    if (!datas.length) return undefined;
    return await ler(db, datas);
  } catch (e) {
    console.warn(`[charts-d1] leitura de ${chart} no D1 falhou; usando a planilha:`, e);
    return undefined;
  }
}

// ---- FILTROS ----
async function fetchF(tab: string): Promise<{ dates: string[]; styles: string[] }> {
  const alvo = chartD1DaAba(tab);
  if (alvo) {
    const d1 = await viaD1(alvo.chart, async (db, datas) => {
      if (alvo.paises) return (await temPesosPais(db, alvo.chart)) ? { dates: datas, styles: [] } : undefined;
      return { dates: datas, styles: await generosDoChart(db, alvo.chart, (await referenciasD1(db)).cat) };
    });
    if (d1) return d1;
  }

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
  const alvo = chartD1DaAba(tab);
  if (alvo) {
    const d1 = await viaD1<unknown[]>(alvo.chart, async (db) => {
      // Sem pesos de país no D1, COUNTRIES ainda é da planilha.
      if (alvo.paises && !(await temPesosPais(db, alvo.chart))) return undefined;
      const { cat, fotos } = await referenciasD1(db);
      return alvo.paises
        ? linhasPaises(db, alvo.chart, date, cat, fotos)
        : linhasDoChart(db, alvo.chart, date, style, cat, fotos);
    });
    if (d1) return d1;
  }

  const isA = tab === "DADOS ÁLBUNS";
  const isC = tab.includes("COUNTRIES");
  const key = isA ? "chartsAlbums" : isC ? "chartsCountries" : "chartsBase";
  const [data, capaPorTitulo] = await Promise.all([readSheet(key, tab), buildCapaPorTituloCatalogo()]);
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
        capa: fixImg(r[7]) || fixImg(capaPorTitulo.get(normalizarTitulo(r[3] || ""))),
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
            capa: fixImg(r[10]) || fixImg(capaPorTitulo.get(normalizarTitulo(r[3] || ""))),
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
            capa: fixImg(r[15]) || fixImg(capaPorTitulo.get(normalizarTitulo(r[3] || ""))),
            style: r[17],
          },
    );
}

// Musicas!H guarda "Artista - Título" (não só o título) — o cruzamento por
// título puro (ex.: "EM Alta"!B, só o nome da faixa) nunca batia com isso,
// então indexa tanto a string completa quanto só a parte depois do
// "Artista - " (quando existir), cobrindo os dois formatos usados nas
// diferentes abas de origem (EM Alta, BILLBOARD HOT 100, SPOTIFY, etc.).
async function buildCapaPorTituloCatalogo(): Promise<Map<string, string>> {
  const musicas = await readSheet("principal", "Musicas").catch(() => [] as Row[]);
  // Uma mesma faixa pode existir em duas linhas da planilha Musicas: a
  // original (single) e a versão dentro de um álbum ("TRACKLIST ALBUM",
  // coluna I). Quando isso acontece, a capa do SINGLE deve vencer — senão
  // o card mostra a capa do álbum pra uma faixa que é, na verdade, single
  // (bug relatado: "Rose Thompson - Boulangerie" mostrando capa do álbum).
  const capaPorTitulo = new Map<string, string>();
  const tipoPorTitulo = new Map<string, string>();
  const registra = (chave: string, capa: string, tipoSingle: string) => {
    if (!chave || !capa) return;
    const ehFaixaDeAlbum = tipoSingle === "TRACKLIST ALBUM";
    const tipoAtual = tipoPorTitulo.get(chave);
    if (!capaPorTitulo.has(chave) || (tipoAtual === "TRACKLIST ALBUM" && !ehFaixaDeAlbum)) {
      capaPorTitulo.set(chave, capa);
      tipoPorTitulo.set(chave, tipoSingle);
    }
  };
  musicas.slice(1).forEach((r) => {
    const nomeCompleto = (r[7] || "").trim();
    const capa = (r[3] || "").trim();
    if (!nomeCompleto || !capa) return;
    const tipoSingle = (r[8] || "").trim().toUpperCase();
    registra(normalizarTitulo(nomeCompleto), capa, tipoSingle);
    const partes = nomeCompleto.split(" - ");
    if (partes.length > 1) {
      registra(normalizarTitulo(partes.slice(1).join(" - ")), capa, tipoSingle);
    }
  });
  return capaPorTitulo;
}

// ---- REAL TIME ----
async function fetchRT(): Promise<{ spotify: unknown[]; apple: unknown[]; youtube: unknown[] }> {
  const [data, capaPorTitulo] = await Promise.all([
    readSheet("chartsRealtime", "EM Alta"),
    // A aba "EM Alta" quase nunca vem com a própria coluna de capa (G)
    // preenchida — cruza por título com o catálogo real (Musicas, planilha
    // principal) pra herdar a capa de verdade, mesmo padrão já usado pros
    // cards de Apple Music/YouTube do Catálogo (ver empirePlayController).
    buildCapaPorTituloCatalogo(),
  ]);

  const out: { spotify: unknown[]; apple: unknown[]; youtube: unknown[] } = { spotify: [], apple: [], youtube: [] };
  data.slice(1).forEach((r) => {
    if (!r[1]) return;
    const capaPlanilha = fixImg(r[6]);
    const capaCatalogo = capaPorTitulo.get(normalizarTitulo(r[1] || ""));
    // Catálogo (capa real da música/álbum) tem prioridade sobre a coluna G
    // da própria "EM Alta": quando essa coluna vem preenchida, geralmente é
    // com a foto do ARTISTA (não da capa), o que gerava o bug relatado de
    // charts mostrando foto de artista em vez da capa do material.
    const item = { t: r[1], s: fmt(r[3]), p: r[5], c: fixImg(capaCatalogo) || capaPlanilha };
    const plat = (r[4] || "").toLowerCase();
    if (plat.includes("spotify")) out.spotify.push(item);
    else if (plat.includes("apple")) out.apple.push(item);
    else out.youtube.push(item);
  });
  return out;
}

// ---- ADMIN DIAGNÓSTICO (temporário) ----
// GET /api/charts/admin/debug-realtime-covers — compara o título bruto de
// "EM Alta" com o título bruto da coluna H de Musicas, pra descobrir por que
// o cruzamento por título não está batendo (ex.: formatos diferentes,
// "Artista - Título" vs só "Título").
export async function debugRealtimeCoversController(): Promise<Response> {
  const [data, musicas, capaPorTitulo] = await Promise.all([
    readSheet("chartsRealtime", "EM Alta"),
    readSheet("principal", "Musicas").catch(() => [] as Row[]),
    buildCapaPorTituloCatalogo(),
  ]);
  const linhasEmAlta = data.slice(1).filter((r) => r[1]);
  const emAlta = linhasEmAlta.map((r) => {
    const norm = normalizarTitulo(r[1] || "");
    const achouNoCatalogo = capaPorTitulo.has(norm);
    // Pra cada título que NÃO bateu no catálogo, procura por ocorrência
    // parcial em Musicas!H (contém/é contido) pra ver se existe uma linha
    // parecida com grafia diferente.
    const parecido = achouNoCatalogo
      ? null
      : musicas
          .slice(1)
          .map((m) => (m[7] || "").trim())
          .filter(Boolean)
          .find((t) => {
            const nt = normalizarTitulo(t);
            return nt.includes(norm) || norm.includes(nt);
          }) || null;
    return {
      titulo_bruto: r[1],
      titulo_normalizado: norm,
      colG: r[6] || "",
      achou_no_catalogo: achouNoCatalogo,
      titulo_parecido_em_musicas: parecido,
    };
  });
  return jsonOk({ total_em_alta: linhasEmAlta.length, total_musicas: musicas.length - 1, emAlta });
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

function contarNumero1(items: { t: string; v: string }[]): number {
  return items.filter((item) => {
    const positions = String(item.v)
      .split("-")
      .map((s) => Number(s.trim()))
      .filter((n) => !isNaN(n) && n > 0);
    return positions.length > 0 && Math.min(...positions) === 1;
  }).length;
}

// Parte dos charts semanais no HOF vinda do D1, só dos charts que já têm
// semanas lá (os outros campos seguem da HALL_OF_FAME_DB).
async function perfilHOFDoD1(artist: string): Promise<Record<string, unknown>> {
  const db = getCatalogoDb();
  if (!db) return {};
  try {
    const [hot100, spotify, apple, youtube] = await Promise.all(
      CHARTS_HOF.map(async (c) => (await datasD1(db, c)).length > 0),
    );
    if (!hot100 && !spotify && !apple && !youtube) return {};
    const p = await perfilHOF(db, artist);
    return {
      ...(hot100 ? { n1_hot100: p.n1_hot100, runs: p.runs } : {}),
      ...(spotify ? { n1_spotify: p.n1_spotify, sp: p.sp } : {}),
      ...(apple ? { am: p.am } : {}),
      ...(youtube ? { n1_youtube: p.n1_youtube, yt: p.yt } : {}),
    };
  } catch (e) {
    console.warn("[charts-d1] HOF do D1 falhou; usando a planilha:", e);
    return {};
  }
}

async function fetchHOFProfile(artist: string): Promise<unknown> {
  const data = await readSheet("chartsBase", "HALL_OF_FAME_DB");
  const r = data.find((row) => (row[0] || "").trim().toUpperCase() === artist.trim().toUpperCase());
  if (!r) return {};
  const doD1 = await perfilHOFDoD1(artist);
  const runsBase = parseHOFList(r[12]);
  const runsLegado = parseHOFList(r[13]);
  const runsCombinados = [...runsBase, ...runsLegado];
  const n1BaseNumerico = Number(r[4]);
  const n1Hot100 = !isNaN(n1BaseNumerico)
    ? String(n1BaseNumerico + contarNumero1(runsLegado))
    : r[4];
  return {
    name: r[0],
    img: fixImg(r[1]),
    country: r[2],
    style: r[3],
    n1_hot100: n1Hot100,
    n1_spotify: r[5],
    n1_youtube: r[6],
    n1_bb200: r[7],
    yt: parseHOFList(r[8]),
    sp: parseHOFList(r[9]),
    am: parseHOFList(r[10]),
    alb: parseHOFList(r[11]),
    runs: runsCombinados,
    ...doD1,
    // Runs legados (col. N) seguem somando por cima do Hot 100 do D1, como
    // somavam por cima da col. M.
    ...(doD1.runs
      ? {
          runs: [...(doD1.runs as { t: string; v: string }[]), ...runsLegado],
          n1_hot100: String(Number(doD1.n1_hot100) + contarNumero1(runsLegado)),
        }
      : {}),
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
  // Mesmo cruzamento com o catálogo (Musicas) usado em fetchRT — essas abas
  // de origem (BILLBOARD HOT 100, SPOTIFY etc.) raramente têm as colunas de
  // capa (P/Q) preenchidas, então os cards "Top por plataforma" da Início
  // ficavam sem nenhuma imagem.
  // Só lido quando algum chart realmente cai na planilha.
  let capaPorTituloP: Promise<Map<string, string>> | null = null;
  const capaPorTitulo = () => (capaPorTituloP ??= buildCapaPorTituloCatalogo());

  await Promise.all(
    platforms.map(async ({ key, tab }) => {
      const doD1 = await viaD1(tab as ChartId, async (db) => {
        const { cat, fotos } = await referenciasD1(db);
        return numero1DaUltimaSemana(db, tab as ChartId, cat, fotos);
      });
      if (doD1) {
        result[key] = doD1;
        return;
      }
      const data = await readSheet("chartsBase", tab);
      if (data.length === 0) return;
      const row = latestRow(data.slice(1));
      if (row) {
        const capaPropria = fixImg(row[15] || row[16] || "");
        const capa = capaPropria || fixImg((await capaPorTitulo()).get(normalizarTitulo(row[3] || "")));
        result[key] = { tit: row[3] || "", art: row[7] || "", capa };
      }
    }),
  );

  try {
    const data = await readSheet("chartsAlbums", "DADOS ÁLBUNS");
    if (data.length > 0) {
      const row = latestRow(data.slice(1));
      if (row) {
        const capaPropria = fixImg(row[10] || "");
        const capa = capaPropria || fixImg((await capaPorTitulo()).get(normalizarTitulo(row[3] || "")));
        result["bb200"] = { tit: row[3] || "", art: row[11] || "", capa };
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
// Cache de resposta deste endpoint (por isolate) — BUG REAL confirmado em
// produção (2026-11-11, player Weuller sem conseguir enviar vídeo): o
// cache de 15s do googleSheetsService (pensado pra picos passageiros) não
// bastava porque esse endpoint é a Empire Charts pública (public/charts-app),
// com cada visita de página chamando getBannerN1s/getTopArtistCover etc. e o
// front só cacheando em memória por carregamento de página — sob tráfego
// normal (não só pico), isso já mantinha o projeto do Sheets batendo na
// cota "Read requests per minute" de forma praticamente contínua (LOGS
// mostrou o mesmo erro por ~18h direto), starvando toda a aba principal
// (inclusive escritas de Gestão, ex: Music Videos). Dado que ranking/
// capa/lançamentos não precisam de frescor ao segundo, um TTL bem mais
// longo aqui (5min) corta a maior parte dessas leituras repetidas sem
// prejuízo real pro jogador.
const CHARTS_RESPONSE_CACHE_TTL_MS = 5 * 60_000;
const chartsResponseCache = new Map<string, { body: string; expiresAt: number }>();
const chartsResponseInFlight = new Map<string, Promise<string>>();

/** Descarta as respostas em cache deste isolate (chamado após ingerir uma semana no D1). */
export function limparCacheCharts(): void {
  chartsResponseCache.clear();
  datasD1Cache.clear();
  referenciasD1Cache = null;
}

export async function chartsApiController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const p = url.searchParams;
  const action = p.get("action") || "";
  const cacheKey = url.search;

  const cached = chartsResponseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return new Response(cached.body, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
  const emAndamento = chartsResponseInFlight.get(cacheKey);
  if (emAndamento) {
    return new Response(await emAndamento, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  const promise = (async () => {
    const body = await computeChartsResponseBody(action, p);
    chartsResponseCache.set(cacheKey, { body, expiresAt: Date.now() + CHARTS_RESPONSE_CACHE_TTL_MS });
    return body;
  })().finally(() => {
    chartsResponseInFlight.delete(cacheKey);
  });
  chartsResponseInFlight.set(cacheKey, promise);
  return new Response(await promise, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

async function computeChartsResponseBody(action: string, p: URLSearchParams): Promise<string> {
  const toBody = (data: unknown) => JSON.stringify(data);
  try {
    switch (action) {
      case "getRealTime":
        return toBody(await fetchRT());
      case "getFilters":
        return toBody(await fetchF(p.get("tab") || ""));
      case "getChart":
        return toBody(await fetchC(p.get("tab") || "", p.get("date") || "", p.get("style") || ""));
      case "getMonthlyStats":
        return toBody(
          await fetchM(p.get("platform") || "", p.get("month") || "", p.get("artist") || "", p.get("year") || ""),
        );
      case "getMonthlyYears":
        return toBody(await fetchMY());
      case "getMonthlyDates":
        return toBody(await fetchMD(p.get("year") || ""));
      case "getArtists":
        return toBody(await fetchA(p.get("platform") || "", p.get("month") || "", p.get("year") || ""));
      case "getHOFList":
        return toBody(await fetchHOFList());
      case "getHOFProfile":
        return toBody(await fetchHOFProfile(p.get("artist") || ""));
      case "getBannerN1s":
        return toBody(await fetchBannerN1s());
      case "getTopArtistCover":
        return toBody(await fetchTopArtistCover());
      case "getReleases":
        return toBody(await fetchReleases());
      default:
        return toBody({ error: `Ação desconhecida: ${action}` });
    }
  } catch (err: any) {
    console.error("[chartsApiController] Erro:", err);
    return toBody({ error: err.message || "Erro ao carregar Charts." });
  }
}
