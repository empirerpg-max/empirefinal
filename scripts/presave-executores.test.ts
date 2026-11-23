import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { FakePlanilhas } from "./helpers/fakePlanilhas";
// Executores dos passos do pre-save, com "procurar antes de gravar".
// Uso: bun test scripts/presave-executores.test.ts
const E = await import("../backend/src/controllers/presaveLancamento/executores.ts");
type Passo = import("../backend/src/services/presaveLancamentoDb.ts").Passo;

const jessica = () => JSON.parse(readFileSync(new URL("./fixtures/presave-jessica.json", import.meta.url), "utf8"));
const passo = (nome: string, extra: Partial<Passo> = {}): Passo => ({
  campanhaId: "PRESAVE-d4fd66d2", passo: nome, ordem: 1, estado: "pendente", tentativas: 0,
  procurarAntes: false, resultado: null, ultimoErro: null, atualizadoEm: "", ...extra,
});
function ctx(feitos: Record<string, Record<string, unknown>> = {}) {
  const c = jessica();
  const passos = new Map<string, Passo>();
  for (const [k, r] of Object.entries(feitos)) passos.set(k, passo(k, { estado: "feito", resultado: r }));
  return E.criarContexto(c, passos);
}
const ALBUM = "Jessica Johnson - Bad Behavior";
const musicasDoAlbum = (f: FakePlanilhas) => f.aba("principal", "Musicas").filter((r) => r[10] === ALBUM);

test("contexto usa a data do dia D, não a de hoje", () => {
  expect(ctx().dataFormatada).toBe("22/11/2026");
});

test("faixa musicas grava uma linha", async () => {
  const f = new FakePlanilhas();
  const r = await E.executarPasso(ctx(), passo("faixa:6:musicas"), f.deps());
  const linhas = musicasDoAlbum(f);
  expect(linhas.length).toBe(1);
  expect(linhas[0][7]).toBe("Jessica Johnson - Shipbait");
  expect(linhas[0][20]).toBe("6");
  expect(r.songTitle).toBe("Jessica Johnson - Shipbait");
  expect(r.linha).toBe(2);
});

test("procurarAntes acha e não grava", async () => {
  const f = new FakePlanilhas();
  await E.executarPasso(ctx(), passo("faixa:6:musicas"), f.deps());
  const n = f.escritas.length;
  const r = await E.executarPasso(ctx(), passo("faixa:6:musicas", { procurarAntes: true }), f.deps());
  expect(f.escritas.length).toBe(n);
  expect(r.linha).toBe(2);
  expect(musicasDoAlbum(f).length).toBe(1);
});

test("mesmo título com outro número não conta como achado", async () => {
  const f = new FakePlanilhas();
  const row = Array(24).fill("");
  row[7] = "Jessica Johnson - Pretty Woman"; row[10] = ALBUM; row[20] = "4";
  f.aba("principal", "Musicas").push(row);
  await E.executarPasso(ctx(), passo("faixa:1:musicas", { procurarAntes: true }), f.deps());
  expect(musicasDoAlbum(f).filter((r) => r[7] === "Jessica Johnson - Pretty Woman").length).toBe(2);
});

test("busca que falha não grava", async () => {
  const f = new FakePlanilhas();
  f.falhas.set("readFresh", 1);
  await expect(E.executarPasso(ctx(), passo("faixa:6:musicas", { procurarAntes: true }), f.deps())).rejects.toThrow();
  expect(musicasDoAlbum(f).length).toBe(0);
});

test("charts devolve o código pela posição da linha", async () => {
  const f = new FakePlanilhas();
  const ec = f.aba("edicaoCharts", "EDIÇÃO CHARTS");
  while (ec.length < 1057) ec.push(["x", `Outra - ${ec.length}`]);
  const r = await E.executarPasso(ctx({ "faixa:12:musicas": { linha: 904, songTitle: "Jessica Johnson - Bad Behavior", pendente: false } }), passo("faixa:12:charts"), f.deps());
  expect(r.linhaCharts).toBe(1058);
  expect(r.codigoUnico).toBe("EMP1057");
});

test("charts com procurarAntes acha a linha existente pelo título + álbum", async () => {
  const f = new FakePlanilhas();
  const dep = { "faixa:6:musicas": { linha: 2, songTitle: "Jessica Johnson - Shipbait", pendente: true } };
  await E.executarPasso(ctx(dep), passo("faixa:6:charts"), f.deps());
  const r = await E.executarPasso(ctx(dep), passo("faixa:6:charts", { procurarAntes: true }), f.deps());
  expect(f.aba("edicaoCharts", "EDIÇÃO CHARTS").filter((x) => x[1] === "Jessica Johnson - Shipbait").length).toBe(1);
  expect(r.codigoUnico).toBe("EMP001");
});

test("codigo copia para Musicas!Z e espelha no D1", async () => {
  const f = new FakePlanilhas();
  const m = await E.executarPasso(ctx(), passo("faixa:6:musicas"), f.deps());
  await E.executarPasso(ctx({ "faixa:6:musicas": m }), passo("faixa:6:codigo"), f.deps()).catch(() => {});
  const r = await E.executarPasso(ctx({ "faixa:6:musicas": m, "faixa:6:charts": { linhaCharts: 2, codigoUnico: "EMP001" } }), passo("faixa:6:codigo"), f.deps());
  expect(r.codigoUnico).toBe("EMP001");
  expect(f.aba("principal", "Musicas")[1][25]).toBe("EMP001");
  expect(f.mirrors).toEqual([2]);
});

test("codigo sem dependência feita lança", async () => {
  const f = new FakePlanilhas();
  await expect(E.executarPasso(ctx(), passo("faixa:6:codigo"), f.deps())).rejects.toThrow(/depend/i);
});

test("album usa o tópico reservado e devolve o código", async () => {
  const f = new FakePlanilhas();
  const r = await E.executarPasso(ctx(), passo("album"), f.deps());
  const albuns = f.aba("principal", "Albuns");
  expect(albuns.length).toBe(2);
  expect(albuns[1][1]).toBe("album_1793842998607_xvp873");
  expect(r.linhaAlbuns).toBe(2);
  expect(r.codigoUnicoAlbum).toBe("EMPALBM001");
});

test("album com procurarAntes acha pelo tópico e não regrava", async () => {
  const f = new FakePlanilhas();
  await E.executarPasso(ctx(), passo("album"), f.deps());
  const r = await E.executarPasso(ctx(), passo("album", { procurarAntes: true }), f.deps());
  expect(f.aba("principal", "Albuns").length).toBe(2);
  expect(f.aba("edicaoCharts", "EDIÇÃO CHARTS ÁLBUMS").length).toBe(2);
  expect(r.codigoUnicoAlbum).toBe("EMPALBM001");
});

test("bonus grava 914002 na coluna PRE-SAVE da linha do álbum", async () => {
  const f = new FakePlanilhas();
  const album = await E.executarPasso(ctx(), passo("album"), f.deps());
  const r = await E.executarPasso(ctx({ album }), passo("bonus", { resultado: { valor: 914002 } }), f.deps());
  expect(f.aba("edicaoCharts", "EDIÇÃO CHARTS ÁLBUMS")[1][18]).toBe("914002");
  expect(r.valor).toBe(914002);
});

test("tracklist grava as 12 faixas na linha do álbum e recusa linha de outro álbum", async () => {
  const f = new FakePlanilhas();
  const album = await E.executarPasso(ctx(), passo("album"), f.deps());
  await E.executarPasso(ctx({ album }), passo("tracklist"), f.deps());
  const tl = JSON.parse(f.aba("principal", "Albuns")[1][12]);
  expect(tl.length).toBe(12);
  expect(tl[8]).toEqual({ titulo: "Jessica Johnson - Nobody's Wife", disco: 1, ordem: 9 });
  f.aba("principal", "Albuns")[1][1] = "album_de_outro";
  await expect(E.executarPasso(ctx({ album }), passo("tracklist"), f.deps())).rejects.toThrow();
});

test("fechar grava o código só se a linha for da campanha", async () => {
  const f = new FakePlanilhas();
  const ps = f.aba("principal", "PreSave_Album");
  while (ps.length < 8) ps.push([]);
  ps.push(["PRESAVE-d4fd66d2"]);
  await E.executarPasso(ctx({ album: { linhaAlbuns: 2, codigoUnicoAlbum: "EMPALBM098" } }), passo("fechar"), f.deps());
  expect(ps[8][16]).toBe("EMPALBM098");
  ps[8][0] = "PRESAVE-outra";
  await expect(E.executarPasso(ctx({ album: { linhaAlbuns: 2, codigoUnicoAlbum: "EMPALBM098" } }), passo("fechar"), f.deps())).rejects.toThrow();
});

test("vinculo vincula a faixa existente e espelha no D1", async () => {
  const f = new FakePlanilhas();
  const row = Array(26).fill(""); row[7] = "Jessica Johnson - Nobody's Wife"; row[25] = "EMP997";
  f.aba("principal", "Musicas").push(row);
  const r = await E.executarPasso(ctx(), passo("vinculo:9"), f.deps());
  expect(f.aba("principal", "Musicas")[1][10]).toBe(ALBUM);
  expect(f.mirrors).toEqual([2]);
  expect(r.linhas).toEqual([2]);
});

test("extra envia shop/info/arte com o código do álbum", async () => {
  const f = new FakePlanilhas();
  await E.executarPasso(ctx({ album: { linhaAlbuns: 2, codigoUnicoAlbum: "EMPALBM098" } }), passo("extra"), f.deps());
  expect(f.extras).toEqual([{ codigoUnico: "EMPALBM098", tipo: "album", shop: [{ foto: "https://drive/shop", titulo: "Official Merchandising" }], info: "info", arte: [{ tipo: "imagem", url: "https://drive/arte" }] }]);
});

test("registro grava uma vez e com procurarAntes não repete", async () => {
  const f = new FakePlanilhas();
  const dep = { "faixa:6:musicas": { linha: 2, songTitle: "Jessica Johnson - Shipbait", pendente: true } };
  await E.executarPasso(ctx(dep), passo("faixa:6:registro"), f.deps());
  await E.executarPasso(ctx(dep), passo("faixa:6:registro", { procurarAntes: true }), f.deps());
  expect(f.aba("registrosCharts", "REGISTRO DE MÚSICA").length).toBe(2);
});
