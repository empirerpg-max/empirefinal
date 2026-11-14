import { test, expect } from "bun:test";
// Charts semanais no D1. Uso: bun test scripts/charts-d1.test.ts
import { CHARTS, type LinhaDados } from "../backend/src/services/chartsD1/tipos";
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
