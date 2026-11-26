import { test, expect, beforeEach, mock } from "bun:test";
import { instalarFakeD1 } from "./helpers/fakeD1";
// Início/Término da transmissão pelo admin (Empire TV).
// Uso: bash scripts/rodar-testes-isolados.sh scripts/tv-evento-admin.test.ts
const R = new URL("../backend/src/", import.meta.url).pathname;

const realG = await import(R + "services/googleSheetsService.ts");
let agenda: string[][] = [];
let marcas: unknown[][] = [];
const REGRAS = [
  ["TIPO", "Label", "Faixa"],
  ["Show", "Faixa alta", "80 a 100"],
];
mock.module(R + "services/googleSheetsService.ts", () => ({
  ...realG,
  appendRows: async () => {},
  googleSheetsService: {
    ...realG.googleSheetsService,
    agendaTV: {
      readValues: async (aba: string) => {
        if (aba === "Agenda_TV") return agenda;
        if (aba === "Regras") return REGRAS;
        if (aba === "TV_Participacao_Processada") return [["Chave", "Programa", "ProcessadoEm"], ...marcas];
        return [];
      },
      appendRow: async (_aba: string, linha: unknown[]) => {
        if (linha[0] !== "Chave") marcas.push(linha);
        return 2;
      },
    },
    registrosCharts: { readValues: async () => [], updateValues: async () => {} },
  },
}));
mock.module(R + "services/prestigioService.ts", () => ({ somarPrestigio: async () => {} }));
let token: string | null = "tok";
let admin = true;
mock.module(R + "services/sessionService.ts", () => ({
  verifySessionToken: async () => null,
  extractBearerToken: () => token,
  requestProvesAdmin: async () => admin,
}));

const C = await import(R + "controllers/tvController.ts");

globalThis.fetch = (async () => new Response("[]", { status: 200 })) as typeof fetch;
process.env.SUPABASE_URL = "http://supa";
process.env.SUPABASE_SERVICE_ROLE_KEY = "k";

const MIN = 60_000;
const p2 = (n: number) => String(n).padStart(2, "0");
function montarAgenda() {
  const inicio = Math.floor(Date.now() / MIN) * MIN - 60 * MIN;
  const d = new Date(inicio - 3 * 3600_000);
  agenda = [
    ["Programa", "Tipo", "Material", "Buff", "Data", "Horario", "Capa_URL", "Status", "Topico_ID", "Topico_URL", "TIPO_EVENTO", "Duracao_Seg"],
    ["Show", "", "", "", `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`, `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`, "", "", "salaA", "", "Show", "1200"],
  ];
}
// O processamento só fecha a conta 5 min depois do fim (buffer de segurança):
// depois de gravar o evento no KV, o relógio do teste avança 6 min.
const dateNowOriginal = Date.now;
let saltoMs = 0;
Date.now = () => dateNowOriginal() + saltoMs;
function kvFalso() {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    puts: [] as string[],
    put: async function (this: any, k: string, v: string) {
      this.puts.push(v);
      m.set(k, v);
      saltoMs += 6 * MIN;
    },
  };
}
let kv = kvFalso();
const post = (corpo: unknown) =>
  C.registrarEventoAdminController(
    new Request("http://x/api/tv/evento-admin", { method: "POST", body: JSON.stringify(corpo) }),
  );
async function idDoGrupo() {
  return C.agruparTransmissoes(await C.readProgramas())[0].rowIds[0] as string;
}
const mapaKv = () => JSON.parse(kv.m.get("tv-eventos-reais") || "{}");

beforeEach(() => {
  instalarFakeD1();
  marcas = [];
  saltoMs = 0;
  token = "tok";
  admin = true;
  kv = kvFalso();
  (globalThis as any).__FLAGS_KV__ = kv;
  montarAgenda();
});

test("sem token = 401; não-admin = 403", async () => {
  const id = await idDoGrupo();
  token = null;
  expect((await post({ programa_id: id, acao: "inicio" })).status).toBe(401);
  token = "tok";
  admin = false;
  expect((await post({ programa_id: id, acao: "inicio" })).status).toBe(403);
  expect(kv.m.size).toBe(0);
});

test("campos inválidos ou programa sem grupo = 400", async () => {
  const id = await idDoGrupo();
  expect((await post({ programa_id: id, acao: "x" })).status).toBe(400);
  expect((await post({ acao: "inicio" })).status).toBe(400);
  expect((await post({ programa_id: "inexistente", acao: "inicio" })).status).toBe(400);
});

test("admin inicio grava inicioTs na chave do grupo e sobrescreve numa correção", async () => {
  const id = await idDoGrupo();
  const g = C.agruparTransmissoes(await C.readProgramas())[0];
  const r = await post({ programa_id: id, acao: "inicio" });
  const j = await r.json();
  expect(r.status).toBe(200);
  expect(j.ok).toBe(true);
  expect(j.acao).toBe("inicio");
  expect(typeof j.inicioTs).toBe("number");
  expect(mapaKv()[g.chave].inicioTs).toBe(j.inicioTs);
  kv.m.set("tv-eventos-reais", JSON.stringify({ [g.chave]: { inicioTs: 1 } }));
  await post({ programa_id: id, acao: "inicio" });
  expect(mapaKv()[g.chave].inicioTs).toBeGreaterThan(1);
});

test("fim duas vezes: a segunda não processa/credita de novo", async () => {
  const id = await idDoGrupo();
  await post({ programa_id: id, acao: "inicio" });
  const r1 = await (await post({ programa_id: id, acao: "fim" })).json();
  expect(r1.processamento.transmissoesProcessadas).toBe(1);
  expect(marcas.length).toBe(1);
  const r2 = await (await post({ programa_id: id, acao: "fim" })).json();
  expect(r2.processamento.transmissoesProcessadas).toBe(0);
  expect(marcas.length).toBe(1);
});

test("fim sem inicio grava só o fim e processa com o início da grade", async () => {
  const id = await idDoGrupo();
  const g = C.agruparTransmissoes(await C.readProgramas())[0];
  const r = await (await post({ programa_id: id, acao: "fim" })).json();
  expect(r.ok).toBe(true);
  expect(typeof r.fimTs).toBe("number");
  // 1ª gravação (antes do processamento limpar a entrada): só o fim.
  expect(JSON.parse(kv.puts[0])[g.chave]).toEqual({ fimTs: r.fimTs });
  expect(r.processamento.transmissoesProcessadas).toBe(1);
});

test("inicio depois do fim já gravado = 409 com erro, KV intacto", async () => {
  const id = await idDoGrupo();
  const g = C.agruparTransmissoes(await C.readProgramas())[0];
  kv.m.set("tv-eventos-reais", JSON.stringify({ [g.chave]: { inicioTs: 10, fimTs: 20 } }));
  const r = await post({ programa_id: id, acao: "inicio" });
  expect(r.status).toBe(409);
  const j = await r.json();
  expect(j.ok).toBe(false);
  expect(typeof j.erro).toBe("string");
  expect(mapaKv()[g.chave]).toEqual({ inicioTs: 10, fimTs: 20 });
});

const get = (q: string) =>
  C.lerEventoAdminController(new Request(`http://x/api/tv/evento-admin${q}`, { method: "GET" }));

test("GET evento-admin: só admin; devolve inicioTs/fimTs do grupo", async () => {
  const id = await idDoGrupo();
  const g = C.agruparTransmissoes(await C.readProgramas())[0];
  token = null;
  expect((await get(`?programa_id=${id}`)).status).toBe(401);
  token = "tok";
  admin = false;
  expect((await get(`?programa_id=${id}`)).status).toBe(403);
  admin = true;
  expect((await get("")).status).toBe(400);
  expect((await get("?programa_id=inexistente")).status).toBe(400);
  const vazio = await get(`?programa_id=${id}`);
  expect(vazio.status).toBe(200);
  expect(await vazio.json()).toEqual({ ok: true });
  kv.m.set("tv-eventos-reais", JSON.stringify({ [g.chave]: { inicioTs: 10 } }));
  expect(await (await get(`?programa_id=${id}`)).json()).toEqual({ ok: true, inicioTs: 10 });
  kv.m.set("tv-eventos-reais", JSON.stringify({ [g.chave]: { inicioTs: 10, fimTs: 20 } }));
  expect(await (await get(`?programa_id=${id}`)).json()).toEqual({ ok: true, inicioTs: 10, fimTs: 20 });
  expect(kv.puts.length).toBe(0);
});
