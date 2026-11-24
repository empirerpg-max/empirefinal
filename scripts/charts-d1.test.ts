import { test, expect } from "bun:test";
// Charts semanais no D1. Uso: bun test scripts/charts-d1.test.ts
import { CHARTS, type LinhaDados } from "../backend/src/services/chartsD1/tipos";
import { calcularMovimento } from "../backend/src/services/chartsD1/movimento";
import { rankingsPorPais, type EntradaMusica, type Pesos } from "../backend/src/services/chartsD1/paises";
import { REGRAS_PADRAO } from "../backend/src/services/chartsD1/regras";
import { calcularSemanaPaises } from "../backend/src/services/chartsD1/semanaPaises";
import { parseNumeroBR, dataBrParaIso, dataIsoParaBr, parseLinhaDados, validarSemana } from "../backend/src/services/chartsD1/dados";

const semanaFake = (dataIso: string, n: number): LinhaDados[] =>
  CHARTS.flatMap((chart) =>
    Array.from({ length: n }, (_, i) => ({ chart, dataIso, pos: i + 1, titulo: `Artista - Faixa ${i + 1}`, valor: 1000 - i, valorTotal: null, artistasPlanilha: ["Artista"] })),
  );

test("parseNumeroBR", () => {
  expect(parseNumeroBR("1.175")).toBe(1175);
  expect(parseNumeroBR("17.492.254")).toBe(17492254);
  expect(parseNumeroBR("")).toBeNull();
});
test("datas", () => {
  expect(dataBrParaIso("25/05/2020")).toBe("2020-05-25");
  expect(dataIsoParaBr("2026-11-11")).toBe("11/11/2026");
});
test("parseLinhaDados", () => {
  const l = parseLinhaDados(["SPOTIFY","11/11/2026","3","Louise - BDSM (feat. Sabine & Destiny)","1.126","","","Louise","Destiny","","",""])!;
  expect(l).toEqual({ chart: "SPOTIFY", dataIso: "2026-11-11", pos: 3, titulo: "Louise - BDSM (feat. Sabine & Destiny)", valor: 1126, valorTotal: null, artistasPlanilha: ["Louise","Destiny"] });
  expect(parseLinhaDados(["", "11/11/2026", "1"])).toBeNull();
  expect(parseLinhaDados(["SPOTIFY", "", "1"])).toBeNull();
  expect(parseLinhaDados(["SPOTIFY", "11/11/2026", ""])).toBeNull();
});
test("validarSemana: completa ok, faltando chart / posição repetida / duas datas recusam", () => {
  const semana = semanaFake("2026-11-11", 100);
  expect(validarSemana(semana)).toEqual({ ok: true, dataIso: "2026-11-11" });
  expect(validarSemana(semana.filter((l) => l.chart !== "YOUTUBE")).ok).toBe(false);
  expect(validarSemana([...semana, { ...semana[0] }]).ok).toBe(false);
  expect(validarSemana([...semana.slice(1), { ...semana[0], dataIso: "2026-11-04" }]).ok).toBe(false);
  expect(validarSemana([...semana, { ...semana[0], chart: "iTUNES" }]).ok).toBe(false);
});

test("movimento", () => {
  expect(calcularMovimento(5, undefined)).toEqual({ status: "NEW", posAnterior: null, peak: 5, semanas: 1, semanasN1: 0 });
  const h = { tituloNorm: "x", posAnterior: 3, peak: 2, semanas: 4, semanasN1: 0 };
  expect(calcularMovimento(1, h)).toEqual({ status: "↑", posAnterior: 3, peak: 1, semanas: 5, semanasN1: 1 });
  expect(calcularMovimento(7, h).status).toBe("↓");
  expect(calcularMovimento(3, h).status).toBe("=");
  expect(calcularMovimento(3, { ...h, posAnterior: null }).status).toBe("NEW"); // reentrada
});

import { indexarCatalogo, buscarNoCatalogo, resolverArtistas, extrairArtistasDoTitulo, chaveMusica } from "../backend/src/services/chartsD1/artistas";

test("catálogo casa grafia diferente e single vence álbum", () => {
  const cat = indexarCatalogo([
    { titulo: "Mind Maze feat. Rayna", artista: "TED", artista_2: "Rayna", capa_url: "single.jpg", genero: "Pop", tipo_single: "SINGLE" },
    { titulo: "Mind Maze (feat. Rayna)", artista: "TED", artista_2: "Rayna", capa_url: "album.jpg", genero: "Pop", tipo_single: "TRACKLIST ALBUM" },
  ] as any);
  const m = buscarNoCatalogo("TED - Mind Maze (feat. Rayna)", cat)!;
  expect(m.capa).toBe("single.jpg");
  expect(m.genero).toBe("Pop");
});
test("single vence álbum também quando o álbum vem primeiro", () => {
  const cat = indexarCatalogo([
    { titulo: "Boulangerie", artista: "Rose", capa_url: "album.jpg", genero: "", tipo_single: "TRACKLIST ALBUM" },
    { titulo: "Boulangerie", artista: "Rose", capa_url: "single.jpg", genero: "", tipo_single: "" },
  ] as any);
  expect(buscarNoCatalogo("Boulangerie", cat)!.capa).toBe("single.jpg");
  expect(buscarNoCatalogo("Rose - Boulangerie", cat)!.ehFaixaDeAlbum).toBe(false);
});
test("resolverArtistas: planilha > catálogo > título", () => {
  const cat = indexarCatalogo([{ titulo: "Sober", artista: "Louise", capa_url: "", genero: "", tipo_single: "" }] as any);
  const base = { chart: "SPOTIFY", dataIso: "2026-11-11", pos: 1, valor: 1, valorTotal: null };
  expect(resolverArtistas({ ...base, titulo: "Louise - Sober", artistasPlanilha: ["Louise", "Kendall"] }, cat, new Set())).toEqual({ artistas: ["Louise", "Kendall"], fonte: "planilha" });
  expect(resolverArtistas({ ...base, titulo: "Louise - Sober", artistasPlanilha: [] }, cat, new Set()).fonte).toBe("catalogo");
  expect(resolverArtistas({ ...base, titulo: "Brandy - Black Empire (feat. Sabine, Kendall & Louise)", artistasPlanilha: [] }, cat, new Set(["BRANDY", "SABINE", "KENDALL", "LOUISE"])))
    .toEqual({ artistas: ["Brandy", "Sabine", "Kendall", "Louise"], fonte: "titulo" });
  expect(resolverArtistas({ ...base, titulo: "Zed - X", artistasPlanilha: [] }, cat, new Set()).fonte).toBe("nenhuma");
});
test("extrairArtistasDoTitulo", () => {
  expect(extrairArtistasDoTitulo("A x B - Song ft. C")).toEqual(["A", "B", "C"]);
  expect(extrairArtistasDoTitulo("A & B, C - Song")).toEqual(["A", "B", "C"]);
});

import { criarD1Sqlite, type AoExecutar } from "./charts-d1-sqlite";
import { ingerirSemana, historicoAntesDe } from "../backend/src/services/chartsD1/repo";
import { chartsIngestController } from "../backend/src/controllers/chartsIngestController";

// 5 charts × 100 linhas cruas da aba DADOS (A..L), uma faixa diferente por posição.
const linhasFake = (dataBr: string): string[][] =>
  CHARTS.flatMap((chart) =>
    Array.from({ length: 100 }, (_, i) => [chart, dataBr, String(i + 1), `Artista ${i + 1} - Faixa ${i + 1}`, String(1000 - i), "", "", `Artista ${i + 1}`, "", "", "", ""]),
  );
const linhasFakeTrocandoPos1e2 = (dataBr: string): string[][] =>
  linhasFake(dataBr).map((l) => (l[2] === "1" ? [...l.slice(0, 3), "Artista 2 - Faixa 2", ...l.slice(4)] : l[2] === "2" ? [...l.slice(0, 3), "Artista 1 - Faixa 1", ...l.slice(4)] : l));

test("ingestão semanal: grava, calcula status e reenvio substitui", async () => {
  const db = criarD1Sqlite();
  expect((await ingerirSemana(db, { linhas: linhasFake("04/11/2026") })).ok).toBe(true);
  const r = await ingerirSemana(db, { linhas: linhasFakeTrocandoPos1e2("11/11/2026") });
  expect(r).toEqual({ ok: true, data: "2026-11-11", linhas: 500 });
  await ingerirSemana(db, { linhas: linhasFakeTrocandoPos1e2("11/11/2026") });
  const n = await db.prepare("SELECT COUNT(*) c FROM chart_semana WHERE data='2026-11-11'").all<{ c: number }>();
  expect(n.results[0].c).toBe(500);
  const top = await db.prepare("SELECT status, semanas_n1 FROM chart_semana WHERE chart='SPOTIFY' AND data='2026-11-11' AND pos=1").all<any>();
  expect(top.results[0]).toEqual({ status: "↑", semanas_n1: 1 });
});
test("ingestão semanal incompleta não grava nada", async () => {
  const db = criarD1Sqlite();
  const r = await ingerirSemana(db, { linhas: linhasFake("11/11/2026").filter((l) => l[0] !== "YOUTUBE") });
  expect(r.ok).toBe(false);
  const n = await db.prepare("SELECT COUNT(*) c FROM chart_semana").all<{ c: number }>();
  expect(n.results[0].c).toBe(0);
});
test("histórico: deduplica 200 linhas e ignora iTUNES", async () => {
  const db = criarD1Sqlite();
  const dup = linhasFake("19/10/2020");
  const r = await ingerirSemana(db, { linhas: [...dup, ...dup, ["iTUNES", "19/10/2020", "1", "A - B", "1", "", "", "", "", "", "", ""]], modo: "historico" });
  expect(r).toEqual({ ok: true, data: "2020-10-19", linhas: 500 });
  const log = await db.prepare("SELECT modo, ok, mensagem FROM chart_ingestao").all<any>();
  expect(log.results[0].modo).toBe("historico");
  expect(log.results[0].mensagem).toContain("duplicad");
});
test("controller: 401 sem token", async () => {
  const res = await chartsIngestController(new Request("http://x/api/charts/ingest", { method: "POST", body: "{}" }));
  expect(res.status).toBe(401);
});
test("controller: 401 com secret configurado e header ausente", async () => {
  const g = globalThis as Record<string, unknown>;
  const antes = g.__CHARTS_INGEST_TOKEN__;
  g.__CHARTS_INGEST_TOKEN__ = "segredo";
  try {
    const res = await chartsIngestController(new Request("http://x/api/charts/ingest", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  } finally {
    g.__CHARTS_INGEST_TOKEN__ = antes;
  }
});
test("chaveMusica: só caixa, acento e espaços", () => {
  expect(chaveMusica("  Brida -  Bastarda [FunkItaliaRemix] ")).toBe("brida - bastarda [funkitaliaremix]");
  expect(chaveMusica("Rayna - Aphrodite (live at Anti Tour)")).not.toBe(chaveMusica("Rayna - Aphrodite"));
  expect(chaveMusica("Ánne - Canção")).toBe("anne - cancao");
});
test("versões diferentes da mesma faixa na mesma semana têm histórico próprio", async () => {
  const db = criarD1Sqlite();
  const comVersoes = (dataBr: string, trocar: boolean) =>
    linhasFake(dataBr).map((l) => {
      // Pares que normalizarTitulo junta (colchetes / parênteses) e são músicas diferentes.
      const pares: Record<string, [string, string]> = {
        "1": ["Brida - Bastarda", "Brida - Bastarda [FunkItaliaRemix]"],
        "2": ["Brida - Bastarda [FunkItaliaRemix]", "Brida - Bastarda"],
        "3": ["Rayna - Aphrodite", "Rayna - Aphrodite (live at Anti Tour)"],
        "4": ["Rayna - Aphrodite (live at Anti Tour)", "Rayna - Aphrodite"],
      };
      const par = pares[l[2]];
      return par ? [...l.slice(0, 3), par[trocar ? 1 : 0], ...l.slice(4)] : l;
    });
  expect((await ingerirSemana(db, { linhas: comVersoes("04/11/2026", false) })).ok).toBe(true);
  expect((await ingerirSemana(db, { linhas: comVersoes("11/11/2026", true) })).ok).toBe(true);
  const rows = await db.prepare("SELECT pos, titulo, status, semanas FROM chart_semana WHERE chart='SPOTIFY' AND data='2026-11-11' AND pos<=4 ORDER BY pos").all<any>();
  expect(rows.results).toEqual([
    { pos: 1, titulo: "Brida - Bastarda [FunkItaliaRemix]", status: "↑", semanas: 2 },
    { pos: 2, titulo: "Brida - Bastarda", status: "↓", semanas: 2 },
    { pos: 3, titulo: "Rayna - Aphrodite (live at Anti Tour)", status: "↑", semanas: 2 },
    { pos: 4, titulo: "Rayna - Aphrodite", status: "↓", semanas: 2 },
  ]);
});

test("semanal: PONTOS/VENDAS vazio ou ilegível recusa a semana", async () => {
  const db = criarD1Sqlite();
  const linhas = linhasFake("11/11/2026");
  linhas[3] = [...linhas[3].slice(0, 4), "", ...linhas[3].slice(5)];
  linhas[7] = [...linhas[7].slice(0, 4), "abc", ...linhas[7].slice(5)];
  const r = await ingerirSemana(db, { linhas });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.erros.length).toBe(2);
  const n = await db.prepare("SELECT COUNT(*) c FROM chart_semana").all<{ c: number }>();
  expect(n.results[0].c).toBe(0);
});
test("artistas resolvidos do catálogo/título, artista_info e pais_peso com upsert", async () => {
  const db = criarD1Sqlite();
  await db.prepare("CREATE TABLE musicas (titulo TEXT, codigo_unico TEXT, artista TEXT, artista_2 TEXT, artista_3 TEXT, artista_4 TEXT, artista_5 TEXT, artista_6 TEXT, capa_url TEXT, genero TEXT, tipo_single TEXT)").run();
  await db.prepare("INSERT INTO musicas VALUES ('Faixa 1', NULL, 'Artista 1', 'Convidada', NULL, NULL, NULL, NULL, 'c.jpg', 'Pop', 'SINGLE')").run();
  const linhas = linhasFake("11/11/2026").map((l) => [...l.slice(0, 7), "", "", "", "", ""]);
  linhas[1] = [linhas[1][0], linhas[1][1], linhas[1][2], "Amanda Brokne - Faixa X (feat. Zed)", ...linhas[1].slice(4)];
  const r = await ingerirSemana(db, {
    linhas,
    artistas: [[" Amanda Brokne ", " austrália ", "f.jpg"], ["", "BRASIL", ""]],
    pesos: [["PAÍS", "SPOTIFY (B)", "APPLE MUSIC (C)", "YOUTUBE (D)"], ["BRASIL", "7,20%", "5,00%", "10,10%"]],
  });
  expect(r.ok).toBe(true);
  const rows = await db.prepare("SELECT pos, artistas, fonte_artistas FROM chart_semana WHERE chart='BILLBOARD HOT 100' AND pos<=3 ORDER BY pos").all<any>();
  expect(rows.results.map((x: any) => [JSON.parse(x.artistas), x.fonte_artistas])).toEqual([
    [["Artista 1", "Convidada"], "catalogo"],
    [["Amanda Brokne"], "titulo"],
    [[], "nenhuma"],
  ]);
  const info = await db.prepare("SELECT nome_upper, nome, nacionalidade, foto FROM artista_info").all<any>();
  expect(info.results).toEqual([{ nome_upper: "AMANDA BROKNE", nome: "Amanda Brokne", nacionalidade: "AUSTRÁLIA", foto: "f.jpg" }]);
  const pesos = await db.prepare("SELECT plataforma, peso FROM pais_peso WHERE pais='BRASIL' ORDER BY plataforma").all<any>();
  expect(pesos.results.map((p: any) => [p.plataforma, p.peso])).toEqual([["APPLE MUSIC", 0.05], ["SPOTIFY", 0.072], ["YOUTUBE", 0.101]]);
  const cfg = await db.prepare("SELECT chave, valor FROM chart_config ORDER BY chave").all<any>();
  expect(cfg.results).toEqual([{ chave: "bonus_nacionalidade", valor: "0.20" }, { chave: "charts_d1_ativo", valor: "0" }, { chave: "top_pais", valor: "50" }]);
});
test("reenvio de semana antiga recalcula a semana seguinte", async () => {
  const db = criarD1Sqlite();
  await ingerirSemana(db, { linhas: linhasFakeTrocandoPos1e2("11/11/2026") });
  let top = await db.prepare("SELECT status, semanas FROM chart_semana WHERE chart='YOUTUBE' AND data='2026-11-11' AND pos=1").all<any>();
  expect(top.results[0]).toEqual({ status: "NEW", semanas: 1 });
  await ingerirSemana(db, { linhas: linhasFake("04/11/2026") });
  top = await db.prepare("SELECT status, semanas, peak, pos_anterior FROM chart_semana WHERE chart='YOUTUBE' AND data='2026-11-11' AND pos=1").all<any>();
  expect(top.results[0]).toEqual({ status: "↑", semanas: 2, peak: 1, pos_anterior: 2 });
  const h = await historicoAntesDe(db, "YOUTUBE", "2026-11-12", ["artista 1 - faixa 1"]);
  expect(h.get("artista 1 - faixa 1")).toEqual({ tituloNorm: "artista 1 - faixa 1", posAnterior: 2, peak: 1, semanas: 2, semanasN1: 1 });
});
test("controller: 405 (PUT), 400 e 200 com token", async () => {
  const g = globalThis as Record<string, unknown>;
  const antes = { token: g.__CHARTS_INGEST_TOKEN__, db: g.__CATALOGO_DB__ };
  g.__CHARTS_INGEST_TOKEN__ = "segredo";
  g.__CATALOGO_DB__ = criarD1Sqlite();
  try {
    const auth = { Authorization: "Bearer segredo" };
    expect((await chartsIngestController(new Request("http://x/api/charts/ingest", { method: "PUT", headers: auth }))).status).toBe(405);
    expect((await chartsIngestController(new Request("http://x/api/charts/ingest", { method: "POST", headers: { Authorization: "Bearer errado" }, body: "{}" }))).status).toBe(401);
    const ruim = await chartsIngestController(new Request("http://x/api/charts/ingest", { method: "POST", headers: auth, body: JSON.stringify({ linhas: [] }) }));
    expect(ruim.status).toBe(400);
    expect((await ruim.json()).ok).toBe(false);
    const bom = await chartsIngestController(new Request("http://x/api/charts/ingest", { method: "POST", headers: auth, body: JSON.stringify({ linhas: linhasFake("11/11/2026") }) }));
    expect(bom.status).toBe(200);
    expect(await bom.json()).toEqual({ ok: true, data: "2026-11-11", linhas: 500 });
  } finally {
    g.__CHARTS_INGEST_TOKEN__ = antes.token;
    g.__CATALOGO_DB__ = antes.db;
  }
});

// ---- Leitura (/api/charts) a partir do D1 ----
import { readFileSync } from "node:fs";
import {
  datasDoChart, generosDoChart, linhasDoChart, numero1DaUltimaSemana, perfilHOF,
} from "../backend/src/services/chartsD1/repo";

// Catálogo fake: "Artista i - Faixa i" com capa própria; ímpar = Pop, par = Rock.
const musicasFake = Array.from({ length: 100 }, (_, i) => ({
  titulo: `Faixa ${i + 1}`, artista: `Artista ${i + 1}`, capa_url: `capa-${i + 1}.jpg`,
  genero: (i + 1) % 2 ? "Pop" : "Rock", tipo_single: "SINGLE",
}));
const catFake = indexarCatalogo(musicasFake as any);

/** Tabela musicas do D1 com o catálogo fake (o gênero é gravado na ingestão). */
async function criarMusicasFake(db: ReturnType<typeof criarD1Sqlite>) {
  await db.prepare("CREATE TABLE musicas (titulo TEXT, codigo_unico TEXT, artista TEXT, artista_2 TEXT, artista_3 TEXT, artista_4 TEXT, artista_5 TEXT, artista_6 TEXT, capa_url TEXT, genero TEXT, tipo_single TEXT)").run();
  for (const m of musicasFake) {
    await db.prepare("INSERT INTO musicas (titulo, artista, capa_url, genero, tipo_single) VALUES (?, ?, ?, ?, ?)").bind(m.titulo, m.artista, m.capa_url, m.genero, m.tipo_single).run();
  }
}

// Semana fake pra leitura: título E artista trocam juntos entre #1 e #2 na
// segunda semana; valores bem espaçados (não empatam ao dividir por país).
const linhasLeitura = (dataBr: string, trocar: boolean): string[][] =>
  linhasFake(dataBr).map((l) => {
    const pos = Number(l[2]);
    const n = trocar && pos <= 2 ? 3 - pos : pos;
    return [l[0], l[1], l[2], `Artista ${n} - Faixa ${n}`, String((101 - pos) * 1000), "", "", `Artista ${n}`, "", "", "", ""];
  });

async function dbComDuasSemanas(artistas: string[][] = [], pesos: string[][] = [], aoExecutar?: AoExecutar) {
  const db = criarD1Sqlite(":memory:", aoExecutar);
  await criarMusicasFake(db);
  expect((await ingerirSemana(db, { linhas: linhasLeitura("04/11/2026", false), artistas, pesos })).ok).toBe(true);
  expect((await ingerirSemana(db, { linhas: linhasLeitura("11/11/2026", true) })).ok).toBe(true);
  return db;
}

// Cópia do CSV real "PAÍSES E PESOS" (81 países).
const CSV_PESOS = new URL("./fixtures/charts-d1-pesos.csv", import.meta.url);
function pesosDoCsv(): string[][] {
  return readFileSync(CSV_PESOS, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => [...l.matchAll(/"([^"]*)"|([^,]+)|(?<=,)(?=,|$)/g)].map((m) => m[1] ?? m[2] ?? ""));
}

test("getChart do D1 mantém contrato", async () => {
  const db = await dbComDuasSemanas();
  const rows = await linhasDoChart(db, "BILLBOARD HOT 100", "11/11/2026", "", catFake, new Map());
  expect(Object.keys(rows[0]).sort()).toEqual(["art", "capa", "pos", "st", "style", "tit", "val", "valTotal"]);
  expect(rows).toHaveLength(100);
  expect(rows[0]).toEqual({ pos: 1, tit: "Artista 2 - Faixa 2", val: "100.000", valTotal: "199.000", art: "Artista 2", st: "↑", capa: "capa-2.jpg", style: "Rock" });
  const pop = await linhasDoChart(db, "BILLBOARD HOT 100", "11/11/2026", "Pop", catFake, new Map());
  expect(pop.length).toBe(50);
  expect(pop.every((r) => r.style === "Pop")).toBe(true);
});
test("getChart do D1: capa cai pra foto do artista e depois pra vazio", async () => {
  const db = await dbComDuasSemanas();
  const rows = await linhasDoChart(db, "SPOTIFY", "04/11/2026", "", new Map(), new Map([["ARTISTA 1", "foto-1.jpg"]]));
  expect(rows[0].capa).toBe("foto-1.jpg");
  expect(rows[1].capa).toBe("");
  expect(rows[0].st).toBe("NEW");
});
test("filtros do D1: datas mais recentes primeiro e gêneros do catálogo", async () => {
  const db = await dbComDuasSemanas();
  expect(await datasDoChart(db, "SPOTIFY")).toEqual(["11/11/2026", "04/11/2026"]);
  expect(await generosDoChart(db, "SPOTIFY")).toEqual(["Pop", "Rock"]);
});
test("países (regra C): 81 × top 50 no recorte do Spotify, nacionalidade sem acento casa com o país", async () => {
  const pesos = pesosDoCsv();
  const nPaises = pesos.slice(1).filter((p) => p[0].trim() && p[1].trim()).length;
  expect(nPaises).toBe(81);
  // "Australia" sem acento casa com "AUSTRÁLIA" de pais_peso.
  const db = await dbComDuasSemanas([["Artista 60", "Austrália", "f60.jpg"], ["Artista 61", "Australia", ""]], pesos);
  const rows = (await calcularSemanaPaises(db, "11/11/2026", catFake, new Map())).countries.get("SPOTIFY")!;
  expect(Object.keys(rows[0]).sort()).toEqual(["art", "capa", "mes", "pais", "pos", "st", "tit", "val"]);
  expect(new Set(rows.map((r) => r.pais)).size).toBe(nPaises);
  expect(rows).toHaveLength(nPaises * 50);
  const brasil = rows.filter((r) => r.pais === "BRASIL");
  expect(brasil).toHaveLength(50);
  expect(brasil.map((r) => r.pos)).toEqual(brasil.map((_, i) => i + 1));
  expect(brasil[0]).toMatchObject({ mes: "11/11/2026" });
  // Artistas australianos ("Austrália" e "Australia") ficam acima no próprio país do que no Brasil.
  const posEm = (pais: string, tit: string) => rows.find((r) => r.pais === pais && r.tit === tit)?.pos ?? 99;
  for (const tit of ["Artista 60 - Faixa 60", "Artista 61 - Faixa 61"]) {
    expect(posEm("AUSTRÁLIA", tit)).toBeLessThan(posEm("BRASIL", tit));
  }
});
test("datas vazias → fallback", async () => {
  expect(await datasDoChart(criarD1Sqlite(), "DIGITAL SALES")).toEqual([]);
  const db = await dbComDuasSemanas();
  await db.prepare("DELETE FROM chart_datas WHERE chart = 'DIGITAL SALES'").run();
  expect(await datasDoChart(db, "DIGITAL SALES")).toEqual([]);
});
test("banner: #1 da semana mais recente", async () => {
  const db = await dbComDuasSemanas();
  expect(await numero1DaUltimaSemana(db, "YOUTUBE", catFake, new Map())).toEqual({ tit: "Artista 2 - Faixa 2", art: "Artista 2", capa: "capa-2.jpg" });
  expect(await numero1DaUltimaSemana(criarD1Sqlite(), "YOUTUBE", catFake, new Map())).toBeNull();
});
test("HOF: #1s e runs cronológicos pelos artistas da música", async () => {
  const db = await dbComDuasSemanas();
  const p = await perfilHOF(db, "artista 2");
  expect(p.n1_hot100).toBe("1");
  expect(p.n1_spotify).toBe("1");
  expect(p.n1_youtube).toBe("1");
  expect(p.runs).toEqual([{ t: "Artista 2 - Faixa 2", v: "2 - 1" }]);
  // sp/am/yt: só o pico (cabe no layout do HOF); runs mantém as posições.
  expect(p.sp).toEqual([{ t: "Artista 2 - Faixa 2", v: "1" }]);
  expect(p.am).toEqual([{ t: "Artista 2 - Faixa 2", v: "1" }]);
  expect(p.yt).toEqual([{ t: "Artista 2 - Faixa 2", v: "1" }]);
  const p20 = await perfilHOF(db, "Artista 20"); // não confunde com "Artista 2"
  expect(p20.runs).toEqual([{ t: "Artista 20 - Faixa 20", v: "20 - 20" }]);
  expect(p20.n1_hot100).toBe("0");
});

import { googleSheetsService } from "../backend/src/services/googleSheetsService";
import { chartsApiController, limparCacheCharts } from "../backend/src/controllers/chartsController";

/** Roda `fn` com o D1 fake e as planilhas trocadas por stubs (registra o que foi lido). */
async function comApiCharts(db: unknown, abas: Record<string, string[][]>, fn: (lidas: string[]) => Promise<void>) {
  const g = globalThis as Record<string, unknown>;
  const svc = googleSheetsService as unknown as Record<string, { readValues: (s: string) => Promise<string[][]> }>;
  const chaves = ["chartsBase", "chartsCountries", "chartsAlbums", "principal"];
  const antes = { db: g.__CATALOGO_DB__, ...Object.fromEntries(chaves.map((k) => [k, svc[k].readValues])) } as Record<string, any>;
  const lidas: string[] = [];
  g.__CATALOGO_DB__ = db;
  for (const k of chaves) svc[k].readValues = async (s: string) => { lidas.push(`${k}:${s}`); return abas[s] ?? []; };
  limparCacheCharts();
  try {
    await fn(lidas);
  } finally {
    g.__CATALOGO_DB__ = antes.db;
    for (const k of chaves) svc[k].readValues = antes[k];
    limparCacheCharts();
  }
}
const api = async (q: string) => (await chartsApiController(new Request(`http://x/api/charts?${q}`))).json();
/** Libera a leitura do D1 (carga inicial concluída). */
const ativarD1 = async (db: ReturnType<typeof criarD1Sqlite>) => expect(await ingerirSemana(db, { ativar: true })).toEqual({ ok: true, ativo: true });

test("/api/charts: chart com semanas no D1 lê do D1; chart vazio cai na planilha", async () => {
  const db = await dbComDuasSemanas([], pesosDoCsv());
  await ativarD1(db);
  await db.prepare("DELETE FROM chart_datas WHERE chart = 'DIGITAL SALES'").run();
  const planilhaSales = [["h"], ["DIGITAL SALES", "01/01/2025", "1", "Velha - Planilha", "10", "", "", "Velha"]];
  await comApiCharts(db, { "DIGITAL SALES": planilhaSales }, async (lidas) => {
    expect(await api("action=getFilters&tab=SPOTIFY")).toEqual({ dates: ["11/11/2026", "04/11/2026"], styles: ["Pop", "Rock"] });
    const rows = await api("action=getChart&tab=SPOTIFY&date=11/11/2026");
    expect(rows).toHaveLength(100);
    expect(rows[0]).toMatchObject({ pos: 1, tit: "Artista 2 - Faixa 2", st: "↑" });
    expect((await api("action=getFilters&tab=SPOTIFY COUNTRIES")).dates).toEqual(["11/11/2026", "04/11/2026"]);
    expect(lidas.filter((l) => l.startsWith("chartsBase") || l.startsWith("chartsCountries"))).toEqual([]);
    expect((await api("action=getFilters&tab=DIGITAL SALES")).dates).toEqual(["01/01/2025"]);
    expect(lidas).toContain("chartsBase:DIGITAL SALES");
    const banners = await api("action=getBannerN1s");
    expect(banners.spotify).toEqual({ tit: "Artista 2 - Faixa 2", art: "Artista 2", capa: "capa-2.jpg" });
    expect(banners.sales).toMatchObject({ tit: "Velha - Planilha", art: "Velha" });
  });
});
test("/api/charts HOF: números/runs dos charts do D1 sobre img/country/style e álbuns da planilha", async () => {
  const db = await dbComDuasSemanas();
  await ativarD1(db);
  const hof = [["h"], ["Artista 2", "img", "BRASIL", "Pop", "9", "9", "9", "4", "Velha|1", "Velha|1", "Velha|1", "Album|1 - 2", "Velha|1", ""]];
  await comApiCharts(db, { HALL_OF_FAME_DB: hof }, async () => {
    const p = await api("action=getHOFProfile&artist=Artista 2");
    expect(p).toMatchObject({ name: "Artista 2", img: "img", country: "BRASIL", style: "Pop", n1_hot100: "1", n1_spotify: "1", n1_youtube: "1", n1_bb200: "4" });
    expect(p.runs).toEqual([{ t: "Artista 2 - Faixa 2", v: "2 - 1" }]);
    expect(p.am).toEqual([{ t: "Artista 2 - Faixa 2", v: "1" }]);
    expect(p.alb).toEqual([{ t: "Album", v: "1 - 2" }]);
  });
});

test("países: 81 × 100 músicas × 2 semanas cabe no orçamento de CPU", () => {
  const pesos: Pesos = new Map(
    pesosDoCsv().slice(1).filter((p) => p[1]?.trim()).map((p) => [p[0].trim().toUpperCase(), parseNumeroBR(p[1].replace("%", ""))! / 100]),
  );
  expect(pesos.size).toBe(81);
  const paises = [...pesos.keys()];
  const semana = (desloc: number): EntradaMusica[] =>
    Array.from({ length: 100 }, (_, i) => ({
      tituloNorm: `m${(i + desloc) % 100}`, titulo: `M ${i}`, artistaPrincipal: `A ${i}`, artistas: [`A ${i}`], valor: (100 - i) * 1000,
      nacionalidades: new Set(i % 3 ? [paises[i % paises.length]] : []), foco: i % 5 ? null : paises[(i * 7) % paises.length],
    }));
  const R = REGRAS_PADRAO.paises;
  rankingsPorPais(semana(1), semana(0), pesos, "2026-11-11", "2026-11-04", R); // aquece o JIT
  const t0 = performance.now();
  const r = rankingsPorPais(semana(1), semana(0), pesos, "2026-11-11", "2026-11-04", R);
  const ms = performance.now() - t0;
  expect(r.size).toBe(81);
  expect([...r.values()].every((l) => l.length === 50)).toBe(true);
  expect(ms).toBeLessThan(50);
});
test("/api/charts COUNTRIES sem pesos no D1 cai na planilha", async () => {
  const db = await dbComDuasSemanas(); // sem pesos
  await ativarD1(db);
  const planilha = [["h"], ["BRASIL", "1", "SPOTIFY", "Velha - Planilha", "10", "Outubro", "Velha", ""]];
  await comApiCharts(db, { "SPOTIFY COUNTRIES": planilha }, async (lidas) => {
    expect((await api("action=getFilters&tab=SPOTIFY COUNTRIES")).dates).toEqual(["Outubro"]);
    expect(await api("action=getChart&tab=SPOTIFY COUNTRIES&date=Outubro")).toMatchObject([{ pais: "BRASIL", tit: "Velha - Planilha" }]);
    expect(lidas).toContain("chartsCountries:SPOTIFY COUNTRIES");
  });
});
test("/api/charts HOF: runs legados (col. N) somam por cima do D1; sem linha na planilha não consulta o D1", async () => {
  const db = await dbComDuasSemanas();
  await ativarD1(db);
  const hof = [["h"], ["Artista 2", "img", "BRASIL", "Pop", "9", "9", "9", "4", "", "", "", "", "Velha|1", "Legado|3 - 1,Outro|5"]];
  await comApiCharts(db, { HALL_OF_FAME_DB: hof }, async () => {
    const p = await api("action=getHOFProfile&artist=Artista 2");
    expect(p.runs).toEqual([{ t: "Artista 2 - Faixa 2", v: "2 - 1" }, { t: "Legado", v: "3 - 1" }, { t: "Outro", v: "5" }]);
    expect(p.n1_hot100).toBe("2");
  });
  let consultas = 0;
  const contando = { ...db, prepare: (sql: string) => { if (/FROM chart_artista_musica/.test(sql)) consultas++; return db.prepare(sql); } };
  await comApiCharts(contando, { HALL_OF_FAME_DB: hof }, async () => {
    expect(await api("action=getHOFProfile&artist=Ninguem")).toEqual({});
    await api("action=getHOFProfile&artist=Artista 2");
  });
  expect(consultas).toBe(1);
});
test("/api/charts banners: com os 5 charts no D1 não lê Musicas pra capa", async () => {
  const db = await dbComDuasSemanas();
  await ativarD1(db);
  await comApiCharts(db, {}, async (lidas) => {
    const b = await api("action=getBannerN1s");
    expect(Object.keys(b).sort()).toEqual(["apple", "hot100", "sales", "spotify", "youtube"]);
    expect(lidas.filter((l) => l.startsWith("principal"))).toEqual([]);
  });
});

// ---- Task 6: datas já carregadas e planejamento da carga inicial ----
import { datasCarregadas, chartsD1Ativo } from "../backend/src/services/chartsD1/repo";
import { planejarLotes, lerCsv } from "./charts-d1-carga-inicial";

test("datasCarregadas: datas ISO distintas gravadas, vazio sem tabelas", async () => {
  const db = criarD1Sqlite();
  expect(await datasCarregadas(db)).toEqual([]);
  await ingerirSemana(db, { linhas: linhasFake("04/11/2026") });
  await ingerirSemana(db, { linhas: linhasFake("11/11/2026") });
  expect(await datasCarregadas(db)).toEqual(["2026-11-04", "2026-11-11"]);
});
test("controller GET: lista datas gravadas com Bearer; sem token 401; PUT 405", async () => {
  const g = globalThis as Record<string, unknown>;
  const antes = { token: g.__CHARTS_INGEST_TOKEN__, db: g.__CATALOGO_DB__ };
  g.__CHARTS_INGEST_TOKEN__ = "segredo";
  const db = criarD1Sqlite();
  g.__CATALOGO_DB__ = db;
  try {
    const auth = { Authorization: "Bearer segredo" };
    await ingerirSemana(db, { linhas: linhasFake("11/11/2026") });
    const r = await chartsIngestController(new Request("http://x/api/charts/ingest", { headers: auth }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, datas: ["2026-11-11"] });
    expect((await chartsIngestController(new Request("http://x/api/charts/ingest"))).status).toBe(401);
    expect((await chartsIngestController(new Request("http://x/api/charts/ingest", { method: "PUT", headers: auth }))).status).toBe(405);
  } finally {
    g.__CHARTS_INGEST_TOKEN__ = antes.token;
    g.__CATALOGO_DB__ = antes.db;
  }
});
test("lerCsv: aspas, vírgulas e quebras de linha dentro de campo", () => {
  expect(lerCsv('a,"b,c",d\r\n"x ""y""","l1\nl2",\n')).toEqual([["a", "b,c", "d"], ['x "y"', "l1\nl2", ""]]);
});
test("planejarLotes: cronológico, pula carregadas, corta no limite sem partir semana", () => {
  const l = (data: string, n: number) => Array.from({ length: n }, (_, i) => ["SPOTIFY", data, String(i + 1)]);
  const linhas = [...l("11/11/2026", 3), ...l("25/05/2020", 3), ...l("04/11/2026", 3), ["", "", ""], ["SPOTIFY", "", "1"]];
  expect(planejarLotes(linhas, new Set(), 100).map((x) => x.data)).toEqual(["2020-05-25", "2026-11-04", "2026-11-11"]);
  expect(planejarLotes(linhas, new Set(["2026-11-04"]), 100).map((x) => x.data)).toEqual(["2020-05-25", "2026-11-11"]);
  // limite 5: cabe só a 1ª semana (3); a 2ª estouraria (6) e não é partida
  expect(planejarLotes(linhas, new Set(), 5).map((x) => x.data)).toEqual(["2020-05-25"]);
  expect(planejarLotes(linhas, new Set(), 6).map((x) => x.data)).toEqual(["2020-05-25", "2026-11-04"]);
  expect(planejarLotes(linhas, new Set(), 100)[0].linhas.length).toBe(3);
});

// ---- Revisão final: leituras por índice, tabelas derivadas, ativação ----

/** Plano de cada SELECT/DELETE/UPDATE executado que toca as tabelas dos charts. */
function planosDe(db: ReturnType<typeof criarD1Sqlite>, execs: { sql: string; params: unknown[] }[]) {
  const vistos = new Set<string>();
  const out: { sql: string; plano: string[] }[] = [];
  for (const e of execs) {
    if (!/^\s*(SELECT|DELETE|UPDATE)/i.test(e.sql) || !/chart_(semana|datas|artista_musica)/.test(e.sql) || vistos.has(e.sql)) continue;
    vistos.add(e.sql);
    out.push({ sql: e.sql, plano: [] });
  }
  return Promise.all(
    out.map(async (o) => {
      const params = execs.find((e) => e.sql === o.sql)!.params;
      const r = await db.prepare(`EXPLAIN QUERY PLAN ${o.sql}`).bind(...params).all<{ detail: string }>();
      return { sql: o.sql, plano: r.results.map((x) => x.detail) };
    }),
  );
}

test("ingestão e leitura não varrem chart_semana: histórico por ix_chart_norm, semanas pela PK", async () => {
  const execs: { sql: string; params: unknown[] }[] = [];
  const db = await dbComDuasSemanas([["Artista 1", "Brasil", ""]], pesosDoCsv(), (sql, params) => execs.push({ sql, params }));
  // reenvio da semana antiga: recalcula a seguinte e as runs
  expect((await ingerirSemana(db, { linhas: linhasLeitura("04/11/2026", false) })).ok).toBe(true);
  await datasDoChart(db, "SPOTIFY");
  await datasCarregadas(db);
  await generosDoChart(db, "SPOTIFY");
  await linhasDoChart(db, "SPOTIFY", "11/11/2026", "Pop", catFake, new Map());
  await calcularSemanaPaises(db, "11/11/2026", catFake, new Map());
  await numero1DaUltimaSemana(db, "SPOTIFY", catFake, new Map());
  await perfilHOF(db, "Artista 2");
  const planos = await planosDe(db, execs);
  const varreduras = planos.filter((p) => p.plano.some((d) => /^SCAN chart_(semana|artista_musica)\b/.test(d)));
  expect(varreduras).toEqual([]);
  const historico = planos.filter((p) => /titulo_norm IN/.test(p.sql));
  expect(historico.length).toBeGreaterThan(0);
  for (const h of historico) expect(h.plano.join(" | ")).toContain("ix_chart_norm");
  // nenhuma query lê o histórico inteiro do chart por data
  expect(execs.some((e) => /data\s*>\s*\?\s*GROUP BY chart/i.test(e.sql))).toBe(false);
});
test("ingestão: leituras por semana não crescem com o histórico", async () => {
  let lidas = 0;
  const db = criarD1Sqlite(":memory:", (sql, _p, n) => { if (/^\s*SELECT/i.test(sql)) lidas += n; });
  const porSemana: number[] = [];
  for (let s = 0; s < 12; s++) {
    const d = new Date(Date.UTC(2026, 0, 5 + 7 * s));
    const br = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
    // 10 faixas ficam no chart; as outras 90 são novas toda semana (o histórico do chart cresce 450/semana).
    const linhas = linhasFake(br).map((l) => (Number(l[2]) > 10 ? [...l.slice(0, 3), `Nova ${s} - Faixa ${l[2]}`, ...l.slice(4)] : l));
    lidas = 0;
    expect((await ingerirSemana(db, { linhas, modo: "historico" })).ok).toBe(true);
    porSemana.push(lidas);
  }
  // Só o histórico das faixas da semana (50 que ficam × semanas), não o chart inteiro (~5.000 linhas na 12ª).
  expect(porSemana[11]).toBeLessThan(50 * 11 + 600);
  expect(porSemana[11] - porSemana[10]).toBeLessThanOrEqual(60);
});
test("schema: chart_semana sem rowid, genero e valor_acumulado gravados na ingestão", async () => {
  const db = criarD1Sqlite();
  await criarMusicasFake(db);
  const l1 = linhasLeitura("04/11/2026", false).map((l) => (l[2] === "1" ? [...l.slice(0, 5), "5.000.000", ...l.slice(6)] : l));
  await ingerirSemana(db, { linhas: l1 });
  await ingerirSemana(db, { linhas: linhasLeitura("11/11/2026", false) });
  const [ddl] = (await db.prepare("SELECT sql FROM sqlite_master WHERE name = 'chart_semana'").all<{ sql: string }>()).results;
  expect(ddl.sql).toContain("WITHOUT ROWID");
  const rows = await db.prepare("SELECT data, genero, valor_acumulado FROM chart_semana WHERE chart = 'SPOTIFY' AND pos IN (1, 2) ORDER BY data, pos").all<any>();
  expect(rows.results).toEqual([
    { data: "2026-11-04", genero: "Pop", valor_acumulado: 5000000 }, // valor_total da planilha vence
    { data: "2026-11-04", genero: "Rock", valor_acumulado: 99000 },
    { data: "2026-11-11", genero: "Pop", valor_acumulado: 5100000 }, // acumulado anterior + valor
    { data: "2026-11-11", genero: "Rock", valor_acumulado: 198000 },
  ]);
  const datas = await db.prepare("SELECT chart, data FROM chart_datas WHERE chart = 'YOUTUBE' ORDER BY data").all<any>();
  expect(datas.results).toEqual([{ chart: "YOUTUBE", data: "2026-11-04" }, { chart: "YOUTUBE", data: "2026-11-11" }]);
});
test("generosDoChart: gêneros da semana pedida (padrão: a mais recente)", async () => {
  const db = criarD1Sqlite();
  await criarMusicasFake(db);
  await ingerirSemana(db, { linhas: linhasLeitura("04/11/2026", false) });
  // semana nova só com faixas ímpares (Pop)
  await ingerirSemana(db, { linhas: linhasLeitura("11/11/2026", false).map((l) => [...l.slice(0, 3), "Artista 1 - Faixa 1", ...l.slice(4)]) });
  expect(await generosDoChart(db, "SPOTIFY")).toEqual(["Pop"]);
  expect(await generosDoChart(db, "SPOTIFY", "04/11/2026")).toEqual(["Pop", "Rock"]);
  expect(await generosDoChart(criarD1Sqlite(), "SPOTIFY")).toEqual([]);
});
test("HOF: chart_artista_musica fica certa com semana fora de ordem e reenvio", async () => {
  const db = criarD1Sqlite();
  // 11/11 chega antes de 04/11: a run continua cronológica.
  await ingerirSemana(db, { linhas: linhasLeitura("11/11/2026", true) });
  await ingerirSemana(db, { linhas: linhasLeitura("04/11/2026", false) });
  let p = await perfilHOF(db, "Artista 2");
  expect(p.runs).toEqual([{ t: "Artista 2 - Faixa 2", v: "2 - 1" }]);
  expect(p.n1_hot100).toBe("1");
  // Reenvio de 04/11 sem a faixa do Artista 2: a posição some da run.
  await ingerirSemana(db, { linhas: linhasLeitura("04/11/2026", false).map((l) => (l[2] === "2" ? [...l.slice(0, 3), "Outro - Faixa", ...l.slice(4, 7), "Outro", ...l.slice(8)] : l)) });
  p = await perfilHOF(db, "Artista 2");
  expect(p.runs).toEqual([{ t: "Artista 2 - Faixa 2", v: "1" }]);
  // Reenvio de 11/11 sem o Artista 2: a música sai do perfil.
  await ingerirSemana(db, { linhas: linhasLeitura("11/11/2026", false) });
  p = await perfilHOF(db, "Artista 2");
  expect(p.runs).toEqual([{ t: "Artista 2 - Faixa 2", v: "2" }]);
  const outro = await perfilHOF(db, "outro");
  expect(outro.runs).toEqual([{ t: "Outro - Faixa", v: "2" }]);
});
test("HOF: artista com acento casa sem acento (e vice-versa)", async () => {
  const db = criarD1Sqlite();
  await ingerirSemana(db, { linhas: linhasFake("11/11/2026").map((l) => (l[2] === "1" ? [...l.slice(0, 3), "Ánne - Canção", ...l.slice(4, 7), "Ánne", ...l.slice(8)] : l)) });
  expect((await perfilHOF(db, "anne")).runs).toEqual([{ t: "Ánne - Canção", v: "1" }]);
  expect((await perfilHOF(db, " ÁNNE ")).n1_spotify).toBe("1");
  expect((await perfilHOF(db, "Ann")).runs).toEqual([]);
});
test("ativação: D1 inativo cai na planilha; POST só com ativar liga a leitura", async () => {
  const db = await dbComDuasSemanas();
  const planilha = [["h"], ["SPOTIFY", "01/01/2025", "1", "Velha - Planilha", "10", "", "", "Velha"]];
  await comApiCharts(db, { SPOTIFY: planilha }, async (lidas) => {
    expect((await api("action=getFilters&tab=SPOTIFY")).dates).toEqual(["01/01/2025"]);
    expect(lidas).toContain("chartsBase:SPOTIFY");
  });
  const g = globalThis as Record<string, unknown>;
  const antes = { token: g.__CHARTS_INGEST_TOKEN__, db: g.__CATALOGO_DB__ };
  g.__CHARTS_INGEST_TOKEN__ = "segredo";
  g.__CATALOGO_DB__ = db;
  try {
    const res = await chartsIngestController(new Request("http://x/api/charts/ingest", {
      method: "POST", headers: { Authorization: "Bearer segredo" }, body: JSON.stringify({ ativar: true }),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ativo: true });
    const sem = await chartsIngestController(new Request("http://x/api/charts/ingest", {
      method: "POST", headers: { Authorization: "Bearer segredo" }, body: JSON.stringify({}),
    }));
    expect(sem.status).toBe(400);
  } finally {
    g.__CHARTS_INGEST_TOKEN__ = antes.token;
    g.__CATALOGO_DB__ = antes.db;
  }
  await comApiCharts(db, { SPOTIFY: planilha }, async (lidas) => {
    expect((await api("action=getFilters&tab=SPOTIFY")).dates).toEqual(["11/11/2026", "04/11/2026"]);
    expect(lidas).not.toContain("chartsBase:SPOTIFY");
  });
});
test("ativação: semana com ativar grava e liga; seed fica '0'", async () => {
  const db = criarD1Sqlite();
  await ingerirSemana(db, { linhas: linhasFake("04/11/2026") });
  const flag = async () => (await db.prepare("SELECT valor FROM chart_config WHERE chave = 'charts_d1_ativo'").all<{ valor: string }>()).results[0]?.valor;
  expect(await flag()).toBe("0");
  expect(await chartsD1Ativo(db)).toBe(false);
  expect(await ingerirSemana(db, { linhas: linhasFake("11/11/2026"), ativar: true })).toEqual({ ok: true, data: "2026-11-11", linhas: 500 });
  expect(await flag()).toBe("1");
  expect(await chartsD1Ativo(db)).toBe(true);
  await ingerirSemana(db, { linhas: linhasFake("18/11/2026") }); // seed não desliga
  expect(await flag()).toBe("1");
  expect(await chartsD1Ativo(criarD1Sqlite())).toBe(false);
});

// ---- Carga inicial pelo GitHub Action: partes de SQL puro (charts-d1-gerar-parte.ts) ----
import {
  literalSql, insertsMultiLinha, montarArquivoSql, lerDatasCarregadas, lerAtivo, montarBancoLocal, gerarParte, importarCatalogo,
} from "./charts-d1-gerar-parte";

/** Banco local com as semanas dadas (500 linhas cada) e os pesos reais. */
const bancoLocalFake = (datasBr: string[]) =>
  montarBancoLocal(datasBr.flatMap((d) => linhasFake(d)), pesosDoCsv().slice(1).filter((p) => (p[0] ?? "").trim()));
const estadoRemoto = async (remoto: ReturnType<typeof criarD1Sqlite>) => {
  try {
    const datas = (await remoto.prepare("SELECT data FROM chart_datas").all<{ data: string }>()).results.map((r) => r.data);
    const [a] = (await remoto.prepare("SELECT valor FROM chart_config WHERE chave = 'charts_d1_ativo'").all<{ valor: string }>()).results;
    return { carregadas: new Set(datas), ativoRemoto: a?.valor ?? null };
  } catch {
    return { carregadas: new Set<string>(), ativoRemoto: null }; // banco remoto ainda sem tabelas
  }
};
const dump = async (db: ReturnType<typeof criarD1Sqlite>, sql: string) => JSON.stringify((await db.prepare(sql).all()).results);

test("gerar-parte: literais SQL escapam aspas, NULL, números e voltam iguais do SQLite", async () => {
  expect(literalSql("D'Angelo")).toBe("'D''Angelo'");
  expect(literalSql(null)).toBe("NULL");
  expect(literalSql(undefined)).toBe("NULL");
  expect(literalSql(42)).toBe("42");
  expect(literalSql(0.0725)).toBe("0.0725");
  expect(literalSql(NaN)).toBe("NULL");
  expect(literalSql(true)).toBe("1");
  const db = criarD1Sqlite();
  db.exec("CREATE TABLE t (a, b, c)");
  const linhas = [["It's \"x\"; DROP TABLE t; --", null, 1.5], ["l1\nl2 ''", 0, -3]];
  db.exec(montarArquivoSql(insertsMultiLinha("INSERT INTO t (a, b, c)", linhas)));
  expect((await db.prepare("SELECT a, b, c FROM t").all<any>()).results.map((r) => [r.a, r.b, r.c])).toEqual(linhas);
  // statements nunca passam do limite de bytes
  const grandes = Array.from({ length: 50 }, (_, i) => [`${i}`.padEnd(1000, "x")]);
  const sts = insertsMultiLinha("INSERT INTO t (a)", grandes, 5000);
  expect(sts.length).toBeGreaterThan(10);
  expect(sts.every((s) => Buffer.byteLength(s) <= 5000)).toBe(true);
});
test("gerar-parte: lê a saída JSON do wrangler e tolera vazio/erro", () => {
  const ok = JSON.stringify([{ results: [{ data: "2020-05-25" }, { data: "2020-05-25" }, { data: "2020-06-01" }], success: true, meta: {} }]);
  expect([...lerDatasCarregadas(ok)]).toEqual(["2020-05-25", "2020-06-01"]);
  expect(lerDatasCarregadas(undefined).size).toBe(0);
  expect(lerDatasCarregadas("").size).toBe(0);
  expect(lerDatasCarregadas("[]").size).toBe(0);
  expect(lerDatasCarregadas('{"error":{"text":"no such table: chart_datas"}}').size).toBe(0);
  expect(lerDatasCarregadas("✘ [ERROR] no such table").size).toBe(0);
  expect(lerAtivo(JSON.stringify([{ results: [{ valor: "1" }], success: true }]))).toBe("1");
  expect(lerAtivo(JSON.stringify([{ results: [], success: true }]))).toBeNull();
  expect(lerAtivo(undefined)).toBeNull();
});
test("gerar-parte: escolhe semanas pendentes mais antigas inteiras até o limite", async () => {
  const { db, erros } = await bancoLocalFake(["11/11/2026", "28/10/2026", "04/11/2026"]);
  expect(erros).toEqual([]);
  const p = await gerarParte(db, { carregadas: new Set(), ativoRemoto: null, limite: 1200 });
  expect(p.datas).toEqual(["2026-10-28", "2026-11-04"]); // a 3ª estouraria 1200
  expect(p.linhas).toBe(1000);
  expect(p.restantes).toBe(1);
  expect(p.ativacao).toBe(false);
  const sql = p.statements.join("\n");
  expect(sql).toContain("INSERT OR REPLACE INTO pais_peso");
  expect(sql).toContain("INSERT OR IGNORE INTO chart_config");
  expect(sql).toContain("DELETE FROM chart_semana WHERE data = '2026-10-28'");
  expect(sql).not.toContain("2026-11-11");
  expect(sql).not.toMatch(/\b(BEGIN|COMMIT)\b/);
  // carregadas são puladas
  expect((await gerarParte(db, { carregadas: new Set(["2026-10-28"]), ativoRemoto: "0", limite: 1200 })).datas).toEqual(["2026-11-04", "2026-11-11"]);
  // semana maior que o limite: nada, com motivo
  const nada = await gerarParte(db, { carregadas: new Set(), ativoRemoto: null, limite: 499 });
  expect(nada.statements).toEqual([]);
  expect(nada.nada).toContain("2026-10-28");
});
test("gerar-parte: sem semanas pendentes grava o Hall of Fame e ativa; ativado não faz nada", async () => {
  const { db } = await bancoLocalFake(["04/11/2026", "11/11/2026"]);
  const todas = new Set(["2026-11-04", "2026-11-11"]);
  const p = await gerarParte(db, { carregadas: todas, ativoRemoto: "0", limite: 25000 });
  expect(p.ativacao).toBe(true);
  expect(p.datas).toEqual([]);
  expect(p.statements).toContain("DELETE FROM chart_artista_musica");
  expect(p.statements.at(-1)).toBe("UPDATE chart_config SET valor = '1' WHERE chave = 'charts_d1_ativo'");
  expect(p.statements.some((s) => s.startsWith("INSERT INTO chart_artista_musica"))).toBe(true);
  expect(p.statements.join("\n")).not.toContain("INSERT INTO chart_semana");
  expect(p.linhasArtista).toBe((await db.prepare("SELECT COUNT(*) n FROM chart_artista_musica").all<{ n: number }>()).results[0].n);
  const fim = await gerarParte(db, { carregadas: todas, ativoRemoto: "1", limite: 25000 });
  expect(fim.statements).toEqual([]);
  expect(montarArquivoSql(fim.statements)).toBe("");
});
test("gerar-parte: aplicar as partes em sequência reproduz a carga local inteira (e reaplicar não muda nada)", async () => {
  const { db } = await bancoLocalFake(["25/05/2020", "01/06/2020", "08/06/2020", "15/06/2020", "22/06/2020"]);
  const remoto = criarD1Sqlite();
  const partes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const p = await gerarParte(db, { ...(await estadoRemoto(remoto)), limite: 1000 });
    const sql = montarArquivoSql(p.statements);
    if (!sql) break;
    partes.push(sql);
    remoto.exec(sql);
    if (i === 0) remoto.exec(sql); // reexecução da mesma parte (retry) é idempotente
  }
  expect(partes.length).toBe(4); // 2 + 2 + 1 semanas, depois a ativação
  const tabelas = [
    "SELECT * FROM chart_semana ORDER BY chart, data, pos",
    "SELECT * FROM chart_datas ORDER BY chart, data",
    "SELECT * FROM chart_artista_musica ORDER BY artista_key, chart, titulo_norm",
    "SELECT * FROM pais_peso ORDER BY plataforma, pais",
  ];
  for (const t of tabelas) expect(await dump(remoto, t)).toBe(await dump(db, t));
  expect((await estadoRemoto(remoto)).ativoRemoto).toBe("1");
});
test("gerar-parte: catálogo do wrangler export entra no banco local (coluna a mais é criada)", async () => {
  const { db } = await montarBancoLocal([], []);
  importarCatalogo(db, `PRAGMA defer_foreign_keys=TRUE;\nINSERT INTO "musicas" ("codigo_unico","titulo","artista","genero","coluna_nova") VALUES('1','Faixa; ''1''','Artista','Pop','x');`);
  expect((await db.prepare("SELECT titulo, genero, coluna_nova FROM musicas").all<any>()).results).toEqual([{ titulo: "Faixa; '1'", genero: "Pop", coluna_nova: "x" }]);
});

// ---- Gênero por artista (artista_info.genero, da INFOS ACTS) ----
import {
  CHARTS_D1_SCHEMA, carregarGenerosArtistas, garantirSchemaCharts,
} from "../backend/src/services/chartsD1/repo";
import { artistasDoCsvInfos } from "./charts-d1-carga-inicial";

test("migração: artista_info antiga (sem genero) ganha a coluna e mantém os dados; rodar de novo não quebra", async () => {
  const db = criarD1Sqlite();
  await db.prepare("CREATE TABLE artista_info (nome_upper TEXT PRIMARY KEY, nome TEXT, nacionalidade TEXT, foto TEXT)").run();
  await db.prepare("INSERT INTO artista_info VALUES ('ANTIGO', 'Antigo', 'BRASIL', 'a.jpg')").run();
  // Antes da migração a leitura não quebra: só não há gêneros de artista.
  expect(await carregarGenerosArtistas(db)).toEqual(new Map());
  await garantirSchemaCharts(db);
  await garantirSchemaCharts(db); // idempotente ("duplicate column" ignorado)
  expect((await ingerirSemana(db, { linhas: linhasFake("11/11/2026"), artistas: [["Novo", "EUA", "n.jpg", "Pop"]] })).ok).toBe(true);
  const info = await db.prepare("SELECT nome_upper, foto, genero FROM artista_info ORDER BY nome_upper").all<any>();
  expect(info.results).toEqual([
    { nome_upper: "ANTIGO", foto: "a.jpg", genero: null },
    { nome_upper: "NOVO", foto: "n.jpg", genero: "Pop" },
  ]);
  // Banco novo: o CREATE já traz a coluna.
  const novo = criarD1Sqlite();
  await garantirSchemaCharts(novo);
  const cols = await novo.prepare("PRAGMA table_info(artista_info)").all<{ name: string }>();
  expect(cols.results.map((c) => c.name)).toContain("genero");
  expect(CHARTS_D1_SCHEMA.some((s) => /artista_info[\s\S]*genero TEXT/.test(s))).toBe(true);
});

test("upsert de artista_info: gênero opcional, vazio/'-'/ausente não apaga o já gravado", async () => {
  const db = criarD1Sqlite();
  const enviar = async (artistas: string[][]) =>
    expect((await ingerirSemana(db, { linhas: linhasFake("11/11/2026"), artistas })).ok).toBe(true);
  const ler = async () => (await db.prepare("SELECT foto, genero FROM artista_info WHERE nome_upper = 'ARTISTA X'").all<any>()).results[0];
  await enviar([["Artista X", "Brasil", "f.jpg", " Pop "], ["Sem Genero", "", "", ""]]);
  expect(await ler()).toEqual({ foto: "f.jpg", genero: "Pop" });
  await enviar([["Artista X", "Brasil", "g.jpg"]]); // 3 elementos (planilha sem coluna de gênero)
  expect(await ler()).toEqual({ foto: "g.jpg", genero: "Pop" });
  await enviar([["Artista X", "Brasil", "g.jpg", ""]]);
  await enviar([["Artista X", "Brasil", "g.jpg", "-"]]);
  expect((await ler()).genero).toBe("Pop");
  await enviar([["Artista X", "Brasil", "g.jpg", "Rock"]]);
  expect((await ler()).genero).toBe("Rock");
  const sem = await db.prepare("SELECT genero FROM artista_info WHERE nome_upper = 'SEM GENERO'").all<any>();
  expect(sem.results[0].genero).toBeNull();
  expect(await carregarGenerosArtistas(db)).toEqual(new Map([["ARTISTA X", "Rock"]]));
});

test("gênero na leitura: o da música vence; sem ele, o do artista principal (vale pra semanas antigas)", async () => {
  const db = criarD1Sqlite();
  await criarMusicasFake(db);
  // Faixas 1 e 2 fora do catálogo: chart_semana.genero fica vazio.
  await db.prepare("DELETE FROM musicas WHERE titulo IN ('Faixa 1', 'Faixa 2')").run();
  const artistas = [["Artista 1", "", "", "Funk"], ["Artista 2", "", ""], ["Artista 3", "", "", "Jazz"]];
  expect((await ingerirSemana(db, { linhas: linhasLeitura("04/11/2026", false), artistas })).ok).toBe(true);

  let rows = await linhasDoChart(db, "BILLBOARD HOT 100", "04/11/2026", "", catFake, new Map());
  expect(rows.slice(0, 3).map((r) => r.style)).toEqual(["Funk", "", "Pop"]); // #3: catálogo (Pop) vence o artista (Jazz)
  expect(await generosDoChart(db, "BILLBOARD HOT 100")).toEqual(["Funk", "Pop", "Rock"]);
  const funk = await linhasDoChart(db, "BILLBOARD HOT 100", "04/11/2026", "Funk", catFake, new Map());
  expect(funk.map((r) => r.pos)).toEqual([1]);
  expect(await linhasDoChart(db, "BILLBOARD HOT 100", "04/11/2026", "Jazz", catFake, new Map())).toEqual([]);

  // Gênero do Artista 2 preenchido depois (outra semana): a semana antiga passa a usá-lo.
  expect((await ingerirSemana(db, { linhas: linhasLeitura("11/11/2026", false), artistas: [["Artista 2", "", "", "Trap"]] })).ok).toBe(true);
  rows = await linhasDoChart(db, "BILLBOARD HOT 100", "04/11/2026", "", catFake, new Map());
  expect(rows[1].style).toBe("Trap");
  expect(await generosDoChart(db, "BILLBOARD HOT 100", "04/11/2026")).toEqual(["Funk", "Pop", "Rock", "Trap"]);
  // Mapa passado pelo controller (cache) é o usado, sem reler artista_info.
  const doCache = new Map([["ARTISTA 1", "Axé"]]);
  rows = await linhasDoChart(db, "BILLBOARD HOT 100", "04/11/2026", "Axé", catFake, new Map(), doCache);
  expect(rows.map((r) => r.pos)).toEqual([1]);
  expect(await generosDoChart(db, "BILLBOARD HOT 100", "04/11/2026", doCache)).toEqual(["Axé", "Pop", "Rock"]);
});

test("/api/charts: filtro de gênero do Hot 100 usa o gênero do artista", async () => {
  const db = criarD1Sqlite();
  // Sem catálogo: só o gênero do artista existe.
  expect((await ingerirSemana(db, { linhas: linhasLeitura("04/11/2026", false), artistas: [["Artista 5", "", "", "Funk"]] })).ok).toBe(true);
  await ativarD1(db);
  await comApiCharts(db, {}, async (lidas) => {
    expect(await api("action=getFilters&tab=BILLBOARD HOT 100")).toEqual({ dates: ["04/11/2026"], styles: ["Funk"] });
    const rows = await api("action=getChart&tab=BILLBOARD HOT 100&date=04/11/2026&style=Funk");
    expect(rows.map((r: any) => [r.pos, r.tit, r.style])).toEqual([[5, "Artista 5 - Faixa 5", "Funk"]]);
    expect(lidas.filter((l) => l.startsWith("chartsBase"))).toEqual([]);
  });
});

test("carga inicial --infos: colunas pelo cabeçalho, gênero opcional", () => {
  const comGenero = artistasDoCsvInfos([
    ["Nome", "x", "Gênero Musical", "", "", "", "Foto", "", "", "", "", "", "", "Nacionalidade"],
    ["Ana", "", "Pop", "", "", "", "a.jpg", "", "", "", "", "", "", "Brasil"],
    ["", "", "Rock", "", "", "", "", "", "", "", "", "", "", ""],
  ]);
  expect(comGenero).toEqual([["Ana", "Brasil", "a.jpg", "Pop"]]);
  const linha = Array.from({ length: 14 }, (_, i) => `c${i}`);
  expect(artistasDoCsvInfos([Array(14).fill(""), linha])).toEqual([["c0", "c13", "c6"]]); // sem cabeçalho reconhecido: A/G/N
  expect(artistasDoCsvInfos([["ARTISTA", "ESTILO"], ["Bia", "Funk"]])).toEqual([["Bia", "", "", "Funk"]]);
});
