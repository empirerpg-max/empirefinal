import { test, expect, beforeEach } from "bun:test";
import { instalarFakeD1 } from "./helpers/fakeD1";
import {
  PLANILHA_VIRTUAL_CREATE_STATEMENTS,
  parseA1,
  lerIntervalo,
  gravarIntervalo,
  proximaLinhaAppend,
  removerLinhas,
  limparIntervalo,
  substituirAba,
  itemFila,
} from "../backend/src/services/planilhaVirtualD1";

let db: any;
beforeEach(() => {
  const sqlite = instalarFakeD1();
  for (const s of PLANILHA_VIRTUAL_CREATE_STATEMENTS) sqlite.exec(s);
  db = (globalThis as any).__CATALOGO_DB__;
});

test("parseA1", () => {
  expect(parseA1("A:ZZ")).toEqual({ c1: 0, r1: 1, c2: 701, r2: null });
  expect(parseA1("A2:A20000")).toEqual({ c1: 0, r1: 2, c2: 0, r2: 20000 });
  expect(parseA1("F5")).toEqual({ c1: 5, r1: 5, c2: 5, r2: 5 });
  expect(parseA1("A1:I1")).toEqual({ c1: 0, r1: 1, c2: 8, r2: 1 });
});

test("gravar e ler devolve aparado como o Sheets", async () => {
  await db.batch(await gravarIntervalo("p", "Aba", "A1:C3", [["a", "", ""], ["", "", ""], ["x", "y", ""]]));
  expect(await lerIntervalo("p", "Aba", "A:ZZ")).toEqual([["a"], [], ["x", "y"]]);
  expect(await lerIntervalo("p", "Aba", "B3:C3")).toEqual([["y"]]);
  expect(await lerIntervalo("p", "Aba", "A5:C9")).toEqual([]);
});

test("intervalo que começa no meio devolve a partir da primeira linha pedida", async () => {
  await db.batch(await substituirAba("p", "M", [["h"], [], ["a", "b"]]));
  expect(await lerIntervalo("p", "M", "A2:B3")).toEqual([[], ["a", "b"]]);
});

test("valor gravado volta literal (sem reformatar)", async () => {
  await db.batch(await gravarIntervalo("p", "Aba", "A1:C1", [["2026-11-18", "0123", 95]]));
  expect(await lerIntervalo("p", "Aba", "A1:C1")).toEqual([["2026-11-18", "0123", "95"]]);
});

test("append cai depois da última linha com QUALQUER célula", async () => {
  await db.batch(await gravarIntervalo("p", "MV", "A1:B2", [["h1", "h2"], ["v", ""]]));
  await db.batch(await gravarIntervalo("p", "MV", "T7", [["thumb-padrao"]]));
  expect(await proximaLinhaAppend("p", "MV")).toBe(8);
});

test("removerLinhas desloca as de baixo", async () => {
  await db.batch(await substituirAba("p", "R", [["h"], ["1"], ["2"], ["3"]]));
  await db.batch(await removerLinhas("p", "R", [2]));
  expect(await lerIntervalo("p", "R", "A:A")).toEqual([["h"], ["2"], ["3"]]);
  await db.batch(await removerLinhas("p", "R", [1, 3]));
  expect(await lerIntervalo("p", "R", "A:A")).toEqual([["2"]]);
});

test("gravação parcial preserva as outras células da linha", async () => {
  await db.batch(await substituirAba("p", "S", [["a", "b", "c"]]));
  await db.batch(await gravarIntervalo("p", "S", "B1", [["X"]]));
  expect(await lerIntervalo("p", "S", "A1:C1")).toEqual([["a", "X", "c"]]);
});

test("limparIntervalo esvazia só as células pedidas", async () => {
  await db.batch(await substituirAba("p", "L", [["a", "b", "c"], ["d"]]));
  await db.batch(await limparIntervalo("p", "L", "B1:C2"));
  expect(await lerIntervalo("p", "L", "A:ZZ")).toEqual([["a"], ["d"]]);
});

test("itemFila entra na fila", async () => {
  await db.batch([itemFila("p", "MV", "update", "A2:B2", [["x", "y"]])]);
  const r = await db.prepare("SELECT aba, operacao, intervalo, valores_json FROM fila_backup_planilha").all();
  expect(r.results).toEqual([{ aba: "MV", operacao: "update", intervalo: "A2:B2", valores_json: '[["x","y"]]' }]);
});
