import { test, expect, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { fileURLToPath } from "node:url";
// Correção da chave de `musicas` (musicasRekeyD1.ts) num SQLite de verdade, COM
// foreign keys ligadas (como no D1) — prova que nenhum comentário é apagado.
// Uso: bun test scripts/testar-chave-musicas-d1.test.ts
const R = fileURLToPath(new URL("../backend/src/services/", import.meta.url));
const norm = (v: unknown) => String(v ?? "").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ");
const linha = (o: Record<number, string>) => { const r: string[] = Array(31).fill(""); for (const [k, v] of Object.entries(o)) r[+k] = v; return r; };
// Planilha "Musicas": B=1 id tópico, H=7 título, N=13 artista, X=23 pendente, Z=25 código
let planilha: string[][] = [];
mock.module(R + "googleSheetsService.ts", () => ({
  readValuesFresh: async () => planilha.map((r) => [...r]),
  googleSheetsService: { principal: { readValues: async () => [] } },
  normalizeText: (v: unknown) => String(v ?? "").trim(),
  normalizeComparison: norm,
}));
mock.module(R + "logSistemaService.ts", () => ({ registrarLogSistema: async () => {} }));

const sqlite = new Database(":memory:");
sqlite.exec("PRAGMA foreign_keys = ON");
const prep = (sql: string, b: unknown[] = []): any => ({ bind: (...v: unknown[]) => prep(sql, v),
  run: async () => { sqlite.query(sql).run(...(b as never[])); return { results: [], success: true }; },
  all: async () => ({ results: sqlite.query(sql).all(...(b as never[])), success: true }) });
const db: any = { prepare: (s: string) => prep(s),
  batch: async (st: any[]) => { const out = []; sqlite.exec("BEGIN"); try { for (const s of st) out.push(await s.run()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return out; } };
(globalThis as any).__CATALOGO_DB__ = db;

// --- esquema ANTIGO (código único como chave + FK com cascata) ---
sqlite.exec(`CREATE TABLE musicas (codigo_unico TEXT PRIMARY KEY, id_topico TEXT, titulo TEXT NOT NULL, artista TEXT NOT NULL, artista_2 TEXT, artista_3 TEXT, artista_4 TEXT, artista_5 TEXT, artista_6 TEXT, album TEXT, album_2 TEXT, album_3 TEXT, album_4 TEXT, album_5 TEXT, capa_url TEXT, audio_url TEXT, letra TEXT, letra_sincronizada TEXT, genero TEXT, tipo_single TEXT, tipo_musica TEXT, data_lancamento TEXT, data_lancamento_iso TEXT, weeks INTEGER, weeks_video INTEGER, ordem INTEGER, id_criador TEXT, comentarios_para TEXT, metacritic_por_jogador TEXT, metacritic_media REAL, pendente INTEGER NOT NULL DEFAULT 0, reportado_incorreto INTEGER NOT NULL DEFAULT 0, shop_json TEXT, loja_info TEXT, arte_extra_json TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now')), atualizado_em TEXT NOT NULL DEFAULT (datetime('now')))`);
sqlite.exec(`CREATE TABLE comentarios_musicas (id INTEGER PRIMARY KEY AUTOINCREMENT, musica_id TEXT NOT NULL REFERENCES musicas(codigo_unico) ON DELETE CASCADE, jogador_id TEXT, jogador_nome TEXT, comentario TEXT NOT NULL, reacoes_json TEXT, data_hora TEXT, reply_to INTEGER REFERENCES comentarios_musicas(id) ON DELETE SET NULL, criado_em TEXT NOT NULL DEFAULT (datetime('now')))`);
sqlite.exec(`INSERT INTO musicas (codigo_unico, id_topico, titulo, artista) VALUES
  ('EMP671','musica_ryvc4j','Bad Friend (Live at Grammys)','Anníbal Páris'),
  ('EMP930','musica_hssgy4','Follia','Max Gorghan'),
  ('EMP946',NULL,'Max Gorghan - Abbiso di Follia','Max Gorghan'),
  ('EMP661',NULL,'AETHERIA','Emma')`);
sqlite.exec(`INSERT INTO comentarios_musicas (musica_id, jogador_nome, comentario) VALUES ('EMP671','Chris','top'),('EMP671','Wes','demais'),('EMP930','Dani','amei')`);
sqlite.exec(`INSERT INTO comentarios_musicas (musica_id, jogador_nome, comentario, reply_to) VALUES ('EMP671','Lucas','concordo',1)`);

const M = await import(R + "musicasRekeyD1.ts");
const S = await import(R + "musicasDbService.ts");
const cont = () => sqlite.query("SELECT (SELECT count(*) FROM musicas) m, (SELECT count(*) FROM comentarios_musicas) c").get() as any;

test("migração: mesmas músicas, NENHUM comentário apagado, respostas preservadas, backup criado", async () => {
  const r = await M.migrarChaveMusicas(db);
  expect(r.jaMigrada).toBe(false);
  expect(r.antes).toEqual({ musicas: 4, comentarios: 4 });
  expect(r.depois).toEqual({ musicas: 4, comentarios: 4 });
  expect((sqlite.query("SELECT reply_to FROM comentarios_musicas WHERE jogador_nome='Lucas'").get() as any).reply_to).toBe(1);
  expect((sqlite.query("SELECT count(*) n FROM bkp_comentarios_musicas_20261117").get() as any).n).toBe(4);
  expect((sqlite.query("SELECT chave FROM musicas WHERE codigo_unico='EMP671'").get() as any).chave).toBe("t:musica_ryvc4j");
  expect((sqlite.query("SELECT chave FROM musicas WHERE codigo_unico='EMP946'").get() as any).chave).toBe("c:EMP946|Max Gorghan - Abbiso di Follia");
  expect((await M.migrarChaveMusicas(db)).jaMigrada).toBe(true); // idempotente
});
test("versões com o mesmo código convivem; gravar uma não apaga a outra", async () => {
  await S.buildMusicaUpsertStatement(db, { codigoUnico: "EMP671", idTopico: "musica_k6q3vw", titulo: "Anníbal Páris - Bad Friend", artista: "Anníbal Páris" }).run();
  await S.buildMusicaUpsertStatement(db, { codigoUnico: "EMP671", idTopico: "musica_ryvc4j", titulo: "Bad Friend (Live at Grammys)", artista: "Anníbal Páris", genero: "Pop" }).run();
  const v = sqlite.query("SELECT titulo, genero FROM musicas WHERE codigo_unico='EMP671' ORDER BY titulo").all() as any[];
  expect(v.map((x) => x.titulo)).toEqual(["Anníbal Páris - Bad Friend", "Bad Friend (Live at Grammys)"]);
  expect(v[1].genero).toBe("Pop");
  expect(cont().c).toBe(4); // comentários intactos
});
test("faixa pendente que ganha tópico é promovida (sem duplicar)", async () => {
  await S.buildMusicaUpsertStatement(db, { codigoUnico: "EMP946", idTopico: "musica_novo", titulo: "Max Gorghan - Abbiso di Follia", artista: "Max Gorghan" }).run();
  const v = sqlite.query("SELECT chave FROM musicas WHERE codigo_unico='EMP946'").all() as any[];
  expect(v.map((x) => x.chave)).toEqual(["t:musica_novo"]);
});
test("restauração: insere só o que falta, nunca altera o que já existe; promove pendente que ganhou tópico", async () => {
  sqlite.exec("UPDATE musicas SET genero='EDITADO_NO_D1' WHERE codigo_unico='EMP930'");
  planilha = [
    linha({ 7: "Nome da música" }),
    linha({ 1: "musica_hssgy4", 7: "Max Gorghan - Follia", 13: "Max Gorghan", 25: "EMP930" }), // já existe (por tópico)
    linha({ 1: "musica_relic", 7: "Raven - RELIC", 13: "Raven", 25: "EMP620" }), // falta
    linha({ 1: "musica_relic_rmx", 7: "Raven - RELIC (BREMM Remix)", 13: "Raven", 25: "EMP620" }), // falta, mesmo código
    linha({ 7: "Peter Johnson - Jesus", 13: "Peter Johnson", 23: "Sim" }), // sem código, falta
    linha({ 1: "musica_aeth", 7: "Emma - AETHERIA", 13: "Emma", 25: "EMP661" }), // no D1 sem tópico e sem prefixo -> promove
    linha({ 25: "https://www.youtube.com/x", 23: "13/11/2026" }), // lixo
  ];
  const sim = await M.restaurarMusicasDaPlanilha(db, false);
  expect(sim.restauradas.map((r: any) => r.linha)).toEqual([3, 4, 5]);
  expect(sim.promovidas.map((r: any) => r.linha)).toEqual([6]);
  expect(sim.ignoradas.map((r: any) => r.linha)).toEqual([7]);
  expect(cont().m).toBe(5); // simulação não grava
  const r = await M.restaurarMusicasDaPlanilha(db, true);
  expect(r.faltandoDepois).toBe(0);
  expect(cont().m).toBe(8);
  expect((sqlite.query("SELECT genero FROM musicas WHERE chave='t:musica_hssgy4'").get() as any).genero).toBe("EDITADO_NO_D1");
  expect((sqlite.query("SELECT count(*) n FROM musicas WHERE codigo_unico='EMP661'").get() as any).n).toBe(1);
  expect((sqlite.query("SELECT chave FROM musicas WHERE codigo_unico='EMP661'").get() as any).chave).toBe("t:musica_aeth");
  expect((await M.restaurarMusicasDaPlanilha(db, false)).restauradas.length).toBe(0); // idempotente
  expect(cont().c).toBe(4);
});
test("Fórum: tópico novo só vai pra versão única sem tópico", () => {
  const sql = `UPDATE musicas SET id_topico = ?1, chave = 't:' || ?1 WHERE codigo_unico = ?2 AND coalesce(trim(id_topico), '') = '' AND (SELECT count(*) FROM musicas WHERE codigo_unico = ?2 AND coalesce(trim(id_topico), '') = '') = 1 AND NOT EXISTS (SELECT 1 FROM musicas WHERE chave = 't:' || ?1)`;
  sqlite.exec("INSERT INTO musicas (chave, codigo_unico, titulo, artista) VALUES ('c:EMP999|A','EMP999','A','X'),('c:EMP999|B','EMP999','B','X'),('c:EMP998|C','EMP998','C','X')");
  sqlite.query(sql).run("t1", "EMP999");
  expect((sqlite.query("SELECT count(*) n FROM musicas WHERE id_topico='t1'").get() as any).n).toBe(0);
  sqlite.query(sql).run("t2", "EMP998");
  expect((sqlite.query("SELECT chave FROM musicas WHERE codigo_unico='EMP998'").get() as any).chave).toBe("t:t2");
});
