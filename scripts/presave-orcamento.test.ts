import { test, expect } from "bun:test";
// Orçamento de chamadas externas por execução (orcamentoChamadas.ts).
// Uso: bun test scripts/presave-orcamento.test.ts
const O = await import("../backend/src/services/orcamentoChamadas.ts");

test("fora de um orçamento, chamadasRestantes() é Infinity", () => {
  expect(O.chamadasRestantes()).toBe(Infinity);
});

test("conta as chamadas registradas dentro do orçamento", async () => {
  const resto = await O.comOrcamento(5, async () => {
    O.registrarChamadaExterna();
    O.registrarChamadaExterna();
    O.registrarChamadaExterna();
    return O.chamadasRestantes();
  });
  expect(resto).toBe(2);
  expect(O.chamadasRestantes()).toBe(Infinity);
});

test("nunca fica negativo e aceita contar várias de uma vez", async () => {
  expect(await O.comOrcamento(1, async () => { O.registrarChamadaExterna(3); return O.chamadasRestantes(); })).toBe(0);
});
