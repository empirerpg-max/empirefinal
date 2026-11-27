import { describe, expect, test } from "bun:test";
import { FAIXA_SETA, bordas, destinoDaPagina, scrollParaMostrar } from "../src/lib/scrollRow";

describe("FAIXA_SETA", () => {
  test("é 56 px", () => {
    expect(FAIXA_SETA).toBe(56);
  });
});

describe("bordas", () => {
  test("no início: só a direita tem conteúdo", () => {
    expect(bordas(0, 300, 1000)).toEqual({ esquerda: false, direita: true });
  });
  test("no meio: os dois lados", () => {
    expect(bordas(200, 300, 1000)).toEqual({ esquerda: true, direita: true });
  });
  test("no fim: só a esquerda", () => {
    expect(bordas(700, 300, 1000)).toEqual({ esquerda: true, direita: false });
  });
  test("conteúdo que cabe inteiro: nenhuma seta", () => {
    expect(bordas(0, 300, 300)).toEqual({ esquerda: false, direita: false });
    expect(bordas(0, 300, 200)).toEqual({ esquerda: false, direita: false });
  });
  test("margem de 4 px como useDragScroll", () => {
    expect(bordas(4, 300, 1000).esquerda).toBe(false);
    expect(bordas(5, 300, 1000).esquerda).toBe(true);
    expect(bordas(696, 300, 1000).direita).toBe(false);
    expect(bordas(695, 300, 1000).direita).toBe(true);
  });
});

describe("destinoDaPagina", () => {
  // Itens de 100 px a cada 100 px: inícios 0, 100, ..., 900.
  const inicios = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900];

  test("avança largura − 2·faixa e encosta no começo de um item", () => {
    // clientWidth 400 → passo 288 → alvo 288 → maior início ≤ 288 = 200
    expect(destinoDaPagina(1, 0, 400, inicios)).toBe(200);
    // de 200: alvo 488 → 400
    expect(destinoDaPagina(1, 200, 400, inicios)).toBe(400);
  });

  test("não passa do último início", () => {
    expect(destinoDaPagina(1, 850, 400, inicios)).toBe(900);
    expect(destinoDaPagina(1, 900, 400, inicios)).toBe(900);
  });

  test("volta: o menor início ≥ alvo", () => {
    // de 400: alvo 112 → menor início ≥ 112 = 200
    expect(destinoDaPagina(-1, 400, 400, inicios)).toBe(200);
    // de 200: alvo −88 → 0
    expect(destinoDaPagina(-1, 200, 400, inicios)).toBe(0);
  });

  test("não passa do começo", () => {
    expect(destinoDaPagina(-1, 0, 400, inicios)).toBe(0);
    expect(destinoDaPagina(-1, 50, 400, inicios)).toBe(0);
  });

  test("sempre anda pelo menos um item, mesmo com item mais largo que a página", () => {
    const largos = [0, 500, 1000];
    // passo 288 não alcança o próximo início (500): vai até ele mesmo assim
    expect(destinoDaPagina(1, 0, 400, largos)).toBe(500);
    // para trás de 1000: alvo 712, nenhum início em [712, 1000) → o anterior, 500
    expect(destinoDaPagina(-1, 1000, 400, largos)).toBe(500);
  });

  test("faixa configurável", () => {
    // faixa 0 → passo 400 → alvo 400
    expect(destinoDaPagina(1, 0, 400, inicios, 0)).toBe(400);
  });

  test("sem itens: 0", () => {
    expect(destinoDaPagina(1, 0, 400, [])).toBe(0);
  });
});

describe("scrollParaMostrar", () => {
  // Área útil entre as faixas: [scrollLeft + 56, scrollLeft + clientWidth − 56]
  test("item já inteiro entre as faixas → null", () => {
    expect(scrollParaMostrar(100, 200, 0, 400)).toBeNull();
    expect(scrollParaMostrar(56, 344, 0, 400)).toBeNull();
  });

  test("item cortado à direita → rola até ele terminar antes da faixa", () => {
    // fim 500, quer fim ≤ sl + 400 − 56 → sl = 156
    expect(scrollParaMostrar(400, 500, 0, 400)).toBe(156);
    // parcialmente sob a faixa da direita
    expect(scrollParaMostrar(300, 380, 0, 400)).toBe(36);
  });

  test("item cortado à esquerda → rola até ele começar depois da faixa", () => {
    // início 300, sl 400 → sl = 300 − 56 = 244
    expect(scrollParaMostrar(300, 380, 400, 400)).toBe(244);
    // sob a faixa da esquerda
    expect(scrollParaMostrar(420, 500, 400, 400)).toBe(364);
  });

  test("primeiro item no começo da fileira (sem faixa à esquerda) → null", () => {
    expect(scrollParaMostrar(0, 80, 0, 400)).toBeNull();
    expect(scrollParaMostrar(8, 80, 0, 400)).toBeNull();
  });

  test("nunca devolve valor negativo", () => {
    expect(scrollParaMostrar(20, 80, 100, 400)).toBe(0);
  });

  test("item maior que a área útil → mostra o começo dele", () => {
    expect(scrollParaMostrar(500, 1000, 0, 400)).toBe(444);
  });
});
