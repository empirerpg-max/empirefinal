import { test, expect } from "bun:test";
// Coletor de minutos da presença na Empire TV (lado do app). Puro: o tempo é injetado.
// Uso: bun test scripts/tv-presenca-cliente.test.ts
const { ColetorMinutos } = await import("../src/lib/tvPresencaCliente.ts");
const M = (h: number, m: number, s = 0) => Date.UTC(2026, 10, 26, h, m, s);

test("duas marcas no mesmo minuto viram uma só pendente", () => {
  const c = new ColetorMinutos();
  c.marcar(M(20, 0, 5));
  c.marcar(M(20, 0, 50));
  expect(c.pendentes(M(20, 0, 55)).length).toBe(1);
});

test("pendentes devolve as idades (agora - marca) em ms", () => {
  const c = new ColetorMinutos();
  c.marcar(M(20, 0, 10));
  c.marcar(M(20, 1, 10));
  c.marcar(M(20, 2, 10));
  expect(c.pendentes(M(20, 3, 0))).toEqual([170_000, 110_000, 50_000]);
});

test("sem confirmar, pendentes continua devolvendo as mesmas marcas (reenvio)", () => {
  const c = new ColetorMinutos();
  c.marcar(M(20, 0));
  c.marcar(M(20, 1));
  const agora = M(20, 2);
  expect(c.pendentes(agora)).toEqual([120_000, 60_000]);
  expect(c.pendentes(agora)).toEqual([120_000, 60_000]);
  c.marcar(M(20, 2, 30));
  expect(c.pendentes(M(20, 3))).toEqual([180_000, 120_000, 30_000]);
});

test("depois de confirmar, fica vazio; marcas novas voltam a acumular", () => {
  const c = new ColetorMinutos();
  c.marcar(M(20, 0));
  c.marcar(M(20, 1));
  c.pendentes(M(20, 2));
  c.confirmar();
  expect(c.pendentes(M(20, 2))).toEqual([]);
  c.marcar(M(20, 2, 1));
  expect(c.pendentes(M(20, 3))).toEqual([59_000]);
});

test("confirmar só limpa o que foi lido em pendentes (marca nova durante o envio fica)", () => {
  const c = new ColetorMinutos();
  c.marcar(M(20, 0));
  c.pendentes(M(20, 1)); // lido para envio
  c.marcar(M(20, 1, 5)); // chega durante o envio
  c.confirmar();
  expect(c.pendentes(M(20, 2))).toEqual([55_000]);
});

test("marcas com mais de 6 h caem e o lote nunca passa de 400", () => {
  const c = new ColetorMinutos();
  for (let k = 0; k < 500; k++) c.marcar(M(10, 0) + k * 60_000);
  const agora = M(10, 0) + 500 * 60_000;
  const p = c.pendentes(agora);
  expect(p.length).toBeLessThanOrEqual(400);
  expect(Math.max(...p)).toBeLessThanOrEqual(6 * 3600_000);
  expect(Math.min(...p)).toBe(60_000);
});
