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

type Chamada = { url: string; body: any };
let chamadas: Chamada[] = [];
let responder: (url: string, body: any) => Response = () => new Response("{}", { status: 200 });
(globalThis as any).fetch = async (url: string, init: any) => {
  const body = init?.body ? JSON.parse(init.body) : null;
  chamadas.push({ url: String(url), body });
  return responder(String(url), body);
};
(globalThis as any).__FLAGS_KV__ = { get: async () => null, put: async () => {} };

const { PLANILHA_VIRTUAL_CREATE_STATEMENTS, itemFila } = await import(R + "services/planilhaVirtualD1.ts");
const { despacharFila, statusFila } = await import(R + "services/despachanteFilaBackup.ts");
const P = "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo";
const db = () => (globalThis as any).__CATALOGO_DB__;
const pendentes = async () => (await db().prepare("SELECT id, tentativas, ultimo_erro FROM fila_backup_planilha ORDER BY id").all()).results;

beforeEach(() => {
  const sqlite = instalarFakeD1();
  for (const s of PLANILHA_VIRTUAL_CREATE_STATEMENTS) sqlite.exec(s);
  chamadas = [];
  logs.length = 0;
  responder = (url) =>
    url.includes("fields=sheets")
      ? new Response(JSON.stringify({ sheets: [{ properties: { title: "Music Videos", sheetId: 7 } }] }), { status: 200 })
      : new Response("{}", { status: 200 });
});

test("updates seguidos da mesma aba viram um values:batchUpdate só, e a fila esvazia", async () => {
  await db().batch([
    itemFila(P, "Music Videos", "update", "A2:B2", [["a", "b"]]),
    itemFila(P, "Music Videos", "append", "A3:B3", [["c", "d"]]),
  ]);
  const r = await despacharFila();
  expect(r).toMatchObject({ gravados: 2, pendentes: 0, parouPorLimite: false });
  const lotes = chamadas.filter((c) => c.url.includes("values:batchUpdate"));
  expect(lotes.length).toBe(1);
  expect(lotes[0].body.data.map((d: any) => d.range)).toEqual(["'Music Videos'!A2:B2", "'Music Videos'!A3:B3"]);
  expect(lotes[0].body.valueInputOption).toBe("USER_ENTERED");
  expect(await pendentes()).toEqual([]);
});

test("delete só é enviado depois dos itens anteriores da mesma aba", async () => {
  await db().batch([
    itemFila(P, "Music Videos", "update", "A2", [["a"]]),
    itemFila(P, "Music Videos", "delete", null, [5, 3]),
    itemFila(P, "Music Videos", "update", "A4", [["z"]]),
  ]);
  await despacharFila();
  const ordem = chamadas.filter((c) => !c.url.includes("fields=sheets")).map((c) => (c.url.includes("values:batchUpdate") ? "lote" : c.url.includes(":batchUpdate") ? "delete" : "?"));
  expect(ordem).toEqual(["lote", "delete", "lote"]);
  const del = chamadas.find((c) => c.url.endsWith(":batchUpdate") && !c.url.includes("values"))!;
  expect(del.body.requests.map((q: any) => q.deleteDimension.range.startIndex)).toEqual([4, 2]);
});

test("erro de cota para o despacho e mantém os itens", async () => {
  await db().batch([itemFila(P, "Music Videos", "update", "A2", [["a"]]), itemFila(P, "Comentarios_MV", "update", "A2", [["b"]])]);
  responder = () => new Response(JSON.stringify({ error: { message: "Quota exceeded for quota metric 'Write requests'" } }), { status: 429 });
  const r = await despacharFila();
  expect(r.parouPorLimite).toBe(true);
  expect(r.gravados).toBe(0);
  expect(chamadas.length).toBe(1);
  const p = await pendentes();
  expect(p.length).toBe(2);
  expect(p[0].tentativas).toBe(1);
});

test("erro permanente fica registrado no item e não bloqueia outras abas", async () => {
  await db().batch([itemFila(P, "Music Videos", "update", "A2", [["a"]]), itemFila(P, "Comentarios_MV", "update", "A2", [["b"]])]);
  responder = (_u, body) =>
    body?.data?.[0]?.range?.startsWith("'Music Videos'")
      ? new Response(JSON.stringify({ error: { message: "Unable to parse range" } }), { status: 400 })
      : new Response("{}", { status: 200 });
  const r = await despacharFila();
  expect(r.gravados).toBe(1);
  expect(r.erros.length).toBe(1);
  const p = await pendentes();
  expect(p.length).toBe(1);
  expect(p[0].ultimo_erro).toContain("Unable to parse range");
  expect(logs.length).toBe(1);
});

test("clear vai para values:clear e statusFila conta pendentes por aba", async () => {
  await db().batch([itemFila(P, "Comentarios_MV", "clear", "B1:B2", null), itemFila(P, "Music Videos", "update", "A1", [["x"]])]);
  expect(await statusFila()).toEqual([
    { aba: "Comentarios_MV", pendentes: 1, maisAntigo: expect.any(String) },
    { aba: "Music Videos", pendentes: 1, maisAntigo: expect.any(String) },
  ]);
  await despacharFila();
  expect(chamadas.some((c) => c.url.includes("Comentarios_MV") && c.url.endsWith(":clear"))).toBe(true);
  expect(await statusFila()).toEqual([]);
});
