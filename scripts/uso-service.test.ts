import { test, expect, beforeAll } from "bun:test";
// Serviço de uso no D1 (medição de uso). Uso: bun test scripts/uso-service.test.ts
import { instalarFakeD1 } from "./helpers/fakeD1";
const U = await import("../backend/src/services/usoService.ts");
const sqlite = instalarFakeD1();
const db = (globalThis as any).__CATALOGO_DB__;
const T = Date.UTC(2026, 10, 27, 15, 0); // 2026-11-27
const DIA2 = Date.UTC(2026, 10, 28, 15, 0); // 2026-11-28
const linhas = (t: string) => sqlite.query(`SELECT * FROM ${t} ORDER BY 1,2,3`).all() as any[];
const limpar = () => { for (const t of ["uso_diario", "uso_jogador_dia", "uso_jogador_tela_dia"]) sqlite.run(`DELETE FROM ${t}`); };
const lote = (eventos: any[], extra: any = {}) => ({ versao: "anterior" as const, aparelho: "celular" as const, eventos, ...extra });

beforeAll(async () => { await U.garantirTabelasUso(db); });

test("diaUTC devolve a data UTC", () => {
  expect(U.diaUTC(T)).toBe("2026-11-27");
  expect(U.diaUTC(Date.UTC(2026, 10, 27, 23, 59, 59))).toBe("2026-11-27");
});

test("dois lotes do mesmo dia somam a contagem", async () => {
  limpar();
  await U.gravarLoteUso(db, lote([{ evento: "tela", alvo: "/charts", n: 2 }]), null, T);
  await U.gravarLoteUso(db, lote([{ evento: "tela", alvo: "/charts", n: 3 }]), null, T);
  expect(linhas("uso_diario")).toEqual([{ dia: "2026-11-27", versao: "anterior", aparelho: "celular", evento: "tela", alvo: "/charts", contagem: 5 }]);
});

test("eventos repetidos no mesmo lote viram uma instrução só", async () => {
  limpar();
  const r = await U.gravarLoteUso(db, lote([
    { evento: "tela", alvo: "/a", n: 1 }, { evento: "tela", alvo: "/a", n: 4 }, { evento: "acao", alvo: "/a", n: 1 },
  ]), null, T);
  expect(r.gravadas).toBe(2);
  expect(linhas("uso_diario").map((l) => [l.evento, l.contagem])).toEqual([["acao", 1], ["tela", 5]]);
});

test("jogador conta uma vez por dia e uma vez por tela por dia", async () => {
  limpar();
  const l = lote([{ evento: "tela", alvo: "/charts", n: 1 }], { telas: ["/charts", "/forum", "/charts"] });
  const r1 = await U.gravarLoteUso(db, l, "j1", T);
  await U.gravarLoteUso(db, l, "j1", T);
  expect(r1.gravadas).toBe(1 + 1 + 2); // evento + jogador + 2 telas distintas
  expect(linhas("uso_jogador_dia")).toEqual([{ dia: "2026-11-27", jogador: "j1", versao: "anterior" }]);
  expect(linhas("uso_jogador_tela_dia")).toEqual([
    { dia: "2026-11-27", tela: "/charts", jogador: "j1" },
    { dia: "2026-11-27", tela: "/forum", jogador: "j1" },
  ]);
});

test("sem jogador não grava nas tabelas de jogadores", async () => {
  limpar();
  const r = await U.gravarLoteUso(db, lote([{ evento: "tela", alvo: "/charts", n: 1 }], { telas: ["/charts"] }), null, T);
  expect(r.gravadas).toBe(1);
  expect(linhas("uso_jogador_dia")).toEqual([]);
  expect(linhas("uso_jogador_tela_dia")).toEqual([]);
});

test("limparLote corta e descarta o inválido", () => {
  expect(U.limparLote({ versao: "x" })).toBeNull();
  expect(U.limparLote(null)).toBeNull();
  const l = U.limparLote({ versao: "anterior", aparelho: "celular", eventos: [
    ...Array(250).fill({ evento: "tela", alvo: "/a", n: 1 }),
    { evento: "hack", alvo: "/b", n: 1 }, { evento: "acao", alvo: "x".repeat(500), n: 1 }, { evento: "acao", alvo: "/c", n: 5000 }] });
  expect(l!.eventos.length).toBe(200);
  expect(l!.eventos.every((e) => e.alvo.length <= 120 && e.n >= 1 && e.n <= 1000)).toBe(true);
  const m = U.limparLote({ versao: "beta", aparelho: "tablet", eventos: [
    { evento: "hack", alvo: "/b", n: 1 }, { evento: "acao", alvo: "x".repeat(500), n: 1 }, { evento: "acao", alvo: "/c", n: 5000 }, { evento: "acao", alvo: "/d", n: 0 }] });
  expect(m!.eventos.map((e) => [e.alvo.length, e.n])).toEqual([[120, 1], [2, 1000]]);
});

test("resumoUso soma o período, conta jogadores distintos e ordena por n", async () => {
  limpar();
  await U.gravarLoteUso(db, lote([{ evento: "tela", alvo: "/charts", n: 2 }, { evento: "tela", alvo: "/forum", n: 7 }, { evento: "acao", alvo: "curtir", n: 3 }], { telas: ["/charts", "/forum"] }), "j1", T);
  await U.gravarLoteUso(db, { versao: "beta", aparelho: "computador", eventos: [{ evento: "tela", alvo: "/charts", n: 10 }, { evento: "caminho", alvo: "/charts>/forum", n: 4 }], telas: ["/charts"] }, "j2", DIA2);
  await U.gravarLoteUso(db, lote([{ evento: "tela", alvo: "/charts", n: 1 }], { telas: ["/charts"] }), "j1", DIA2);
  const r = await U.resumoUso(db, "2026-11-27", "2026-11-28");
  expect(r).toEqual({
    jogadores: 2,
    telas: [{ alvo: "/charts", n: 13, jogadores: 2 }, { alvo: "/forum", n: 7, jogadores: 1 }],
    acoes: [{ alvo: "curtir", n: 3 }],
    caminhos: [{ alvo: "/charts>/forum", n: 4 }],
    porAparelho: [{ aparelho: "computador", n: 14 }, { aparelho: "celular", n: 13 }],
  });
  const so1 = await U.resumoUso(db, "2026-11-27", "2026-11-27");
  expect(so1.jogadores).toBe(1);
  expect(so1.telas[0]).toEqual({ alvo: "/forum", n: 7, jogadores: 1 });
});

test("apagarUsoAntigo remove só dias anteriores ao corte", async () => {
  limpar();
  const dias = [Date.UTC(2026, 10, 25), T, DIA2];
  for (const d of dias) await U.gravarLoteUso(db, lote([{ evento: "tela", alvo: "/a", n: 1 }], { telas: ["/a"] }), "j1", d);
  const apagadas = await U.apagarUsoAntigo(db, "2026-11-27");
  expect(apagadas).toBe(3); // 1 linha em cada tabela
  for (const t of ["uso_diario", "uso_jogador_dia", "uso_jogador_tela_dia"]) {
    expect(linhas(t).map((l) => l.dia)).toEqual(["2026-11-27", "2026-11-28"]);
  }
});
