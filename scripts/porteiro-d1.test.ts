import { test, expect, beforeEach, mock } from "bun:test";
import { instalarFakeD1 } from "./helpers/fakeD1";

const R = new URL("../backend/src/", import.meta.url).pathname;
mock.module(R + "google/service-account.ts", () => ({
  getGoogleAccessToken: async () => "tok",
  getDriveOAuthAccessToken: async () => "tok",
  readRuntimeEnv: () => "",
}));
mock.module(R + "services/logSistemaService.ts", () => ({
  registrarLogSistema: async () => {},
  traduzirErroEscrita: () => ({ causaProvavel: "", comoResolver: "" }),
}));

let googleCalls: string[] = [];
(globalThis as any).fetch = async (url: string) => {
  googleCalls.push(String(url));
  return new Response(JSON.stringify({ values: [["x"]], updates: { updatedRange: "'Social'!A2:A2" } }), { status: 200 });
};
const kv = new Map<string, string>();
(globalThis as any).__FLAGS_KV__ = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v) };
let sqliteAtual: any;

const { PLANILHA_VIRTUAL_CREATE_STATEMENTS } = await import(R + "services/planilhaVirtualD1.ts");
const { definirEstadoAba, estadoAba, limparCacheEstado } = await import(R + "services/porteiroD1.ts");
const G = await import(R + "services/googleSheetsService.ts");

async function contarFila(aba: string): Promise<number> {
  const r = await (globalThis as any).__CATALOGO_DB__
    .prepare("SELECT count(*) AS n FROM fila_backup_planilha WHERE aba = ?").bind(aba).first();
  return r.n;
}

beforeEach(async () => {
  const sqlite = instalarFakeD1();
  sqliteAtual = sqlite;
  for (const s of PLANILHA_VIRTUAL_CREATE_STATEMENTS) sqlite.exec(s);
  // tabelas tipadas do espelho de vídeos não existem aqui: o espelho falha em silêncio (já é o contrato dele)
  kv.clear();
  googleCalls = [];
  for (const aba of ["Music Videos", "Comentarios_MV", "VIDEOS_PENDENTES_EMPIRE_TV"]) await definirEstadoAba(aba, "off");
});

test("aba ligada: gravação e leitura só no D1, zero chamadas ao Google", async () => {
  await definirEstadoAba("Music Videos", "on");
  expect(await G.updateValues("principal", "Music Videos", "A1:B1", [["h1", "h2"]])).toBe(true);
  const linha = await G.appendRow("principal", "Music Videos", ["x", "y"]);
  expect(linha).toBe(2);
  expect(await G.readValues("principal", "Music Videos")).toEqual([["h1", "h2"], ["x", "y"]]);
  expect(await G.readValuesFresh("principal", "Music Videos", "A2:B2")).toEqual([["x", "y"]]);
  expect(googleCalls.filter((u) => u.includes("sheets.googleapis.com"))).toEqual([]);
  expect(await contarFila("Music Videos")).toBe(2);
});

test("append guarda na fila o intervalo exato da linha", async () => {
  await definirEstadoAba("Comentarios_MV", "on");
  await G.updateValues("principal", "Comentarios_MV", "A1:C1", [["a", "b", "c"]]);
  await G.appendRow("principal", "Comentarios_MV", ["1", "2", "3"]);
  const r = await (globalThis as any).__CATALOGO_DB__
    .prepare("SELECT operacao, intervalo FROM fila_backup_planilha ORDER BY id DESC LIMIT 1").first();
  expect(r).toEqual({ operacao: "append", intervalo: "A2:C2" });
});

test("aba desligada: comportamento antigo (vai ao Google)", async () => {
  await G.readValues("principal", "Social", "A1:A2");
  expect(googleCalls.some((u) => u.includes("sheets.googleapis.com"))).toBe(true);
});

test("ensureSheetTab de aba ligada não chama o Google", async () => {
  await definirEstadoAba("VIDEOS_PENDENTES_EMPIRE_TV", "on");
  await G.ensureSheetTab("principal", "VIDEOS_PENDENTES_EMPIRE_TV");
  expect(googleCalls).toEqual([]);
});

test("D1 indisponível com aba ligada: leitura lança, sem Google", async () => {
  await definirEstadoAba("Music Videos", "on");
  delete (globalThis as any).__CATALOGO_DB__;
  await expect(G.readValues("principal", "Music Videos")).rejects.toThrow();
  expect(googleCalls).toEqual([]);
});

test("dois appendRow em paralelo ganham linhas diferentes", async () => {
  await definirEstadoAba("Comentarios_MV", "on");
  const [a, b] = await Promise.all([
    G.appendRow("principal", "Comentarios_MV", ["c1"]),
    G.appendRow("principal", "Comentarios_MV", ["c2"]),
  ]);
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(a).not.toBe(b);
  expect((await G.readValues("principal", "Comentarios_MV")).length).toBe(2);
});

test("I1: carregando/pausado — toda gravação LANÇA (nunca finge sucesso)", async () => {
  for (const estado of ["carregando", "pausado"] as const) {
    await definirEstadoAba("Comentarios_MV", estado);
    expect(await estadoAba("1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo", "Comentarios_MV")).toBe(estado);
    await expect(G.appendRows("principal", "Comentarios_MV", [["z"]])).rejects.toThrow("manutenção");
    await expect(G.appendRow("principal", "Comentarios_MV", ["z"])).rejects.toThrow("manutenção");
    await expect(G.updateValues("principal", "Comentarios_MV", "A1", [["z"]])).rejects.toThrow("manutenção");
    await expect(G.clearValues("principal", "Comentarios_MV", "A1")).rejects.toThrow("manutenção");
    await expect(G.updateValuesBatch("principal", [{ sheetName: "Comentarios_MV", range: "A1", values: [["z"]] }])).rejects.toThrow("manutenção");
  }
  expect(googleCalls).toEqual([]);
});

test("pausado: leitura continua no D1", async () => {
  await definirEstadoAba("Music Videos", "on");
  await G.updateValues("principal", "Music Videos", "A1", [["d1"]]);
  await definirEstadoAba("Music Videos", "pausado");
  expect(await G.readValues("principal", "Music Videos")).toEqual([["d1"]]);
  expect(googleCalls).toEqual([]);
});

test("I1: falha do D1 numa gravação de aba ligada LANÇA", async () => {
  await definirEstadoAba("Music Videos", "on");
  const db = (globalThis as any).__CATALOGO_DB__;
  const batchOriginal = db.batch;
  db.batch = async () => { throw new Error("D1 fora do ar"); };
  await expect(G.updateValues("principal", "Music Videos", "A1", [["x"]])).rejects.toThrow("D1 fora do ar");
  await expect(G.appendRow("principal", "Music Videos", ["x"])).rejects.toThrow("D1 fora do ar");
  db.batch = batchOriginal;
});

test("C1: duas gravações simultâneas em células diferentes da mesma linha — as duas ficam", async () => {
  await definirEstadoAba("Music Videos", "on");
  await G.updateValues("principal", "Music Videos", "A2:C2", [["a", "b", "c"]]);
  await Promise.all([
    G.updateValues("principal", "Music Videos", "A2", [["likes"]]),
    G.updateValues("principal", "Music Videos", "C2", [["reportado"]]),
  ]);
  expect(await G.readValues("principal", "Music Videos", "A2:C2")).toEqual([["likes", "b", "reportado"]]);
});

test("C2: estado vem do D1 (não do KV) e expira: carregando velho volta a 'off', pausado velho volta a 'on'", async () => {
  kv.set("d1primeiro:Music Videos", "on"); // KV não manda mais em nada
  expect(await estadoAba("1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo", "Music Videos")).toBe("off");
  await definirEstadoAba("Music Videos", "carregando");
  await definirEstadoAba("Comentarios_MV", "pausado");
  sqliteAtual.exec("UPDATE catalogo_estado_aba SET atualizado_em_ms = atualizado_em_ms - 6 * 60 * 1000");
  limparCacheEstado();
  expect(await estadoAba("1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo", "Music Videos")).toBe("off");
  expect(await estadoAba("1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo", "Comentarios_MV")).toBe("on");
});

test("C2: sem D1 e sem estado conhecido, aba do porteiro não cai para a planilha", async () => {
  limparCacheEstado();
  delete (globalThis as any).__CATALOGO_DB__;
  await expect(G.readValues("principal", "Comentarios_MV")).rejects.toThrow();
  await expect(G.appendRow("principal", "Comentarios_MV", ["x"])).rejects.toThrow();
  expect(googleCalls).toEqual([]);
});

test("I2: tabelas são criadas sozinhas num D1 vazio", async () => {
  instalarFakeD1(); // banco novo, sem nenhuma tabela
  await definirEstadoAba("Comentarios_MV", "on");
  expect(await G.appendRow("principal", "Comentarios_MV", ["x"])).toBe(1);
});

test("updateValuesBatch misto separa D1 e Google", async () => {
  await definirEstadoAba("Music Videos", "on");
  expect(
    await G.updateValuesBatch("principal", [
      { sheetName: "Music Videos", range: "A1", values: [["v"]] },
      { sheetName: "Social", range: "A1", values: [["s"]] },
    ]),
  ).toBe(true);
  expect(await contarFila("Music Videos")).toBe(1);
  expect(googleCalls.filter((u) => u.includes("values:batchUpdate")).length).toBe(1);
});

test("deleteRows e clearValues em aba ligada mexem só no D1 e vão para a fila", async () => {
  await definirEstadoAba("Comentarios_MV", "on");
  await G.updateValues("principal", "Comentarios_MV", "A1:B3", [["h", "x"], ["1", "y"], ["2", "z"]]);
  await G.deleteRows("principal", "Comentarios_MV", [2]);
  expect(await G.clearValues("principal", "Comentarios_MV", "B1:B2")).toBe(true);
  expect(await G.readValues("principal", "Comentarios_MV")).toEqual([["h"], ["2"]]);
  expect(googleCalls).toEqual([]);
  expect(await contarFila("Comentarios_MV")).toBe(3);
});

test("aba fora da lista é sempre 'off', sem consultar nada", async () => {
  delete (globalThis as any).__CATALOGO_DB__;
  expect(await estadoAba("1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo", "Social")).toBe("off");
});
