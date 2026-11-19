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

const { PLANILHA_VIRTUAL_CREATE_STATEMENTS } = await import(R + "services/planilhaVirtualD1.ts");
const { definirEstadoAba, estadoAba } = await import(R + "services/porteiroD1.ts");
const G = await import(R + "services/googleSheetsService.ts");

async function contarFila(aba: string): Promise<number> {
  const r = await (globalThis as any).__CATALOGO_DB__
    .prepare("SELECT count(*) AS n FROM fila_backup_planilha WHERE aba = ?").bind(aba).first();
  return r.n;
}

beforeEach(async () => {
  const sqlite = instalarFakeD1();
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

test("carregando: gravação recusada com mensagem amigável", async () => {
  await definirEstadoAba("Comentarios_MV", "carregando");
  expect(await estadoAba("1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo", "Comentarios_MV")).toBe("carregando");
  await expect(G.appendRows("principal", "Comentarios_MV", [["z"]])).rejects.toThrow("manutenção");
  expect(await G.appendRow("principal", "Comentarios_MV", ["z"])).toBeNull();
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

test("aba fora da lista nunca consulta o KV", async () => {
  kv.set("d1primeiro:Social", "on");
  expect(await estadoAba("1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo", "Social")).toBe("off");
});
