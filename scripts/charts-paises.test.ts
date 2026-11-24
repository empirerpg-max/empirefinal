import { test, expect } from "bun:test";
// Paradas por país nos charts. Uso: bun test scripts/charts-paises.test.ts
import { sorteio01 } from "../backend/src/services/chartsD1/sorteio";
import { fatiasRegraC, valoresPorPais, rankingsPorPais, type Pesos, type EntradaMusica } from "../backend/src/services/chartsD1/paises";
import { regrasDeConfig, parseRegrasSemana, REGRAS_PADRAO } from "../backend/src/services/chartsD1/regras";
import { fontes, pontos, emAcr, calcularParada, fatorPontos, PONTOS_MAX_PARADA, resolverPaisParada, mapaPaisPorNome, paradasDaSemana, type MusicaSemana } from "../backend/src/services/chartsD1/paradas";
import { criarD1Sqlite } from "./charts-d1-sqlite";
import { CHARTS_D1_SCHEMA, ingerirSemana } from "../backend/src/services/chartsD1/repo";
import { calcularSemanaPaises, ROTULO_PARADAS } from "../backend/src/services/chartsD1/semanaPaises";
import { indexarCatalogo } from "../backend/src/services/chartsD1/artistas";
import { validarGravacaoFoco, musicaFocoController } from "../backend/src/controllers/musicaFocoController";
import { issueSessionToken, ADMIN_TG_ID } from "../backend/src/services/sessionService";
import { rankingAoVivoPorPais, calcularAoVivoPaises, proximaDataChart, limparCacheAoVivoPaises, type ItemAoVivo, type LinhaAoVivoPais } from "../backend/src/services/chartsD1/aoVivoPaises";

test("sorteio01: determinístico, em [0,1), varia com a chave", () => {
  expect(sorteio01("2026-11-11|x|BRASIL|nac")).toBe(sorteio01("2026-11-11|x|BRASIL|nac"));
  const v = ["a", "b", "c", "d", "e"].map(sorteio01);
  for (const x of v) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  expect(new Set(v).size).toBe(5);
});
test("regrasDeConfig: sobrepõe números válidos e paradas; ignora lixo", () => {
  const r = regrasDeConfig(new Map([["nac_max", "5"], ["variacao", "abc"], ["paradas", "[{\"id\":\"X\"}]"]]));
  expect(r.paises.nac_max).toBe(5);
  expect(r.paises.variacao).toBe(0.15);
  // item incompleto ("X" sem nome/paises/tipo/números) → padrão inteiro
  expect(r.paradas.length).toBe(12);
  expect(regrasDeConfig(new Map([["paradas", "{quebrado"]])).paradas.length).toBe(12);
  const ok = { id: "X", nome: "N", paises: ["BRASIL"], tipo: "unidades", top: 10, ordem: 1, a: 0, tp: 1, tga: 2, tgv: 3, descricao: "d" };
  const cfg = (o: object) => new Map([["paradas", JSON.stringify([{ ...ok, ...o }])]]);
  expect(regrasDeConfig(cfg({})).paradas.map((x) => x.id)).toEqual(["X"]);
  for (const ruim of [{ nome: 1 }, { paises: "BRASIL" }, { paises: [1] }, { tipo: "outro" }, { top: "10" }, { tga: null }, { ordem: undefined }])
    expect(regrasDeConfig(cfg(ruim)).paradas.length).toBe(12);
});
test("parseRegrasSemana: null para vazio/inválido", () => {
  expect(parseRegrasSemana(null)).toBeNull();
  expect(parseRegrasSemana("{x")).toBeNull();
  expect(parseRegrasSemana(JSON.stringify(REGRAS_PADRAO))).toEqual(REGRAS_PADRAO);
});

const pesos: Pesos = new Map([["EUA", 0.3], ["AUSTRÁLIA", 0.02], ["BRASIL", 0.05]]);
const R = REGRAS_PADRAO.paises;
const m = (t: string, nac: string[] = [], foco: string | null = null) =>
  ({ tituloNorm: t, nacionalidades: new Set(nac), foco });

test("regra C: Σ pb ≥ 1 → fatias somam 1; Σ pb < 1 → sobra o resto (inclui música sem nacionalidade nem foco)", () => {
  const cheio: Pesos = new Map([["EUA", 0.7], ["BRASIL", 0.5]]);
  for (const x of [m("a"), m("b", ["BRASIL"]), m("c", ["EUA"], "BRASIL")]) {
    const soma = [...fatiasRegraC(cheio, x, "2026-11-11", R).values()].reduce((s, v) => s + v, 0);
    expect(soma).toBeCloseTo(1, 12);
    const somaParcial = [...fatiasRegraC(pesos, x, "2026-11-11", R).values()].reduce((s, v) => s + v, 0);
    expect(somaParcial).toBeGreaterThan(0);
    expect(somaParcial).toBeLessThan(1);
  }
});
test("regra C: determinística e sem depender da ordem dos pesos", () => {
  const inv: Pesos = new Map([...pesos].reverse());
  expect(fatiasRegraC(pesos, m("b", ["AUSTRÁLIA"]), "2026-11-11", R))
    .toEqual(fatiasRegraC(inv, m("b", ["AUSTRÁLIA"]), "2026-11-11", R));
});
test("regra C: nativo ganha mais que estrangeiro no seu país; bônus ≤ teto", () => {
  const nat = fatiasRegraC(pesos, m("x", ["AUSTRÁLIA"]), "2026-11-11", { ...R, variacao: 0 });
  const est = fatiasRegraC(pesos, m("x"), "2026-11-11", { ...R, variacao: 0 });
  expect(nat.get("AUSTRÁLIA")!).toBeGreaterThan(est.get("AUSTRÁLIA")! * 1.5);
  const eua = fatiasRegraC(pesos, m("y", ["EUA"]), "2026-11-11", { ...R, variacao: 0, nac_min: 4, nac_max: 4 });
  // pb 0.3 × 4 = 1.2 → limitado a 0.2
  expect(eua.get("EUA")!).toBeCloseTo((0.3 + 0.2) / (0.5 + 0.02 + 0.05 + 0.63), 9);
});
test("regra C: foco no país da nacionalidade não soma; com faixas padrão, foco < nacionalidade", () => {
  const z = { ...R, variacao: 0 };
  expect(fatiasRegraC(pesos, m("x", ["BRASIL"], "BRASIL"), "d", z)).toEqual(fatiasRegraC(pesos, m("x", ["BRASIL"]), "d", z));
  const foco = fatiasRegraC(pesos, m("x", [], "BRASIL"), "d", z).get("BRASIL")!;
  const nac = fatiasRegraC(pesos, m("x", ["BRASIL"]), "d", z).get("BRASIL")!;
  const nada = fatiasRegraC(pesos, m("x"), "d", z).get("BRASIL")!;
  expect(foco).toBeGreaterThan(nada);
  expect(foco).toBeLessThanOrEqual(nac); // foco_max 1.5 ≤ nac_min 1.5
});
test("hit mundial 4× maior vence nativo num país de 2%; nativo perto vence", () => {
  const z = { ...R, variacao: 0, nac_min: 3, nac_max: 3 };
  const mk = (t: string, valor: number, nac: string[]): EntradaMusica =>
    ({ tituloNorm: t, titulo: t, artistaPrincipal: t, artistas: [t], valor, nacionalidades: new Set(nac), foco: null });
  const r1 = rankingsPorPais([mk("hit", 1_000_000, ["EUA"]), mk("aus", 200_000, ["AUSTRÁLIA"])], [], pesos, "d", null, z);
  expect(r1.get("AUSTRÁLIA")![0].tituloNorm).toBe("hit");
  const r2 = rankingsPorPais([mk("hit", 1_000_000, ["EUA"]), mk("aus", 500_000, ["AUSTRÁLIA"])], [], pesos, "d", null, z);
  expect(r2.get("AUSTRÁLIA")![0].tituloNorm).toBe("aus");
});
test("rankingsPorPais: sem semana anterior → tudo NEW", () => {
  const e: EntradaMusica = { tituloNorm: "a", titulo: "A", artistaPrincipal: "x", artistas: ["x"], valor: 10, nacionalidades: new Set(), foco: null };
  expect(rankingsPorPais([e], [], pesos, "d", null, R).get("BRASIL")![0].st).toBe("NEW");
});

test("REGRAS_PADRAO: valores sentinela, vendas (a) e regrasDeConfig sem referências compartilhadas", () => {
  const ex = REGRAS_PADRAO.paradas.find((p) => p.id === "EXCL_US")!;
  expect(ex.ordem).toBe(0);
  expect(ex.top).toBe(100);
  const de = REGRAS_PADRAO.paradas.find((p) => p.id === "DE")!;
  expect(de.tipo).toBe("receita");
  expect(de.tp).toBe(0.008);
  expect(de.a).toBe(1.29);
  expect(REGRAS_PADRAO.paradas.find((p) => p.id === "BR")!.a).toBe(0);
  expect(REGRAS_PADRAO.paradas.find((p) => p.id === "JP")!.a).toBe(2);
  expect(regrasDeConfig(new Map([["paradas", "[]"]])).paradas.length).toBe(12);
  expect(regrasDeConfig(new Map([["paradas", "[1]"]])).paradas.length).toBe(12);
  const orig = REGRAS_PADRAO.paradas[0].nome;
  const r = regrasDeConfig(new Map());
  r.paradas[0].nome = "MUTADO";
  expect(REGRAS_PADRAO.paradas[0].nome).toBe(orig);
  const eua = r.paradas.find((p) => p.id === "EUA")!;
  const ca = r.paradas.find((p) => p.id === "CA")!;
  expect(eua.recorrencia).not.toBe(ca.recorrencia);
  expect(REGRAS_PADRAO.paradas.find((p) => p.id === "EUA")!.recorrencia).not.toBe(
    REGRAS_PADRAO.paradas.find((p) => p.id === "CA")!.recorrencia);
});

import { indexarFocos, focoVigente, carregarFocos, FOCO_SCHEMA } from "../backend/src/services/chartsD1/foco";
test("focoVigente: só depois de 'desde'; troca do admin não muda semanas anteriores; GLOBAL = null", () => {
  const h = indexarFocos([
    { codigo_unico: "EMP1", pais: "ESTADOS UNIDOS", desde: "2026-11-01" },
    { codigo_unico: "EMP1", pais: "REINO UNIDO", desde: "2026-11-20" },
    { codigo_unico: "EMP2", pais: "GLOBAL", desde: "2026-01-01" },
  ]);
  expect(focoVigente(h, "EMP1", "2026-11-01")).toBeNull();
  expect(focoVigente(h, "EMP1", "2026-11-11")).toBe("ESTADOS UNIDOS");
  expect(focoVigente(h, "EMP1", "2026-11-20")).toBe("ESTADOS UNIDOS");
  expect(focoVigente(h, "EMP1", "2026-11-27")).toBe("REINO UNIDO");
  expect(focoVigente(h, "EMP2", "2026-11-27")).toBeNull();
  expect(focoVigente(h, undefined, "2026-11-27")).toBeNull();
});
test("carregarFocos: 'no such table' → mapa vazio; lê linhas existentes; schema definido", async () => {
  const semTabela: any = { prepare: () => ({ all: async () => { throw new Error("D1_ERROR: no such table: musica_foco"); } }) };
  expect((await carregarFocos(semTabela)).size).toBe(0);
  const comLinhas: any = { prepare: () => ({ all: async () => ({ results: [{ codigo_unico: "A", pais: "BRASIL", desde: "2026-01-01" }] }) }) };
  expect(focoVigente(await carregarFocos(comLinhas), "A", "2026-02-01")).toBe("BRASIL");
  expect(FOCO_SCHEMA[0]).toContain("musica_foco");
});

const pais = (v: number) => new Map([["REINO UNIDO", v], ["ESTADOS UNIDOS", v * 3]]);
const ms = (t: string, o: Partial<MusicaSemana> = {}): MusicaSemana => ({
  tituloNorm: t, titulo: t, artistaPrincipal: t, semanas: 1, pontosGlobal100: 0, streamsGlobaisAnteriores: [0, 0, 0],
  totalGlobal: { SPOTIFY: 1000, YOUTUBE: 600, "APPLE MUSIC": 300, "DIGITAL SALES": 10 },
  porPais: { SPOTIFY: pais(100), YOUTUBE: pais(60), "APPLE MUSIC": pais(30), "DIGITAL SALES": pais(1) }, ...o });
const P = (id: string) => REGRAS_PADRAO.paradas.find((p) => p.id === id)!;

test("fontes: pagos = Apple + 45% Spotify; plataforma ausente = 0", () => {
  expect(fontes(ms("a"), "REINO UNIDO", 0.45)).toEqual({ vendas: 1, pagos: 30 + 45, gratis_audio: 55, gratis_video: 60 });
  const semApple = ms("b", { porPais: { SPOTIFY: pais(100) } });
  expect(fontes(semApple, "REINO UNIDO", 0.45)).toEqual({ vendas: 0, pagos: 45, gratis_audio: 55, gratis_video: 0 });
});
test("pontos: SNEP ignora grátis; Brasil ignora vendas; Alemanha por receita", () => {
  const f = { vendas: 10, pagos: 1500, gratis_audio: 6000, gratis_video: 6000 };
  expect(pontos(f, P("FR"))).toBeCloseTo(10 + 10, 9);
  expect(pontos(f, P("BR"))).toBeCloseTo(15 + 20 + 20, 9);
  expect(pontos(f, P("DE"))).toBeCloseTo(10 * 1.29 + 1500 * 0.008 + 12000 * 0.0008, 9);
});
test("UK: no máximo 3 por artista", () => {
  const l = ["a", "b", "c", "d"].map((t, i) => ms(t, { artistaPrincipal: "Mia", porPais: { SPOTIFY: pais(1000 - i) } }));
  l.push(ms("e", { artistaPrincipal: "Outro", porPais: { SPOTIFY: pais(1) } }));
  expect(calcularParada(l, P("UK"), "REINO UNIDO", 0.45).map((x) => x.tituloNorm)).toEqual(["a", "b", "c", "e"]);
});
test("UK: ACR usa 200/1200 quando caiu 3 semanas e semanas > 9", () => {
  const m = ms("a", { semanas: 10, streamsGlobaisAnteriores: [1800, 1900, 2000] });
  expect(emAcr(m, 1700, P("UK").acr!)).toBe(true);
  expect(emAcr({ ...m, semanas: 9 }, 1700, P("UK").acr!)).toBe(false);
  expect(emAcr({ ...m, streamsGlobaisAnteriores: [1800, 1700, 2000] }, 1700, P("UK").acr!)).toBe(false);
});
test("EUA: recorrência remove ≥20 semanas abaixo de #50 e sobe os de baixo", () => {
  const l = Array.from({ length: 60 }, (_, i) => ms(`m${i}`, { semanas: i === 55 ? 25 : 1, porPais: { SPOTIFY: new Map([["ESTADOS UNIDOS", 1000 - i]]) } }));
  const r = calcularParada(l, P("EUA"), "ESTADOS UNIDOS", 0.45);
  expect(r.length).toBe(50);
  expect(r.some((x) => x.tituloNorm === "m55")).toBe(false);
});
// Lista com Spotify EUA decrescente (posição provisória = índice + 1) e `semanas` por índice.
const listaEua = (n: number, semanas: Record<number, number>) =>
  Array.from({ length: n }, (_, i) => ms(`m${i}`, { semanas: semanas[i] ?? 1, porPais: { SPOTIFY: new Map([["ESTADOS UNIDOS", 1000 - i]]) } }));
test("EUA: recorrência 20/50 remove #51 e o de baixo sobe (top ampliado para o efeito aparecer)", () => {
  // Com top 50 quem está em #51 já sairia pelo corte; top 60 deixa a regra visível.
  const r = calcularParada(listaEua(52, { 10: 25, 50: 25 }), { ...P("EUA"), top: 60 }, "ESTADOS UNIDOS", 0.45);
  expect(r.length).toBe(51);
  expect(r.some((x) => x.tituloNorm === "m50")).toBe(false);
  expect(r.find((x) => x.tituloNorm === "m10")?.pos).toBe(11); // ≥20 semanas mas dentro do Top 50: fica
  expect(r[50]).toMatchObject({ pos: 51, tituloNorm: "m51" });
});
test("EUA: recorrência 52/25 remove #30 e o #51 entra no Top 50", () => {
  const r = calcularParada(listaEua(51, { 29: 52 }), P("EUA"), "ESTADOS UNIDOS", 0.45);
  expect(r.length).toBe(50);
  expect(r.some((x) => x.tituloNorm === "m29")).toBe(false);
  expect(r[29].tituloNorm).toBe("m30");
  expect(r[49]).toMatchObject({ pos: 50, tituloNorm: "m50" });
});
test("UK: música em ACR recebe val menor que a mesma fora do ACR", () => {
  const base = { porPais: { SPOTIFY: pais(1_000_000), YOUTUBE: pais(600_000) } };
  // Streams globais atuais = 1000 + 600 + 300 = 1900, caindo há 3 semanas.
  // pontosGlobal100 = unidades globais da parada, para o fator ser 1 e o val ficar em unidades.
  const g100 = pontos(fontes(ms("a"), null, 0.45), P("UK")) * 0.1; // fator 0,1: fica abaixo do teto
  const acr = ms("a", { ...base, pontosGlobal100: g100, semanas: 10, streamsGlobaisAnteriores: [2000, 2100, 2200] });
  const normal = ms("a", { ...base, pontosGlobal100: g100, semanas: 1, streamsGlobaisAnteriores: [2000, 2100, 2200] });
  const vAcr = calcularParada([acr], P("UK"), "REINO UNIDO", 0.45)[0].val;
  const vNormal = calcularParada([normal], P("UK"), "REINO UNIDO", 0.45)[0].val;
  expect(vNormal).toBe(Math.round((450_000 / 100 + 550_000 / 600 + 600_000 / 600) * 0.1));
  expect(vAcr).toBe(Math.round((450_000 / 200 + 550_000 / 1200 + 600_000 / 1200) * 0.1));
  expect(vAcr).toBeLessThan(vNormal);
});
test("Excl. US = mundo − EUA", () => {
  const p = P("EXCL_US");
  const m = ms("a", { pontosGlobal100: pontos(fontes(ms("a"), null, 0.45), p) });
  const esperado = pontos(fontes(m, null, 0.45), p) - pontos(fontes(m, "ESTADOS UNIDOS", 0.45), p);
  expect(calcularParada([m], p, "ESTADOS UNIDOS", 0.45)[0].val).toBe(Math.round(esperado));
});
test("resolverPaisParada e mapaPaisPorNome: duas grafias do mesmo país → mesma escolha, qualquer ordem", () => {
  const a = new Set(["AUSTRÁLIA", "AUSTRALIA"]);
  const b = new Set(["AUSTRALIA", "AUSTRÁLIA"]);
  expect(resolverPaisParada(P("AU"), a)).toBe(resolverPaisParada(P("AU"), b));
  expect(mapaPaisPorNome(a).get("AUSTRALIA")).toBe(resolverPaisParada(P("AU"), a)!);
  expect([...mapaPaisPorNome(a)]).toEqual([...mapaPaisPorNome(b)]);
});
test("cache da semana por país: LRU com no máximo 6 semanas", () => {
  limparCacheCharts();
  const futuro = Date.now() + 60_000;
  const ent = () => ({ valor: Promise.resolve({} as any), expiresAt: futuro });
  for (let i = 1; i <= 8; i++) gravarSemanaPaisesCache(`0${i}/01/2026`, ent());
  expect(tamanhoCacheSemanaPaises()).toBe(6);
  // vencida é descartada na inserção seguinte
  gravarSemanaPaisesCache("vencida", { valor: Promise.resolve({} as any), expiresAt: Date.now() - 1 });
  gravarSemanaPaisesCache("09/01/2026", ent());
  expect(tamanhoCacheSemanaPaises()).toBe(6);
  limparCacheCharts();
  expect(tamanhoCacheSemanaPaises()).toBe(0);
});
test("resolverPaisParada: aliases sem acento; ausente → parada omitida", () => {
  expect(resolverPaisParada(P("EUA"), new Set(["EUA"]))).toBe("EUA");
  expect(resolverPaisParada(P("AU"), new Set(["AUSTRALIA"]))).toBe("AUSTRALIA");
  const r = paradasDaSemana([ms("a")], [], REGRAS_PADRAO, new Set(["REINO UNIDO"]));
  expect(r.map((x) => x.parada.id)).toEqual(["UK"]);
  expect(r[0].linhas[0].st).toBe("NEW");
});

// ───────────── Orquestrador da semana (SQLite em memória) ─────────────

/** Schema + 2 semanas (Global 100 + 4 plataformas) + pais_peso + artista_info + musica_foco. */
async function bancoDeTeste(o: { semApple?: boolean; semSales?: boolean } = {}) {
  const db = criarD1Sqlite();
  for (const s of CHARTS_D1_SCHEMA) db.exec(s);
  const musicas = [
    ["Amanda - Koala", "Amanda"],
    ["Bob - Freedom", "Bob"],
    ["Bob - Liberty", "Bob"],
    ["Carl - Tea", "Carl"],
    ["Dua - Hit", "Dua"],
  ];
  const charts = ["BILLBOARD HOT 100", "SPOTIFY", "YOUTUBE"];
  if (!o.semApple) charts.push("APPLE MUSIC");
  if (!o.semSales) charts.push("DIGITAL SALES");
  const semana = (data: string, fator: number) =>
    charts.flatMap((chart, ci) =>
      // Ordem muda por chart/semana: rankings diferentes entre plataformas.
      musicas.map((_, i) => musicas[(i + ci + fator) % musicas.length]).map(([titulo, art], i) =>
        [chart, data, String(i + 1), titulo, String((musicas.length - i) * 1000 * fator), "", "", art]),
    );
  const pesos = [
    ["ESTADOS UNIDOS", "30,00%", "35,00%", "25,00%"],
    ["REINO UNIDO", "8,00%", "9,00%", "6,00%"],
    ["AUSTRÁLIA", "2,00%", "2,50%", "1,50%"],
  ];
  const artistas = [["Amanda", "Australia", "", ""], ["Bob", "Reino Unido", "", ""], ["Carl", "Estados Unidos", "", ""]];
  const ingerir = async (data: string, fator: number) => {
    const r = await ingerirSemana(db, { linhas: semana(data, fator), modo: "historico", pesos, artistas });
    if (!r.ok) throw new Error(JSON.stringify(r));
  };
  await ingerir("04/11/2026", 1);
  await ingerir("11/11/2026", 2);
  db.exec("INSERT INTO musica_foco (codigo_unico, pais, desde, por_admin) VALUES ('C1', 'AUSTRALIA', '2026-01-01', 0)");
  return Object.assign(db, { ingerir });
}

test("calcularSemanaPaises: COUNTRIES e paradas; mesma música em 4 plataformas não duplica; fixo por data", async () => {
  const db = await bancoDeTeste(); // helper no próprio arquivo: schema + 2 semanas + pais_peso + artista_info + musica_foco
  const a = await calcularSemanaPaises(db, "11/11/2026", new Map(), new Map());
  const b = await calcularSemanaPaises(db, "11/11/2026", new Map(), new Map());
  expect(a).toEqual(b);
  const uk = a.paradas.filter((l) => l.pais === "UK Official Charts");
  expect(new Set(uk.map((l) => l.tit)).size).toBe(uk.length);
  expect(a.countries.get("SPOTIFY")!.length).toBeGreaterThan(0);
  // mudar chart_config não muda semana que já tem regras gravadas
  await db.prepare("INSERT OR REPLACE INTO chart_config (chave, valor) VALUES ('nac_max','9')").run();
  expect(await calcularSemanaPaises(db, "11/11/2026", new Map(), new Map())).toEqual(a);
});
test("semana só com Spotify/YouTube/Global (antes de Apple e Sales): paradas sem NaN", async () => {
  const db = await bancoDeTeste({ semApple: true, semSales: true });
  const r = await calcularSemanaPaises(db, "11/11/2026", new Map(), new Map());
  expect(r.paradas.every((l) => !String(l.val).includes("NaN"))).toBe(true);
});
test("calcularSemanaPaises: ingestão grava as regras da semana uma vez; formato das linhas; foco via catálogo", async () => {
  const db = await bancoDeTeste();
  const regras = await db.prepare("SELECT data, versao FROM chart_regras_semana ORDER BY data").all<{ data: string; versao: number }>();
  expect(regras.results).toEqual([{ data: "2026-11-04", versao: 1 }, { data: "2026-11-11", versao: 1 }]);
  const a = await calcularSemanaPaises(db, "11/11/2026", new Map(), new Map());
  // COUNTRIES só das 3 plataformas com recorte; sem "DIGITAL SALES COUNTRIES".
  expect([...a.countries.keys()].sort()).toEqual(["APPLE MUSIC", "SPOTIFY", "YOUTUBE"]);
  const eua = a.paradas.filter((l) => l.pais === "Billboard Hot 100");
  expect(eua.map((l) => l.pos)).toEqual(eua.map((_, i) => i + 1));
  expect(eua[0]).toMatchObject({ mes: "11/11/2026", ordem: 1, desc: "Estados Unidos · vendas + streaming" });
  expect(["↑", "↓", "=", "NEW"]).toContain(eua[0].st);
  expect(ROTULO_PARADAS).toBe("PARADAS OFICIAIS");
  // Foco na Austrália (via codigo_unico do catálogo) aumenta o valor de Dua lá.
  const cat = indexarCatalogo([{ titulo: "Hit", artista: "Dua", codigo_unico: "C1", capa_url: "", genero: "", tipo_single: "" }]);
  const comFoco = await calcularSemanaPaises(db, "11/11/2026", cat, new Map());
  const valAu = (s: typeof a) =>
    Number(s.countries.get("SPOTIFY")!.find((l) => l.pais === "AUSTRÁLIA" && l.tit === "Dua - Hit")!.val.replace(/\D/g, ""));
  expect(valAu(comFoco)).toBeGreaterThan(valAu(a));
});

/** Grava (substitui) as regras de uma semana, partindo do padrão. */
async function gravarRegras(db: Awaited<ReturnType<typeof bancoDeTeste>>, dataIso: string, mudar: (r: typeof REGRAS_PADRAO) => void) {
  const r = structuredClone(REGRAS_PADRAO);
  mudar(r);
  await db.prepare("INSERT OR REPLACE INTO chart_regras_semana (data, versao, regras) VALUES (?, 1, ?)").bind(dataIso, JSON.stringify(r)).run();
}
const lerRegras = async (db: Awaited<ReturnType<typeof bancoDeTeste>>, dataIso: string) =>
  parseRegrasSemana((await db.prepare("SELECT regras FROM chart_regras_semana WHERE data = ?").bind(dataIso).all<{ regras: string }>()).results[0]?.regras)!;

test("regras gravadas da semana mandam no cálculo; reingestão após mudar chart_config mantém a linha original", async () => {
  const db = await bancoDeTeste();
  const base = await calcularSemanaPaises(db, "11/11/2026", new Map(), new Map());
  expect(base.paradas.some((l) => l.pais === "UK Official Charts")).toBe(true);

  await gravarRegras(db, "2026-11-11", (r) => {
    r.paises.nac_min = 8;
    r.paises.nac_max = 9;
    r.paradas = r.paradas.filter((p) => p.id !== "UK");
  });
  const mudada = await calcularSemanaPaises(db, "11/11/2026", new Map(), new Map());
  expect(mudada.paradas.some((l) => l.pais === "UK Official Charts")).toBe(false);
  expect(mudada.countries).not.toEqual(base.countries);
  // Amanda (australiana) ganha mais na Austrália com o bônus de nacionalidade maior.
  const valAu = (s: typeof base) =>
    Number(s.countries.get("SPOTIFY")!.find((l) => l.pais === "AUSTRÁLIA" && l.tit === "Amanda - Koala")!.val.replace(/\D/g, ""));
  expect(valAu(mudada)).toBeGreaterThan(valAu(base));

  // Reenvio da semana com chart_config diferente: INSERT OR IGNORE mantém a linha gravada.
  const antes = await lerRegras(db, "2026-11-11");
  await db.prepare("INSERT OR REPLACE INTO chart_config (chave, valor) VALUES ('nac_max','3')").run();
  await db.ingerir("11/11/2026", 2);
  expect(await lerRegras(db, "2026-11-11")).toEqual(antes);
  expect(await calcularSemanaPaises(db, "11/11/2026", new Map(), new Map())).toEqual(mudada);
});
test("paradas: `st` compara com a semana anterior calculada pelas regras dela (d-1)", async () => {
  const db = await bancoDeTeste();
  const uk = (s: Awaited<ReturnType<typeof calcularSemanaPaises>>) => s.paradas.filter((l) => l.pais === "UK Official Charts");
  // Mesmas 5 músicas nas duas semanas: ninguém é NEW.
  expect(uk(await calcularSemanaPaises(db, "11/11/2026", new Map(), new Map())).some((l) => l.st === "NEW")).toBe(false);
  // Na semana anterior o UK tinha só Top 2: quem não estava lá vira NEW agora.
  await gravarRegras(db, "2026-11-04", (r) => { r.paradas.find((p) => p.id === "UK")!.top = 2; });
  const linhas = uk(await calcularSemanaPaises(db, "11/11/2026", new Map(), new Map()));
  expect(linhas.length).toBeGreaterThan(2);
  expect(linhas.filter((l) => l.st !== "NEW").length).toBe(2);
});

// ───────────── API /api/charts: COUNTRIES (regra C) e PARADAS OFICIAIS ─────────────
import { googleSheetsService } from "../backend/src/services/googleSheetsService";
import { chartD1DaAba, chartsApiController, limparCacheCharts, gravarSemanaPaisesCache, tamanhoCacheSemanaPaises } from "../backend/src/controllers/chartsController";

test("chartD1DaAba: PARADAS OFICIAIS lê as datas do Global 100", () => {
  expect(chartD1DaAba("PARADAS OFICIAIS")).toEqual({ chart: "BILLBOARD HOT 100", paises: true, paradas: true });
  expect(chartD1DaAba("SPOTIFY COUNTRIES")).toEqual({ chart: "SPOTIFY", paises: true, paradas: false });
  expect(chartD1DaAba("SPOTIFY")).toEqual({ chart: "SPOTIFY", paises: false, paradas: false });
  expect(chartD1DaAba("DIGITAL SALES COUNTRIES")).toBeNull();
});

/** Roda `fn` com `db` como D1 do app e as planilhas trocadas por stubs vazios (registra o que foi lido). */
async function comApi(db: unknown, fn: (lidas: string[]) => Promise<void>) {
  const g = globalThis as Record<string, unknown>;
  const svc = googleSheetsService as unknown as Record<string, { readValues: (s: string) => Promise<string[][]> }>;
  const chaves = ["chartsBase", "chartsCountries", "chartsAlbums", "principal"];
  const antes = { db: g.__CATALOGO_DB__, ...Object.fromEntries(chaves.map((k) => [k, svc[k].readValues])) } as Record<string, any>;
  const lidas: string[] = [];
  g.__CATALOGO_DB__ = db;
  for (const k of chaves) svc[k].readValues = async (s: string) => { lidas.push(`${k}:${s}`); return []; };
  limparCacheCharts();
  try {
    await fn(lidas);
  } finally {
    g.__CATALOGO_DB__ = antes.db;
    for (const k of chaves) svc[k].readValues = antes[k];
    limparCacheCharts();
  }
}
const chamar = (q: string) => chartsApiController(new Request(`http://x/api/charts?${q}`));
const PARADAS_Q = (data: string) => `action=getChart&tab=${encodeURIComponent(ROTULO_PARADAS)}&date=${encodeURIComponent(data)}`;

test("/api/charts PARADAS OFICIAIS e COUNTRIES: semana calculada (regra C), JSON idêntico entre chamadas, sem planilha", async () => {
  const db = await bancoDeTeste();
  expect(await ingerirSemana(db, { ativar: true })).toEqual({ ok: true, ativo: true });
  const esperado = await calcularSemanaPaises(db, "11/11/2026", new Map(), new Map());
  // Conta os cálculos de semana (a consulta de chart_semana do orquestrador).
  let calculos = 0;
  const contando = { prepare: (sql: string) => { if (/FROM chart_semana\s+WHERE chart IN/.test(sql)) calculos++; return db.prepare(sql); } };
  await comApi(contando, async (lidas) => {
    expect(await (await chamar(`action=getFilters&tab=${encodeURIComponent(ROTULO_PARADAS)}`)).json())
      .toEqual({ dates: ["11/11/2026", "04/11/2026"], styles: [] });
    const r1 = await (await chamar(PARADAS_Q("11/11/2026"))).text();
    const r2 = await (await chamar(PARADAS_Q("11/11/2026"))).text();
    expect(r2).toBe(r1);
    const linhas = JSON.parse(r1) as { pais: string }[];
    expect(linhas).toEqual(JSON.parse(JSON.stringify(esperado.paradas)));
    expect(linhas.length).toBeGreaterThan(0);
    const nomes = new Set(linhas.map((l) => l.pais));
    expect(nomes.has("UK Official Charts")).toBe(true);
    expect(nomes.has("Billboard Hot 100")).toBe(true);
    // COUNTRIES da mesma semana sai do cache da semana (sem recalcular).
    const antes = calculos;
    const spotify = await (await chamar("action=getChart&tab=SPOTIFY%20COUNTRIES&date=11%2F11%2F2026")).json();
    expect(spotify).toEqual(JSON.parse(JSON.stringify(esperado.countries.get("SPOTIFY"))));
    expect(calculos).toBe(antes);
    expect(lidas).toEqual([]);
  });
});
test("/api/charts: Cache-Control longo só para semana passada servida do D1", async () => {
  const db = await bancoDeTeste();
  expect(await ingerirSemana(db, { ativar: true })).toEqual({ ok: true, ativo: true });
  await comApi(db, async () => {
    const atual = await chamar(PARADAS_Q("11/11/2026"));
    expect(atual.headers.get("Cache-Control")).toBeNull();
    const passada = await chamar(PARADAS_Q("04/11/2026"));
    expect(passada.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(((await passada.json()) as unknown[]).length).toBeGreaterThan(0);
    // Também na resposta que sai do cache por URL.
    expect((await chamar(PARADAS_Q("04/11/2026"))).headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect((await chamar("action=getChart&tab=SPOTIFY&date=04%2F11%2F2026")).headers.get("Cache-Control")).toBe("public, max-age=86400");
  });
});
test("/api/charts PARADAS OFICIAIS sem D1 ativo → [] e nenhuma planilha lida", async () => {
  const db = await bancoDeTeste(); // leitura do D1 não ativada
  await comApi(db, async (lidas) => {
    expect(await (await chamar(PARADAS_Q("11/11/2026"))).json()).toEqual([]);
    expect(await (await chamar(`action=getFilters&tab=${encodeURIComponent(ROTULO_PARADAS)}`)).json()).toEqual({ dates: [], styles: [] });
    expect(lidas).toEqual([]);
  });
});

test("validarGravacaoFoco: trava após definido; admin troca; país inválido recusado", () => {
  const P = new Set(["BRASIL", "REINO UNIDO"]);
  expect(validarGravacaoFoco([], "BRASIL", P, false)).toEqual({ ok: true });
  expect(validarGravacaoFoco([], "GLOBAL", P, false)).toEqual({ ok: true });
  expect(validarGravacaoFoco([], "MARTE", P, false)).toMatchObject({ ok: false, status: 400 });
  const h = [{ pais: "BRASIL", desde: "2026-11-01" }];
  expect(validarGravacaoFoco(h, "REINO UNIDO", P, false)).toMatchObject({ ok: false, status: 409 });
  expect(validarGravacaoFoco(h, "REINO UNIDO", P, true)).toEqual({ ok: true });
  expect(validarGravacaoFoco(h, "BRASIL", P, true)).toMatchObject({ ok: false, status: 409 });
});

// ---- Handlers reais do foco (GET/POST) sobre SQLite em memória ----
async function comFocoDb(fn: (db: ReturnType<typeof criarD1Sqlite>) => Promise<void>) {
  const db = criarD1Sqlite();
  for (const sql of CHARTS_D1_SCHEMA) await db.prepare(sql).run();
  for (const [plat, pais] of [["spotify", "BRASIL"], ["youtube", "BRASIL"], ["youtube", "AFRICA DO SUL"], ["spotify", "ÁFRICA DO SUL"], ["spotify", "REINO UNIDO"]]) {
    await db.prepare("INSERT INTO pais_peso (plataforma, pais, peso) VALUES (?, ?, 1)").bind(plat, pais).run();
  }
  const g = globalThis as Record<string, unknown>;
  const antes = g.__CATALOGO_DB__;
  g.__CATALOGO_DB__ = db;
  try { await fn(db); } finally { g.__CATALOGO_DB__ = antes; }
}
const focoGet = async (codigo: string) => (await musicaFocoController(new Request(`http://x/api/musica-foco?codigo=${codigo}`), "")).json() as Promise<any>;
const focoPost = (codigo: string, pais: string, token?: string) =>
  musicaFocoController(new Request("http://x/api/musica-foco", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify({ codigo, pais }),
  }), "");

test("foco API: lista de países distintos, alfabética, sem duplicata por acento", async () => {
  await comFocoDb(async () => {
    const r = await (await musicaFocoController(new Request("http://x/api/musica-foco/paises"), "paises")).json() as any;
    expect(r.success).toBe(true);
    expect(r.paises).toEqual(["ÁFRICA DO SUL", "BRASIL", "REINO UNIDO"]);
  });
});

test("foco API: não-admin grava, GET devolve travado; 2ª gravação 409; admin troca; mesmo dia atualiza a linha; grafia de pais_peso", async () => {
  await comFocoDb(async (db) => {
    expect((await focoGet("EMP1")).foco).toBeNull();
    expect((await focoGet("EMP1")).travado).toBe(false);

    // (f) entrada com outra caixa/acento → grafia de pais_peso
    const p1 = await focoPost("EMP1", "áfrica do sul");
    expect(p1.status).toBe(200);
    const j1 = await p1.json() as any;
    expect(j1.foco.pais).toBe("ÁFRICA DO SUL");
    const g = await focoGet("EMP1");
    expect(g.travado).toBe(true);
    expect(g.foco.pais).toBe("ÁFRICA DO SUL");

    // (c) segunda gravação de não-admin
    const p2 = await focoPost("EMP1", "BRASIL");
    expect(p2.status).toBe(409);
    expect((await p2.json() as any).error).toBe("O foco deste lançamento já foi definido. Peça à administração para alterar.");

    // (d) admin real (token da conta fixa de admin)
    const token = await issueSessionToken("admin", ADMIN_TG_ID);
    const p3 = await focoPost("EMP1", "brasil", token);
    expect(p3.status).toBe(200);
    expect((await focoGet("EMP1")).foco.pais).toBe("BRASIL");
    const rep = await focoPost("EMP1", "Brasil", token);
    expect(rep.status).toBe(409);
    expect((await rep.json() as any).error).toBe("Esse já é o foco atual.");

    // (e) mesmo dia: segunda troca do admin atualiza a linha, sem duplicar
    const p4 = await focoPost("EMP1", "REINO UNIDO", token);
    expect(p4.status).toBe(200);
    const linhas = (await db.prepare("SELECT pais, por_admin FROM musica_foco WHERE codigo_unico = ?").bind("EMP1").all<{ pais: string; por_admin: number }>()).results;
    expect(linhas).toEqual([{ pais: "REINO UNIDO", por_admin: 1 }]);

    // país inválido
    expect((await focoPost("EMP2", "MARTE")).status).toBe(400);
  });
});

test("foco API: não-admin nunca sobrescreve linha do mesmo dia (corrida) → 409 e linha intacta", async () => {
  await comFocoDb(async (db) => {
    const hoje = new Date().toISOString().slice(0, 10);
    // Linha já gravada hoje por outra requisição, depois da validação desta.
    const orig = db.prepare.bind(db);
    let injetou = false;
    (db as any).prepare = (sql: string) => {
      const st = orig(sql);
      if (!injetou && sql.startsWith("INSERT INTO musica_foco")) {
        injetou = true;
        orig("INSERT INTO musica_foco (codigo_unico, pais, desde, por_admin) VALUES ('EMP9', 'BRASIL', ?, 0)").bind(hoje).run();
      }
      return st;
    };
    const r = await focoPost("EMP9", "REINO UNIDO");
    expect(r.status).toBe(409);
    expect((await r.json() as any).error).toBe("O foco deste lançamento já foi definido. Peça à administração para alterar.");
    const linhas = (await orig("SELECT pais FROM musica_foco WHERE codigo_unico = 'EMP9'").all<{ pais: string }>()).results;
    expect(linhas).toEqual([{ pais: "BRASIL" }]);
  });
});

test("paradas: pontos na moeda do Global 100 (≤ 1000) sem mudar a ordem", () => {
  const l = ["a", "b", "c"].map((t, i) => ms(t, { pontosGlobal100: [705, 400, 100][i], porPais: { SPOTIFY: pais(1_000_000 * (3 - i)) }, totalGlobal: { SPOTIFY: 187_000_000 / (i + 1) } }));
  const p = P("UK");
  const com = calcularParada(l, p, "REINO UNIDO", 0.45);
  // Ordem esperada: direto pelas unidades brutas do país.
  const bruto = [...l].sort((x, y) => pontos(fontes(y, "REINO UNIDO", 0.45), p) - pontos(fontes(x, "REINO UNIDO", 0.45), p)).map((m) => m.tituloNorm);
  expect(com.map((x) => x.tituloNorm)).toEqual(bruto);
  for (const x of com) expect(x.val).toBeLessThanOrEqual(PONTOS_MAX_PARADA);
  expect(fatorPontos(l, p, 0.45)).toBeGreaterThan(0);
});

test("paradas: música fora do Global 100 com unidades enormes fica em 1000 e mantém a posição", () => {
  const l = [
    ms("g", { pontosGlobal100: 900, porPais: { SPOTIFY: pais(1_000) } }),
    ms("h", { pontosGlobal100: 0, porPais: { SPOTIFY: pais(900_000_000) } }),
  ];
  const r = calcularParada(l, P("UK"), "REINO UNIDO", 0.45);
  expect(r[0]).toMatchObject({ tituloNorm: "h", pos: 1, val: 1000 });
  expect(r[1].tituloNorm).toBe("g");
});

test("paradas: proporção pontos/unidades distorcida continua ≤ 1000", () => {
  const l = [
    ms("x", { pontosGlobal100: 1000, porPais: { SPOTIFY: pais(5_000_000) }, totalGlobal: { SPOTIFY: 5_000_000 } }),
    ms("y", { pontosGlobal100: 1, porPais: { SPOTIFY: pais(4_000_000) }, totalGlobal: { SPOTIFY: 4_000_000 } }),
  ];
  for (const x of calcularParada(l, P("UK"), "REINO UNIDO", 0.45)) expect(x.val).toBeLessThanOrEqual(1000);
});

test("ao vivo por país: soma + resto = streams; fatia fixa na semana; países por peso", () => {
  const pesos: Pesos = new Map([["EUA", 0.3], ["BRASIL", 0.05], ["AUSTRÁLIA", 0.02]]);
  const R = REGRAS_PADRAO.paises;
  const it = (t: string, n: number, nac: string[] = []): ItemAoVivo =>
    ({ t, n, c: "", artistas: [t.split(" - ")[0]], nacionalidades: new Set(nac), foco: null });
  const a = rankingAoVivoPorPais([it("A - x", 1000, ["BRASIL"]), it("B - y", 800)], pesos, "2026-11-18", R);
  expect([...new Set(a.map((l) => l.pais))]).toEqual(["EUA", "BRASIL", "AUSTRÁLIA"]);
  const b = rankingAoVivoPorPais([it("A - x", 2000, ["BRASIL"]), it("B - y", 1600)], pesos, "2026-11-18", R);
  // streams dobraram → valores dobram (mesma fatia na mesma semana)
  const va = (l: LinhaAoVivoPais[], p: string, t: string) => Number(l.find((x) => x.pais === p && x.t === t)!.s.replace(/\./g, ""));
  expect(Math.abs(va(b, "BRASIL", "A - x") - 2 * va(a, "BRASIL", "A - x"))).toBeLessThanOrEqual(1);
  expect(rankingAoVivoPorPais([it("A - x", 1000, ["BRASIL"])], pesos, "2026-11-18", R))
    .toEqual(rankingAoVivoPorPais([it("A - x", 1000, ["BRASIL"])], pesos, "2026-11-18", R));
});
test("ao vivo por país: valor inválido conta 0; sem nacionalidade não some", () => {
  const pesos: Pesos = new Map([["BRASIL", 0.05]]);
  const r = rankingAoVivoPorPais(
    [{ t: "Z - w", n: NaN, c: "", artistas: [], nacionalidades: new Set(), foco: null }],
    pesos, "2026-11-18", REGRAS_PADRAO.paises);
  expect(r).toEqual([{ pais: "BRASIL", pos: 1, t: "Z - w", s: "0", c: "", art: "Z" }]);
});
test("ao vivo por país: itens com a mesma chave são somados (uma linha por país)", () => {
  const pesos: Pesos = new Map([["EUA", 0.3], ["BRASIL", 0.05]]);
  const R = REGRAS_PADRAO.paises;
  const mk = (t: string, n: number): ItemAoVivo => ({ t, n, c: "capa", artistas: ["A"], nacionalidades: new Set(), foco: null });
  const dup = rankingAoVivoPorPais([mk("A - x", 600), mk("a - X", 400), mk("B - y", NaN)], pesos, "2026-11-18", R);
  const uno = rankingAoVivoPorPais([mk("A - x", 1000), mk("B - y", NaN)], pesos, "2026-11-18", R);
  expect(dup.filter((l) => l.pais === "EUA").length).toBe(2);
  expect(dup).toEqual(uno);
  expect(dup.find((l) => l.pais === "EUA")!.t).toBe("A - x");
});
test("regra C: soma dos países + resto = streams (sem bônus/variação)", () => {
  const pesos: Pesos = new Map([["EUA", 0.3], ["BRASIL", 0.05], ["AUSTRÁLIA", 0.02]]);
  const R = { ...REGRAS_PADRAO.paises, variacao: 0 };
  const m: EntradaMusica = { tituloNorm: "a x", titulo: "A - x", artistaPrincipal: "A", artistas: ["A"], valor: 1000, nacionalidades: new Set(), foco: null };
  const por = valoresPorPais([m], pesos, "2026-11-18", R).get("a x")!;
  const soma = [...por.values()].reduce((x, y) => x + y, 0);
  const resto = 1000 * Math.max(0, 1 - 0.37);
  expect(soma).toBeLessThanOrEqual(1000);
  expect(Math.abs(soma + resto - 1000)).toBeLessThanOrEqual(1);
});

test("calcularAoVivoPaises: usa próxima data de chart; vazio sem chart_datas/pesos", async () => {
  expect(proximaDataChart("2026-11-11")).toBe("2026-11-18");
  const vazio = criarD1Sqlite(); // sem tabelas
  limparCacheAoVivoPaises();
  expect(await calcularAoVivoPaises(vazio, { spotify: [{ t: "Amanda - Koala", n: 10, c: "" }], apple: [], youtube: [] }, new Map()))
    .toEqual({ spotify: [], apple: [], youtube: [] });
  const db = await bancoDeTeste();
  limparCacheAoVivoPaises();
  const entrada = { spotify: [{ t: "Amanda - Koala", n: 1000, c: "" }, { t: "Bob - Freedom", n: 900, c: "" }], apple: [], youtube: [] };
  const r = await calcularAoVivoPaises(db, entrada, new Map());
  expect(r.spotify.length).toBeGreaterThan(0);
  expect(r.apple).toEqual([]);
  limparCacheAoVivoPaises();
  expect(await calcularAoVivoPaises(db, entrada, new Map())).toEqual(r);
});
