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
