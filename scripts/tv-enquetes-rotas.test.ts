import { test, expect, beforeEach, mock } from "bun:test";
import { instalarFakeD1 } from "./helpers/fakeD1";
// Rotas e aviso no chat das enquetes da Empire TV.
// Uso: bash scripts/rodar-testes-isolados.sh scripts/tv-enquetes-rotas.test.ts
const R = new URL("../backend/src/", import.meta.url).pathname;

const realG = await import(R + "services/googleSheetsService.ts");
let agenda: string[][] = [];
let appends: Array<{ aba: string; rows: unknown[][]; range: string }> = [];
let appendFalha = false;
mock.module(R + "services/googleSheetsService.ts", () => ({
  ...realG,
  appendRows: async (_k: string, aba: string, rows: unknown[][], range: string) => {
    if (appendFalha) throw new Error("planilha fora");
    appends.push({ aba, rows, range });
  },
  googleSheetsService: {
    ...realG.googleSheetsService,
    agendaTV: {
      readValues: async (aba: string) => (aba === "Agenda_TV" ? agenda : aba === "Regras" ? [["TIPO", "Label", "Faixa"]] : []),
      appendRow: async () => 2,
    },
    registrosCharts: { readValues: async () => [], updateValues: async () => {} },
  },
}));
mock.module(R + "services/prestigioService.ts", () => ({ somarPrestigio: async () => {} }));
let token: string | null = "tok";
let admin = true;
let sessao: { id: string; usuario: string } | null = { id: "j1", usuario: "Ana" };
mock.module(R + "services/sessionService.ts", () => ({
  verifySessionToken: async () => sessao,
  extractBearerToken: () => token,
  requestProvesAdmin: async () => admin,
}));

const C = await import(R + "controllers/tvController.ts");
const E = await import(R + "services/tvEnquetes.ts");

process.env.SUPABASE_URL = "http://supa";
process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
let inserts: Array<{ url: string; headers: any; body: any }> = [];
let supaFalha = false;
globalThis.fetch = (async (url: string, init?: any) => {
  if (init?.method === "POST") {
    inserts.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    if (supaFalha) throw new Error("supabase fora");
    return new Response("", { status: 201 });
  }
  return new Response("[]", { status: 200 });
}) as unknown as typeof fetch;

let sqls: string[] = [];
let n = 0;
function nova() {
  instalarFakeD1();
  const db = (globalThis as any).__CATALOGO_DB__;
  const prep = db.prepare;
  db.prepare = (s: string) => {
    sqls.push(s);
    return prep(s);
  };
  return db;
}
const req = (path: string, metodo: string, corpo?: unknown) =>
  new Request("http://x" + path, { method: metodo, ...(corpo ? { body: JSON.stringify(corpo) } : {}) });
const criar = (extra: Record<string, unknown> = {}, prog?: string) =>
  C.criarEnqueteChatController(
    req("/api/tv/enquetes", "POST", { programa_id: prog ?? "p" + n, pergunta: "Qual?", tipo: "unica", opcoes: ["A", "B"], ...extra }),
  );
const lerVotos = () => sqls.filter((s) => s.includes("FROM tv_enquete_voto")).length;

beforeEach(() => {
  n++;
  nova();
  sqls = [];
  appends = [];
  inserts = [];
  appendFalha = false;
  supaFalha = false;
  token = "tok";
  admin = true;
  sessao = { id: "j1", usuario: "Ana" };
  delete (globalThis as any).__FLAGS_KV__;
});

test("criar: 401 sem token, 403 sem admin, 400 inválida, 503 sem banco", async () => {
  token = null;
  expect((await criar()).status).toBe(401);
  token = "tok";
  admin = false;
  expect((await criar()).status).toBe(403);
  admin = true;
  const r = await criar({ opcoes: ["A"] });
  expect(r.status).toBe(400);
  expect((await r.json()).erro).toContain("2 a 10");
  expect(inserts.length).toBe(0);
  (globalThis as any).__CATALOGO_DB__ = undefined;
  expect((await criar()).status).toBe(503);
});

test("criar: devolve id e insere ENQ:: no chat como Empire TV", async () => {
  const r = await criar();
  const j = await r.json();
  expect(r.status).toBe(200);
  expect(j.ok).toBe(true);
  expect(inserts.length).toBe(1);
  expect(inserts[0].url).toBe("http://supa/rest/v1/tv_chat_messages");
  expect(inserts[0].headers.Prefer).toBe("return=minimal");
  expect(inserts[0].body).toEqual({ programa_id: "p" + n, user: "Empire TV", user_id: "empire-tv", text: `ENQ::${j.id}` });
});

test("criar: encerra_em_min vira horário do servidor; outros valores → 400", async () => {
  const db = (globalThis as any).__CATALOGO_DB__;
  const lerFim = async (id: string) =>
    (await db.prepare("SELECT encerra_em FROM tv_enquete WHERE programa_id = ? AND id = ?").bind("p" + n, id).all()).results[0].encerra_em;
  for (const min of [2, 5, 10, 15]) {
    const antes = Date.now();
    const r = await criar({ pergunta: "Qual " + min + "?", encerra_em_min: min });
    const depois = Date.now();
    expect(r.status).toBe(200);
    const fim = await lerFim((await r.json()).id);
    expect(fim).toBeGreaterThanOrEqual(antes + min * 60_000);
    expect(fim).toBeLessThanOrEqual(depois + min * 60_000);
  }
  const sem = await criar({ pergunta: "Sem?" });
  expect(await lerFim((await sem.json()).id)).toBeNull();
  const zero = await criar({ pergunta: "Zero?", encerra_em_min: 0 });
  expect(await lerFim((await zero.json()).id)).toBeNull();
  // horário absoluto do aparelho não é mais aceito como encerramento
  const abs = await criar({ pergunta: "Abs?", encerra_em: Date.now() + 120_000 });
  expect(await lerFim((await abs.json()).id)).toBeNull();
  const antes = inserts.length;
  for (const ruim of [1, 3, 7, 30, -5, "5x", 2.5, true]) {
    const r = await criar({ pergunta: "Ruim?", encerra_em_min: ruim });
    expect(r.status).toBe(400);
    expect((await r.json()).erro).toContain("Encerramento automático");
  }
  expect(inserts.length).toBe(antes);
});

test("falha do Supabase não impede a criação", async () => {
  supaFalha = true;
  const r = await criar();
  expect(r.status).toBe(200);
  expect((await r.json()).id.length).toBeGreaterThan(10);
});

test("votar: 401 sem sessão, 400 inválida, 200, 409 encerrada", async () => {
  const id = (await (await criar()).json()).id;
  const votar = (corpo: unknown) => C.votarEnqueteChatController(req("/api/tv/enquetes/votar", "POST", corpo));
  const base = { programa_id: "p" + n, enquete_id: id };
  sessao = null;
  expect((await votar({ ...base, opcoes: [0] })).status).toBe(401);
  sessao = { id: "j1", usuario: "Ana" };
  expect((await votar({ ...base, opcoes: [5] })).status).toBe(400);
  expect((await votar({ ...base, opcoes: [0] })).status).toBe(200);
  await C.encerrarEnqueteChatController(req("/api/tv/enquetes/encerrar", "POST", base));
  expect((await votar({ ...base, opcoes: [1] })).status).toBe(409);
});

test("encerrar: 403 sem admin; admin grava 1 appendRows e 1 inserção ENQRES", async () => {
  const id = (await (await criar()).json()).id;
  const base = { programa_id: "p" + n, enquete_id: id };
  await C.votarEnqueteChatController(req("/api/tv/enquetes/votar", "POST", { ...base, opcoes: [1] }));
  const enc = () => C.encerrarEnqueteChatController(req("/api/tv/enquetes/encerrar", "POST", base));
  admin = false;
  expect((await enc()).status).toBe(403);
  admin = true;
  inserts = [];
  expect((await enc()).status).toBe(200);
  expect(inserts.map((i) => i.body.text)).toEqual([`ENQRES::${id}`]);
  expect(appends.length).toBe(1);
  expect(appends[0].aba).toBe("Enquetes_TV");
  expect(appends[0].range).toBe("A:G");
  expect(appends[0].rows.map((r) => r.slice(1))).toEqual([
    ["p" + n, "Qual?", "unica", "A", 0, 0],
    ["p" + n, "Qual?", "unica", "B", 1, 100],
  ]);
  // segunda vez: já encerrada, nada novo
  await enc();
  expect(appends.length).toBe(1);
  expect(inserts.length).toBe(1);
});

test("falha da planilha ou do Supabase não derruba o encerrar", async () => {
  const id = (await (await criar()).json()).id;
  appendFalha = true;
  supaFalha = true;
  const r = await C.encerrarEnqueteChatController(req("/api/tv/enquetes/encerrar", "POST", { programa_id: "p" + n, enquete_id: id }));
  expect(r.status).toBe(200);
});

test("GET: exige programa_id; sem sessão meuVoto null; com sessão traz o voto", async () => {
  const id = (await (await criar()).json()).id;
  const get = (q: string) => C.listarEnquetesChatController(req("/api/tv/enquetes" + q, "GET"));
  expect((await get("")).status).toBe(400);
  await C.votarEnqueteChatController(req("/api/tv/enquetes/votar", "POST", { programa_id: "p" + n, enquete_id: id, opcoes: [1] }));
  sessao = null;
  let j = await (await get("?programa_id=p" + n)).json();
  expect(j.enquetes[0]).toMatchObject({ id, meuVoto: null, total: 1 });
  sessao = { id: "j1", usuario: "Ana" };
  j = await (await get("?programa_id=p" + n)).json();
  expect(j.enquetes[0].meuVoto).toEqual([1]);
  sessao = { id: "j2", usuario: "Bia" };
  j = await (await get("?programa_id=p" + n)).json();
  expect(j.enquetes[0].meuVoto).toBeNull();
});

test("GET repetido sempre lê contadores do banco (sem cache): voto aparece na hora", async () => {
  const id = (await (await criar()).json()).id;
  const get = async () =>
    (await (await C.listarEnquetesChatController(req("/api/tv/enquetes?programa_id=p" + n, "GET"))).json()).enquetes[0];
  expect((await get()).total).toBe(0);
  sqls = [];
  await get();
  expect(sqls.filter((x) => /^SELECT[\s\S]*FROM tv_enquete WHERE/.test(x)).length).toBe(1);
  expect(sqls.filter((x) => x.includes("FROM tv_enquete_voto") && !x.includes("jogador_id = ?")).length).toBe(0);
  await C.votarEnqueteChatController(req("/api/tv/enquetes/votar", "POST", { programa_id: "p" + n, enquete_id: id, opcoes: [0] }));
  const e3 = await get();
  expect(e3.total).toBe(1);
  expect(e3.meuVoto).toEqual([0]);
});

test("expiração por GET ou por votar posta ENQRES e grava a planilha uma única vez", async () => {
  const db = (globalThis as any).__CATALOGO_DB__;
  const prog = "p" + n;
  const mk = () => E.criarEnquete(db, { programaId: prog, pergunta: "Q?", tipo: "unica", opcoes: ["A", "B"], secreto: false, soFim: false, encerraEmMs: Date.now() + 40, criadaPor: "adm" }, Date.now());
  const a = await mk();
  const b = await mk();
  await new Promise((r) => setTimeout(r, 80));
  const get = () => C.listarEnquetesChatController(req("/api/tv/enquetes?programa_id=" + prog, "GET"));
  // votar na vencida: 409 + aviso
  const rv = await C.votarEnqueteChatController(req("/api/tv/enquetes/votar", "POST", { programa_id: prog, enquete_id: a, opcoes: [0] }));
  expect(rv.status).toBe(409);
  // GET fecha a outra, duas vezes seguidas
  await Promise.all([get(), get()]);
  await get();
  expect(inserts.map((i) => i.body.text).sort()).toEqual([`ENQRES::${a}`, `ENQRES::${b}`].sort());
  expect(appends.length).toBe(2);
  // votar de novo na já fechada não repete
  await C.votarEnqueteChatController(req("/api/tv/enquetes/votar", "POST", { programa_id: prog, enquete_id: a, opcoes: [0] }));
  expect(inserts.length).toBe(2);
});

test("evento-admin fim encerra enquetes abertas do grupo e avisa no chat", async () => {
  const MIN = 60_000;
  const p2 = (x: number) => String(x).padStart(2, "0");
  const d = new Date(Math.floor(Date.now() / MIN) * MIN - 60 * MIN - 3 * 3600_000);
  agenda = [
    ["Programa", "Tipo", "Material", "Buff", "Data", "Horario", "Capa_URL", "Status", "Topico_ID", "Topico_URL", "TIPO_EVENTO", "Duracao_Seg"],
    ["Show", "", "", "", `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`, `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`, "", "", "salaA", "", "Show", "1200"],
  ];
  const m = new Map<string, string>();
  (globalThis as any).__FLAGS_KV__ = { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) };
  const rowId = C.agruparTransmissoes(await C.readProgramas())[0].rowIds[0] as string;
  const db = (globalThis as any).__CATALOGO_DB__;
  const id = await E.criarEnquete(db, { programaId: rowId, pergunta: "Q?", tipo: "unica", opcoes: ["A", "B"], secreto: false, soFim: false, encerraEmMs: null, criadaPor: "adm" }, Date.now());
  const r = await C.registrarEventoAdminController(req("/api/tv/evento-admin", "POST", { programa_id: rowId, acao: "fim" }));
  expect(r.status).toBe(200);
  expect(inserts.map((i) => i.body.text)).toContain(`ENQRES::${id}`);
  expect(appends.length).toBe(1);
  expect((await E.listarEnquetes(db, rowId, null, Date.now()))[0].aberta).toBe(false);
});
