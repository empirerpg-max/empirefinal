import { test, expect, beforeEach, mock } from "bun:test";
import { instalarFakeD1 } from "./helpers/fakeD1";
// Rotas do Beta test (D1 + KV beta-config).
// Uso: bash scripts/rodar-testes-isolados.sh scripts/beta-test-rotas.test.ts
const R = new URL("../backend/src/", import.meta.url).pathname;

let sessao: { id: string; usuario: string } | null = null;
let admin = false;
mock.module(R + "services/sessionService.ts", () => ({
  verifySessionToken: async () => sessao,
  extractBearerToken: (r: Request) => r.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
  requestProvesAdmin: async () => admin,
  ADMIN_TG_ID: "999",
}));
const notificacoes: any[] = [];
mock.module(R + "controllers/notificacoesController.ts", () => ({
  registrarNotificacao: async (p: unknown) => {
    notificacoes.push(p);
  },
}));

const C = await import(R + "controllers/betaController.ts");

const req = (path: string, corpo?: unknown) =>
  new Request("http://x/api/beta/" + path, {
    method: corpo === undefined ? "GET" : "POST",
    headers: { authorization: "Bearer t", "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
const kv = (cfg: unknown) => {
  const guardado = { v: cfg === undefined ? null : JSON.stringify(cfg) };
  (globalThis as any).__FLAGS_KV__ = {
    get: async (k: string) => (k === "beta-config" ? guardado.v : null),
    put: async (k: string, v: string) => {
      if (k === "beta-config") guardado.v = v;
    },
  };
  return guardado;
};

let sqlite: any;
beforeEach(() => {
  sqlite = instalarFakeD1();
  sessao = { id: "j1", usuario: "Ana" };
  admin = false;
  notificacoes.length = 0;
  (globalThis as any).__FLAGS_KV__ = undefined;
  C._zerarCacheConfigBeta();
});

test("estado sem tabela no D1 cria a tabela e responde", async () => {
  const j = await (await C.betaEstadoController(req("estado"))).json();
  expect(j).toEqual({ ok: true, modo: "desligado", podeVer: false, podeVoltar: false, versao: "anterior", boasVindasVistas: false });
  expect(sqlite.query("SELECT name FROM sqlite_master WHERE name = 'beta_jogador'").all().length).toBe(1);
});

test("estado sem sessão", async () => {
  sessao = null;
  const j = await (await C.betaEstadoController(req("estado"))).json();
  expect(j).toEqual({ ok: true, modo: "desligado", podeVer: false, podeVoltar: false, versao: "anterior", boasVindasVistas: true });
});

test("estado com modo todos e sem escolha → beta", async () => {
  kv({ modo: "todos" });
  const j = await (await C.betaEstadoController(req("estado"))).json();
  expect(j.versao).toBe("beta");
  expect(j.podeVer).toBe(true);
});

test("estado: convidado por usuário, sem @ e sem diferença de caixa", async () => {
  kv({ modo: "convidados", convidados: ["@ANA"] });
  const j = await (await C.betaEstadoController(req("estado"))).json();
  expect(j.podeVer).toBe(true);
});

test("estado: admin pelo id vê o Beta mesmo desligado", async () => {
  sessao = { id: "999", usuario: "Chefe" };
  const j = await (await C.betaEstadoController(req("estado"))).json();
  expect(j.podeVer).toBe(true);
});

test("escolha beta e anterior gravam e voltam no estado", async () => {
  kv({ modo: "todos" });
  let r = await C.betaEscolhaController(req("escolha", { versao: "anterior" }));
  expect(await r.json()).toEqual({ ok: true, versao: "anterior" });
  expect((await (await C.betaEstadoController(req("estado"))).json()).versao).toBe("anterior");
  r = await C.betaEscolhaController(req("escolha", { versao: "beta" }));
  expect((await r.json()).versao).toBe("beta");
});

test("escolha anterior em obrigatorio → 409", async () => {
  kv({ modo: "obrigatorio" });
  const r = await C.betaEscolhaController(req("escolha", { versao: "anterior" }));
  expect(r.status).toBe(409);
});

test("escolha beta sem poder ver → 403; versão inválida → 400", async () => {
  expect((await C.betaEscolhaController(req("escolha", { versao: "beta" }))).status).toBe(403);
  kv({ modo: "todos" });
  expect((await C.betaEscolhaController(req("escolha", { versao: "xis" }))).status).toBe(400);
});

test("escolha com motivo grava também um reporte (texto vazio vira o rótulo)", async () => {
  kv({ modo: "todos" });
  await C.betaEscolhaController(req("escolha", { versao: "anterior", motivo: "lento", tela: "Home", rota: "/home?x=1" }));
  const l = sqlite.query("SELECT texto, motivo, rota, versao FROM beta_reporte").all();
  expect(l).toEqual([{ texto: "Ficou lento", motivo: "lento", rota: "/home", versao: "beta" }]);
});

test("reporte grava, valida e notifica uma vez", async () => {
  const r = await C.betaReporteController(
    req("reporte", { texto: " bug ", tela: "Home", rota: "/home?a=1", versao: "beta", printUrl: "http://ruim", tecnico: "x" }),
  );
  const j = await r.json();
  expect(j.ok).toBe(true);
  expect(typeof j.id).toBe("string");
  const l = sqlite.query("SELECT texto, rota, print_url FROM beta_reporte").all();
  expect(l[0].rota).toBe("/home");
  expect(l[0].print_url).toBe("");
  expect(notificacoes.length).toBe(1);
  expect(notificacoes[0]).toMatchObject({ evento: "reporte_beta", ownerId: "999", autorId: "j1", autorNome: "Ana", tipoMedia: "beta", tituloMedia: "Home", topicId: j.id });
});

test("reporte com texto vazio → 400; limite → 429", async () => {
  const r = await C.betaReporteController(req("reporte", { texto: "  ", tela: "t", rota: "/", versao: "beta" }));
  expect(r.status).toBe(400);
  expect((await r.json()).erro).toBe("Conte o que aconteceu.");
  for (let i = 0; i < 10; i++) await C.betaReporteController(req("reporte", { texto: "a", tela: "t", rota: "/", versao: "beta" }));
  const l = await C.betaReporteController(req("reporte", { texto: "a", tela: "t", rota: "/", versao: "beta" }));
  expect(l.status).toBe(429);
  expect((await l.json()).erro).toBe("Você já enviou muitos reportes hoje. Tente amanhã.");
});

test("reportes exige admin (sessão comum → 403)", async () => {
  expect((await C.betaReportesController(req("reportes"))).status).toBe(403);
  expect((await C.betaReporteStatusController(req("reporte/status", { id: "a", status: "visto" }))).status).toBe(403);
  expect((await C.betaConfigGetController(req("config"))).status).toBe(403);
  expect((await C.betaConfigPostController(req("config", { modo: "todos" }))).status).toBe(403);
});

test("reportes lista, filtra por status e muda status", async () => {
  await C.betaReporteController(req("reporte", { texto: "a", tela: "t", rota: "/", versao: "beta" }));
  admin = true;
  let j = await (await C.betaReportesController(req("reportes"))).json();
  expect(j.ok).toBe(true);
  expect(j.reportes.length).toBe(1);
  const id = j.reportes[0].id;
  const s = await C.betaReporteStatusController(req("reporte/status", { id, status: "resolvido" }));
  expect(await s.json()).toEqual({ ok: true });
  j = await (await C.betaReportesController(req("reportes?status=novo"))).json();
  expect(j.reportes.length).toBe(0);
  j = await (await C.betaReportesController(req("reportes?status=resolvido&antesDe=abc"))).json();
  expect(j.reportes.length).toBe(1);
  const n = await C.betaReporteStatusController(req("reporte/status", { id: "nao-existe", status: "visto" }));
  expect(n.status).toBe(404);
});

test("config: GET devolve o padrão; POST grava e zera o cache", async () => {
  admin = true;
  kv(undefined);
  expect((await (await C.betaConfigGetController(req("config"))).json()).config).toEqual({ modo: "desligado", convidados: [] });
  const r = await C.betaConfigPostController(req("config", { modo: "todos", convidados: ["a"] }));
  expect((await r.json()).config).toEqual({ modo: "todos", convidados: ["a"] });
  admin = false;
  expect((await (await C.betaEstadoController(req("estado"))).json()).modo).toBe("todos");
});

test("config POST com modo inválido grava o padrão; sem KV → 503", async () => {
  admin = true;
  const g = kv(undefined);
  const r = await C.betaConfigPostController(req("config", { modo: "zzz" }));
  expect((await r.json()).config).toEqual({ modo: "desligado", convidados: [] });
  expect(JSON.parse(g.v!)).toEqual({ modo: "desligado", convidados: [] });
  (globalThis as any).__FLAGS_KV__ = undefined;
  expect((await C.betaConfigPostController(req("config", { modo: "todos" }))).status).toBe(503);
});
