import { test, expect } from "bun:test";
// Paradas por país nos charts. Uso: bun test scripts/charts-paises.test.ts
import { sorteio01 } from "../backend/src/services/chartsD1/sorteio";
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
