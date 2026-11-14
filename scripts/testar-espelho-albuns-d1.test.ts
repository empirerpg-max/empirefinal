import { test, expect, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Espelho genérico dos álbuns (espelhoAbasD1.ts) num SQLite de verdade, com a
// planilha simulada a partir dos CSVs exportados.
// Uso: CSV_ALBUNS=... CSV_EXTRA=... CSV_COMENTARIOS=... bun test scripts/testar-espelho-albuns-d1.test.ts
const R = fileURLToPath(new URL("../backend/src/services/", import.meta.url));
function parseCsv(t: string): string[][] { const out: string[][] = []; let row: string[] = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i+1] === "\n") i++; row.push(f); out.push(row); row = []; f = ""; } else f += c; }
  if (f !== "" || row.length) { row.push(f); out.push(row); } return out; }
const trim = (rows: string[][]) => rows.map(r => { const c = [...r]; while (c.length && c[c.length-1] === "") c.pop(); return c; });
const sheets: Record<string, string[][]> = {
  Albuns: trim(parseCsv(readFileSync(process.env.CSV_ALBUNS!, "utf-8"))),
  Extra_Albuns: trim(parseCsv(readFileSync(process.env.CSV_EXTRA!, "utf-8"))),
  Comentarios_Albuns: trim(parseCsv(readFileSync(process.env.CSV_COMENTARIOS!, "utf-8"))),
};
const norm = (v: unknown) => String(v ?? "").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ");
mock.module(R + "googleSheetsService.ts", () => ({
  readValuesFresh: async (_k: string, aba: string) => sheets[aba].map(r => [...r]),
  normalizeText: (v: unknown) => String(v ?? "").trim(),
  normalizeComparison: norm,
}));
mock.module(R + "logSistemaService.ts", () => ({ registrarLogSistema: async () => {} }));
const sqlite = new Database(":memory:");
const prep = (sql: string, b: unknown[] = []): any => ({ bind: (...v: unknown[]) => prep(sql, v),
  run: async () => { sqlite.query(sql).run(...(b as never[])); return { results: [], success: true }; },
  all: async () => ({ results: sqlite.query(sql).all(...(b as never[])), success: true }) });
(globalThis as any).__CATALOGO_DB__ = { prepare: (s: string) => prep(s),
  batch: async (st: any[]) => { const out = []; sqlite.exec("BEGIN"); try { for (const s of st) out.push(await s.run()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return out; } };
const E = await import(R + "espelhoAbasD1.ts");
for (const s of E.ESPELHO_CREATE_STATEMENTS) sqlite.exec(s);

test("carga inicial: as 3 abas idênticas, linha a linha (inclusive cabeçalho, coluna sem título e linha em branco)", async () => {
  for (const aba of E.ABAS_ALBUM) {
    expect((await E.sincronizarAba(aba)).ok).toBe(true);
    const rel = await E.validarAba(aba);
    expect(rel.ok).toBe(true);
    expect(rel.linhasD1).toBe(sheets[aba].length);
    expect(await E.linhasDaAbaD1(aba)).toEqual(sheets[aba]);
  }
  expect(sheets.Albuns.length).toBe(107);
  expect(sheets.Comentarios_Albuns.length).toBe(188);
});
test("edição, inserção e exclusão de linha: validação acusa e a ressincronização corrige", async () => {
  sheets.Comentarios_Albuns[5] = [...sheets.Comentarios_Albuns[5]]; sheets.Comentarios_Albuns[5][3] += " (editado)";
  sheets.Comentarios_Albuns.push(["album_x", "1", "Teste", "novo", "14/11/2026"]);
  sheets.Albuns.splice(10, 1);
  const a = await E.validarAba("Comentarios_Albuns"); const b = await E.validarAba("Albuns");
  expect(a.diferentes).toEqual([6]); expect(a.faltandoNoD1).toEqual([189]); expect(b.ok).toBe(false);
  const r = await E.reconciliarAbasEspelho();
  expect(r.filter(x => !x.ok).map(x => x.aba).sort()).toEqual(["Albuns", "Comentarios_Albuns"]);
  for (const aba of E.ABAS_ALBUM) expect((await E.validarAba(aba)).ok).toBe(true);
});
test("planilha vazia (falha de leitura) nunca apaga o D1", async () => {
  const antes = sheets.Extra_Albuns; sheets.Extra_Albuns = [];
  expect((await E.sincronizarAba("Extra_Albuns")).ok).toBe(false);
  sheets.Extra_Albuns = antes;
  expect((await E.validarAba("Extra_Albuns")).ok).toBe(true);
});
test("busca por tópico e por chave", async () => {
  const c = await E.linhasPorBuscaD1("Comentarios_Albuns", [norm("42")]);
  expect(c!.slice(1).filter(r => r.length).length).toBe(sheets.Comentarios_Albuns.filter(r => r[0] === "42").length);
  const a = await E.linhasPorChaveD1("Albuns", ["album_1792551638543_utb9mi"]);
  expect(a!.filter(r => r.length).length).toBe(2);
  expect(a![0]).toEqual(sheets.Albuns[0]);
});
