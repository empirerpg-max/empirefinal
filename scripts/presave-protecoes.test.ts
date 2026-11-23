import { test, expect } from "bun:test";
import { instalarFakeD1 } from "./helpers/fakeD1";
// Gestão não grava faixa em álbum de pre-save com lançamento em andamento.
// Uso: bun test scripts/presave-protecoes.test.ts
instalarFakeD1();
const P = await import("../backend/src/controllers/presaveLancamento/protecoes.ts");
const DB = await import("../backend/src/services/presaveLancamentoDb.ts");

await DB.criarLancamento(
  { campanhaId: "PRESAVE-x", albumTitulo: "Jessica Johnson - Bad Behavior", albumTopicId: "album_x" },
  [{ passo: "album", ordem: 1, procurarAntes: false }],
);

test("album com lançamento incompleto bloqueia", async () => {
  expect(await P.bloqueioPresave("jessica johnson - bad behavior")).toBe(P.MENSAGEM_ALBUM_EM_ANDAMENTO);
});

test("album sem pre-save não bloqueia", async () => {
  expect(await P.bloqueioPresave("Outra Artista - Outro Álbum")).toBe(null);
  expect(await P.bloqueioPresave("")).toBe(null);
});

test("album completo não bloqueia", async () => {
  await DB.marcarCompleto("PRESAVE-x");
  expect(await P.bloqueioPresave("Jessica Johnson - Bad Behavior")).toBe(null);
});
