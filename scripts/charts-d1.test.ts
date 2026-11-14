import { test, expect } from "bun:test";
// Charts semanais no D1. Uso: bun test scripts/charts-d1.test.ts
import { CHARTS, type LinhaDados } from "../backend/src/services/chartsD1/tipos";
import { calcularMovimento } from "../backend/src/services/chartsD1/movimento";
import { fatiasPorPais, rankingPais, type Pesos } from "../backend/src/services/chartsD1/paises";
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
test("fatias: soma fecha em 1 com resto, com Σ>1 e com dupla nacionalidade", () => {
  const soma = (m: Map<string, number>, resto: number) => [...m.values()].reduce((a, b) => a + b, 0) + resto;
  const p1: Pesos = new Map([["BRASIL", 0.072], ["ESTADOS UNIDOS", 0.1845]]); // Σ<1
  const f1 = fatiasPorPais(p1, new Set(), 0.2);
  expect(f1.get("BRASIL")).toBeCloseTo(0.072);
  const f2 = fatiasPorPais(p1, new Set(["BRASIL", "ESTADOS UNIDOS"]), 0.2);
  expect(f2.get("BRASIL")!).toBeGreaterThan(0.072);
  expect(soma(f2, (1 - 0.2565) / (0.2565 + 0.4 + (1 - 0.2565)))).toBeCloseTo(1);
  const p3: Pesos = new Map([["A", 0.7], ["B", 0.5]]); // Σ>1 (como YouTube 119,96%)
  const f3 = fatiasPorPais(p3, new Set(), 0.2);
  expect(f3.get("A")! + f3.get("B")!).toBeCloseTo(1);
});
test("rankingPais: artista local sobe no próprio país", () => {
  const pesos: Pesos = new Map([["AUSTRÁLIA", 0.025], ["BRASIL", 0.072]]);
  const ms = [
    { tituloNorm: "a", titulo: "X - A", artistaPrincipal: "X", valor: 1000, nacionalidades: new Set<string>() },
    { tituloNorm: "b", titulo: "Amanda Brokne - B", artistaPrincipal: "Amanda Brokne", valor: 800, nacionalidades: new Set(["AUSTRÁLIA"]) },
  ];
  expect(rankingPais(ms, pesos, "AUSTRÁLIA", 0.2, 50)[0].tituloNorm).toBe("b");
  expect(rankingPais(ms, pesos, "BRASIL", 0.2, 50)[0].tituloNorm).toBe("a");
});

import { indexarCatalogo, buscarNoCatalogo, resolverArtistas, extrairArtistasDoTitulo } from "../backend/src/services/chartsD1/artistas";

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

import { criarD1Sqlite } from "./charts-d1-sqlite";
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
  await db.prepare("CREATE TABLE musicas (titulo TEXT, artista TEXT, artista_2 TEXT, artista_3 TEXT, artista_4 TEXT, artista_5 TEXT, artista_6 TEXT, capa_url TEXT, genero TEXT, tipo_single TEXT)").run();
  await db.prepare("INSERT INTO musicas VALUES ('Faixa 1', 'Artista 1', 'Convidada', NULL, NULL, NULL, NULL, 'c.jpg', 'Pop', 'SINGLE')").run();
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
  expect(cfg.results).toEqual([{ chave: "bonus_nacionalidade", valor: "0.20" }, { chave: "top_pais", valor: "50" }]);
});
test("reenvio de semana antiga recalcula a semana seguinte", async () => {
  const db = criarD1Sqlite();
  await ingerirSemana(db, { linhas: linhasFakeTrocandoPos1e2("11/11/2026") });
  let top = await db.prepare("SELECT status, semanas FROM chart_semana WHERE chart='YOUTUBE' AND data='2026-11-11' AND pos=1").all<any>();
  expect(top.results[0]).toEqual({ status: "NEW", semanas: 1 });
  await ingerirSemana(db, { linhas: linhasFake("04/11/2026") });
  top = await db.prepare("SELECT status, semanas, peak, pos_anterior FROM chart_semana WHERE chart='YOUTUBE' AND data='2026-11-11' AND pos=1").all<any>();
  expect(top.results[0]).toEqual({ status: "↑", semanas: 2, peak: 1, pos_anterior: 2 });
  const h = await historicoAntesDe(db, "YOUTUBE", "2026-11-12");
  expect(h.get("artista 1 faixa 1")).toEqual({ tituloNorm: "artista 1 faixa 1", posAnterior: 2, peak: 1, semanas: 2, semanasN1: 1 });
});
test("controller: 405, 400 e 200 com token", async () => {
  const g = globalThis as Record<string, unknown>;
  const antes = { token: g.__CHARTS_INGEST_TOKEN__, db: g.__CATALOGO_DB__ };
  g.__CHARTS_INGEST_TOKEN__ = "segredo";
  g.__CATALOGO_DB__ = criarD1Sqlite();
  try {
    const auth = { Authorization: "Bearer segredo" };
    expect((await chartsIngestController(new Request("http://x/api/charts/ingest", { headers: auth }))).status).toBe(405);
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
