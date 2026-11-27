import { test, expect } from "bun:test";
// Regras puras de rolagem do chat (Empire TV).
// Uso: bun test scripts/tv-chat-rolagem.test.ts
const R = await import("../src/lib/tvChatRolagem.ts");

test("estaNoFim: exatamente 80 px de folga conta como no fim", () => {
  const el = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 };
  // scrollHeight - scrollTop - clientHeight = 500 -> longe do fim
  expect(R.estaNoFim(el)).toBe(false);
  // 80 px de distância exatamente -> true
  expect(R.estaNoFim({ scrollTop: 420, scrollHeight: 1000, clientHeight: 500 })).toBe(true);
  // 81 px -> false
  expect(R.estaNoFim({ scrollTop: 419, scrollHeight: 1000, clientHeight: 500 })).toBe(false);
  // no fim absoluto -> true
  expect(R.estaNoFim({ scrollTop: 500, scrollHeight: 1000, clientHeight: 500 })).toBe(true);
});

test("estaNoFim: folgaPx customizada é respeitada", () => {
  const el = { scrollTop: 400, scrollHeight: 1000, clientHeight: 500 }; // distância 100
  expect(R.estaNoFim(el)).toBe(false);
  expect(R.estaNoFim(el, 100)).toBe(true);
  expect(R.estaNoFim(el, 99)).toBe(false);
});

test("pertoDoTopo: exatamente 120 px conta como perto do topo", () => {
  expect(R.pertoDoTopo(120)).toBe(true);
  expect(R.pertoDoTopo(121)).toBe(false);
  expect(R.pertoDoTopo(0)).toBe(true);
});

test("pertoDoTopo: limitePx customizado é respeitado", () => {
  expect(R.pertoDoTopo(50, 50)).toBe(true);
  expect(R.pertoDoTopo(51, 50)).toBe(false);
});

test("decidirAoChegar: estava no fim -> rola e zera", () => {
  expect(R.decidirAoChegar(true, false, 5)).toEqual({ rolar: true, novas: 0 });
});

test("decidirAoChegar: mensagem minha -> rola e zera", () => {
  expect(R.decidirAoChegar(false, true, 3)).toEqual({ rolar: true, novas: 0 });
});

test("decidirAoChegar: fora do fim e não minha -> não rola e soma 1", () => {
  expect(R.decidirAoChegar(false, false, 0)).toEqual({ rolar: false, novas: 1 });
  expect(R.decidirAoChegar(false, false, 4)).toEqual({ rolar: false, novas: 5 });
});
