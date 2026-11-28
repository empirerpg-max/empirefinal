import { describe, expect, test } from "bun:test";
import { ESTADO_SEGURO, mostrarFaixa, mostrarSelo, type EstadoBeta } from "../src/lib/beta/regras";

const base: EstadoBeta = { ...ESTADO_SEGURO };

describe("telas do Beta: decisões de exibição", () => {
  test("renderiza nada com modo desligado e jogador comum", () => {
    expect(mostrarFaixa(ESTADO_SEGURO)).toBe(false);
    expect(mostrarSelo(ESTADO_SEGURO)).toBe(false);
  });
  test("faixa aparece com podeVer e versão anterior", () => {
    expect(mostrarFaixa({ ...base, podeVer: true, versao: "anterior" })).toBe(true);
    expect(mostrarFaixa({ ...base, podeVer: false, versao: "anterior" })).toBe(false);
    expect(mostrarFaixa({ ...base, podeVer: true, versao: "beta" })).toBe(false);
  });
  test("selo aparece com versão beta", () => {
    expect(mostrarSelo({ ...base, podeVer: true, versao: "beta" })).toBe(true);
    expect(mostrarSelo({ ...base, versao: "anterior" })).toBe(false);
  });
  test("faixa e selo nunca aparecem juntos", () => {
    for (const versao of ["beta", "anterior"] as const)
      for (const podeVer of [true, false])
        expect(mostrarFaixa({ ...base, podeVer, versao }) && mostrarSelo({ ...base, podeVer, versao })).toBe(false);
  });
});
