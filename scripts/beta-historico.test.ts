import { describe, expect, test } from "bun:test";
import {
  abrirCamada,
  criarDesmontador,
  criarMarca,
  quantoVoltarAoDesmontar,
  deveFecharNoPopstate,
  deveVoltarAoFecharPelaUi,
  entradaEhDaCamada,
  type HistoricoLike,
} from "../src/lib/historicoOverlay";

// Histórico falso em memória: pilha + índice. back()/go() são ENFILEIRADOS (como no
// navegador, são assíncronos) e só valem em flush(), que avisa os ouvintes (popstate).
function criarHistoricoFalso(estadoInicial: unknown = null) {
  const pilha: unknown[] = [estadoInicial];
  let indice = 0;
  const fila: number[] = [];
  const chamadasGo: number[] = [];
  const ouvintes: Array<() => void> = [];
  const h = {
    get state() {
      return pilha[indice];
    },
    pushState(s: unknown) {
      pilha.splice(indice + 1);
      pilha.push(s);
      indice++;
    },
    go(d: number) {
      chamadasGo.push(d);
      fila.push(d);
    },
    back() {
      chamadasGo.push(-1);
      fila.push(-1);
    },
  };
  return {
    h,
    ouvintes,
    chamadasGo,
    get tamanho() {
      return pilha.length;
    },
    get indice() {
      return indice;
    },
    flush() {
      while (fila.length) {
        indice = Math.max(0, Math.min(pilha.length - 1, indice + fila.shift()!));
        ouvintes.forEach((f) => f());
      }
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
    f.flush();
    expect(deveFecharNoPopstate(f.h.state, m)).toBe(true);
  });

  test("fechar pelo X volta 1 entrada só se a da camada ainda for a atual", () => {
    const f = criarHistoricoFalso({ key: "r" });
    const m = criarMarca();
    abrirCamada(f.h, m);
    expect(deveVoltarAoFecharPelaUi(f.h.state, m)).toBe(true);
    f.h.back();
    f.flush();
    expect(deveVoltarAoFecharPelaUi(f.h.state, m)).toBe(false);
  });

  test("duas camadas: voltar fecha só a de cima; a de baixo continua aberta", () => {
    const f = criarHistoricoFalso({ key: "r" });
    const a = criarMarca();
    const b = criarMarca();
    abrirCamada(f.h, a);
    abrirCamada(f.h, b);
    expect((f.h.state as any).key).toBe("r");
    f.h.back();
    f.flush(); // popstate: as duas camadas escutam
    expect(deveFecharNoPopstate(f.h.state, b)).toBe(true);
    expect(deveFecharNoPopstate(f.h.state, a)).toBe(false);
    // fechar a de baixo pelo X ainda consome a entrada dela
    expect(deveVoltarAoFecharPelaUi(f.h.state, a)).toBe(true);
    f.h.back();
    f.flush();
    expect(deveFecharNoPopstate(f.h.state, a)).toBe(true);
  });

  test("duas camadas: fechar só a de baixo consome as 2 entradas; a de cima fecha pelo popstate", () => {
    const f = criarHistoricoFalso({ key: "r" });
    const a = criarMarca();
    const b = criarMarca();
    abrirCamada(f.h, a);
    abrirCamada(f.h, b);
    const tarefas: Array<() => void> = [];
    const d = criarDesmontador(f.h, (fn) => tarefas.push(fn));
    let cimaFechou = false;
    f.ouvintes.push(() => {
      if (deveFecharNoPopstate(f.h.state, b)) cimaFechou = true;
      d.assentou();
    });
    d.desmontar(a, false);
    tarefas.splice(0).forEach((t) => t());
    expect(f.chamadasGo).toEqual([-2]);
    f.flush();
    expect(f.indice).toBe(0);
    expect(cimaFechou).toBe(true);
  });

  test("navegou para outra rota com a camada aberta: fechar não consome nada", () => {
    const f = criarHistoricoFalso({ key: "r" });
    const m = criarMarca();
    abrirCamada(f.h, m);
    f.h.pushState({ key: "outra-rota" }, ""); // navegação por link
    expect(quantoVoltarAoDesmontar(f.h.state, m, false)).toBe(0);
    const desmontar = criarDesmontador(f.h, (fn) => fn());
    desmontar.desmontar(m, false);
    f.flush();
    expect((f.h.state as any).key).toBe("outra-rota");
  });

  test("quantoVoltarAoDesmontar: fechada pelo voltar = 0; topo = 1; com pendentes desconta", () => {
    const f = criarHistoricoFalso({ key: "r" });
    const a = criarMarca();
    const b = criarMarca();
    abrirCamada(f.h, a);
    abrirCamada(f.h, b);
    expect(quantoVoltarAoDesmontar(f.h.state, a, true)).toBe(0);
    expect(quantoVoltarAoDesmontar(f.h.state, b, false)).toBe(1);
    expect(quantoVoltarAoDesmontar(f.h.state, a, false)).toBe(2);
    expect(quantoVoltarAoDesmontar(f.h.state, a, false, 2)).toBe(0);
  });

  test("camada única fechada pelo X: consome exatamente 1 entrada", () => {
    const f = criarHistoricoFalso({ key: "r" });
    const m = criarMarca();
    abrirCamada(f.h, m);
    criarDesmontador(f.h, (fn) => fn()).desmontar(m, false);
    f.flush();
    expect(f.indice).toBe(0);
  });

  for (const ordem of ["baixo-primeiro", "cima-primeiro"]) {
    test(`duas camadas fechadas no mesmo tick (${ordem}): UM go(-2), nenhuma entrada sobra`, () => {
      const f = criarHistoricoFalso({ key: "r" });
      const a = criarMarca();
      const b = criarMarca();
      abrirCamada(f.h, a);
      abrirCamada(f.h, b);
      const tarefas: Array<() => void> = [];
      const d = criarDesmontador(f.h, (fn) => tarefas.push(fn));
      if (ordem === "baixo-primeiro") {
        d.desmontar(a, false);
        d.desmontar(b, false);
      } else {
        d.desmontar(b, false);
        d.desmontar(a, false);
      }
      expect(f.chamadasGo).toEqual([]);
      tarefas.splice(0).forEach((t) => t());
      expect(f.chamadasGo).toEqual([-2]);
      f.flush();
      expect(f.indice).toBe(0);
      expect((f.h.state as any).key).toBe("r");
    });
  }

  test("camada de cima fecha, e em tick posterior (antes do popstate) a de baixo: total 2, nunca 3", () => {
    const f = criarHistoricoFalso({ key: "r" });
    const a = criarMarca();
    const b = criarMarca();
    abrirCamada(f.h, a);
    abrirCamada(f.h, b);
    const tarefas: Array<() => void> = [];
    const d = criarDesmontador(f.h, (fn) => tarefas.push(fn));
    f.ouvintes.push(() => d.assentou());
    d.desmontar(b, false);
    tarefas.splice(0).forEach((t) => t()); // go(-1) enfileirado, SEM flush
    d.desmontar(a, false); // outro tick, state ainda velho
    tarefas.splice(0).forEach((t) => t());
    expect(f.chamadasGo.reduce((x, y) => x + y, 0)).toBe(-2);
    f.flush();
    expect(f.indice).toBe(0);
  });
});
