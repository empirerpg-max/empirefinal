import { test, expect } from "bun:test";
// Uso: bun test scripts/tv-chat-gestos.test.ts
const G = await import("../src/hooks/useArrastarParaResponder.ts");
const base = { dx: 0, dy: 0, ms: 100, moveuVertical: false };

test("60 px para a esquerda responde", () => {
  expect(G.decidirGesto({ ...base, dx: -60, dy: 4 })).toBe("responder");
});
test("30 px não faz nada", () => {
  expect(G.decidirGesto({ ...base, dx: -30 })).toBe("nada");
});
test("movimento vertical domina: nada, nem toque longo", () => {
  expect(G.decidirGesto({ ...base, dx: -60, dy: 90, moveuVertical: true })).toBe("nada");
  expect(G.decidirGesto({ ...base, dx: -20, dy: 60 })).toBe("nada");
  expect(G.decidirGesto({ dx: 0, dy: 40, ms: 800, moveuVertical: true })).toBe("nada");
});
test("segurar 500 ms parado abre o menu", () => {
  expect(G.decidirGesto({ dx: 2, dy: -3, ms: 500, moveuVertical: false })).toBe("menu");
  expect(G.decidirGesto({ dx: 2, dy: -3, ms: 499, moveuVertical: false })).toBe("nada");
});
test("segurar mas mexer mais de 10 px não abre o menu", () => {
  expect(G.decidirGesto({ dx: -25, dy: 0, ms: 600, moveuVertical: false })).toBe("nada");
});
test("arrastar para a direita não faz nada", () => {
  expect(G.decidirGesto({ ...base, dx: 80 })).toBe("nada");
  expect(G.decidirGesto({ dx: 80, dy: 0, ms: 900, moveuVertical: false })).toBe("nada");
});
test("deslocamentoVisivel limita em [-70, 0]", () => {
  expect(G.deslocamentoVisivel(-30)).toBe(-30);
  expect(G.deslocamentoVisivel(-200)).toBe(-70);
  expect(G.deslocamentoVisivel(40)).toBe(0);
  expect(G.deslocamentoVisivel(0)).toBe(0);
});
test("menu abre uma vez por gesto: timer e contextmenu nativo, em qualquer ordem", () => {
  const parado = { dx: 1, dy: 1, ms: 500, moveuVertical: false };
  // timer primeiro, depois o contextmenu do Android
  expect(G.deveAbrirMenu("timer", { jaAbriuNesteGesto: false, gesto: parado })).toBe(true);
  expect(G.deveAbrirMenu("contextmenu", { jaAbriuNesteGesto: true })).toBe(false);
  // contextmenu primeiro (~400 ms), depois o timer
  expect(G.deveAbrirMenu("contextmenu", { jaAbriuNesteGesto: false })).toBe(true);
  expect(G.deveAbrirMenu("timer", { jaAbriuNesteGesto: true, gesto: parado })).toBe(false);
  // timer sozinho só abre com o dedo parado
  expect(G.deveAbrirMenu("timer", { jaAbriuNesteGesto: false, gesto: { ...parado, dx: -30 } })).toBe(false);
  expect(G.deveAbrirMenu("timer", { jaAbriuNesteGesto: false, gesto: null })).toBe(false);
});
