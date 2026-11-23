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

// Planilha real falsa: abas existentes (com nº de linhas da grade) e conteúdo.
let abas: Record<string, { sheetId: number; rowCount: number; valores: string[][] }> = {};
type Chamada = { url: string; body: any };
let chamadas: Chamada[] = [];
let sobrescrever: ((url: string, body: any) => Response | null) | null = null;
const ok = (x: unknown = {}) => new Response(JSON.stringify(x), { status: 200 });
(globalThis as any).fetch = async (url: string, init: any) => {
  const body = init?.body ? JSON.parse(init.body) : null;
  const u = decodeURIComponent(String(url));
  chamadas.push({ url: u, body });
  const forcado = sobrescrever?.(u, body);
  if (forcado) return forcado;
  const nova = body?.requests?.[0]?.addSheet?.properties?.title;
  if (nova) abas[nova] = { sheetId: 99, rowCount: 1000, valores: [] };
  if (u.includes("?fields=sheets")) {
    return ok({ sheets: Object.entries(abas).map(([title, a]) => ({ properties: { title, sheetId: a.sheetId, gridProperties: { rowCount: a.rowCount } } })) });
  }
  const leitura = u.match(/values\/'([^']+)'!A:ZZ\?/);
  if (leitura) return ok({ values: abas[leitura[1]]?.valores ?? [] });
  return ok();
};

const { PLANILHA_VIRTUAL_CREATE_STATEMENTS, itemFila } = await import(R + "services/planilhaVirtualD1.ts");
const { garantirTabelas } = await import(R + "services/porteiroD1.ts");
const { despacharFila, statusFila } = await import(R + "services/despachanteFilaBackup.ts");
const P = "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo";
const db = () => (globalThis as any).__CATALOGO_DB__;
const pendentes = async () => (await db().prepare("SELECT id, tentativas, ultimo_erro FROM fila_backup_planilha ORDER BY id").all()).results;
const dadosGoogle = () => chamadas.filter((c) => !c.url.includes("?fields=sheets") && !/values\/'[^']+'!A:ZZ\?/.test(c.url));
const tipo = (c: Chamada) =>
  c.url.includes("values:batchUpdate") ? "lote" : c.url.endsWith(":clear") ? "clear" : c.body?.requests?.[0]?.deleteDimension ? "delete" : c.body?.requests?.[0]?.addSheet ? "addSheet" : c.body?.requests?.[0]?.appendDimension ? "appendDimension" : "?";

beforeEach(async () => {
  const sqlite = instalarFakeD1();
  for (const s of PLANILHA_VIRTUAL_CREATE_STATEMENTS) sqlite.exec(s);
  await garantirTabelas();
  chamadas = [];
  logs.length = 0;
  sobrescrever = null;
  abas = {
    "Music Videos": { sheetId: 7, rowCount: 1000, valores: [] },
    Comentarios_MV: { sheetId: 8, rowCount: 1000, valores: [] },
  };
});

test("updates seguidos da mesma aba viram um values:batchUpdate só, e a fila esvazia", async () => {
  await db().batch([itemFila(P, "Music Videos", "update", "A2:B2", [["a", "b"]]), itemFila(P, "Music Videos", "append", "A3:B3", [["c", "d"]])]);
  const r = await despacharFila();
  expect(r).toMatchObject({ gravados: 2, pendentes: 0, parouPorLimite: false });
  const lotes = dadosGoogle().filter((c) => tipo(c) === "lote");
  expect(lotes.length).toBe(1);
  expect(lotes[0].body.data.map((d: any) => d.range)).toEqual(["'Music Videos'!A2:B2", "'Music Videos'!A3:B3"]);
  expect(lotes[0].body.valueInputOption).toBe("USER_ENTERED");
  expect(await pendentes()).toEqual([]);
});

test("delete só é enviado depois dos itens anteriores e só apaga linhas iguais à foto", async () => {
  abas["Music Videos"].valores = [["h"], ["a"], ["c"], ["d"], ["e"]];
  await db().batch([
    itemFila(P, "Music Videos", "update", "A2", [["a"]]),
    itemFila(P, "Music Videos", "delete", null, [{ linha: 5, celulas: ["e"] }, { linha: 3, celulas: ["c"] }]),
    itemFila(P, "Music Videos", "update", "A4", [["z"]]),
  ]);
  await despacharFila();
  expect(dadosGoogle().map(tipo)).toEqual(["lote", "delete", "lote"]);
  const del = dadosGoogle().find((c) => tipo(c) === "delete")!;
  expect(del.body.requests.map((q: any) => q.deleteDimension.range.startIndex)).toEqual([4, 2]);
});

test("I4: delete repetido (linhas já não batem com a foto) não apaga nada", async () => {
  abas["Music Videos"].valores = [["h"], ["a"], ["d"]]; // linhas 3 e 5 já foram apagadas antes
  await db().batch([itemFila(P, "Music Videos", "delete", null, [{ linha: 5, celulas: ["e"] }, { linha: 3, celulas: ["c"] }])]);
  const r = await despacharFila();
  expect(r.gravados).toBe(1);
  expect(dadosGoogle().filter((c) => tipo(c) === "delete")).toEqual([]);
  expect(await pendentes()).toEqual([]);
});

test("I4: outra execução em andamento — esta não faz nada", async () => {
  await db().prepare("INSERT INTO despachante_lock (id, ate_ms) VALUES (1, ?)").bind(Date.now() + 60_000).run();
  await db().batch([itemFila(P, "Music Videos", "update", "A2", [["a"]])]);
  const r = await despacharFila();
  expect(r).toMatchObject({ gravados: 0, ocupado: true });
  expect(chamadas).toEqual([]);
  expect((await pendentes()).length).toBe(1);
});

test("I4: trava velha (execução que morreu) é retomada, e a trava é solta no fim", async () => {
  await db().prepare("INSERT INTO despachante_lock (id, ate_ms) VALUES (1, ?)").bind(Date.now() - 1).run();
  await db().batch([itemFila(P, "Music Videos", "update", "A2", [["a"]])]);
  expect((await despacharFila()).gravados).toBe(1);
  await db().batch([itemFila(P, "Music Videos", "update", "A3", [["b"]])]);
  expect((await despacharFila()).gravados).toBe(1);
});

test("I3: grade pequena é aumentada antes de gravar e aba que falta é criada", async () => {
  abas["Music Videos"].rowCount = 5;
  await db().batch([
    itemFila(P, "Music Videos", "append", "A10:B10", [["x", "y"]]),
    itemFila(P, "VIDEOS_PENDENTES_EMPIRE_TV", "update", "A1:B1", [["ID", "x"]]),
  ]);
  const r = await despacharFila();
  expect(r.erros).toEqual([]);
  const seq = dadosGoogle().map(tipo);
  expect(seq.indexOf("appendDimension")).toBeLessThan(seq.indexOf("lote"));
  expect(seq).toContain("addSheet");
  const app = dadosGoogle().find((c) => tipo(c) === "appendDimension")!;
  expect(app.body.requests[0].appendDimension.sheetId).toBe(7);
});

test("erro de cota para o despacho e mantém os itens", async () => {
  await db().batch([itemFila(P, "Music Videos", "update", "A2", [["a"]]), itemFila(P, "Comentarios_MV", "update", "A2", [["b"]])]);
  sobrescrever = () => new Response(JSON.stringify({ error: { message: "Quota exceeded for quota metric 'Write requests'" } }), { status: 429 });
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
  sobrescrever = (_u, body) =>
    body?.data?.[0]?.range?.startsWith("'Music Videos'") ? new Response(JSON.stringify({ error: { message: "Unable to parse range" } }), { status: 400 }) : null;
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
  expect(dadosGoogle().some((c) => c.url.includes("Comentarios_MV") && tipo(c) === "clear")).toBe(true);
  expect(await statusFila()).toEqual([]);
});

test("I2: D1 sem as tabelas novas — despachante e status funcionam", async () => {
  instalarFakeD1();
  expect(await despacharFila()).toMatchObject({ gravados: 0, pendentes: 0 });
  expect(await statusFila()).toEqual([]);
});
