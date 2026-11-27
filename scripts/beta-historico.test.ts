import { describe, expect, test } from "bun:test";
import {
  abrirCamada,
  criarDesmontador,
  criarMarca,
  quantoVoltarAoDesmontar,
  deveFecharNoPopstate,
  deveVoltarAoFecharPelaUi,
  entradaEhDaCamada,
  esperarSaidaDaEntrada,
  LIMITE_ESPERA_SAIDA_MS,
  type HistoricoLike,
} from "../src/lib/historicoOverlay";

// Histórico falso em memória: pilha + índice. back()/go() são ENFILEIRADOS (como no
// navegador, são assíncronos) e só valem em flush(), que avisa os ouvintes (popstate).
function criarHistoricoFalso(estadoInicial: unknown = null) {
  const pilha: unknown[] = [estadoInicial];
  let indice = 0;
  const fila: number[] = [];
  const chamadasGo: number[] = [];
  const chamadasReplace: unknown[] = [];
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
    replaceState(s: unknown) {
      chamadasReplace.push(s);
      pilha[indice] = s;
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
    chamadasReplace,
    /** Pilhas de marcas de cada entrada do histórico, da base até a última. */
    get entradas() {
      return pilha.map((e) => ((e as any)?.__overlays ?? []) as string[]);
    },
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

  test("tres camadas, tres ticks, popstates pousando no meio: total exatamente 3, indice 0", () => {
    const f = criarHistoricoFalso({ key: "r" });
    const [a, b, c] = [criarMarca(), criarMarca(), criarMarca()];
    abrirCamada(f.h, a);
    abrirCamada(f.h, b);
    abrirCamada(f.h, c);
    const tarefas: Array<() => void> = [];
    const rodar = () => tarefas.splice(0).forEach((t) => t());
    const d = criarDesmontador(f.h, (fn) => tarefas.push(fn));
    f.ouvintes.push(() => d.assentou());
    d.desmontar(c, false);
    rodar();
    f.flush(); // popstate pousa
    d.desmontar(b, false);
    rodar();
    f.flush();
    d.desmontar(a, false);
    rodar();
    f.flush();
    expect(f.chamadasGo.reduce((x, y) => x + y, 0)).toBe(-3);
    expect(f.indice).toBe(0);
  });

  test("tres camadas, go() em voo: popstate intermediário não zera a janela (total 3)", () => {
    const f = criarHistoricoFalso({ key: "r" });
    const [a, b, c] = [criarMarca(), criarMarca(), criarMarca()];
    abrirCamada(f.h, a);
    abrirCamada(f.h, b);
    abrirCamada(f.h, c);
    const tarefas: Array<() => void> = [];
    const rodar = () => tarefas.splice(0).forEach((t) => t());
    const d = criarDesmontador(f.h, (fn) => tarefas.push(fn));
    f.ouvintes.push(() => d.assentou());
    d.desmontar(c, false);
    rodar(); // go(-1) em voo
    d.desmontar(b, false);
    rodar(); // go(-1) em voo, state ainda velho
    d.assentou(); // popstate do 1o passo: nao pode zerar (aqui state ainda [a,b,c])
    d.desmontar(a, false);
    rodar();
    f.flush();
    expect(f.chamadasGo.reduce((x, y) => x + y, 0)).toBe(-3);
    expect(f.indice).toBe(0);
  });

  // Troca: a camada que fecha pela UI e a que abre no mesmo tick (cleanup de
  // uma, efeito da outra, depois a microtask). Ouvinte global (assentou) é
  // registrado antes dos das camadas, como no hook.
  function montarTroca() {
    const f = criarHistoricoFalso({ key: "r", __TSR_index: 1 });
    const tarefas: Array<() => void> = [];
    const rodar = () => tarefas.splice(0).forEach((t) => t());
    const d = criarDesmontador(f.h, (fn) => tarefas.push(fn));
    f.ouvintes.push(() => d.assentou());
    const fechadas = new Set<string>();
    const escutar = (m: string) =>
      f.ouvintes.push(() => {
        if (deveFecharNoPopstate(f.h.state, m)) fechadas.add(m);
      });
    return { f, d, rodar, fechadas, escutar };
  }

  test("troca: c fecha pela UI e d abre no mesmo tick -> d reaproveita a entrada, sem go()", () => {
    const { f, d, rodar, fechadas, escutar } = montarTroca();
    const c = criarMarca();
    abrirCamada(f.h, c, d);
    escutar(c);
    d.desmontar(c, false); // cleanup de c
    const dd = criarMarca();
    abrirCamada(f.h, dd, d); // efeito de d, mesmo tick
    escutar(dd);
    rodar();
    f.flush();
    expect(f.chamadasGo).toEqual([]);
    expect(f.chamadasReplace.length).toBe(1);
    expect(f.entradas).toEqual([[], [dd]]);
    expect(f.indice).toBe(1);
    expect((f.h.state as any).key).toBe("r");
    expect((f.h.state as any).__TSR_index).toBe(1);
    expect(fechadas.has(dd)).toBe(false);
    // voltar do usuário fecha d e cai na base
    f.h.back();
    f.flush();
    expect(fechadas.has(dd)).toBe(true);
    expect(f.indice).toBe(0);
    expect((f.h.state as any).key).toBe("r");
  });

  test("troca com duas camadas abaixo: a aberta, b sobre a, b trocada por c -> a e c, uma entrada cada", () => {
    const { f, d, rodar, fechadas, escutar } = montarTroca();
    const [a, b, c] = [criarMarca(), criarMarca(), criarMarca()];
    abrirCamada(f.h, a, d);
    escutar(a);
    abrirCamada(f.h, b, d);
    escutar(b);
    d.desmontar(b, false);
    abrirCamada(f.h, c, d);
    escutar(c);
    rodar();
    f.flush();
    expect(f.chamadasGo).toEqual([]);
    expect(f.entradas).toEqual([[], [a], [a, c]]);
    expect(f.indice).toBe(2);
    expect(fechadas.size).toBe(0);
    f.h.back();
    f.flush();
    expect(fechadas.has(c)).toBe(true);
    expect(fechadas.has(a)).toBe(false);
    f.h.back();
    f.flush();
    expect(fechadas.has(a)).toBe(true);
    expect(f.indice).toBe(0);
  });

  test("troca com duas camadas fechando juntas (b e c) e d abrindo: go(-1) e d assume a entrada de b", () => {
    const { f, d, rodar, fechadas, escutar } = montarTroca();
    const [a, b, c] = [criarMarca(), criarMarca(), criarMarca()];
    abrirCamada(f.h, a, d);
    escutar(a);
    abrirCamada(f.h, b, d);
    abrirCamada(f.h, c, d);
    d.desmontar(c, false);
    d.desmontar(b, false);
    const dd = criarMarca();
    abrirCamada(f.h, dd, d);
    escutar(dd);
    rodar();
    expect(f.chamadasGo).toEqual([-1]);
    f.flush();
    expect(f.entradas.slice(0, f.indice + 1)).toEqual([[], [a], [a, dd]]);
    expect(fechadas.size).toBe(0);
    f.h.back();
    f.flush();
    expect(fechadas.has(dd)).toBe(true);
    expect(fechadas.has(a)).toBe(false);
    expect(f.indice).toBe(1);
  });

  test("troca adiada em que a nova fecha antes do go() pousar: consome a entrada reservada também", () => {
    const { f, d, rodar } = montarTroca();
    const [a, b] = [criarMarca(), criarMarca()];
    abrirCamada(f.h, a, d);
    abrirCamada(f.h, b, d);
    d.desmontar(a, false); // a fecha (b junto, via popstate)
    const dd = criarMarca();
    abrirCamada(f.h, dd, d);
    rodar(); // go(-1): reserva a entrada de a para dd
    d.desmontar(dd, false); // dd fecha antes de pousar
    f.flush();
    expect(f.chamadasGo.reduce((x, y) => x + y, 0)).toBe(-2);
    expect(f.indice).toBe(0);
  });
});

describe("esperarSaidaDaEntrada (ação que navega roda só depois que a entrada saiu)", () => {
  function montar() {
    const f = criarHistoricoFalso({ rota: "/pagina" });
    const timers: Array<{ f: () => void; ms: number; ativo: boolean }> = [];
    const agendados: Array<() => void> = [];
    const opcoes = {
      lerState: () => f.h.state,
      ouvirPopstate: (cb: () => void) => {
        f.ouvintes.push(cb);
        return () => {
          const i = f.ouvintes.indexOf(cb);
          if (i >= 0) f.ouvintes.splice(i, 1);
        };
      },
      esperar: (cb: () => void, ms: number) => {
        const t = { f: cb, ms, ativo: true };
        timers.push(t);
        return () => {
          t.ativo = false;
        };
      },
      // o "depois" roda fora do despacho do popstate (setTimeout 0 no app)
      emSeguida: (cb: () => void) => agendados.push(cb),
    };
    const rodarAgendados = () => agendados.splice(0).forEach((cb) => cb());
    const estourar = () => timers.filter((t) => t.ativo).forEach((t) => ((t.ativo = false), t.f()));
    return { f, opcoes, timers, rodarAgendados, estourar };
  }

  test("não roda antes do popstate; roda depois que a entrada da camada saiu", () => {
    const { f, opcoes, rodarAgendados } = montar();
    abrirCamada(f.h, "m1");
    const chamadas: string[] = [];
    esperarSaidaDaEntrada({ ...opcoes, marca: "m1", depois: () => chamadas.push(String((f.h.state as any)?.rota)) });
    rodarAgendados();
    expect(chamadas).toEqual([]);
    f.h.back(); // o go() do fechamento pela UI
    expect(chamadas).toEqual([]);
    f.flush();
    expect(chamadas).toEqual([]); // ainda dentro do despacho do popstate
    rodarAgendados();
    expect(chamadas).toEqual(["/pagina"]); // roda com a entrada já fora: navegar empurra por cima da página
    expect(f.ouvintes.length).toBe(0); // ouvinte removido
  });

  test("popstate em que a marca ainda está na pilha (camada de cima fechou) não dispara", () => {
    const { f, opcoes, rodarAgendados } = montar();
    abrirCamada(f.h, "m1");
    abrirCamada(f.h, "m2");
    let n = 0;
    esperarSaidaDaEntrada({ ...opcoes, marca: "m1", depois: () => n++ });
    f.h.back();
    f.flush();
    rodarAgendados();
    expect(n).toBe(0);
    f.h.back();
    f.flush();
    rodarAgendados();
    expect(n).toBe(1);
  });

  test("sem popstate (ex.: entrada reaproveitada por outra camada), o tempo limite roda uma vez", () => {
    const { f, opcoes, timers, rodarAgendados, estourar } = montar();
    abrirCamada(f.h, "m1");
    let n = 0;
    esperarSaidaDaEntrada({ ...opcoes, marca: "m1", depois: () => n++ });
    expect(timers[0].ms).toBe(LIMITE_ESPERA_SAIDA_MS);
    estourar();
    rodarAgendados();
    expect(n).toBe(1);
    f.h.back();
    f.flush();
    rodarAgendados();
    expect(n).toBe(1); // nunca duas vezes
    expect(f.ouvintes.length).toBe(0);
  });

  test("depois do popstate, o tempo limite não roda de novo", () => {
    const { f, opcoes, rodarAgendados, estourar } = montar();
    abrirCamada(f.h, "m1");
    let n = 0;
    esperarSaidaDaEntrada({ ...opcoes, marca: "m1", depois: () => n++ });
    f.h.back();
    f.flush();
    rodarAgendados();
    estourar();
    rodarAgendados();
    expect(n).toBe(1);
  });

  test("se a entrada já saiu ao começar a esperar, roda logo (sem esperar popstate)", () => {
    const { f, opcoes, rodarAgendados } = montar();
    let n = 0;
    esperarSaidaDaEntrada({ ...opcoes, marca: "m-que-nao-esta", depois: () => n++ });
    rodarAgendados();
    expect(n).toBe(1);
    expect(f.ouvintes.length).toBe(0);
  });
});
