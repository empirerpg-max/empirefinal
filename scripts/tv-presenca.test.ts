import { test, expect } from "bun:test";
// Cálculo puro da presença por minuto (Empire TV).
// Uso: bun test scripts/tv-presenca.test.ts
const P = await import("../backend/src/services/tvPresenca.ts");
const M = (h: number, m: number) => Date.UTC(2026, 10, 26, h, m) ;
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
