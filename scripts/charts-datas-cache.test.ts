import { test, expect } from "bun:test";
// Lista de datas de cada chart guardada pronta em chart_config ("datas:<CHART>"):
// a leitura vira 1 linha em vez de varrer chart_datas a cada tela.
// Spec: docs/superpowers/specs/2026-11-26-d1-rows-read-reducao-design.md
// Uso: bun test scripts/charts-datas-cache.test.ts
import { criarD1Sqlite } from "./charts-d1-sqlite";
import { CHARTS } from "../backend/src/services/chartsD1/tipos";
import { datasDoChart, garantirSchemaCharts, ingerirSemana } from "../backend/src/services/chartsD1/repo";

async function novoDb(log?: string[]) {
  const db = criarD1Sqlite(":memory:", log ? (sql) => log.push(sql) : undefined);
  await garantirSchemaCharts(db);
  return db;
}

const linhasFake = (dataBr: string): string[][] =>
  CHARTS.flatMap((chart) =>
    Array.from({ length: 3 }, (_, i) => [chart, dataBr, String(i + 1), `Artista ${i + 1} - Faixa ${i + 1}`, String(1000 - i), "", "", `Artista ${i + 1}`, "", "", "", ""]),
  );

test("datasDoChart: sem linha pronta, monta, grava e devolve igual à consulta antiga", async () => {
  const db = await novoDb();
  for (const d of ["2026-11-04", "2026-11-18", "2026-11-11"]) {
    await db.prepare("INSERT INTO chart_datas (chart, data) VALUES ('SPOTIFY', ?)").bind(d).run();
  }
  expect(await datasDoChart(db, "SPOTIFY")).toEqual(["18/11/2026", "11/11/2026", "04/11/2026"]);
  const r = await db.prepare("SELECT valor FROM chart_config WHERE chave = 'datas:SPOTIFY'").all<{ valor: string }>();
  expect(JSON.parse(r.results[0].valor)).toEqual(["2026-11-18", "2026-11-11", "2026-11-04"]);
});

test("datasDoChart: com linha pronta lê só ela (não consulta chart_datas)", async () => {
  const log: string[] = [];
  const db = await novoDb(log);
  await db.prepare("INSERT INTO chart_config (chave, valor) VALUES ('datas:SPOTIFY', ?)").bind(JSON.stringify(["2026-11-18"])).run();
  log.length = 0;
  expect(await datasDoChart(db, "SPOTIFY")).toEqual(["18/11/2026"]);
  expect(log.some((s) => s.includes("chart_datas"))).toBe(false);
});

test("ingerirSemana regrava a lista pronta no mesmo lote, sem duplicar no reenvio", async () => {
  const db = await novoDb();
  expect((await ingerirSemana(db, { linhas: linhasFake("18/11/2026") })).ok).toBe(true);
  expect(await datasDoChart(db, "SPOTIFY")).toEqual(["18/11/2026"]); // grava a linha pronta
  expect((await ingerirSemana(db, { linhas: linhasFake("25/11/2026") })).ok).toBe(true);
  expect((await ingerirSemana(db, { linhas: linhasFake("25/11/2026") })).ok).toBe(true);
  const r = await db.prepare("SELECT valor FROM chart_config WHERE chave = 'datas:SPOTIFY'").all<{ valor: string }>();
  const lista: string[] = JSON.parse(r.results[0].valor);
  expect(lista).toEqual(["2026-11-25", "2026-11-18"]);
  expect(await datasDoChart(db, "SPOTIFY")).toEqual(["25/11/2026", "18/11/2026"]);
});

test("chart sem nenhuma data: devolve []", async () => {
  const db = await novoDb();
  expect(await datasDoChart(db, "DIGITAL SALES")).toEqual([]);
});

test("mudança direta em chart_datas (fora da ingestão) mantém a lista pronta certa", async () => {
  const db = await novoDb();
  expect((await ingerirSemana(db, { linhas: linhasFake("18/11/2026") })).ok).toBe(true);
  expect((await ingerirSemana(db, { linhas: linhasFake("25/11/2026") })).ok).toBe(true);
  expect(await datasDoChart(db, "SPOTIFY")).toEqual(["25/11/2026", "18/11/2026"]);
  await db.prepare("DELETE FROM chart_datas WHERE chart = 'SPOTIFY' AND data = '2026-11-25'").run();
  expect(await datasDoChart(db, "SPOTIFY")).toEqual(["18/11/2026"]);
  await db.prepare("DELETE FROM chart_datas WHERE chart = 'SPOTIFY'").run();
  expect(await datasDoChart(db, "SPOTIFY")).toEqual([]);
});

test("banco sem tabelas dos charts: devolve [] sem erro", async () => {
  expect(await datasDoChart(criarD1Sqlite(), "SPOTIFY")).toEqual([]);
});
