import { test, expect, beforeEach, mock } from "bun:test";
import { instalarFakeD1 } from "./helpers/fakeD1";

const R = new URL("../backend/src/", import.meta.url).pathname;
mock.module(R + "google/service-account.ts", () => ({
  getGoogleAccessToken: async () => "tok",
  getDriveOAuthAccessToken: async () => "tok",
  readRuntimeEnv: () => "",
}));
const logs: string[] = [];
mock.module(R + "services/logSistemaService.ts", () => ({
  registrarLogSistema: async (x: any) => void logs.push(x.oQueAconteceu),
  traduzirErroEscrita: () => ({ causaProvavel: "", comoResolver: "" }),
}));

const { PLANILHA_VIRTUAL_CREATE_STATEMENTS, itemFila, gravarIntervalo, parseA1 } = await import(R + "services/planilhaVirtualD1.ts");

// Planilha real falsa que APLICA as gravações do despachante.
let planilha: Record<string, string[][]> = {};
let formulas: Record<string, string[][]> = {};
const ok = (x: unknown = {}) => new Response(JSON.stringify(x), { status: 200 });
(globalThis as any).fetch = async (url: string, init: any) => {
  const u = decodeURIComponent(String(url));
  const body = init?.body ? JSON.parse(init.body) : null;
  if (u.includes("?fields=sheets")) {
    return ok({ sheets: Object.keys(planilha).map((title, i) => ({ properties: { title, sheetId: i, gridProperties: { rowCount: 5000 } } })) });
  }
  if (u.includes("values:batchUpdate")) {
    for (const d of body.data) {
      const aba = d.range.match(/^'([^']+)'/)[1];
      const { c1, r1 } = parseA1(d.range);
      const linhas = (planilha[aba] ??= []);
      d.values.forEach((row: string[], i: number) => {
        const alvo = (linhas[r1 - 1 + i] ??= []);
        row.forEach((v, j) => {
          while (alvo.length < c1 + j) alvo.push("");
          alvo[c1 + j] = String(v);
        });
      });
      for (let i = 0; i < linhas.length; i++) linhas[i] ??= [];
    }
    return ok();
  }
  const aba = u.match(/values\/'([^']+)'/)?.[1] ?? "";
  if (!(aba in planilha)) return new Response(JSON.stringify({ error: { message: "Unable to parse range: " + aba } }), { status: 400 });
  const valores = u.includes("valueRenderOption=FORMULA") ? formulas[aba] ?? planilha[aba] : planilha[aba];
  return ok({ values: valores });
};

const { estadoAba, definirEstadoAba, lerD1, limparCacheEstado, PLANILHA_PRINCIPAL_ID: P } = await import(R + "services/porteiroD1.ts");
const G = await import(R + "services/googleSheetsService.ts");
const A = await import(R + "controllers/adminD1PrimeiroController.ts");
const db = () => (globalThis as any).__CATALOGO_DB__;
const RAPIDO = { esperaMs: 0 };

beforeEach(async () => {
  const sqlite = instalarFakeD1();
  for (const s of PLANILHA_VIRTUAL_CREATE_STATEMENTS) sqlite.exec(s);
  limparCacheEstado();
  logs.length = 0;
  planilha = {
    "Music Videos": [["ID do usuário", "Título do tópico", "ID da mensagem", "x", "y", "z", "g", "h", "i", "j", "fonte", "ID da mensagem"], [], ["1", "Alexxa - love castlevania", "", "", "", "t1"]],
  };
  formulas = {};
});

test("carga copia a aba exata (cabeçalho duplicado, linha vazia no meio) e liga", async () => {
  expect(await A.carregarAba("Music Videos", RAPIDO)).toEqual({ ok: true, linhas: 3 });
  expect(await estadoAba(P, "Music Videos")).toBe("on");
  expect(await lerD1(P, "Music Videos")).toEqual(planilha["Music Videos"]);
});

test("aba que não existe na planilha carrega vazia e liga", async () => {
  expect(await A.carregarAba("VIDEOS_PENDENTES_EMPIRE_TV", RAPIDO)).toEqual({ ok: true, linhas: 0 });
  expect(await estadoAba(P, "VIDEOS_PENDENTES_EMPIRE_TV")).toBe("on");
});

test("aba com fórmula não é ligada", async () => {
  formulas["Music Videos"] = [["ID do usuário"], [], ["1", '=ARRAYFORMULA(B2:B&"x")']];
  expect(await A.carregarAba("Music Videos", RAPIDO)).toMatchObject({ ok: false, motivo: "formula", celulas: ["B3"] });
  expect(await estadoAba(P, "Music Videos")).toBe("off");
});

test("carga recusada com fila pendente da aba", async () => {
  await A.statusAbas(); // cria as tabelas
  await db().batch([itemFila(P, "Music Videos", "update", "A1", [["x"]])]);
  expect(await A.carregarAba("Music Videos", RAPIDO)).toMatchObject({ ok: false, motivo: "fila-pendente" });
  expect(await estadoAba(P, "Music Videos")).toBe("off");
});

test("I5: carga recusada em aba já ligada (a planilha nunca volta a mandar no D1)", async () => {
  await A.carregarAba("Music Videos", RAPIDO);
  await G.updateValues("principal", "Music Videos", "B3", [["só no D1"]]);
  await db().prepare("DELETE FROM fila_backup_planilha").run();
  expect(await A.carregarAba("Music Videos", RAPIDO)).toEqual({ ok: false, motivo: "ja-ligada" });
  expect((await lerD1(P, "Music Videos", "B3"))[0][0]).toBe("só no D1");
});

test("C2: desligar esvazia a fila na planilha, confere e só então volta para 'off'", async () => {
  await A.carregarAba("Music Videos", RAPIDO);
  await G.updateValues("principal", "Music Videos", "B3", [["editado no app"]]);
  expect(await A.desligarAba("Music Videos", RAPIDO)).toEqual({ ok: true });
  expect(planilha["Music Videos"][2][1]).toBe("editado no app");
  expect(await estadoAba(P, "Music Videos")).toBe("off");
});

test("C2: desligar com backup divergente volta para 'on' e não perde nada", async () => {
  await A.carregarAba("Music Videos", RAPIDO);
  await db().batch(await gravarIntervalo(P, "Music Videos", "B3", [["só no D1, sem fila"]]));
  expect(await A.desligarAba("Music Videos", RAPIDO)).toEqual({ ok: false, motivo: "divergencia", linhas: [3] });
  expect(await estadoAba(P, "Music Videos")).toBe("on");
});

test("integridade acusa diferença e não altera o D1", async () => {
  await A.carregarAba("Music Videos", RAPIDO);
  await db().batch(await gravarIntervalo(P, "Music Videos", "B3", [["editado no D1"]]));
  logs.length = 0;
  expect(await A.verificarIntegridade()).toEqual([{ aba: "Music Videos", ok: false, diferentes: [3] }]);
  expect((await lerD1(P, "Music Videos", "B3"))[0][0]).toBe("editado no D1");
  expect(logs.length).toBe(1);
  expect(logs[0]).toContain("NÃO foi alterado");
});

test("status lista as 3 abas (e funciona num D1 sem as tabelas novas)", async () => {
  instalarFakeD1();
  await A.carregarAba("Music Videos", RAPIDO);
  const s = await A.statusAbas();
  expect(s.map((x: any) => [x.aba, x.estado, x.linhasD1, x.pendentesFila])).toEqual([
    ["Music Videos", "on", 2, 0],
    ["Comentarios_MV", "off", 0, 0],
    ["VIDEOS_PENDENTES_EMPIRE_TV", "off", 0, 0],
  ]);
});
