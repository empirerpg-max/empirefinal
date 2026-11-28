import { describe, expect, test } from "bun:test";
import { TEMPOS_CACHE, opcoesConsulta } from "../src/lib/consultas";

describe("opcoesConsulta", () => {
  test("ao vivo: 30 s e refaz ao voltar para a aba", () => {
    expect(opcoesConsulta("aoVivo")).toEqual({ staleTime: 30_000, refetchOnWindowFocus: true });
  });
  test("catálogo: 5 min e não refaz ao voltar para a aba", () => {
    expect(opcoesConsulta("catalogo")).toEqual({ staleTime: 300_000, refetchOnWindowFocus: false });
  });
  test("social: 30 s e refaz ao voltar para a aba", () => {
    expect(opcoesConsulta("social")).toEqual({ staleTime: 30_000, refetchOnWindowFocus: true });
  });
  test("TEMPOS_CACHE com os valores da spec 5.11", () => {
    expect(TEMPOS_CACHE).toEqual({ aoVivo: 30_000, catalogo: 300_000, social: 30_000 });
  });
});
