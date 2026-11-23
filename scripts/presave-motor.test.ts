import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { instalarFakeD1 } from "./helpers/fakeD1";
import { FakePlanilhas } from "./helpers/fakePlanilhas";
// Motor do lançamento em passos do pre-save: orçamento, trava, retomada.
// Uso: bun test scripts/presave-motor.test.ts
instalarFakeD1(); // um D1 só por arquivo (writeLockService guarda "tabela garantida" por processo)
const M = await import("../backend/src/controllers/presaveLancamento/motor.ts");
const DB = await import("../backend/src/services/presaveLancamentoDb.ts");
const WL = await import("../backend/src/services/writeLockService.ts");

const ALBUM = "Jessica Johnson - Bad Behavior";
const AGORA = new Date("2026-11-22T12:00:00Z");
let seq = 0;

function cenario() {
  const id = `PRESAVE-t${++seq}`;
  const c = JSON.parse(readFileSync(new URL("./fixtures/presave-jessica.json", import.meta.url), "utf8"));
  c.id = id;
  c.albumTopicId = `album_t${seq}`;
  const f = new FakePlanilhas();
  for (const t of ["Jessica Johnson - REIGN", "Jessica Johnson - Sweet Spot", "Jessica Johnson - Nobody's Wife"]) {
    const r = Array(26).fill(""); r[7] = t; f.aba("principal", "Musicas").push(r);
  }
  const ps = f.aba("principal", "PreSave_Album");
  while (ps.length < c._rowIndex - 1) ps.push([]);
  ps.push([id]);
  const avisos: string[] = [];
  const deps = (extra: Partial<import("../backend/src/controllers/presaveLancamento/motor.ts").DepsMotor> = {}) => ({
    escrita: f.deps(),
    lerCampanhas: async () => [JSON.parse(JSON.stringify(c))],
    marcarCampanhaLancada: async (camp: { _rowIndex: number }) => {
      c.status = "lancada";
      const row = f.aba("principal", "PreSave_Album")[camp._rowIndex - 1];
      while (row.length < 13) row.push("");
      row[12] = "lancada";
    },
    avisarTravado: async (_c: unknown, passo: string) => { avisos.push(passo); },
    log: () => {},
    ...extra,
  });
  return { c, f, deps, avisos, id };
}
const doAlbum = (f: FakePlanilhas, aba: string, planilha = "principal", col = 10) =>
  f.aba(planilha, aba).filter((r) => r[col] === ALBUM);
async function ateCompletar(id: string, rodar: () => Promise<unknown>, max = 40) {
  for (let i = 0; i < max; i++) {
    await rodar();
    const l = await DB.obterLancamento(id);
    if (l?.completo) return i + 1;
  }
  throw new Error("não completou");
}

test("campanha de 12 faixas completa em várias execuções, sem duplicar nada", async () => {
  const { f, deps, id } = cenario();
  const execucoes = await ateCompletar(id, () => M.executarMotorLancamentos({ orcamento: 25, agora: AGORA, deps: deps() }));
  expect(execucoes).toBeGreaterThan(1);
  expect(doAlbum(f, "Musicas").length).toBe(12); // 9 inéditas + 3 vinculadas
  expect(f.aba("principal", "Musicas").length).toBe(1 + 3 + 9);
  expect(doAlbum(f, "EDIÇÃO CHARTS", "edicaoCharts", 4).length).toBe(9);
  expect(f.aba("principal", "Albuns").length).toBe(2);
  expect(f.aba("edicaoCharts", "EDIÇÃO CHARTS ÁLBUMS").length).toBe(2);
  expect(f.aba("edicaoCharts", "EDIÇÃO CHARTS ÁLBUMS")[1][18]).toBe("348191"); // bônus congelado: 2 missões de peso 60
  expect(f.aba("principal", "PreSave_Album")[8][16]).toBe("EMPALBM001");
  expect((await DB.listarPassos(id)).every((p) => p.estado === "feito")).toBe(true);
});

test("status vira lancada assim que o álbum existe", async () => {
  const { c, f, deps } = cenario();
  await M.executarMotorLancamentos({ orcamento: 30, agora: AGORA, deps: deps() });
  expect(f.aba("principal", "Albuns").length).toBe(2);
  expect(c.status).toBe("lancada");
  expect(f.aba("principal", "PreSave_Album")[8][12]).toBe("lancada");
  expect(await WL.jaFoiLancadaDeVerdade(c.id)).toBe(true);
});

test("antes do dia D não cria nada", async () => {
  const { f, deps, id } = cenario();
  await M.executarMotorLancamentos({ orcamento: 50, agora: new Date("2026-11-21T12:00:00Z"), deps: deps() });
  expect(await DB.obterLancamento(id)).toBe(null);
  expect(f.escritas.length).toBe(0);
});

test("retoma sem duplicar após queda entre gravar e anotar", async () => {
  const { f, deps, id } = cenario();
  let caiu = false;
  const marcarFeito: typeof DB.marcarFeito = async (cid, passo, r) => {
    if (passo === "faixa:6:musicas" && !caiu) { caiu = true; throw new Error("worker caiu"); }
    return DB.marcarFeito(cid, passo, r);
  };
  await ateCompletar(id, () => M.executarMotorLancamentos({ orcamento: 25, agora: AGORA, deps: deps({ marcarFeito }) }));
  expect(caiu).toBe(true);
  expect(f.aba("principal", "Musicas").filter((r) => r[7] === "Jessica Johnson - Shipbait").length).toBe(1);
  expect(doAlbum(f, "Musicas").length).toBe(12);
});

test("duas execuções simultâneas não duplicam", async () => {
  const { f, deps, id } = cenario();
  for (let i = 0; i < 15; i++) {
    await Promise.all([
      M.executarMotorLancamentos({ orcamento: 30, agora: AGORA, deps: deps() }),
      M.executarMotorLancamentos({ orcamento: 30, agora: AGORA, deps: deps() }),
    ]);
    if ((await DB.obterLancamento(id))?.completo) break;
  }
  expect((await DB.obterLancamento(id))?.completo).toBe(true);
  expect(f.aba("principal", "Albuns").length).toBe(2);
  expect(doAlbum(f, "Musicas").length).toBe(12);
  expect(doAlbum(f, "EDIÇÃO CHARTS", "edicaoCharts", 4).length).toBe(9);
});

test("campanha antiga com marca no D1 não é tocada", async () => {
  const { f, deps, id } = cenario();
  await WL.marcarLancadaDeVerdade(id);
  await M.executarMotorLancamentos({ orcamento: 50, agora: AGORA, deps: deps() });
  expect(await DB.obterLancamento(id)).toBe(null);
  expect(f.escritas.length).toBe(0);
});

test("passo travado para a campanha e avisa uma vez", async () => {
  const { f, deps, id, avisos } = cenario();
  f.falhas.set("registrarNaEdicaoCharts", Infinity);
  for (let i = 0; i < 10; i++) await M.executarMotorLancamentos({ orcamento: 200, agora: AGORA, deps: deps() });
  const ps = await DB.listarPassos(id);
  expect(ps.find((p) => p.passo === "faixa:1:charts")!.estado).toBe("travado");
  expect(ps.find((p) => p.passo === "faixa:1:codigo")!.estado).toBe("pendente");
  expect(avisos).toEqual(["faixa:1:charts"]);
});

test("avisarPassoTravado não lança mesmo se a notificação falhar", async () => {
  const { avisarPassoTravado } = await import("../backend/src/controllers/presaveLancamento/protecoes.ts");
  await avisarPassoTravado({ id: "X", albumTituloFull: ALBUM }, "faixa:1:charts", "erro", {
    push: async () => { throw new Error("push caiu"); },
    log: async () => { throw new Error("log caiu"); },
  });
});
