import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { instalarFakeD1 } from "./helpers/fakeD1";
import { FakePlanilhas } from "./helpers/fakePlanilhas";
// Achados da revisão final no motor/executores do pre-save em passos.
// Uso: bun test scripts/presave-revisao-motor.test.ts
instalarFakeD1();
const M = await import("../backend/src/controllers/presaveLancamento/motor.ts");
const E = await import("../backend/src/controllers/presaveLancamento/executores.ts");
const DB = await import("../backend/src/services/presaveLancamentoDb.ts");
const WL = await import("../backend/src/services/writeLockService.ts");
const O = await import("../backend/src/services/orcamentoChamadas.ts");
const A = await import("../backend/src/controllers/adminRelancarFaixasFaltantesPreSaveController.ts");
type Passo = import("../backend/src/services/presaveLancamentoDb.ts").Passo;

const ALBUM = "Jessica Johnson - Bad Behavior";
const AGORA = new Date("2026-11-22T12:00:00Z");
let seq = 0;
const jessica = () => JSON.parse(readFileSync(new URL("./fixtures/presave-jessica.json", import.meta.url), "utf8"));
function cenario() {
  const c = jessica(); c.id = `PRESAVE-r${++seq}`; c.albumTopicId = `album_r${seq}`;
  const f = new FakePlanilhas();
  for (const t of ["Jessica Johnson - REIGN", "Jessica Johnson - Sweet Spot", "Jessica Johnson - Nobody's Wife"]) {
    const r = Array(26).fill(""); r[7] = t; r[25] = `EMP9${seq}${t.length}`; f.aba("principal", "Musicas").push(r);
  }
  const ps = f.aba("principal", "PreSave_Album"); while (ps.length < 8) ps.push([]); ps.push([c.id]);
  const lancadas: string[] = [];
  const deps = (extra: Record<string, unknown> = {}) => ({
    escrita: f.deps(), lerCampanhas: async () => [JSON.parse(JSON.stringify(c))],
    marcarCampanhaLancada: async (x: { id: string }) => { lancadas.push(x.id); c.status = "lancada"; },
    avisarTravado: async () => {}, log: () => {}, ...extra,
  }) as any;
  return { c, f, deps, lancadas };
}
const passo = (nome: string, extra: Partial<Passo> = {}): Passo => ({ campanhaId: "X", passo: nome, ordem: 1, estado: "pendente", tentativas: 0, procurarAntes: false, resultado: null, ultimoErro: null, atualizadoEm: "", ...extra });
function ctx(feitos: Record<string, Record<string, unknown>> = {}) {
  const passos = new Map<string, Passo>();
  for (const [k, r] of Object.entries(feitos)) passos.set(k, passo(k, { estado: "feito", resultado: r }));
  return E.criarContexto(jessica(), passos);
}

test("C1: Worker morre entre gravar e anotar (nem a falha é anotada) → próxima execução não duplica", async () => {
  const { f, deps, c } = cenario();
  let morreu = false;
  const morrer = async (_id: string, passo: string) => {
    if (passo === "faixa:1:musicas" && !morreu) { morreu = true; throw new Error("worker morto"); }
  };
  await M.executarMotorLancamentos({ orcamento: 500, agora: AGORA, deps: deps({
    marcarFeito: async (id: string, p: string, r: Record<string, unknown>) => { await morrer(id, p); return DB.marcarFeito(id, p, r); },
    registrarFalha: async () => { if (morreu) throw new Error("D1 fora também"); return "falhou"; },
  }) });
  expect(morreu).toBe(true);
  for (let i = 0; i < 20 && !(await DB.obterLancamento(c.id))?.completo; i++) {
    await M.executarMotorLancamentos({ orcamento: 500, agora: AGORA, deps: deps() });
  }
  expect(f.aba("principal", "Musicas").filter((r) => r[7] === "Jessica Johnson - Pretty Woman").length).toBe(1);
});

test("C2: código que não é EMPnnn (ex.: cabeçalho lido pelo GViz) não é aceito", async () => {
  const f = new FakePlanilhas();
  const d = { ...f.deps(), lerCodigoUnicoGerado: async () => "Data de lançamento" };
  await expect(E.executarPasso(ctx({ "faixa:6:musicas": { linha: 2, songTitle: "Jessica Johnson - Shipbait", pendente: true } }), passo("faixa:6:charts"), d)).rejects.toThrow(/Código único/);
  const d2 = { ...f.deps(), registrarAlbumNaEdicaoChartsAlbuns: async () => "Código único" };
  await expect(E.executarPasso(ctx(), passo("album"), d2)).rejects.toThrow(/Código único/);
});

test("I1: álbum já em Albuns com L preenchido mas sem linha na EDIÇÃO CHARTS ÁLBUMS → cria a linha na retomada", async () => {
  const f = new FakePlanilhas();
  f.aba("principal", "Albuns").push(["d", "album_1793842998607_xvp873", "", "", "", "", ALBUM, "", "", "", "Álbum", "EMPALBM005"]);
  const r = await E.executarPasso(ctx(), passo("album", { procurarAntes: true }), f.deps());
  expect(f.aba("edicaoCharts", "EDIÇÃO CHARTS ÁLBUMS").length).toBe(2);
  expect(r.codigoUnicoAlbum).toBe(f.aba("edicaoCharts", "EDIÇÃO CHARTS ÁLBUMS")[1][17]);
});

test("I2: vínculo com uma cópia sem Código único não trava; só espelha as linhas com código", async () => {
  const f = new FakePlanilhas();
  const comCodigo = Array(26).fill(""); comCodigo[7] = "Jessica Johnson - Nobody's Wife"; comCodigo[25] = "EMP997";
  const semCodigo = Array(26).fill(""); semCodigo[7] = "Jessica Johnson - Nobody's Wife";
  f.aba("principal", "Musicas").push(comCodigo, semCodigo);
  const r = await E.executarPasso(ctx(), passo("vinculo:9"), f.deps());
  expect(f.mirrors).toEqual([2]);
  expect(r.linhas).toEqual([2, 3]);
});

test("I3: campanha 'ativa' com marca de já lançada vira 'lancada' (não fica ativa pra sempre)", async () => {
  const { c, deps, lancadas } = cenario();
  await WL.marcarLancadaDeVerdade(c.id);
  await M.executarMotorLancamentos({ orcamento: 500, agora: AGORA, deps: deps() });
  expect(lancadas).toEqual([c.id]);
  expect(await DB.obterLancamento(c.id)).toBe(null);
});

test("I3: admin reconcilia campanha 'ativa' que já tem a marca de lançada", async () => {
  const { c, f, deps } = cenario();
  await WL.marcarLancadaDeVerdade(c.id);
  f.aba("principal", "Albuns").push(["d", "album_real", "", "", "", "", ALBUM, "", "", "", "Álbum", "EMPALBM001"]);
  const eca = Array(19).fill(""); eca[3] = ALBUM; eca[17] = "EMPALBM001";
  f.aba("edicaoCharts", "EDIÇÃO CHARTS ÁLBUMS").push(eca);
  const r = await A.relancarPresave(c.id, { confirmar: true, motor: deps(), orcamento: 500 });
  expect(r.status).toBe(200);
  expect(await DB.obterLancamento(c.id)).not.toBe(null);
});

test("I4: dois orçamentos simultâneos no mesmo isolate não se misturam", async () => {
  const pausa = () => new Promise((r) => setTimeout(r, 5));
  const usar = (limite: number, n: number) => O.comOrcamento(limite, async () => {
    for (let i = 0; i < n; i++) { O.registrarChamadaExterna(); await pausa(); }
    return O.chamadasRestantes();
  });
  const [a, b] = await Promise.all([usar(10, 3), usar(20, 5)]);
  expect(a).toBe(7);
  expect(b).toBe(15);
  expect(O.chamadasRestantes()).toBe(Infinity);
});
