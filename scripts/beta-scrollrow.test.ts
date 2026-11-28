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

  test("inícios além do máximo de rolagem (último item): devolve o início, o navegador limita", () => {
    // clientWidth 400, scrollWidth 1000 → máximo 600. Já no máximo, a seta
    // direita não aparece; se for chamada mesmo assim, devolve um início
    // à frente (≤ último) e o navegador segura em 600.
    const r = destinoDaPagina(1, 600, 400, inicios);
    expect(r).toBe(800);
    expect(r).toBeLessThanOrEqual(900);
    // e voltar a partir do máximo encosta num início normal
    expect(destinoDaPagina(-1, 600, 400, inicios)).toBe(400);
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

  describe("com inícios (pontos de snap)", () => {
    // Itens de 100 px a cada 100 px; inícios = offsetLeft − 56, mín. 0.
    const iniciosSnap = [0, 44, 144, 244, 344, 444, 544, 644, 744, 844];

    test("cortado à direita → para no menor início ≥ o ponto exato", () => {
      // item [400, 500], ponto exato 156; 144 < 156, então 244
      // (≤ 344, o início de snap do próprio item: continua inteiro).
      expect(scrollParaMostrar(400, 500, 0, 400, 56, iniciosSnap)).toBe(244);
      // item [300, 400], ponto exato 56 → 144
      expect(scrollParaMostrar(300, 400, 0, 400, 56, iniciosSnap)).toBe(144);
    });

    test("o item fica inteiro entre as faixas no destino", () => {
      const d = scrollParaMostrar(400, 500, 0, 400, 56, iniciosSnap)!;
      expect(400).toBeGreaterThanOrEqual(d + 56);
      expect(500).toBeLessThanOrEqual(d + 400 - 56);
    });

    test("ponto exato já é um início (±1 px) → usa ele", () => {
      // item [388, 488]: ponto exato 144 → 144
      expect(scrollParaMostrar(388, 488, 0, 400, 56, iniciosSnap)).toBe(144);
    });

    test("cortado à esquerda continua no início do próprio item", () => {
      expect(scrollParaMostrar(300, 400, 400, 400, 56, iniciosSnap)).toBe(244);
    });

    test("já inteiro → null, com ou sem inícios", () => {
      expect(scrollParaMostrar(100, 200, 0, 400, 56, iniciosSnap)).toBeNull();
    });

    test("sem início que sirva → ponto exato (comportamento antigo)", () => {
      expect(scrollParaMostrar(400, 500, 0, 400, 56, [0])).toBe(156);
      expect(scrollParaMostrar(400, 500, 0, 400, 56, [])).toBe(156);
    });
  });
});
