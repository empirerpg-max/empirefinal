import { describe, expect, test } from "bun:test";
import {
  abrirCamada,
  criarMarca,
  deveFecharNoPopstate,
  deveVoltarAoFecharPelaUi,
  entradaEhDaCamada,
  type HistoricoLike,
} from "../src/lib/historicoOverlay";

// Histórico falso em memória: pilha + índice; back() move o índice e avisa os ouvintes.
function criarHistoricoFalso(estadoInicial: unknown = null) {
  const pilha: unknown[] = [estadoInicial];
  let indice = 0;
  const ouvintes: Array<() => void> = [];
  let backs = 0;
  const h: HistoricoLike = {
    get state() {
      return pilha[indice];
    },
    pushState(s) {
      pilha.splice(indice + 1);
      pilha.push(s);
      indice++;
    },
    back() {
      backs++;
      if (indice > 0) {
        indice--;
        ouvintes.forEach((f) => f());
      }
    },
  };
  return {
    h,
    ouvintes,
    get tamanho() {
      return pilha.length;
    },
    get backs() {
      return backs;
    },
  };
}

describe("historicoOverlay", () => {
  test("criarMarca gera ids únicos com prefixo ov-", () => {
    const a = criarMarca();
    const b = criarMarca();
    expect(a.startsWith("ov-")).toBe(true);
    expect(a).not.toBe(b);
  });

  test("abrir empurra 1 entrada com a marca e preserva o state anterior", () => {
    const f = criarHistoricoFalso({ key: "rota-1", __TSR_index: 3 });
    const m = criarMarca();
    abrirCamada(f.h, m);
    expect(f.tamanho).toBe(2);
    expect((f.h.state as any).key).toBe("rota-1");
    expect((f.h.state as any).__TSR_index).toBe(3);
    expect(entradaEhDaCamada(f.h.state, m)).toBe(true);
  });

  test("abrir com state nulo funciona", () => {
    const f = criarHistoricoFalso(null);
    const m = criarMarca();
    abrirCamada(f.h, m);
    expect(entradaEhDaCamada(f.h.state, m)).toBe(true);
  });

  test("voltar (pop) fecha a camada", () => {
    const f = criarHistoricoFalso({ key: "r" });
    const m = criarMarca();
    abrirCamada(f.h, m);
    expect(deveFecharNoPopstate(f.h.state, m)).toBe(false);
    f.h.back();
    expect(deveFecharNoPopstate(f.h.state, m)).toBe(true);
  });

  test("fechar pelo X volta 1 entrada só se a da camada ainda for a atual", () => {
    const f = criarHistoricoFalso({ key: "r" });
    const m = criarMarca();
    abrirCamada(f.h, m);
    expect(deveVoltarAoFecharPelaUi(f.h.state, m)).toBe(true);
    f.h.back();
    expect(deveVoltarAoFecharPelaUi(f.h.state, m)).toBe(false);
  });

  test("duas camadas: voltar fecha só a de cima; a de baixo continua aberta", () => {
    const f = criarHistoricoFalso({ key: "r" });
    const a = criarMarca();
    const b = criarMarca();
    abrirCamada(f.h, a);
    abrirCamada(f.h, b);
    expect((f.h.state as any).key).toBe("r");
    f.h.back(); // popstate: as duas camadas escutam
    expect(deveFecharNoPopstate(f.h.state, b)).toBe(true);
    expect(deveFecharNoPopstate(f.h.state, a)).toBe(false);
    // fechar a de baixo pelo X ainda consome a entrada dela
    expect(deveVoltarAoFecharPelaUi(f.h.state, a)).toBe(true);
    f.h.back();
    expect(deveFecharNoPopstate(f.h.state, a)).toBe(true);
  });

  test("duas camadas: fechar a de baixo com a de cima ainda aberta não desfaz nada", () => {
    const f = criarHistoricoFalso({ key: "r" });
    const a = criarMarca();
    const b = criarMarca();
    abrirCamada(f.h, a);
    abrirCamada(f.h, b);
    expect(deveVoltarAoFecharPelaUi(f.h.state, a)).toBe(false);
  });

  test("navegou para outra rota com a camada aberta: fechar não chama back()", () => {
    const f = criarHistoricoFalso({ key: "r" });
    const m = criarMarca();
    abrirCamada(f.h, m);
    f.h.pushState({ key: "outra-rota" }, ""); // navegação por link
    expect(deveVoltarAoFecharPelaUi(f.h.state, m)).toBe(false);
    expect(f.backs).toBe(0);
  });
});
