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
