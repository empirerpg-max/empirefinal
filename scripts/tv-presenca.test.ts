import { test, expect } from "bun:test";
// Cálculo puro da presença por minuto (Empire TV).
// Uso: bun test scripts/tv-presenca.test.ts
const P = await import("../backend/src/services/tvPresenca.ts");
const M = (h: number, m: number) => Date.UTC(2026, 10, 26, h, m);
test("idades viram minutos pelo relógio do servidor", () => {
  expect(P.minutosDeIdades(M(20, 10), [0, 60_000, 61_000])).toEqual([M(20,8)/60000, M(20,9)/60000, M(20,10)/60000]);
  expect(P.minutosDeIdades(M(20, 10), [-5, 7 * 3600_000])).toEqual([]);
});
test("buraco de até 2 min conta; de 3 min não", () => {
  const ini = M(20, 0), fim = M(20, 10);
  const mins = [0,1,2,5,9].map((k) => M(20, k) / 60000); // buraco 3-4 (2 min) e 6-8 (3 min)
  expect(P.calcularPresenca(mins, ini, fim)).toMatchObject({ minutosPresentes: 7, duracaoMin: 10, pct: 70 });
});
test("minutos fora da janela não contam e pct limita a 100", () => {
  const ini = M(20, 0), fim = M(20, 2);
  const mins = [-1,0,1,2,3].map((k) => M(20, k) / 60000);
  expect(P.calcularPresenca(mins, ini, fim)).toMatchObject({ minutosPresentes: 2, pct: 100 });
});
test("codificar/ler ida e volta e união", () => {
  expect(P.lerMinutos(P.codificarMinutos([3, 1, 2, 2]))).toEqual([1, 2, 3]);
  expect(P.lerMinutos("x,4,,5")).toEqual([4, 5]);
  expect(P.unirMinutos([1, 3], [2, 3])).toEqual([1, 2, 3]);
});
test("transmissão começa no meio do minuto: presença total = 100%", () => {
  const ini = M(20, 0) + 30_000, fim = M(20, 2) + 30_000;
  const mins = [0, 1, 2].map((k) => M(20, k) / 60000);
  expect(P.calcularPresenca(mins, ini, fim)).toMatchObject({ minutosPresentes: 3, duracaoMin: 3, pct: 100 });
});
test("pct nunca passa de 100 com minutos extras", () => {
  const ini = M(20, 0), fim = M(20, 3);
  const mins = [-2, -1, 0, 1, 2, 3, 4].map((k) => M(20, k) / 60000);
  const r = P.calcularPresenca(mins, ini, fim);
  expect(r.pct).toBe(100);
  expect(r.minutosPresentes).toBeLessThanOrEqual(r.duracaoMin);
});
test("idade de exatamente 6 h é mantida; 6 h + 1 ms cai", () => {
  const agora = M(20, 10);
  expect(P.minutosDeIdades(agora, [6 * 3600_000])).toEqual([Math.floor((agora - 6 * 3600_000) / 60000)]);
  expect(P.minutosDeIdades(agora, [6 * 3600_000 + 1])).toEqual([]);
});
test("lerMinutos(null) devolve lista vazia", () => {
  expect(P.lerMinutos(null)).toEqual([]);
});

// ---- D1 (tv_presenca) ----
import { instalarFakeD1 } from "./helpers/fakeD1";
const sqlite = instalarFakeD1();
const db = (globalThis as any).__CATALOGO_DB__;
const linha = (prog: string, jog: string) =>
  sqlite.query("SELECT * FROM tv_presenca WHERE programa_id = ? AND jogador_id = ?").get(prog, jog) as any;

test("gravar une minutos, só escreve quando há minuto novo", async () => {
  await P.garantirTabelaPresenca(db);
  await P.garantirTabelaPresenca(db); // idempotente
  const p = { programaId: "row_5", jogadorId: "j1", nome: "Ana", minutos: [1, 2] };
  expect(await P.gravarMinutosPresenca(db, p, 1000)).toBe("gravado");
  expect(await P.gravarMinutosPresenca(db, { ...p, minutos: [2, 3] }, 2000)).toBe("gravado");
  expect(linha("row_5", "j1")).toMatchObject({ minutos: "1,2,3", atualizado_em: 2000, nome: "Ana" });
  expect(await P.gravarMinutosPresenca(db, { ...p, minutos: [3] }, 3000)).toBe("sem-novidade");
  expect(linha("row_5", "j1").atualizado_em).toBe(2000);
});

test("lerPresencaGrupo une a pessoa em todos os segmentos", async () => {
  await P.garantirTabelaPresenca(db);
  await P.gravarMinutosPresenca(db, { programaId: "row_5", jogadorId: "j2", nome: "Bia", minutos: [10, 11] }, 1);
  await P.gravarMinutosPresenca(db, { programaId: "row_6", jogadorId: "j2", nome: "Bia", minutos: [11, 12] }, 1);
  const m = await P.lerPresencaGrupo(db, ["row_5", "row_6"]);
  expect(m.get("j2")).toEqual({ nome: "Bia", minutos: [10, 11, 12] });
  expect(m.get("j1")?.minutos).toEqual([1, 2, 3]);
  expect((await P.lerPresencaGrupo(db, [])).size).toBe(0);
});

test("lerPresencaGrupo com jogador lê só a linha dele (círculo da sala, sem varrer a sala toda)", async () => {
  await P.garantirTabelaPresenca(db);
  await P.gravarMinutosPresenca(db, { programaId: "row_7", jogadorId: "j3", nome: "Caio", minutos: [20] }, 1);
  await P.gravarMinutosPresenca(db, { programaId: "row_8", jogadorId: "j3", nome: "Caio", minutos: [21] }, 1);
  await P.gravarMinutosPresenca(db, { programaId: "row_7", jogadorId: "j4", nome: "Duda", minutos: [20] }, 1);
  const m = await P.lerPresencaGrupo(db, ["row_7", "row_8"], "j3");
  expect([...m.keys()]).toEqual(["j3"]);
  expect(m.get("j3")).toEqual({ nome: "Caio", minutos: [20, 21] });
  expect((await P.lerPresencaGrupo(db, ["row_7"], "ninguem")).size).toBe(0);
});

test("apagarPresencaAntiga remove só as mais velhas", async () => {
  await P.garantirTabelaPresenca(db);
  await P.gravarMinutosPresenca(db, { programaId: "row_9", jogadorId: "velho", nome: "V", minutos: [1] }, 100);
  await P.gravarMinutosPresenca(db, { programaId: "row_9", jogadorId: "novo", nome: "N", minutos: [1] }, 9000);
  const n = await P.apagarPresencaAntiga(db, 5000);
  expect(n).toBeGreaterThanOrEqual(1);
  expect(linha("row_9", "velho")).toBeNull();
  expect(linha("row_9", "novo")).not.toBeNull();
});
