import { test, expect } from "bun:test";
// Regras puras da versão do Beta test. Uso: bun test scripts/beta-test-regras.test.ts
import { estadoBeta, lerConfigBeta, CONFIG_BETA_PADRAO, MOTIVOS_VOLTA, ROTULO_MOTIVO } from "../src/lib/beta/regras";

const linhas: [any, boolean, boolean, any, boolean, boolean, string][] = [
  ["desligado", false, false, null, false, false, "anterior"],
  ["desligado", false, true, "beta", false, false, "anterior"],
  ["desligado", true, false, null, true, true, "anterior"],
  ["desligado", true, false, "beta", true, true, "beta"],
  ["convidados", false, false, "beta", false, false, "anterior"],
  ["convidados", false, true, null, true, true, "beta"],
  ["convidados", false, true, "anterior", true, true, "anterior"],
  ["todos", false, false, null, true, true, "beta"],
  ["todos", false, false, "anterior", true, true, "anterior"],
  ["obrigatorio", false, false, "anterior", true, false, "beta"],
  ["obrigatorio", true, false, "anterior", true, false, "beta"],
].map(([modo, admin, convidado, escolha, v, b, ver]) => [modo, admin, convidado, escolha, v, b, ver] as any);

test.each(linhas)("estadoBeta modo=%s admin=%s convidado=%s escolha=%s", (modo, admin, convidado, escolha, podeVer, podeVoltar, versao) => {
  expect(estadoBeta({ modo, admin, convidado, escolha })).toEqual({ podeVer, podeVoltar, versao } as any);
});

test("lerConfigBeta aceita só config válida", () => {
  expect(lerConfigBeta(null)).toEqual(CONFIG_BETA_PADRAO);
  expect(lerConfigBeta("x")).toEqual(CONFIG_BETA_PADRAO);
  expect(lerConfigBeta('{"modo":"zzz"}')).toEqual(CONFIG_BETA_PADRAO);
  expect(lerConfigBeta('{"modo":"todos","convidados":["a","a",""," b ",3]}')).toEqual({ modo: "todos", convidados: ["a", "b"] });
  expect(lerConfigBeta('{"modo":"todos"}')).toEqual({ modo: "todos", convidados: [] });
  const muitos = JSON.stringify({ modo: "convidados", convidados: Array.from({ length: 600 }, (_, i) => "j" + i) });
  expect(lerConfigBeta(muitos).convidados.length).toBe(500);
});

test("motivos têm rótulo", () => {
  expect(MOTIVOS_VOLTA.map((m) => ROTULO_MOTIVO[m])).toEqual(["Não achei uma função", "Algo quebrou", "Ficou lento", "Prefiro o visual antigo", "Outro"]);
});
