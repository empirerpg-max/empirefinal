import { test, expect } from "bun:test";
// Despacho por cron: o pre-save roda no cron próprio, separado dos outros jobs.
// Uso: bun test scripts/cron-jobs.test.ts
const C = await import("../src/cronJobs.ts");

test("ehCronPresave reconhece só o cron do pre-save", () => {
  expect(C.CRON_PRESAVE).toBe("2-59/10 * * * *");
  expect(C.ehCronPresave("2-59/10 * * * *")).toBe(true);
  expect(C.ehCronPresave("*/10 * * * *")).toBe(false);
  expect(C.ehCronPresave(undefined)).toBe(false);
});

test("ehCicloDaHora: só o primeiro ciclo de 10 min de cada hora", () => {
  expect(C.ehCicloDaHora(new Date("2026-11-26T13:00:30Z"))).toBe(true);
  expect(C.ehCicloDaHora(new Date("2026-11-26T13:09:59Z"))).toBe(true);
  expect(C.ehCicloDaHora(new Date("2026-11-26T13:10:00Z"))).toBe(false);
  expect(C.ehCicloDaHora(new Date("2026-11-26T13:50:00Z"))).toBe(false);
});
