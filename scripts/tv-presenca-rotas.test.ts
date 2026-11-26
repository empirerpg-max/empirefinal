import { test, expect, beforeEach, mock } from "bun:test";
import { instalarFakeD1 } from "./helpers/fakeD1";
// Rotas de presença da Empire TV (D1 + relógio do servidor).
// Uso: bash scripts/rodar-testes-isolados.sh scripts/tv-presenca-rotas.test.ts
const R = new URL("../backend/src/", import.meta.url).pathname;

const realG = await import(R + "services/googleSheetsService.ts");
let appends: unknown[][] = [];
let agenda: string[][] = [];
mock.module(R + "services/googleSheetsService.ts", () => ({
  ...realG,
  googleSheetsService: {
    ...realG.googleSheetsService,
    agendaTV: {
      readValues: async (aba: string) => (aba === "Agenda_TV" ? agenda : []),
      appendRow: async (_aba: string, linha: unknown[]) => void appends.push(linha),
    },
  },
}));
let sessao: { id: string; usuario: string } | null = null;
mock.module(R + "services/sessionService.ts", () => ({
  verifySessionToken: async () => sessao,
  extractBearerToken: () => "tok",
  requestProvesAdmin: async () => false,
}));

const C = await import(R + "controllers/tvController.ts");
const P = await import(R + "services/tvPresenca.ts");

const post = (corpo: unknown) =>
  C.registrarPresencaTVController(new Request("http://x/api/tv/presenca", { method: "POST", body: JSON.stringify(corpo) }));
const get = (id: string) =>
  C.listarPresencaTVController(new Request(`http://x/api/tv/presenca?programa_id=${id}`));
const linhasD1 = (sqlite: any) => sqlite.query("SELECT * FROM tv_presenca").all();

let sqlite: any;
beforeEach(() => {
  sqlite = instalarFakeD1();
  appends = [];
  sessao = null;
  agenda = [];
  (globalThis as any).__FLAGS_KV__ = undefined;
});

test("(a) POST novo com sessão grava com o id da sessão, não o do corpo", async () => {
  sessao = { id: "sess1", usuario: "Ana" };
  const r = await post({ programa_id: "sala1", idades_ms: [0], telegram_id: "outro" });
  expect(await r.json()).toEqual({ ok: true, resultado: "gravado" });
  const l = linhasD1(sqlite);
  expect(l.length).toBe(1);
  expect(l[0].jogador_id).toBe("sess1");
  expect(l[0].nome).toBe("Ana");
});

test("(b) POST novo sem sessão usa telegram_id; sem nenhum dos dois = 400", async () => {
  await post({ programa_id: "sala1", idades_ms: [0], telegram_id: "tg9", nome: "Bia" });
  expect(linhasD1(sqlite)[0].jogador_id).toBe("tg9");
  expect((await post({ programa_id: "sala1", idades_ms: [0] })).status).toBe(400);
});

test("idades_ms inválido = 400", async () => {
  sessao = { id: "s", usuario: "A" };
  expect((await post({ programa_id: "p", idades_ms: "x" })).status).toBe(400);
  expect((await post({ programa_id: "p", idades_ms: [1, "a"] })).status).toBe(400);
  expect((await post({ programa_id: "p", idades_ms: new Array(401).fill(0) })).status).toBe(400);
});

test("(c) POST antigo só com watched_seconds faz append na planilha e não toca o D1", async () => {
  const r = await post({ programa_id: "sala1", telegram_id: "tg1", nome: "Cy", watched_seconds: 30 });
  expect((await r.json()).ok).toBe(true);
  expect(appends.length).toBe(1);
  expect(appends[0][4]).toBe("30");
  expect(sqlite.query("SELECT name FROM sqlite_master WHERE name='tv_presenca'").all().length).toBe(0);
});

test("(d) idades_ms [0] vira sempre o minuto do servidor", async () => {
  sessao = { id: "s", usuario: "A" };
  const antes = Math.floor(Date.now() / 60000);
  await post({ programa_id: "p", idades_ms: [0] });
  const depois = Math.floor(Date.now() / 60000);
  const mins = P.lerMinutos(linhasD1(sqlite)[0].minutos);
  expect(mins.length).toBe(1);
  expect(mins[0] >= antes && mins[0] <= depois).toBe(true);
});

test("(e) GET devolve percentual = calcularPresenca sobre a janela do grupo", async () => {
  const agora = Date.now();
  const ini = agora - 10 * 60_000;
  const d = new Date(ini - 3 * 3600_000); // Agenda em horário de Brasília (UTC-3)
  const p2 = (n: number) => String(n).padStart(2, "0");
  agenda = [
    ["Programa", "Tipo", "Material", "Buff", "Data", "Horario", "Capa_URL", "Status", "Topico_ID", "Topico_URL", "TIPO_EVENTO", "Duracao_Seg"],
    ["Show", "", "", "", `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`, `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`, "", "", "salaA", "", "", "1200"],
  ];
  const programas = await C.readProgramas();
  const grupo = C.agruparTransmissoes(programas)[0];
  const jan = C.janelaDoGrupo(grupo, {}, agora);
  expect(jan.aoVivo).toBe(true);
  const minIni = Math.floor(jan.inicioMs / 60000);
  const mins = [minIni, minIni + 1, minIni + 2, minIni + 3];
  const esperado = P.calcularPresenca(mins, jan.inicioMs, jan.fimMs);
  await P.garantirTabelaPresenca((globalThis as any).__CATALOGO_DB__);
  await P.gravarMinutosPresenca((globalThis as any).__CATALOGO_DB__, { programaId: "salaA", jogadorId: "u1", nome: "Dan", minutos: mins }, agora);
  const r = await get("salaA");
  const { data } = await r.json();
  expect(data.length).toBe(1);
  expect(data[0]).toMatchObject({ telegram_id: "u1", nome: "Dan", percentual: esperado.pct, watched_seconds: esperado.minutosPresentes * 60 });
  expect(data[0].percentual).toBeGreaterThan(0);
});

test("janelaDoGrupo: real > estimado; fim real > agora se ao vivo > endTs", () => {
  const g: any = { chave: "k", rowIds: [], salaIds: [], totalDuracaoSeg: 600, endTs: 1_000_000 };
  expect(C.janelaDoGrupo(g, {}, 2_000_000)).toEqual({ inicioMs: 400_000, fimMs: 1_000_000, aoVivo: false });
  expect(C.janelaDoGrupo(g, {}, 900_000)).toEqual({ inicioMs: 400_000, fimMs: 900_000, aoVivo: true });
  expect(C.janelaDoGrupo(g, { k: { inicioTs: 100 } }, 2_000_000)).toEqual({ inicioMs: 100, fimMs: 2_000_000, aoVivo: true });
  expect(C.janelaDoGrupo(g, { k: { inicioTs: 100, fimTs: 500 } }, 2_000_000)).toEqual({ inicioMs: 100, fimMs: 500, aoVivo: false });
});
