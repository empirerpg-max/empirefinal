import { test, expect, beforeEach, mock } from "bun:test";
// Ticker "Atividade recente" (Home): com Comentarios_MV no D1, lê só os
// últimos comentários e resolve o título pela tabela `videos` (PK), sem ler
// "Music Videos" inteira. Spec: docs/superpowers/specs/2026-11-26-d1-rows-read-reducao-design.md
// Uso: bun test scripts/atividade-recente.test.ts
import { instalarFakeD1 } from "./helpers/fakeD1";

const R = new URL("../backend/src/", import.meta.url).pathname;
mock.module(R + "google/service-account.ts", () => ({
  getGoogleAccessToken: async () => "tok",
  getDriveOAuthAccessToken: async () => "tok",
  readRuntimeEnv: () => "",
}));
mock.module(R + "services/logSistemaService.ts", () => ({
  registrarLogSistema: async () => {},
  traduzirErroEscrita: () => ({ causaProvavel: "", comoResolver: "" }),
}));

// Abas que não estão no D1 (Musicas, Albuns, Comentarios_Musicas...) vêm "vazias" do Google.
(globalThis as any).fetch = async () =>
  new Response(JSON.stringify({ values: [["cabecalho"]], updates: { updatedRange: "'X'!A2:A2" } }), { status: 200 });
const kv = new Map<string, string>();
(globalThis as any).__FLAGS_KV__ = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v) };

const { PLANILHA_VIRTUAL_CREATE_STATEMENTS } = await import(R + "services/planilhaVirtualD1.ts");
const { definirEstadoAba } = await import(R + "services/porteiroD1.ts");
const { VIDEOS_CREATE_STATEMENTS } = await import(R + "services/videosDbService.ts");
const { COMENTARIOS_VIDEOS_CREATE_STATEMENTS } = await import(R + "services/comentariosVideosDbService.ts");
const G = await import(R + "services/googleSheetsService.ts");
const { getAtividadeRecenteController } = await import(R + "controllers/forumController.ts");

let consultas: { sql: string; params: unknown[] }[] = [];

beforeEach(async () => {
  const sqlite = instalarFakeD1();
  for (const s of PLANILHA_VIRTUAL_CREATE_STATEMENTS) sqlite.exec(s);
  for (const s of [...VIDEOS_CREATE_STATEMENTS, ...COMENTARIOS_VIDEOS_CREATE_STATEMENTS]) sqlite.exec(s);
  const original = sqlite.query.bind(sqlite);
  (sqlite as any).query = (sql: string) => {
    const q: any = original(sql);
    if (q.__contado) return q; // o bun reaproveita o mesmo statement: embrulha uma vez só
    q.__contado = true;
    const all = q.all.bind(q);
    q.all = (...p: unknown[]) => {
      consultas.push({ sql, params: p });
      return all(...p);
    };
    return q;
  };
  kv.clear();
  for (const aba of ["Music Videos", "Comentarios_MV", "VIDEOS_PENDENTES_EMPIRE_TV"]) await definirEstadoAba(aba, "on");
  await G.updateValues("principal", "Comentarios_MV", "A1:C1", [["ID do tópico", "x", "Jogador"]]);
  for (let i = 1; i <= 12; i++) await G.appendRow("principal", "Comentarios_MV", [`t${i}`, "", `j${i}`]);
  for (let i = 1; i <= 12; i++) {
    if (i === 11) continue; // vídeo apagado: comentário dele fica fora do ticker
    sqlite.query("INSERT INTO videos (id_topico, titulo_topico, linha_planilha) VALUES (?, ?, ?)").run(`t${i}`, `Clipe t${i}`, i + 1);
  }
  // O espelho em tempo real (videosD1Sync) roda em segundo plano depois de
  // cada gravação: espera ele terminar antes de contar as consultas do ticker.
  await new Promise((r) => setTimeout(r, 50));
  consultas = [];
});

async function videosDoTicker() {
  const res = await getAtividadeRecenteController();
  const json = await res.json();
  expect(json.success).toBe(true);
  return json.data.filter((x: any) => x.tipo === "video");
}

test("ticker: vídeos vêm dos 8 últimos comentários e títulos pela tabela videos", async () => {
  const videos = await videosDoTicker();
  expect(videos.map((x: any) => x.jogador)).toEqual(["j12", "j10", "j9", "j8", "j7", "j6", "j5"]);
  expect(videos[0]).toEqual({ jogador: "j12", titulo: "Clipe t12", tipo: "video" });
});

test("ticker: Music Videos não é lida e Comentarios_MV não é lida inteira", async () => {
  await videosDoTicker();
  const pv = consultas.filter((c) => c.sql.includes("planilha_virtual") && c.sql.includes("celulas_json"));
  expect(pv.some((c) => c.params.includes("Music Videos"))).toBe(false);
  const mv = pv.filter((c) => c.params.includes("Comentarios_MV"));
  expect(mv.length).toBe(1);
  expect(mv[0].params).toContain(6); // faixa começa na linha 6 (últimas 8 de 2..13)
});

test("ticker: linha vazia no meio da faixa é ignorada", async () => {
  await G.updateValues("principal", "Comentarios_MV", "A11:C11", [["", "", ""]]); // linha de t10
  const videos = await videosDoTicker();
  expect(videos.map((x: any) => x.jogador)).toEqual(["j12", "j9", "j8", "j7", "j6", "j5"]);
});

test("ticker: espelho `videos` vazio cai pra leitura antiga da aba Music Videos", async () => {
  const db = (globalThis as any).__CATALOGO_DB__;
  await G.updateValues("principal", "Music Videos", "A1:F1", [["u", "Título", "", "", "", "message_thread_id"]]);
  await G.appendRow("principal", "Music Videos", ["", "Clipe antigo t12", "", "", "", "t12"]);
  await new Promise((r) => setTimeout(r, 50)); // espelho em tempo real termina antes de esvaziar
  await db.prepare("DELETE FROM videos").run();
  const videos = await videosDoTicker();
  expect(videos[0]).toEqual({ jogador: "j12", titulo: "Clipe antigo t12", tipo: "video" });
});
