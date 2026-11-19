import { test, expect, beforeEach, mock } from "bun:test";
import { instalarFakeD1 } from "./helpers/fakeD1";

const R = new URL("../backend/src/", import.meta.url).pathname;
mock.module(R + "google/service-account.ts", () => ({
  getGoogleAccessToken: async () => "tok",
  getDriveOAuthAccessToken: async () => "tok",
  readRuntimeEnv: () => "",
}));
const logs: string[] = [];
mock.module(R + "services/logSistemaService.ts", () => ({
  registrarLogSistema: async (x: any) => void logs.push(x.oQueAconteceu),
  traduzirErroEscrita: () => ({ causaProvavel: "", comoResolver: "" }),
}));

// Planilha real falsa: valores formatados e fórmulas por aba.
let planilha: Record<string, string[][]> = {};
let formulas: Record<string, string[][]> = {};
(globalThis as any).fetch = async (url: string) => {
  const u = decodeURIComponent(String(url));
  const aba = u.match(/values\/'([^']+)'/)?.[1] ?? "";
  if (!(aba in planilha)) return new Response(JSON.stringify({ error: { message: "Unable to parse range: " + aba } }), { status: 400 });
  const valores = u.includes("valueRenderOption=FORMULA") ? formulas[aba] ?? planilha[aba] : planilha[aba];
  return new Response(JSON.stringify({ values: valores }), { status: 200 });
};
const kv = new Map<string, string>();
(globalThis as any).__FLAGS_KV__ = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v) };

const { PLANILHA_VIRTUAL_CREATE_STATEMENTS, itemFila, gravarIntervalo } = await import(R + "services/planilhaVirtualD1.ts");
const { estadoAba, definirEstadoAba, lerD1, PLANILHA_PRINCIPAL_ID: P } = await import(R + "services/porteiroD1.ts");
const A = await import(R + "controllers/adminD1PrimeiroController.ts");
const db = () => (globalThis as any).__CATALOGO_DB__;

beforeEach(async () => {
  const sqlite = instalarFakeD1();
  for (const s of PLANILHA_VIRTUAL_CREATE_STATEMENTS) sqlite.exec(s);
  kv.clear();
  logs.length = 0;
  for (const aba of ["Music Videos", "Comentarios_MV", "VIDEOS_PENDENTES_EMPIRE_TV"]) await definirEstadoAba(aba, "off");
  planilha = {
    "Music Videos": [["ID do usuário", "Título do tópico", "ID da mensagem", "x", "y", "z", "g", "h", "i", "j", "fonte", "ID da mensagem"], [], ["1", "Alexxa - love castlevania", "", "", "", "t1"]],
  };
  formulas = {};
});

test("carga copia a aba exata (cabeçalho duplicado, linha vazia no meio) e liga", async () => {
  const r = await A.carregarAba("Music Videos", { esperaMs: 0 });
  expect(r).toEqual({ ok: true, linhas: 3 });
  expect(await estadoAba(P, "Music Videos")).toBe("on");
  expect(await lerD1(P, "Music Videos")).toEqual(planilha["Music Videos"]);
});

test("aba que não existe na planilha carrega vazia e liga", async () => {
  const r = await A.carregarAba("VIDEOS_PENDENTES_EMPIRE_TV", { esperaMs: 0 });
  expect(r).toEqual({ ok: true, linhas: 0 });
  expect(await estadoAba(P, "VIDEOS_PENDENTES_EMPIRE_TV")).toBe("on");
});

test("aba com fórmula não é ligada", async () => {
  formulas["Music Videos"] = [["ID do usuário"], [], ["1", '=ARRAYFORMULA(B2:B&"x")']];
  const r = await A.carregarAba("Music Videos", { esperaMs: 0 });
  expect(r).toMatchObject({ ok: false, motivo: "formula", celulas: ["B3"] });
  expect(await estadoAba(P, "Music Videos")).toBe("off");
});

test("carga recusada com fila pendente da aba", async () => {
  await db().batch([itemFila(P, "Music Videos", "update", "A1", [["x"]])]);
  const r = await A.carregarAba("Music Videos", { esperaMs: 0 });
  expect(r).toMatchObject({ ok: false, motivo: "fila-pendente" });
  expect(await estadoAba(P, "Music Videos")).toBe("off");
});

test("desligar recusado com fila pendente; aceito com fila vazia", async () => {
  await A.carregarAba("Music Videos", { esperaMs: 0 });
  await db().batch([itemFila(P, "Music Videos", "update", "A1", [["x"]])]);
  expect(await A.desligarAba("Music Videos")).toEqual({ ok: false, motivo: "fila-pendente", pendentes: 1 });
  await db().prepare("DELETE FROM fila_backup_planilha").run();
  expect(await A.desligarAba("Music Videos")).toEqual({ ok: true });
  expect(await estadoAba(P, "Music Videos")).toBe("off");
});

test("integridade acusa diferença e não altera o D1", async () => {
  await A.carregarAba("Music Videos", { esperaMs: 0 });
  await db().batch(await gravarIntervalo(P, "Music Videos", "B3", [["editado no D1"]]));
  logs.length = 0;
  const r = await A.verificarIntegridade();
  expect(r).toEqual([{ aba: "Music Videos", ok: false, diferentes: [3] }]);
  expect((await lerD1(P, "Music Videos", "B3"))[0][0]).toBe("editado no D1");
  expect(logs.length).toBe(1);
  expect(logs[0]).toContain("NÃO foi alterado");
});

test("status lista as 3 abas", async () => {
  await A.carregarAba("Music Videos", { esperaMs: 0 });
  const s = await A.statusAbas();
  expect(s.map((x: any) => [x.aba, x.estado, x.linhasD1, x.pendentesFila])).toEqual([
    ["Music Videos", "on", 2, 0],
    ["Comentarios_MV", "off", 0, 0],
    ["VIDEOS_PENDENTES_EMPIRE_TV", "off", 0, 0],
  ]);
});
