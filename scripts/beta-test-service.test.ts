import { test, expect, beforeAll } from "bun:test";
// Serviço do Beta test no D1. Uso: bun test scripts/beta-test-service.test.ts
import { instalarFakeD1 } from "./helpers/fakeD1";
const B = await import("../backend/src/services/betaService.ts");
const sqlite = instalarFakeD1();
const db = (globalThis as any).__CATALOGO_DB__;
const T = Date.UTC(2026, 10, 27, 15, 0);
const novo = (extra: any = {}) => ({ jogadorId: "j1", usuario: "Ana", versao: "beta" as const, tela: "Charts", rota: "/charts", texto: "oi", motivo: null, printUrl: "", tecnico: "", ...extra });

beforeAll(async () => { await B.garantirTabelasBeta(db); });

test("gravarEscolha duas vezes mantém 1 linha", async () => {
  await B.gravarEscolha(db, "j1", "beta", T);
  await B.gravarEscolha(db, "j1", "anterior", T + 1);
  expect(sqlite.query("SELECT * FROM beta_jogador").all().length).toBe(1);
  expect(await B.lerEscolha(db, "j1")).toEqual({ versao: "anterior", boasVindasEm: null });
});

test("marcarBoasVindas preserva a versão", async () => {
  await B.marcarBoasVindas(db, "j1", T + 5);
  expect(await B.lerEscolha(db, "j1")).toEqual({ versao: "anterior", boasVindasEm: T + 5 });
  await B.marcarBoasVindas(db, "j9", T);
  expect(await B.lerEscolha(db, "j9")).toEqual({ versao: null, boasVindasEm: T });
});

test("lerEscolha de quem nunca escolheu", async () => {
  expect(await B.lerEscolha(db, "ninguem")).toEqual({ versao: null, boasVindasEm: null });
});

test("limite de 10 reportes por dia UTC", async () => {
  sqlite.run("DELETE FROM beta_reporte");
  for (let i = 0; i < 10; i++) expect(await B.criarReporte(db, novo(), T + i)).toHaveProperty("id");
  expect(await B.criarReporte(db, novo(), T + 11)).toEqual({ erro: "limite" });
  expect(await B.criarReporte(db, novo({ jogadorId: "j2" }), T + 11)).toHaveProperty("id");
  // no dia seguinte libera
  expect(await B.criarReporte(db, novo(), Date.UTC(2026, 10, 28, 0, 0))).toHaveProperty("id");
});

test("corta texto em 2000 e tecnico em 4000", async () => {
  sqlite.run("DELETE FROM beta_reporte");
  const r: any = await B.criarReporte(db, novo({ texto: "x".repeat(5000), tecnico: "y".repeat(9000) }), T);
  const l: any = sqlite.query("SELECT * FROM beta_reporte WHERE id = ?").get(r.id);
  expect(l.texto.length).toBe(2000);
  expect(l.tecnico.length).toBe(4000);
  expect(r.id).toMatch(/^R\d+\d{3}$/);
});

test("listarReportes ordena por criado_em decrescente, filtra e pagina", async () => {
  sqlite.run("DELETE FROM beta_reporte");
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) ids.push(((await B.criarReporte(db, novo({ texto: "t" + i }), T + i * 1000)) as any).id);
  const l = await B.listarReportes(db, { status: "novo", limite: 20 });
  expect(l.map((r) => r.texto)).toEqual(["t2", "t1", "t0"]);
  expect(l[0].criadoEm).toBe(T + 2000);
  expect(l[0].motivo).toBeNull();
  expect((await B.listarReportes(db, { limite: 20, antesDe: T + 2000 })).map((r) => r.texto)).toEqual(["t1", "t0"]);
  expect(await B.mudarStatusReporte(db, ids[2], "visto")).toBe(true);
  expect((await B.listarReportes(db, { status: "novo", limite: 20 })).length).toBe(2);
});

test("mudarStatusReporte inválido ou inexistente → false", async () => {
  expect(await B.mudarStatusReporte(db, "x", "zzz" as any)).toBe(false);
  expect(await B.mudarStatusReporte(db, "naoexiste", "visto")).toBe(false);
});
