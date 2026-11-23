import { test, expect, beforeEach } from "bun:test";
import { instalarFakeD1 } from "./helpers/fakeD1";
// Tabelas D1 dos passos de lançamento do pre-save (presaveLancamentoDb.ts).
// Uso: bun test scripts/presave-lancamento-db.test.ts
const DB = await import("../backend/src/services/presaveLancamentoDb.ts");

const L = { campanhaId: "PRESAVE-1", albumTitulo: "Jessica Johnson - Bad Behavior", albumTopicId: "album_1" };
const PASSOS = [
  { passo: "album", ordem: 1, procurarAntes: false },
  { passo: "faixa:1:musicas", ordem: 2, procurarAntes: false },
];

beforeEach(() => {
  instalarFakeD1();
  DB.__resetTabelasGarantidas();
});

test("criarLancamento é idempotente", async () => {
  expect(await DB.criarLancamento(L, PASSOS)).toBe(true);
  expect(await DB.criarLancamento(L, [{ passo: "outro", ordem: 1, procurarAntes: false }])).toBe(false);
  const ps = await DB.listarPassos("PRESAVE-1");
  expect(ps.map((p) => p.passo)).toEqual(["album", "faixa:1:musicas"]);
  expect(ps[0].estado).toBe("pendente");
});

test("registrarFalha 5x → falhou; 6ª → travado, e procurarAntes vira true", async () => {
  await DB.criarLancamento(L, PASSOS);
  for (let i = 1; i <= 5; i++) expect(await DB.registrarFalha("PRESAVE-1", "album", `erro ${i}`)).toBe("falhou");
  expect(await DB.registrarFalha("PRESAVE-1", "album", "erro 6")).toBe("travado");
  const [album] = await DB.listarPassos("PRESAVE-1");
  expect(album.tentativas).toBe(DB.MAX_TENTATIVAS);
  expect(album.procurarAntes).toBe(true);
  expect(album.ultimoErro).toBe("erro 6");
});

test("marcarFeito guarda resultado", async () => {
  await DB.criarLancamento(L, PASSOS);
  await DB.marcarFeito("PRESAVE-1", "album", { linha: 899 });
  const [album] = await DB.listarPassos("PRESAVE-1");
  expect(album.estado).toBe("feito");
  expect(album.resultado).toEqual({ linha: 899 });
});

test("passo pode nascer feito com resultado", async () => {
  await DB.criarLancamento(L, [{ passo: "album", ordem: 1, procurarAntes: true, estado: "feito", resultado: { codigoUnicoAlbum: "EMPALBM098" } }]);
  const [album] = await DB.listarPassos("PRESAVE-1");
  expect(album.estado).toBe("feito");
  expect(album.resultado).toEqual({ codigoUnicoAlbum: "EMPALBM098" });
});

test("lancamentosIncompletos só lista completo=0", async () => {
  await DB.criarLancamento(L, PASSOS);
  await DB.criarLancamento({ ...L, campanhaId: "PRESAVE-2" }, PASSOS);
  await DB.marcarCompleto("PRESAVE-2");
  const inc = await DB.lancamentosIncompletos();
  expect(inc.map((l) => l.campanhaId)).toEqual(["PRESAVE-1"]);
  expect(inc[0].albumTopicId).toBe("album_1");
});

test("lancamentoEmAndamentoPorAlbum ignora acento/caixa", async () => {
  await DB.criarLancamento(L, PASSOS);
  expect(await DB.lancamentoEmAndamentoPorAlbum("jessica johnson - bad behavior")).toBe("PRESAVE-1");
  expect(await DB.lancamentoEmAndamentoPorAlbum("Outro Álbum")).toBe(null);
  await DB.marcarCompleto("PRESAVE-1");
  expect(await DB.lancamentoEmAndamentoPorAlbum("Jessica Johnson - Bad Behavior")).toBe(null);
});

test("reabrirPassos volta travado para pendente com procurarAntes=true e tentativas=0", async () => {
  await DB.criarLancamento(L, PASSOS);
  for (let i = 0; i < 6; i++) await DB.registrarFalha("PRESAVE-1", "album", "x");
  await DB.marcarCompleto("PRESAVE-1");
  expect(await DB.reabrirPassos("PRESAVE-1")).toBe(1);
  const [album] = await DB.listarPassos("PRESAVE-1");
  expect(album.estado).toBe("pendente");
  expect(album.tentativas).toBe(0);
  expect(album.procurarAntes).toBe(true);
  expect((await DB.lancamentosIncompletos()).length).toBe(1);
});
