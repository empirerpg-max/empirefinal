import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { instalarFakeD1 } from "./helpers/fakeD1";
import { FakePlanilhas } from "./helpers/fakePlanilhas";
// Relançamento admin pelo motor (modo reconciliação) e status do lançamento.
// Uso: bun test scripts/presave-admin.test.ts
instalarFakeD1();
const A = await import("../backend/src/controllers/adminRelancarFaixasFaltantesPreSaveController.ts");
const DB = await import("../backend/src/services/presaveLancamentoDb.ts");

const ALBUM = "Jessica Johnson - Bad Behavior";
const TOPICO_REAL = "album_1795316437054_p0xpik"; // diferente do reservado na campanha (fluxo antigo)
let seq = 0;

/** Planilhas como estão HOJE para a Jessica: tudo gravado, campanha "lancada". */
function cenarioJessicaCompleta(opts: { faltando?: number[] } = {}) {
  const id = `PRESAVE-a${++seq}`;
  const c = JSON.parse(readFileSync(new URL("./fixtures/presave-jessica.json", import.meta.url), "utf8"));
  c.id = id; c.status = "lancada"; c.codigoUnicoAlbum = "EMPALBM098";
  const f = new FakePlanilhas();
  const albuns = f.aba("principal", "Albuns");
  albuns.push(["22/11/2026", TOPICO_REAL, "capa", TOPICO_REAL, "770", "daniel", ALBUM, "", "", "", "Álbum", "EMPALBM098", "[tracklist já corrigida]"]);
  const eca = f.aba("edicaoCharts", "EDIÇÃO CHARTS ÁLBUMS");
  const rowEca = Array(19).fill(""); rowEca[3] = ALBUM; rowEca[17] = "EMPALBM098"; rowEca[18] = "914002";
  eca.push(rowEca);
  f.aba("principal", "Extra_Albuns").push(["Código único"], ["EMPALBM098", "[]", "info editada depois", "[]"]);
  const musicas = f.aba("principal", "Musicas");
  const ec = f.aba("edicaoCharts", "EDIÇÃO CHARTS");
  for (const fx of c.faixas) {
    if (opts.faltando?.includes(fx.num)) continue;
    const titulo = fx.titulo.includes(" - ") ? fx.titulo : `Jessica Johnson - ${fx.titulo}`;
    const r = Array(26).fill(""); r[7] = titulo; r[10] = ALBUM; r[20] = String(fx.num);
    if (fx.inedita) {
      ec.push(["22/11/2026", titulo, "TRACKLIST ALBUM", "SOLO", ALBUM]);
      r[25] = `EMP${String(ec.length - 1).padStart(3, "0")}`;
    }
    musicas.push(r);
  }
  const ps = f.aba("principal", "PreSave_Album");
  while (ps.length < c._rowIndex - 1) ps.push([]);
  ps.push([id]);
  const deps = () => ({
    escrita: f.deps(),
    lerCampanhas: async () => [JSON.parse(JSON.stringify(c))],
    marcarCampanhaLancada: async () => {},
    avisarTravado: async () => {},
    log: () => {},
  });
  return { c, f, deps, id };
}
const escritasReais = (f: FakePlanilhas) => f.escritas;

test("campanha antiga completa vira lista em reconciliação sem regravar nada", async () => {
  const { f, deps, id } = cenarioJessicaCompleta();
  const r = await A.relancarPresave(id, { confirmar: true, motor: deps(), orcamento: 500 });
  expect(r.status).toBe(200);
  expect(escritasReais(f).filter((e) => e.op !== "updateValues" || e.aba !== "PreSave_Album")).toEqual([]);
  expect(f.extras).toEqual([]);
  expect(f.aba("principal", "Albuns")[1][12]).toBe("[tracklist já corrigida]");
  expect(f.aba("edicaoCharts", "EDIÇÃO CHARTS ÁLBUMS")[1][18]).toBe("914002");
  expect(f.aba("registrosCharts", "REGISTRO DE MÚSICA").length).toBe(1);
  const passos = await DB.listarPassos(id);
  expect(passos.every((p) => p.estado === "feito")).toBe(true);
  expect(passos[0].resultado!.albumTopicId).toBe(TOPICO_REAL);
});

test("campanha antiga com 6 faixas faltando grava só as 6", async () => {
  const { f, deps, id } = cenarioJessicaCompleta({ faltando: [6, 7, 8, 10, 11, 12] });
  const antes = f.aba("principal", "Musicas").length;
  for (let i = 0; i < 10; i++) {
    await A.relancarPresave(id, { confirmar: true, motor: deps(), orcamento: 500 });
    if ((await DB.obterLancamento(id))?.completo) break;
  }
  expect(f.aba("principal", "Musicas").length).toBe(antes + 6);
  expect(f.aba("principal", "Musicas").filter((r) => r[10] === ALBUM).length).toBe(12);
  expect(f.aba("edicaoCharts", "EDIÇÃO CHARTS").filter((r) => r[4] === ALBUM).length).toBe(9);
  expect(f.aba("registrosCharts", "REGISTRO DE MÚSICA").length).toBe(1 + 6);
});

test("álbum não achado → 400 e nada criado", async () => {
  const { f, deps, id } = cenarioJessicaCompleta();
  f.aba("principal", "Albuns").splice(1, 1);
  const r = await A.relancarPresave(id, { confirmar: true, motor: deps(), orcamento: 500 });
  expect(r.status).toBe(400);
  expect(await DB.obterLancamento(id)).toBe(null);
});

test("sem confirmar só mostra o que faria", async () => {
  const { deps, id } = cenarioJessicaCompleta();
  const r = await A.relancarPresave(id, { confirmar: false, motor: deps(), orcamento: 500 });
  expect(r.status).toBe(200);
  expect((r.body as { dryRun?: boolean }).dryRun).toBe(true);
  expect(await DB.obterLancamento(id)).toBe(null);
});

test("reabrir lista existente volta travados para pendente", async () => {
  const { deps, id } = cenarioJessicaCompleta();
  await A.relancarPresave(id, { confirmar: true, motor: deps(), orcamento: 500 });
  for (let i = 0; i < 6; i++) await DB.registrarFalha(id, "fechar", "x");
  expect((await DB.listarPassos(id)).find((p) => p.passo === "fechar")!.estado).toBe("travado");
  await A.relancarPresave(id, { confirmar: true, motor: deps(), orcamento: 500 });
  expect((await DB.listarPassos(id)).find((p) => p.passo === "fechar")!.estado).toBe("feito");
});

test("status do lançamento lista os passos", async () => {
  const { deps, id } = cenarioJessicaCompleta();
  await A.relancarPresave(id, { confirmar: true, motor: deps(), orcamento: 500 });
  const { statusLancamento } = await import("../backend/src/controllers/adminPresaveLancamentoController.ts");
  const s = await statusLancamento(id);
  expect(s.completo).toBe(true);
  expect(s.passos.length).toBe(44);
});
