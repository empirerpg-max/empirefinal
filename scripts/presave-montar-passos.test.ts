import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
// Montagem da lista de passos do lançamento (função pura).
// Uso: bun test scripts/presave-montar-passos.test.ts
const { montarPassosLancamento } = await import("../backend/src/controllers/presaveLancamento/montarPassos.ts");
const jessica = () => JSON.parse(readFileSync(new URL("./fixtures/presave-jessica.json", import.meta.url), "utf8"));

test("jessica gera 44 passos, de album a fechar", () => {
  const ps = montarPassosLancamento(jessica(), { reconciliacao: false, bonusCongelado: 914002 });
  expect(ps.length).toBe(44);
  expect(ps[0].passo).toBe("album");
  expect(ps[ps.length - 1].passo).toBe("fechar");
  expect(ps.map((p) => p.passo).slice(1, 6)).toEqual([
    "faixa:1:musicas", "faixa:1:charts", "faixa:1:codigo", "faixa:1:registro", "faixa:2:musicas",
  ]);
  expect(ps.filter((p) => p.passo.startsWith("vinculo:")).map((p) => p.passo)).toEqual(["vinculo:3", "vinculo:4", "vinculo:9"]);
  expect(ps.slice(-4).map((p) => p.passo)).toEqual(["tracklist", "extra", "bonus", "fechar"]);
  expect(ps.every((p) => !p.procurarAntes && (p.estado ?? "pendente") === "pendente")).toBe(true);
});

test("ordem é estritamente crescente", () => {
  const ps = montarPassosLancamento(jessica(), { reconciliacao: false, bonusCongelado: 1 });
  for (let i = 1; i < ps.length; i++) expect(ps[i].ordem).toBeGreaterThan(ps[i - 1].ordem);
});

test("bonus leva o valor congelado", () => {
  const ps = montarPassosLancamento(jessica(), { reconciliacao: false, bonusCongelado: 914002 });
  expect(ps.find((p) => p.passo === "bonus")!.resultado).toEqual({ valor: 914002 });
});

test("modo contagem não tem passo bonus", () => {
  const c = { ...jessica(), modo: "contagem" };
  const ps = montarPassosLancamento(c, { reconciliacao: false, bonusCongelado: null });
  expect(ps.some((p) => p.passo === "bonus")).toBe(false);
});

test("sem extra ativo não tem passo extra", () => {
  const c = { ...jessica(), extraMaterialJson: JSON.stringify({ shopAtivo: false, infoAtivo: false, visualAtivo: false }) };
  expect(montarPassosLancamento(c, { reconciliacao: false, bonusCongelado: 1 }).some((p) => p.passo === "extra")).toBe(false);
  const c2 = { ...jessica(), extraMaterialJson: "" };
  expect(montarPassosLancamento(c2, { reconciliacao: false, bonusCongelado: 1 }).some((p) => p.passo === "extra")).toBe(false);
});

test("reconciliacao marca procurarAntes em todos e album nasce feito", () => {
  const ps = montarPassosLancamento(jessica(), {
    reconciliacao: true,
    bonusCongelado: 914002,
    albumExistente: { linhaAlbuns: 109, codigoUnicoAlbum: "EMPALBM098", albumTopicId: "album_1795316437054_p0xpik" },
  });
  expect(ps.every((p) => p.procurarAntes)).toBe(true);
  expect(ps[0].estado).toBe("feito");
  expect(ps[0].resultado!.codigoUnicoAlbum).toBe("EMPALBM098");
  expect(ps.slice(1).every((p) => (p.estado ?? "pendente") === "pendente")).toBe(true);
});
