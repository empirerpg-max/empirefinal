import { describe, expect, test } from "bun:test";
import {
  ColetorUso,
  acaoDaRequisicao,
  aparelhoPelaLargura,
  normalizarCaminhoApi,
  telaDaRota,
} from "../src/lib/uso/coletor";

describe("ColetorUso", () => {
  test("soma telas iguais", () => {
    const c = new ColetorUso();
    c.tela("/charts");
    c.tela("/charts");
    c.tela("/social");
    const lote = c.retirarLote("anterior", "celular")!;
    expect(lote.eventos).toContainEqual({ evento: "tela", alvo: "/charts", n: 2 });
    expect(lote.eventos).toContainEqual({ evento: "tela", alvo: "/social", n: 1 });
    expect(lote.versao).toBe("anterior");
    expect(lote.aparelho).toBe("celular");
    expect(lote.telas?.sort()).toEqual(["/charts", "/social"]);
  });

  test("acao com tela gera caminho", () => {
    const c = new ColetorUso();
    c.acao("/api/forum/comment", "/forum");
    const ev = c.retirarLote("anterior", "tablet")!.eventos;
    expect(ev).toContainEqual({ evento: "acao", alvo: "/api/forum/comment", n: 1 });
    expect(ev).toContainEqual({ evento: "caminho", alvo: "/api/forum/comment ← /forum", n: 1 });
  });

  test("acao sem tela só conta a acao", () => {
    const c = new ColetorUso();
    c.acao("x", null);
    const ev = c.retirarLote("anterior", "tablet")!.eventos;
    expect(ev).toEqual([{ evento: "acao", alvo: "x", n: 1 }]);
  });

  test("retirarLote vazio é null e zera depois de retirar", () => {
    const c = new ColetorUso();
    expect(c.retirarLote("anterior", "celular")).toBeNull();
    c.tela("/a");
    expect(c.telasDoDia()).toEqual(["/a"]);
    expect(c.retirarLote("anterior", "celular")).not.toBeNull();
    expect(c.retirarLote("anterior", "celular")).toBeNull();
    expect(c.telasDoDia()).toEqual([]);
  });

  test("busca limitada a 1 por 10 s", () => {
    let t = 1000;
    const c = new ColetorUso(() => t);
    c.acao("buscar", null);
    t += 5000;
    c.acao("buscar", null);
    t += 5000;
    c.acao("buscar", null);
    const ev = c.retirarLote("anterior", "celular")!.eventos;
    expect(ev).toEqual([{ evento: "acao", alvo: "buscar", n: 2 }]);
  });

  test("respeita limites do servidor", () => {
    const c = new ColetorUso();
    for (let i = 0; i < 250; i++) for (let k = 0; k <= i; k++) c.tela(`/t${i}`);
    for (let k = 0; k < 1500; k++) c.tela("/muito");
    c.tela("a".repeat(300));
    const lote = c.retirarLote("anterior", "celular")!;
    expect(lote.eventos.length).toBe(200);
    expect(lote.eventos.every((e) => e.n >= 1 && e.n <= 1000 && e.alvo.length <= 120)).toBe(true);
    expect(lote.eventos.find((e) => e.alvo === "/muito")!.n).toBe(1000);
    expect(lote.telas!.length).toBeLessThanOrEqual(50);
  });
});

describe("normalizarCaminhoApi", () => {
  test("troca ids e tira query", () => {
    expect(normalizarCaminhoApi("/api/social/posts/POST-abc123/deletar?x=1")).toBe("/api/social/posts/:id/deletar");
    expect(normalizarCaminhoApi("/api/x/123/y")).toBe("/api/x/:id/y");
    expect(normalizarCaminhoApi("/api/x/0123456789abcdef0123/y")).toBe("/api/x/:id/y");
    expect(normalizarCaminhoApi("/api/artistas/Anitta%20X")).toBe("/api/artistas/:id");
  });
  test("ignora o que não é /api ou é ruído", () => {
    expect(normalizarCaminhoApi("/api/uso")).toBeNull();
    expect(normalizarCaminhoApi("/api/log-error")).toBeNull();
    expect(normalizarCaminhoApi("/api/flags")).toBeNull();
    expect(normalizarCaminhoApi("/outra/coisa")).toBeNull();
  });
});

describe("acaoDaRequisicao", () => {
  test("regras", () => {
    expect(acaoDaRequisicao("GET", "/api/charts", true)).toBeNull();
    expect(acaoDaRequisicao("POST", "/api/forum/comment", false)).toBeNull();
    expect(acaoDaRequisicao("POST", "/api/forum/comment", true)).toBe("/api/forum/comment");
    expect(acaoDaRequisicao("delete", "/api/x/12", true)).toBe("/api/x/:id");
    expect(acaoDaRequisicao("GET", "/api/busca?q=oi", true)).toBe("buscar");
    expect(acaoDaRequisicao("POST", "/api/uso", true)).toBeNull();
  });
});

describe("telaDaRota", () => {
  test("aba/tab/view", () => {
    expect(telaDaRota("/charts", { tab: "Global 100" })).toBe("/charts › Global 100");
    expect(telaDaRota("/a", { aba: "x" })).toBe("/a › x");
    expect(telaDaRota("/charts", {})).toBe("/charts");
    expect(telaDaRota("/charts", { tab: "x".repeat(31) })).toBe("/charts");
    expect(telaDaRota("/charts", { tab: "id 123456789" })).toBe("/charts");
    expect(telaDaRota("/charts", { tab: 5 })).toBe("/charts");
  });
});

test("aparelhoPelaLargura", () => {
  expect(aparelhoPelaLargura(767)).toBe("celular");
  expect(aparelhoPelaLargura(768)).toBe("tablet");
  expect(aparelhoPelaLargura(1023)).toBe("tablet");
  expect(aparelhoPelaLargura(1024)).toBe("computador");
});
