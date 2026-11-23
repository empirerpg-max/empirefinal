import { test, expect } from "bun:test";
// Contador de chamadas externas por execução (orcamentoChamadas.ts).
// Uso: bun test scripts/presave-orcamento.test.ts
const O = await import("../backend/src/services/orcamentoChamadas.ts");

test("sem orçamento iniciado, chamadasRestantes() é Infinity", () => {
  O.encerrarOrcamento();
  expect(O.chamadasRestantes()).toBe(Infinity);
});

test("conta as chamadas registradas", () => {
  O.iniciarOrcamento(5);
  O.registrarChamadaExterna();
  O.registrarChamadaExterna();
  O.registrarChamadaExterna();
  expect(O.chamadasRestantes()).toBe(2);
  O.encerrarOrcamento();
  expect(O.chamadasRestantes()).toBe(Infinity);
});

test("nunca fica negativo", () => {
  O.iniciarOrcamento(1);
  O.registrarChamadaExterna();
  O.registrarChamadaExterna();
  O.registrarChamadaExterna();
  expect(O.chamadasRestantes()).toBe(0);
  O.encerrarOrcamento();
});
