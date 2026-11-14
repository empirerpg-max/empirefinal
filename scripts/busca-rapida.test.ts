import { test, expect } from "bun:test";
// Busca rápida (docs/superpowers/plans/2026-11-14-busca-rapida.md). Uso: bun test scripts/busca-rapida.test.ts
import { buscarNoIndice, termosDeBusca, type ItemBusca } from "../backend/src/services/buscaRapida";

const it = (grupo: ItemBusca["grupo"], id: string, titulo: string, artistas: string, dataIso?: string): ItemBusca => ({
  grupo, id, titulo, subtitulo: artistas, link: `/x/${grupo}/${id}`, dataIso, termos: termosDeBusca(titulo, artistas),
});
const idx: ItemBusca[] = [
  it("musicas", "m1", "Abbiso di Follia", "Max Gorghan", "2026-10-20"),
  it("musicas", "m2", "Follia", "Max Gorghan", "2026-10-01"),
  it("musicas", "m3", "Follia (Remix)", "Max Gorghan", "2026-10-15"),
  it("musicas", "m4", "Alchimia", "Max Gorghan, Samantha Cooper", "2026-10-21"),
  it("musicas", "m5", "Follia Sem Data", "Max Gorghan"),
  it("videos", "v1", "Max Gorghan - Follia", "Max Gorghan", "2026-11-01"),
  it("albuns", "a1", "Max Gorghan - FOLLIA", "Max Gorghan", "2026-10-21"),
  it("artistas", "Samantha Cooper", "Samantha Cooper", ""),
];
const ids = (r: ReturnType<typeof buscarNoIndice>) => r.grupos.flatMap((g) => g.itens.map((i) => i.id));

test("acento e maiúscula", () => {
  expect(ids(buscarNoIndice(idx, "  Fóllia "))).toEqual(ids(buscarNoIndice(idx, "follia")));
  expect(ids(buscarNoIndice(idx, "follia")).length).toBeGreaterThan(0);
});
test("termo curto", () => {
  expect(buscarNoIndice(idx, "a").grupos).toEqual([]);
  expect(buscarNoIndice(idx, "-").grupos).toEqual([]);
  expect(buscarNoIndice(idx, "  f ").grupos).toEqual([]);
});
test("começa-com antes de contém; empate por data desc; sem data por último", () => {
  const m = buscarNoIndice(idx, "follia").grupos.find((g) => g.grupo === "musicas")!;
  expect(m.itens.map((i) => i.id)).toEqual(["m3", "m2", "m5", "m1"]);
});
test("participação", () => {
  expect(ids(buscarNoIndice(idx, "samantha"))).toEqual(["m4", "Samantha Cooper"]);
});
test("versões: cada uma com seu link", () => {
  const v = [it("musicas", "f1", "Fuori Rotta", "Max"), it("musicas", "f2", "Fuori Rotta (Acústico)", "Max"), it("musicas", "f3", "Fuori Rotta (Enaldi Remix)", "Max")];
  const r = buscarNoIndice(v, "fuori rotta").grupos[0].itens;
  expect(r.length).toBe(3);
  expect(new Set(r.map((i) => i.link)).size).toBe(3);
});
test("limite e total", () => {
  const sete = Array.from({ length: 7 }, (_, i) => it("musicas", `s${i}`, `Som ${i}`, "X"));
  const g = buscarNoIndice([...sete, it("videos", "vs", "Som video", "X")], "som").grupos;
  expect(g[0].itens.length).toBe(5); expect(g[0].total).toBe(7);
  const so = buscarNoIndice([...sete, it("videos", "vs", "Som video", "X")], "som", { grupo: "musicas", limitePorGrupo: 50 }).grupos;
  expect(so.length).toBe(1); expect(so[0].itens.length).toBe(7);
});
test("ordem dos grupos; grupo vazio some; sem 'termos' na resposta", () => {
  const r = buscarNoIndice(idx, "follia");
  expect(r.grupos.map((g) => g.grupo)).toEqual(["musicas", "videos", "albuns"]);
  expect("termos" in r.grupos[0].itens[0]).toBe(false);
});
