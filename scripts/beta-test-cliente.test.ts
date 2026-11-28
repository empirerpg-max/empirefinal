import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { api } from "../src/lib/api";
import { acaoDaRequisicao, ColetorUso } from "../src/lib/uso/coletor";
import { limparLote } from "../backend/src/services/usoService";
import {
  ESTADO_SEGURO,
  chaveConsultaEstado,
  chaveEstadoGuardado,
  dadosTecnicos,
  estadoFinal,
  estadoInicial,
  guardarEstado,
  lerEstadoGuardado,
} from "../src/lib/beta/cliente";
import { _zerarErrosRecentes, errosRecentes, instalarErrosRecentes } from "../src/lib/beta/errosRecentes";
import { acaoUsoVoltar } from "../src/lib/beta/regras";

const g = globalThis as Record<string, unknown>;
const orig = { fetch: g.fetch, window: g.window, localStorage: g.localStorage, navigator: g.navigator };

class Janela extends EventTarget {
  innerWidth = 400;
}
function memoria(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}

beforeEach(() => {
  g.localStorage = memoria();
  g.window = new Janela();
  g.navigator = { userAgent: "Teste/1.0" };
  _zerarErrosRecentes();
});
afterEach(() => {
  g.fetch = orig.fetch;
  g.window = orig.window;
  g.localStorage = orig.localStorage;
  g.navigator = orig.navigator;
});

describe("estado do Beta", () => {
  test("estado com erro vira anterior (fetch 500, sem guardado)", async () => {
    g.fetch = async () => new Response(JSON.stringify({ ok: false, erro: "x" }), { status: 500 });
    let servidor = null;
    try {
      servidor = await api.betaEstado();
    } catch {
      servidor = null;
    }
    expect(estadoFinal(servidor, lerEstadoGuardado())).toEqual(ESTADO_SEGURO);
    expect(ESTADO_SEGURO).toEqual({ modo: "desligado", podeVer: false, podeVoltar: false, versao: "anterior", boasVindasVistas: true });
  });

  test("erro de rede mantém o estado guardado", async () => {
    const guardado = { modo: "todos", podeVer: true, podeVoltar: true, versao: "beta", boasVindasVistas: false } as const;
    guardarEstado(guardado, "j1");
    g.fetch = async () => {
      throw new Error("sem rede");
    };
    const servidor = await api.betaEstado().catch(() => null);
    expect(estadoFinal(servidor, lerEstadoGuardado("j1"))).toEqual(guardado);
  });

  test("guardado é usado antes da resposta e lixo no armazenamento é ignorado", () => {
    const e = { modo: "convidados", podeVer: true, podeVoltar: true, versao: "beta", boasVindasVistas: true } as const;
    guardarEstado(e, "j1");
    expect(estadoFinal(null, lerEstadoGuardado("j1"))).toEqual(e);
    localStorage.setItem("empireBetaEstado:j1", "{lixo");
    expect(lerEstadoGuardado("j1")).toBeNull();
    localStorage.setItem("empireBetaEstado:j1", JSON.stringify({ modo: "xis", versao: "beta" }));
    expect(lerEstadoGuardado("j1")).toBeNull();
  });

  test("estadoInicial usa o guardado, senão o seguro", () => {
    expect(estadoInicial("j1")).toEqual(ESTADO_SEGURO);
    const e = { modo: "todos", podeVer: true, podeVoltar: true, versao: "beta", boasVindasVistas: true } as const;
    guardarEstado(e, "j1");
    expect(estadoInicial("j1")).toEqual(e);
  });

  test("estado guardado é por jogador; sem jogador → seguro e nada gravado", () => {
    expect(chaveEstadoGuardado("j1")).toBe("empireBetaEstado:j1");
    expect(chaveConsultaEstado("j1")).toEqual(["beta", "estado", "j1"]);
    expect(chaveConsultaEstado(null)).toEqual(["beta", "estado", null]);
    const e = { modo: "todos", podeVer: true, podeVoltar: true, versao: "beta", boasVindasVistas: true } as const;
    guardarEstado(e, "j1");
    expect(lerEstadoGuardado("j1")).toEqual(e);
    expect(lerEstadoGuardado("j2")).toBeNull();
    expect(estadoInicial("j2")).toEqual(ESTADO_SEGURO);
    // estado antigo sem id (de antes desta versão) não vale para ninguém
    localStorage.setItem("empireBetaEstado", JSON.stringify(e));
    expect(estadoInicial(null)).toEqual(ESTADO_SEGURO);
    expect(lerEstadoGuardado(null)).toBeNull();
    const antes = localStorage.length;
    guardarEstado(e, null);
    expect(localStorage.length).toBe(antes);
  });

  test("betaEstado manda o token guardado no cabeçalho (sem depender do fetch embrulhado)", async () => {
    localStorage.setItem("empire_session_token", "tok-123");
    let auth: string | null = null;
    g.fetch = async (_u: unknown, init?: RequestInit) => {
      auth = new Headers(init?.headers).get("Authorization");
      return new Response(JSON.stringify({ ok: true, modo: "todos", podeVer: true, podeVoltar: true, versao: "beta", boasVindasVistas: true }));
    };
    await api.betaEstado();
    expect(auth).toBe("Bearer tok-123");
  });

  test("POST do Beta manda token e Content-Type juntos", async () => {
    localStorage.setItem("empire_session_token", "tok-9");
    let h: Headers | null = null;
    g.fetch = async (_u: unknown, init?: RequestInit) => {
      h = new Headers(init?.headers);
      return new Response(JSON.stringify({ ok: true, versao: "beta" }));
    };
    await api.betaEscolher({ versao: "beta" });
    expect(h!.get("Authorization")).toBe("Bearer tok-9");
    expect(h!.get("Content-Type")).toBe("application/json");
  });

  test("resposta do servidor ok é devolvida", async () => {
    g.fetch = async () =>
      new Response(JSON.stringify({ ok: true, modo: "todos", podeVer: true, podeVoltar: true, versao: "beta", boasVindasVistas: false }));
    const r = await api.betaEstado();
    expect(r.versao).toBe("beta");
  });
});

describe("errosRecentes e dadosTecnicos", () => {
  test("guarda só os 5 últimos erros, cortados em 300", () => {
    instalarErrosRecentes();
    instalarErrosRecentes(); // idempotente
    const w = g.window as EventTarget;
    for (let i = 0; i < 8; i++) {
      const ev = new Event("error") as Event & { message: string; error: unknown };
      ev.message = `erro ${i} ` + "x".repeat(1000);
      ev.error = { stack: "Error: a\n    at fn (arquivo.js:1:1)\n    at outro" };
      w.dispatchEvent(ev);
    }
    const lista = errosRecentes();
    expect(lista.length).toBe(5);
    expect(lista[0].msg.startsWith("erro 3 ")).toBe(true);
    expect(lista.every((e) => e.msg.length <= 300)).toBe(true);
  });

  test("dadosTecnicos nunca passa de 4.000 caracteres e não inclui a query string", () => {
    instalarErrosRecentes();
    const w = g.window as EventTarget;
    for (let i = 0; i < 5; i++) {
      const ev = new Event("unhandledrejection") as Event & { reason: unknown };
      ev.reason = { message: "m".repeat(5000), stack: "Error\n    at " + "y".repeat(5000) };
      w.dispatchEvent(ev);
    }
    g.navigator = { userAgent: "u".repeat(2000) };
    const json = dadosTecnicos({ versao: "beta", rota: "/charts?segredo=123&q=abc" });
    expect(json.length).toBeLessThanOrEqual(4000);
    expect(json).not.toContain("segredo");
    expect(json).not.toContain("?");
    const o = JSON.parse(json);
    expect(o.versao).toBe("beta");
    expect(o.rota).toBe("/charts");
    expect(o.aparelho).toBe("celular");
    expect(o.largura).toBe(400);
    expect(o.navegador.length).toBe(300);
    expect(Array.isArray(o.erros)).toBe(true);
  });
});

describe("medição de uso", () => {
  test("GET /api/beta/estado é ignorado pelo coletor", () => {
    expect(acaoDaRequisicao("GET", "/api/beta/estado", true)).toBeNull();
  });

  test("beta:voltar:<motivo> passa pelo coletor e pelo servidor, sem texto livre", () => {
    expect(acaoUsoVoltar("lento")).toBe("beta:voltar:lento");
    expect(acaoUsoVoltar()).toBe("beta:voltar:sem_motivo");
    expect(acaoUsoVoltar("texto livre" as never)).toBe("beta:voltar:sem_motivo");
    const c = new ColetorUso();
    c.acao(acaoUsoVoltar("lento"), "/charts");
    const lote = c.retirarLote("beta", "celular")!;
    expect(lote.eventos).toContainEqual({ evento: "acao", alvo: "beta:voltar:lento", n: 1 });
    const limpo = limparLote(lote)!;
    const alvos = limpo.eventos.map((e: { alvo: string }) => e.alvo);
    expect(alvos).toContain("beta:voltar:lento");
    // texto livre à mão é descartado
    const mao = limparLote({ versao: "beta", aparelho: "celular", eventos: [
      { evento: "acao", alvo: "beta:voltar:meu texto", n: 1 },
      { evento: "acao", alvo: "beta:voltar:sem_motivo", n: 1 },
    ] })!;
    expect(mao.eventos.map((e: { alvo: string }) => e.alvo)).toEqual(["beta:voltar:sem_motivo"]);
  });
});
