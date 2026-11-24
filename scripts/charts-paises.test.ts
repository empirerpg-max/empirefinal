import { test, expect } from "bun:test";
// Paradas por país nos charts. Uso: bun test scripts/charts-paises.test.ts
import { sorteio01 } from "../backend/src/services/chartsD1/sorteio";
import { fatiasRegraC, rankingsPorPais, type Pesos, type EntradaMusica } from "../backend/src/services/chartsD1/paises";
import { regrasDeConfig, parseRegrasSemana, REGRAS_PADRAO } from "../backend/src/services/chartsD1/regras";

test("sorteio01: determinístico, em [0,1), varia com a chave", () => {
  expect(sorteio01("2026-11-11|x|BRASIL|nac")).toBe(sorteio01("2026-11-11|x|BRASIL|nac"));
  const v = ["a", "b", "c", "d", "e"].map(sorteio01);
  for (const x of v) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  expect(new Set(v).size).toBe(5);
});
test("regrasDeConfig: sobrepõe números válidos e paradas; ignora lixo", () => {
  const r = regrasDeConfig(new Map([["nac_max", "5"], ["variacao", "abc"], ["paradas", "[{\"id\":\"X\"}]"]]));
  expect(r.paises.nac_max).toBe(5);
  expect(r.paises.variacao).toBe(0.15);
  expect(r.paradas[0].id).toBe("X");
  expect(regrasDeConfig(new Map([["paradas", "{quebrado"]])).paradas.length).toBe(12);
});
test("parseRegrasSemana: null para vazio/inválido", () => {
  expect(parseRegrasSemana(null)).toBeNull();
  expect(parseRegrasSemana("{x")).toBeNull();
  expect(parseRegrasSemana(JSON.stringify(REGRAS_PADRAO))).toEqual(REGRAS_PADRAO);
});

const pesos: Pesos = new Map([["EUA", 0.3], ["AUSTRÁLIA", 0.02], ["BRASIL", 0.05]]);
const R = REGRAS_PADRAO.paises;
const m = (t: string, nac: string[] = [], foco: string | null = null) =>
  ({ tituloNorm: t, nacionalidades: new Set(nac), foco });

test("regra C: Σ pb ≥ 1 → fatias somam 1; Σ pb < 1 → sobra o resto (inclui música sem nacionalidade nem foco)", () => {
  const cheio: Pesos = new Map([["EUA", 0.7], ["BRASIL", 0.5]]);
  for (const x of [m("a"), m("b", ["BRASIL"]), m("c", ["EUA"], "BRASIL")]) {
    const soma = [...fatiasRegraC(cheio, x, "2026-11-11", R).values()].reduce((s, v) => s + v, 0);
    expect(soma).toBeCloseTo(1, 12);
    const somaParcial = [...fatiasRegraC(pesos, x, "2026-11-11", R).values()].reduce((s, v) => s + v, 0);
    expect(somaParcial).toBeGreaterThan(0);
    expect(somaParcial).toBeLessThan(1);
  }
});
test("regra C: determinística e sem depender da ordem dos pesos", () => {
  const inv: Pesos = new Map([...pesos].reverse());
  expect(fatiasRegraC(pesos, m("b", ["AUSTRÁLIA"]), "2026-11-11", R))
    .toEqual(fatiasRegraC(inv, m("b", ["AUSTRÁLIA"]), "2026-11-11", R));
});
test("regra C: nativo ganha mais que estrangeiro no seu país; bônus ≤ teto", () => {
  const nat = fatiasRegraC(pesos, m("x", ["AUSTRÁLIA"]), "2026-11-11", { ...R, variacao: 0 });
  const est = fatiasRegraC(pesos, m("x"), "2026-11-11", { ...R, variacao: 0 });
  expect(nat.get("AUSTRÁLIA")!).toBeGreaterThan(est.get("AUSTRÁLIA")! * 1.5);
  const eua = fatiasRegraC(pesos, m("y", ["EUA"]), "2026-11-11", { ...R, variacao: 0, nac_min: 4, nac_max: 4 });
  // pb 0.3 × 4 = 1.2 → limitado a 0.2
  expect(eua.get("EUA")!).toBeCloseTo((0.3 + 0.2) / (0.5 + 0.02 + 0.05 + 0.63), 9);
});
test("regra C: foco no país da nacionalidade não soma; com faixas padrão, foco < nacionalidade", () => {
  const z = { ...R, variacao: 0 };
  expect(fatiasRegraC(pesos, m("x", ["BRASIL"], "BRASIL"), "d", z)).toEqual(fatiasRegraC(pesos, m("x", ["BRASIL"]), "d", z));
  const foco = fatiasRegraC(pesos, m("x", [], "BRASIL"), "d", z).get("BRASIL")!;
  const nac = fatiasRegraC(pesos, m("x", ["BRASIL"]), "d", z).get("BRASIL")!;
  const nada = fatiasRegraC(pesos, m("x"), "d", z).get("BRASIL")!;
  expect(foco).toBeGreaterThan(nada);
  expect(foco).toBeLessThanOrEqual(nac); // foco_max 1.5 ≤ nac_min 1.5
});
test("hit mundial 4× maior vence nativo num país de 2%; nativo perto vence", () => {
  const z = { ...R, variacao: 0, nac_min: 3, nac_max: 3 };
  const mk = (t: string, valor: number, nac: string[]): EntradaMusica =>
    ({ tituloNorm: t, titulo: t, artistaPrincipal: t, artistas: [t], valor, nacionalidades: new Set(nac), foco: null });
  const r1 = rankingsPorPais([mk("hit", 1_000_000, ["EUA"]), mk("aus", 200_000, ["AUSTRÁLIA"])], [], pesos, "d", null, z);
  expect(r1.get("AUSTRÁLIA")![0].tituloNorm).toBe("hit");
  const r2 = rankingsPorPais([mk("hit", 1_000_000, ["EUA"]), mk("aus", 500_000, ["AUSTRÁLIA"])], [], pesos, "d", null, z);
  expect(r2.get("AUSTRÁLIA")![0].tituloNorm).toBe("aus");
});
test("rankingsPorPais: sem semana anterior → tudo NEW", () => {
  const e: EntradaMusica = { tituloNorm: "a", titulo: "A", artistaPrincipal: "x", artistas: ["x"], valor: 10, nacionalidades: new Set(), foco: null };
  expect(rankingsPorPais([e], [], pesos, "d", null, R).get("BRASIL")![0].st).toBe("NEW");
});

test("REGRAS_PADRAO: valores sentinela, sem vendas e regrasDeConfig sem referências compartilhadas", () => {
  const ex = REGRAS_PADRAO.paradas.find((p) => p.id === "EXCL_US")!;
  expect(ex.ordem).toBe(0);
  expect(ex.top).toBe(100);
  const de = REGRAS_PADRAO.paradas.find((p) => p.id === "DE")!;
  expect(de.tipo).toBe("receita");
  expect(de.tp).toBe(0.008);
  for (const p of REGRAS_PADRAO.paradas) expect("a" in p).toBe(false);
  expect(regrasDeConfig(new Map([["paradas", "[]"]])).paradas.length).toBe(12);
  expect(regrasDeConfig(new Map([["paradas", "[1]"]])).paradas.length).toBe(12);
  const orig = REGRAS_PADRAO.paradas[0].nome;
  const r = regrasDeConfig(new Map());
  r.paradas[0].nome = "MUTADO";
  expect(REGRAS_PADRAO.paradas[0].nome).toBe(orig);
  const eua = r.paradas.find((p) => p.id === "EUA")!;
  const ca = r.paradas.find((p) => p.id === "CA")!;
  expect(eua.recorrencia).not.toBe(ca.recorrencia);
  expect(REGRAS_PADRAO.paradas.find((p) => p.id === "EUA")!.recorrencia).not.toBe(
    REGRAS_PADRAO.paradas.find((p) => p.id === "CA")!.recorrencia);
});
