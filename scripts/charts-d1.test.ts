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
  expect(h.get("artista 1 - faixa 1")).toEqual({ tituloNorm: "artista 1 - faixa 1", posAnterior: 2, peak: 1, semanas: 2, semanasN1: 1 });
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

// ---- Leitura (/api/charts) a partir do D1 ----
import { existsSync, readFileSync } from "node:fs";
import {
  datasDoChart, generosDoChart, linhasDoChart, linhasPaises, numero1DaUltimaSemana, perfilHOF,
} from "../backend/src/services/chartsD1/repo";

// Catálogo fake: "Artista i - Faixa i" com capa própria; ímpar = Pop, par = Rock.
const catFake = indexarCatalogo(
  Array.from({ length: 100 }, (_, i) => ({
    titulo: `Faixa ${i + 1}`, artista: `Artista ${i + 1}`, capa_url: `capa-${i + 1}.jpg`,
    genero: (i + 1) % 2 ? "Pop" : "Rock", tipo_single: "SINGLE",
  })) as any,
);

// Semana fake pra leitura: título E artista trocam juntos entre #1 e #2 na
// segunda semana; valores bem espaçados (não empatam ao dividir por país).
const linhasLeitura = (dataBr: string, trocar: boolean): string[][] =>
  linhasFake(dataBr).map((l) => {
    const pos = Number(l[2]);
    const n = trocar && pos <= 2 ? 3 - pos : pos;
    return [l[0], l[1], l[2], `Artista ${n} - Faixa ${n}`, String((101 - pos) * 1000), "", "", `Artista ${n}`, "", "", "", ""];
  });

async function dbComDuasSemanas(artistas: string[][] = [], pesos: string[][] = []) {
  const db = criarD1Sqlite();
  expect((await ingerirSemana(db, { linhas: linhasLeitura("04/11/2026", false), artistas, pesos })).ok).toBe(true);
  expect((await ingerirSemana(db, { linhas: linhasLeitura("11/11/2026", true) })).ok).toBe(true);
  return db;
}

// CSV "PAÍSES E PESOS" real (81 países) quando disponível; senão um recorte mínimo.
const CSV_PESOS = "/root/.claude/uploads/2a149bbf-d1c1-542e-8fba-44e303dfd808/28fa6e80-Empire_Base_de_Dados_-_PA_SES_E_PESOS.csv";
function pesosDoCsv(): string[][] {
  if (!existsSync(CSV_PESOS)) {
    return [["PAÍS", "SPOTIFY (B)", "APPLE MUSIC (C)", "YOUTUBE (D)"], ["AUSTRÁLIA", "2,50%", "2,00%", "1,00%"], ["BRASIL", "7,20%", "2,50%", "15,50%"]];
  }
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
  expect(await generosDoChart(db, "SPOTIFY", catFake)).toEqual(["Pop", "Rock"]);
});
test("países: 81 × top 50, artista local acima no próprio país", async () => {
  const pesos = pesosDoCsv();
  const nPaises = pesos.slice(1).filter((p) => p[0].trim() && p[1].trim()).length;
  const db = await dbComDuasSemanas([["Artista 60", "Austrália", "f60.jpg"]], pesos);
  const rows = await linhasPaises(db, "SPOTIFY", "11/11/2026", catFake, new Map());
  expect(Object.keys(rows[0]).sort()).toEqual(["art", "capa", "mes", "pais", "pos", "st", "tit", "val"]);
  expect(new Set(rows.map((r) => r.pais)).size).toBe(nPaises);
  expect(rows).toHaveLength(nPaises * 50);
  const brasil = rows.filter((r) => r.pais === "BRASIL");
  expect(brasil).toHaveLength(50);
  expect(brasil[0]).toMatchObject({ pos: 1, tit: "Artista 2 - Faixa 2", mes: "11/11/2026", art: "Artista 2", st: "↑", capa: "capa-2.jpg" });
  expect(brasil[1].st).toBe("↓");
  expect(brasil.some((r) => r.tit === "Artista 60 - Faixa 60")).toBe(false);
  const australia = rows.filter((r) => r.pais === "AUSTRÁLIA");
  expect(australia[0]).toMatchObject({ pos: 1, tit: "Artista 60 - Faixa 60", st: "=" });
});
test("datas vazias → fallback", async () => {
  expect(await datasDoChart(criarD1Sqlite(), "DIGITAL SALES")).toEqual([]);
  const db = await dbComDuasSemanas();
  await db.prepare("DELETE FROM chart_semana WHERE chart = 'DIGITAL SALES'").run();
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
  expect(p.sp).toEqual([{ t: "Artista 2 - Faixa 2", v: "2 - 1" }]);
  expect(p.am).toEqual([{ t: "Artista 2 - Faixa 2", v: "2 - 1" }]);
  expect(p.yt).toEqual([{ t: "Artista 2 - Faixa 2", v: "2 - 1" }]);
  const p20 = await perfilHOF(db, "Artista 20"); // não confunde com "Artista 2"
  expect(p20.runs).toEqual([{ t: "Artista 20 - Faixa 20", v: "20 - 20" }]);
  expect(p20.n1_hot100).toBe("0");
});
test("rankingPais: país de peso pequeno ordena pelo valor real, não pelo arredondado", () => {
  const pesos: Pesos = new Map([["ANGOLA", 0.0005]]);
  const ms = [
    { tituloNorm: "a", titulo: "A", artistaPrincipal: "A", valor: 1000, nacionalidades: new Set<string>() },
    { tituloNorm: "z", titulo: "Z", artistaPrincipal: "Z", valor: 1200, nacionalidades: new Set<string>() },
  ];
  const r = rankingPais(ms, pesos, "ANGOLA", 0.2, 50);
  expect(r.map((m) => [m.tituloNorm, m.val])).toEqual([["z", 1], ["a", 1]]);
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

test("/api/charts: chart com semanas no D1 lê do D1; chart vazio cai na planilha", async () => {
  const db = await dbComDuasSemanas();
  await db.prepare("DELETE FROM chart_semana WHERE chart = 'DIGITAL SALES'").run();
  const planilhaSales = [["h"], ["DIGITAL SALES", "01/01/2025", "1", "Velha - Planilha", "10", "", "", "Velha"]];
  await comApiCharts(db, { "DIGITAL SALES": planilhaSales }, async (lidas) => {
    expect(await api("action=getFilters&tab=SPOTIFY")).toEqual({ dates: ["11/11/2026", "04/11/2026"], styles: [] });
    const rows = await api("action=getChart&tab=SPOTIFY&date=11/11/2026");
    expect(rows).toHaveLength(100);
    expect(rows[0]).toMatchObject({ pos: 1, tit: "Artista 2 - Faixa 2", st: "↑" });
    expect((await api("action=getFilters&tab=SPOTIFY COUNTRIES")).dates).toEqual(["11/11/2026", "04/11/2026"]);
    expect(lidas.filter((l) => l.startsWith("chartsBase") || l.startsWith("chartsCountries"))).toEqual([]);
    expect((await api("action=getFilters&tab=DIGITAL SALES")).dates).toEqual(["01/01/2025"]);
    expect(lidas).toContain("chartsBase:DIGITAL SALES");
    const banners = await api("action=getBannerN1s");
    expect(banners.spotify).toEqual({ tit: "Artista 2 - Faixa 2", art: "Artista 2", capa: "" });
    expect(banners.sales).toMatchObject({ tit: "Velha - Planilha", art: "Velha" });
  });
});
test("/api/charts HOF: números/runs dos charts do D1 sobre img/country/style e álbuns da planilha", async () => {
  const db = await dbComDuasSemanas();
  const hof = [["h"], ["Artista 2", "img", "BRASIL", "Pop", "9", "9", "9", "4", "Velha|1", "Velha|1", "Velha|1", "Album|1 - 2", "Velha|1", ""]];
  await comApiCharts(db, { HALL_OF_FAME_DB: hof }, async () => {
    const p = await api("action=getHOFProfile&artist=Artista 2");
    expect(p).toMatchObject({ name: "Artista 2", img: "img", country: "BRASIL", style: "Pop", n1_hot100: "1", n1_spotify: "1", n1_youtube: "1", n1_bb200: "4" });
    expect(p.runs).toEqual([{ t: "Artista 2 - Faixa 2", v: "2 - 1" }]);
    expect(p.am).toEqual([{ t: "Artista 2 - Faixa 2", v: "2 - 1" }]);
    expect(p.alb).toEqual([{ t: "Album", v: "1 - 2" }]);
  });
});
