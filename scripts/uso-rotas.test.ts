import { test, expect, beforeEach, mock } from "bun:test";
import { instalarFakeD1 } from "./helpers/fakeD1";
// Rotas de medição de uso (D1 + KV home-config).
// Uso: bash scripts/rodar-testes-isolados.sh scripts/uso-rotas.test.ts
const R = new URL("../backend/src/", import.meta.url).pathname;

let sessao: { id: string; usuario: string } | null = null;
let admin = false;
mock.module(R + "services/sessionService.ts", () => ({
  verifySessionToken: async (t?: string) => (t === "tok-beacon" ? { id: "beacon1", usuario: "B" } : sessao),
  extractBearerToken: (r: Request) => r.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
  requestProvesAdmin: async () => admin,
}));

const C = await import(R + "controllers/usoController.ts");
const S = await import(R + "services/usoService.ts");

const lote = { versao: "anterior", aparelho: "celular", eventos: [{ evento: "tela", alvo: "home", n: 2 }], telas: ["home"] };
const post = (corpo: unknown, headers: Record<string, string> = {}) =>
  C.registrarUsoController(
    new Request("http://x/api/uso", {
      method: "POST",
      headers: { "Content-Type": "text/plain", ...headers },
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    }),
  );
const resumo = (q: string) => C.resumoUsoController(new Request(`http://x/api/uso/resumo?${q}`));

let sqlite: any;
beforeEach(() => {
  sqlite = instalarFakeD1();
  sessao = null;
  admin = false;
  (globalThis as any).__FLAGS_KV__ = undefined;
});

test("POST com sessão grava e conta o jogador", async () => {
  sessao = { id: "j1", usuario: "Ana" };
  const r = await post(lote, { authorization: "Bearer x" });
  const j = await r.json();
  expect(j.ok).toBe(true);
  expect(j.ativo).toBe(true);
  expect(j.gravadas).toBeGreaterThan(0);
  expect(sqlite.query("SELECT jogador FROM uso_jogador_dia").all()).toEqual([{ jogador: "j1" }]);
  expect(sqlite.query("SELECT contagem FROM uso_diario").all()).toEqual([{ contagem: 2 }]);
});

test("POST sem sessão grava só as contagens", async () => {
  const r = await post(lote);
  expect((await r.json()).ativo).toBe(true);
  expect(sqlite.query("SELECT * FROM uso_jogador_dia").all().length).toBe(0);
  expect(sqlite.query("SELECT * FROM uso_diario").all().length).toBe(1);
});

test("POST com token no corpo (beacon) identifica o jogador", async () => {
  await post({ ...lote, token: "tok-beacon" });
  expect(sqlite.query("SELECT jogador FROM uso_jogador_dia").all()).toEqual([{ jogador: "beacon1" }]);
});

test("KV com medicaoUso.enabled=false responde ativo:false e não grava", async () => {
  (globalThis as any).__FLAGS_KV__ = {
    get: async (k: string) => (k === "home-config" ? JSON.stringify({ medicaoUso: { enabled: false } }) : null),
  };
  const r = await post(lote);
  expect(await r.json()).toEqual({ ok: true, ativo: false });
  // desligado: nem as tabelas são criadas
  expect(sqlite.query("SELECT name FROM sqlite_master WHERE name LIKE 'uso_%'").all().length).toBe(0);
});

test("medicaoUsoLigada: ausente, JSON ruim ou KV quebrado = ligada", async () => {
  expect(await C.medicaoUsoLigada(undefined)).toBe(true);
  expect(await C.medicaoUsoLigada({ get: async () => "{ruim" })).toBe(true);
  expect(await C.medicaoUsoLigada({ get: async () => { throw new Error("x"); } })).toBe(true);
  expect(await C.medicaoUsoLigada({ get: async () => JSON.stringify({ medicaoUso: { enabled: true } }) })).toBe(true);
});

test("corpo inválido → 400", async () => {
  expect((await post("não é json")).status).toBe(400);
  expect((await post({ versao: "x" })).status).toBe(400);
});

test("resumo sem admin → 403; com admin devolve o ResumoUso", async () => {
  await post(lote);
  const dia = S.diaUTC(Date.now());
  expect((await resumo(`de=${dia}&ate=${dia}`)).status).toBe(403);
  admin = true;
  const r = await resumo(`de=${dia}&ate=${dia}`);
  expect(r.status).toBe(200);
  const j = await r.json();
  expect(j.telas).toEqual([{ alvo: "home", n: 2, jogadores: 0 }]);
});

test("resumo valida datas, ordem e período máximo de 90 dias", async () => {
  admin = true;
  expect((await resumo("de=abc&ate=2026-01-01")).status).toBe(400);
  expect((await resumo("de=2026-02-01&ate=2026-01-01")).status).toBe(400);
  expect((await resumo("de=2026-01-01&ate=2026-06-01")).status).toBe(400);
  expect((await resumo("de=2026-01-01&ate=2026-03-31")).status).toBe(200); // 90 dias
});

test("limparUsoDiaria apaga >90 dias, uma vez por dia", async () => {
  const agora = Date.UTC(2026, 10, 27);
  await S.garantirTabelasUso((globalThis as any).__CATALOGO_DB__);
  sqlite.exec("INSERT INTO uso_diario VALUES ('2026-01-01','anterior','celular','tela','a',1), ('2026-11-20','anterior','celular','tela','a',1)");
  const kv: Record<string, string> = {};
  const flags = { get: async (k: string) => kv[k] ?? null, put: async (k: string, v: string) => void (kv[k] = v) };
  expect(await C.limparUsoDiaria(flags, agora)).toBe(1);
  expect(kv["uso-limpeza-dia"]).toBe("2026-11-27");
  expect(await C.limparUsoDiaria(flags, agora)).toBeNull();
});
