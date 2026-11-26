import { test, expect, beforeEach, mock } from "bun:test";
import { instalarFakeD1 } from "./helpers/fakeD1";
// Processamento da participação na Empire TV com presença por minuto no D1.
// Uso: bash scripts/rodar-testes-isolados.sh scripts/tv-presenca-processar.test.ts
const R = new URL("../backend/src/", import.meta.url).pathname;

const realG = await import(R + "services/googleSheetsService.ts");
let agenda: string[][] = [];
let planilhaPresenca: string[][] = [];
let marcas: unknown[][] = [];
let registros: unknown[][] = [];
let resumos: { aba: string; linhas: unknown[][] }[] = [];
let resumoFalha = false;
const REGRAS = [
  ["TIPO", "Label", "Faixa"],
  ["Show", "Faixa baixa", "1 a 39"],
  ["Show", "Faixa media", "40 a 79"],
  ["Show", "Faixa alta", "80 a 100"],
];
mock.module(R + "services/googleSheetsService.ts", () => ({
  ...realG,
  appendRows: async (_planilha: string, aba: string, linhas: unknown[][]) => {
    if (resumoFalha) throw new Error("Sheets fora do ar");
    resumos.push({ aba, linhas });
  },
  googleSheetsService: {
    ...realG.googleSheetsService,
    agendaTV: {
      readValues: async (aba: string) => {
        if (aba === "Agenda_TV") return agenda;
        if (aba === "Regras") return REGRAS;
        if (aba === "Presenca_TV") return planilhaPresenca;
        if (aba === "TV_Participacao_Processada") return [["Chave", "Programa", "ProcessadoEm"]];
        return [];
      },
      appendRow: async (_aba: string, linha: unknown[]) => {
        marcas.push(linha);
        return 2;
      },
    },
    registrosCharts: {
      readValues: async () => [],
      updateValues: async (_aba: string, _r: string, v: unknown[][]) => void registros.push(v[0]),
    },
  },
}));
let prestigios: string[] = [];
mock.module(R + "services/prestigioService.ts", () => ({
  somarPrestigio: async (id: { telegramId?: string }) => void prestigios.push(id.telegramId || ""),
}));

const C = await import(R + "controllers/tvController.ts");
const P = await import(R + "services/tvPresenca.ts");

// Chat (Supabase) falso: user_id -> quantas mensagens.
let chat: Record<string, number> = {};
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async () => {
  const linhas: { user_id: string; user_name: string }[] = [];
  for (const [id, n] of Object.entries(chat)) for (let i = 0; i < n; i++) linhas.push({ user_id: id, user_name: id });
  return new Response(JSON.stringify(linhas), { status: 200 });
}) as typeof fetch;
void fetchOriginal;
process.env.SUPABASE_URL = "http://supa";
process.env.SUPABASE_SERVICE_ROLE_KEY = "k";

const MIN = 60_000;
let inicio = 0; // início da transmissão (minuto inteiro), 20 min de duração
const p2 = (n: number) => String(n).padStart(2, "0");
function montarAgenda() {
  inicio = Math.floor(Date.now() / MIN) * MIN - 60 * MIN;
  const d = new Date(inicio - 3 * 3600_000); // Agenda em horário de Brasília (UTC-3)
  agenda = [
    ["Programa", "Tipo", "Material", "Buff", "Data", "Horario", "Capa_URL", "Status", "Topico_ID", "Topico_URL", "TIPO_EVENTO", "Duracao_Seg"],
    ["Show", "", "", "", `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`, `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`, "", "", "salaA", "", "Show", "1200"],
  ];
}
async function grupo() {
  return C.agruparTransmissoes(await C.readProgramas())[0];
}
const minutosDe = (k0: number, n: number) => Array.from({ length: n }, (_, k) => inicio / MIN + k0 + k);
async function gravarD1(jogadorId: string, nome: string, minutos: number[]) {
  const db = (globalThis as any).__CATALOGO_DB__;
  const g = await grupo();
  await P.garantirTabelaPresenca(db);
  await P.gravarMinutosPresenca(db, { programaId: g.rowIds[0], jogadorId, nome, minutos }, Date.now());
}
function flagsFalsas(inicial: Record<string, string> = {}) {
  const m = new Map(Object.entries(inicial));
  return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) };
}

beforeEach(() => {
  instalarFakeD1();
  marcas = [];
  registros = [];
  resumos = [];
  resumoFalha = false;
  prestigios = [];
  planilhaPresenca = [];
  chat = {};
  (globalThis as any).__FLAGS_KV__ = undefined;
  montarAgenda();
});

test("percentualDoJogador: d1 só tempo; planilha = maior entre tempo e chat", () => {
  expect(C.percentualDoJogador("d1", 40, 100)).toBe(40);
  expect(C.percentualDoJogador("planilha", 40, 100)).toBe(100);
  expect(C.percentualDoJogador("d1", 69.6, 0)).toBe(70);
});

test("grupo com D1: faixa pelo tempo (chat não conta), prestígio só >= 90, um resumo", async () => {
  await gravarD1("u70", "ana", minutosDe(0, 14)); // 14/20 = 70%
  await gravarD1("u95", "Bia", minutosDe(0, 19)); // 19/20 = 95%
  chat = { u70: 10, soChat: 12 };
  const r = await C.processarParticipacaoTV(flagsFalsas());
  expect(r).toEqual({ transmissoesProcessadas: 1, registrosGravados: 2 });
  expect(marcas.length).toBe(1);
  expect(registros).toContainEqual(["Ana", "", "Faixa media"]);
  expect(registros).toContainEqual(["Bia", "", "Faixa alta"]);
  expect(registros.length).toBe(2); // quem só conversou fica com 0%
  expect(prestigios).toEqual(["u95"]);

  expect(resumos.length).toBe(1);
  expect(resumos[0].aba).toBe("Presenca_TV");
  const g = await grupo();
  const porId = new Map(resumos[0].linhas.map((l) => [l[2], l]));
  expect(porId.size).toBe(3);
  const l70 = porId.get("u70")!;
  expect(typeof l70[0]).toBe("string");
  expect(new Date(l70[0] as string).toISOString()).toBe(l70[0] as string);
  expect(l70.slice(1)).toEqual([
    g.chave, "u70", "ana", 14 * 60, 14, 20, 70, 10,
    new Date(inicio).toISOString(), new Date(inicio + 13 * MIN).toISOString(), "d1",
  ]);
  expect(porId.get("soChat")!.slice(4)).toEqual([0, 0, 20, 0, 12, "", "", "d1"]);
});

test("grupo com D1: janela calculada antes do fim real sobrescrever o grupo (= rota GET)", async () => {
  const g = await grupo();
  const fimReal = (g.endTs as number) + 10 * MIN; // fim real 10 min depois, sem início real
  await gravarD1("u1", "Cy", minutosDe(0, 20)); // os 20 primeiros minutos
  const eventos = { [g.chave]: { fimTs: fimReal } };
  const esperado = P.calcularPresenca(minutosDe(0, 20), C.janelaDoGrupo(g, eventos, Date.now()).inicioMs, fimReal);
  expect(esperado.pct).toBe(67); // 20 de 30 minutos
  await C.processarParticipacaoTV(flagsFalsas({ "tv-eventos-reais": JSON.stringify(eventos) }));
  expect(resumos[0].linhas[0][7]).toBe(67);
  expect(registros).toEqual([["Cy", "", "Faixa media"]]);
});

test("falha no resumo não desfaz nem bloqueia o crédito", async () => {
  resumoFalha = true;
  await gravarD1("u95", "Bia", minutosDe(0, 19));
  const flags = flagsFalsas();
  const r = await C.processarParticipacaoTV(flags);
  expect(r.registrosGravados).toBe(1);
  expect(prestigios).toEqual(["u95"]);
  expect(flags.m.get("error-log") || "").toContain("Presenca_TV");
});

test("grupo sem D1 (planilha): regra antiga intacta e sem resumo", async () => {
  const g = await grupo();
  planilhaPresenca = [
    ["Timestamp", "Programa_ID", "Telegram_ID", "Nome", "Watched_Seconds"],
    ["t", g.rowIds[0], "p40", "Dan", "480"], // 480/1200 = 40%
  ];
  chat = { p40: 10 };
  await C.processarParticipacaoTV(flagsFalsas());
  expect(registros).toEqual([["Dan", "", "Faixa alta"]]); // chat 100% ainda vale
  expect(prestigios).toEqual([]);
  expect(resumos.length).toBe(0);
});

test("sem D1 disponível: caminho antigo", async () => {
  (globalThis as any).__CATALOGO_DB__ = undefined;
  const g = await grupo();
  planilhaPresenca = [
    ["Timestamp", "Programa_ID", "Telegram_ID", "Nome", "Watched_Seconds"],
    ["t", g.rowIds[0], "p95", "Eva", "1140"],
  ];
  await C.processarParticipacaoTV(flagsFalsas());
  expect(registros).toEqual([["Eva", "", "Faixa alta"]]);
  expect(prestigios).toEqual(["p95"]);
  expect(resumos.length).toBe(0);
});

test("limpeza diária: apaga > 30 dias no máximo 1x por dia UTC e nunca lança", async () => {
  const db = (globalThis as any).__CATALOGO_DB__;
  await P.garantirTabelaPresenca(db);
  const agora = Date.UTC(2026, 10, 26, 12, 0);
  await P.gravarMinutosPresenca(db, { programaId: "x", jogadorId: "velho", nome: "", minutos: [1] }, agora - 31 * 86400_000);
  await P.gravarMinutosPresenca(db, { programaId: "x", jogadorId: "novo", nome: "", minutos: [1] }, agora - 29 * 86400_000);
  const flags = flagsFalsas();
  expect(await C.limparPresencaTVDiaria(flags, agora)).toBe(1);
  expect(flags.m.get("tv-presenca-limpeza-dia")).toBe("2026-11-26");
  await P.gravarMinutosPresenca(db, { programaId: "y", jogadorId: "velho2", nome: "", minutos: [1] }, agora - 40 * 86400_000);
  expect(await C.limparPresencaTVDiaria(flags, agora + 3600_000)).toBe(null); // mesmo dia: não roda
  expect(await C.limparPresencaTVDiaria(flags, agora + 86400_000)).toBe(1); // dia seguinte
  const quebrado = { get: async () => { throw new Error("kv"); }, put: async () => {} };
  expect(await C.limparPresencaTVDiaria(quebrado, agora)).toBe(null);
  (globalThis as any).__CATALOGO_DB__ = undefined;
  expect(await C.limparPresencaTVDiaria(flagsFalsas(), agora)).toBe(null);
});

test("grupo com D1: cliente antigo (só Presenca_TV) é creditado pelo tempo, sem chat", async () => {
  const g = await grupo();
  await gravarD1("u70", "ana", minutosDe(0, 14)); // 70% no D1
  planilhaPresenca = [
    ["Timestamp", "Programa_ID", "Telegram_ID", "Nome", "Watched_Seconds"],
    ["t", g.rowIds[0], "old", "Velho", "1140"], // 1140/1200 = 95%
    ["t", g.rowIds[0], "u70", "ana", "600"], // 50% < 70% do D1: D1 vence
    ["t", g.rowIds[0], "old2", "Leo", "120"], // 10% de tempo; chat 100% não conta
  ];
  chat = { old2: 10 };
  const flags = flagsFalsas();
  const r = await C.processarParticipacaoTV(flags);
  expect(r.registrosGravados).toBe(3);
  expect(registros).toContainEqual(["Ana", "", "Faixa media"]);
  expect(registros).toContainEqual(["Velho", "", "Faixa alta"]);
  expect(registros).toContainEqual(["Leo", "", "Faixa baixa"]);
  expect(prestigios).toEqual(["old"]);
  expect(resumos.length).toBe(1);
  const porId = new Map(resumos[0].linhas.map((l) => [l[2], l]));
  expect(porId.get("u70")!.slice(7)).toEqual([70, 0, new Date(inicio).toISOString(), new Date(inicio + 13 * MIN).toISOString(), "d1"]);
  expect(porId.get("old")!.slice(1)).toEqual([g.chave, "old", "Velho", 1140, 19, 20, 95, 0, "", "", "planilha"]);
  expect(porId.get("old2")!.slice(7)).toEqual([10, 10, "", "", "planilha"]);
  const log = flags.m.get("error-log") || "";
  expect(log).toContain("2 jogador(es)");
});

test("grupo com D1: quem tem D1 e segundos antigos fica com a maior % (só tempo); coluna L diz qual venceu", async () => {
  const g = await grupo();
  await gravarD1("misto", "Mia", minutosDe(10, 6)); // 6/20 = 30% no D1 (atualizou no meio)
  await gravarD1("so1", "Rui", minutosDe(0, 2)); // 10% no D1
  planilhaPresenca = [
    ["Timestamp", "Programa_ID", "Telegram_ID", "Nome", "Watched_Seconds"],
    ["t", g.rowIds[0], "misto", "Mia", "1140"], // cliente antigo: 1140/1200 = 95%
  ];
  chat = { so1: 10, "empire-tv": 5 }; // chat não conta; bot nem entra
  const r = await C.processarParticipacaoTV(flagsFalsas());
  expect(r.registrosGravados).toBe(2);
  expect(registros).toContainEqual(["Mia", "", "Faixa alta"]);
  expect(registros).toContainEqual(["Rui", "", "Faixa baixa"]);
  expect(prestigios).toEqual(["misto"]);
  const porId = new Map(resumos[0].linhas.map((l) => [l[2], l]));
  expect(porId.has("empire-tv")).toBe(false);
  expect(porId.get("misto")!.slice(4, 9)).toEqual([360, 6, 20, 95, 0]);
  expect(porId.get("misto")![11]).toBe("planilha");
  expect(porId.get("so1")!.slice(7)).toEqual([10, 10, new Date(inicio).toISOString(), new Date(inicio + MIN).toISOString(), "d1"]);
});

test("processamento: início real sem fim real e fim agendado já passou -> fim = fim agendado", async () => {
  const g = await grupo();
  const eventos = { [g.chave]: { inicioTs: inicio } };
  // Rota GET (sem opção) continua usando "agora" como fim.
  const agora = Date.now();
  expect(C.janelaDoGrupo(g, eventos, agora).fimMs).toBe(agora);
  const j = C.janelaDoGrupo(g, eventos, agora, { processamento: true });
  expect(j).toEqual({ inicioMs: inicio, fimMs: g.endTs as number, aoVivo: false });
  // Antes do fim agendado, mesmo no processamento, ainda é "agora".
  expect(C.janelaDoGrupo(g, eventos, inicio + 5 * MIN, { processamento: true }).fimMs).toBe(inicio + 5 * MIN);

  await gravarD1("u70", "ana", minutosDe(0, 14)); // 14/20 = 70% (com "agora": 14/60 = 23%)
  await C.processarParticipacaoTV(flagsFalsas({ "tv-eventos-reais": JSON.stringify(eventos) }));
  expect(registros).toEqual([["Ana", "", "Faixa media"]]);
  expect(resumos[0].linhas[0][7]).toBe(70);
});

test("lerPresencaGrupo falha -> nada marcado, nada creditado; próxima execução processa", async () => {
  await gravarD1("u95", "Bia", minutosDe(0, 19));
  const real = (globalThis as any).__CATALOGO_DB__;
  (globalThis as any).__CATALOGO_DB__ = {
    prepare: (sql: string) => {
      if (sql.includes("SELECT jogador_id")) throw new Error("D1 caiu");
      return real.prepare(sql);
    },
  };
  const flags = flagsFalsas();
  const r1 = await C.processarParticipacaoTV(flags);
  expect(r1).toEqual({ transmissoesProcessadas: 0, registrosGravados: 0 });
  expect(marcas.length).toBe(0);
  expect(registros.length).toBe(0);
  expect(prestigios).toEqual([]);
  expect(flags.m.get("error-log") || "").toContain("D1");

  (globalThis as any).__CATALOGO_DB__ = real;
  const r2 = await C.processarParticipacaoTV(flags);
  expect(r2).toEqual({ transmissoesProcessadas: 1, registrosGravados: 1 });
  expect(marcas.length).toBe(1);
  expect(registros).toEqual([["Bia", "", "Faixa alta"]]);
  expect(prestigios).toEqual(["u95"]);
});

test("processamento: início real ATRASADO sem fim real -> fim = início real + duração (não colapsa)", async () => {
  const g = await grupo();
  const inicioReal = inicio + 30 * MIN; // começou 30 min depois; fim agendado (inicio+20) já passou
  const eventos = { [g.chave]: { inicioTs: inicioReal } };
  const j = C.janelaDoGrupo(g, eventos, Date.now(), { processamento: true });
  expect(j).toEqual({ inicioMs: inicioReal, fimMs: inicioReal + 20 * MIN, aoVivo: false });

  await gravarD1("u70", "ana", minutosDe(30, 14)); // 14 dos 20 min reais = 70%
  await C.processarParticipacaoTV(flagsFalsas({ "tv-eventos-reais": JSON.stringify(eventos) }));
  expect(registros).toEqual([["Ana", "", "Faixa media"]]);
  expect(resumos[0].linhas[0].slice(5, 8)).toEqual([14, 20, 70]);
});
