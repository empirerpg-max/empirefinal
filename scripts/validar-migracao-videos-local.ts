// Ensaio LOCAL da migração de vídeos pro D1, antes de rodar em produção.
// Executa EXATAMENTE o mesmo código da migração (mesmo schema, mesmos
// INSERT/UPSERT, mesmo executarEmLotes, mesma validação célula a célula)
// num SQLite de verdade (bun:sqlite — mesmo motor do D1), alimentado pelos
// CSVs exportados das abas "Music Videos" e "Comentarios_MV".
//
// Uso:
//   bun scripts/validar-migracao-videos-local.ts <Music_Videos.csv> <Comentarios_MV.csv>
//
// Além do caminho feliz, roda testes negativos pra provar que a validação
// pega perda/alteração de dado e que a pré-checagem bloqueia casos
// perigosos (ID repetido, coluna deslocada, aba vazia).
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { executarEmLotes, type D1DatabaseLike, type D1PreparedStatement } from "../backend/src/services/catalogoDbService";
import {
  VIDEOS_CREATE_STATEMENTS,
  validarLinhasVideosPlanilha,
  buildVideoUpsertStatement,
} from "../backend/src/services/videosDbService";
import {
  COMENTARIOS_VIDEOS_CREATE_STATEMENTS,
  validarLinhasComentariosVideosPlanilha,
  buildComentarioVideoInsertStatement,
} from "../backend/src/services/comentariosVideosDbService";
import {
  validarVideos,
  validarComentariosVideos,
  listarComentariosOrfaos,
} from "../backend/src/services/videosD1Validacao";

// --- CSV (RFC 4180: aspas, aspas escapadas "", quebra de linha dentro de aspas) ---
function parseCsv(texto: string): string[][] {
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ",") {
      linha.push(campo);
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += ch;
  }
  if (campo !== "" || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

/** A API do Sheets omite células vazias no fim de cada linha — imita isso. */
function comoApiDoSheets(rows: string[][]): string[][] {
  return rows.map((r) => {
    const c = [...r];
    while (c.length && c[c.length - 1] === "") c.pop();
    return c;
  });
}

// --- Adaptador D1DatabaseLike sobre bun:sqlite ---
function d1Local(sqlite: Database): D1DatabaseLike {
  const prep = (sql: string, binds: unknown[] = []): D1PreparedStatement => ({
    bind: (...v: unknown[]) => prep(sql, v),
    run: async () => {
      sqlite.query(sql).run(...(binds as never[]));
      return { results: [], success: true };
    },
    all: async <T,>() => ({ results: sqlite.query(sql).all(...(binds as never[])) as T[], success: true }),
  });
  return {
    prepare: (sql) => prep(sql),
    batch: async (stmts) => {
      const out = [];
      for (const s of stmts) {
        try {
          out.push(await s.run());
        } catch {
          out.push({ results: [], success: false });
        }
      }
      return out;
    },
  };
}

function novoBanco(): { sqlite: Database; db: D1DatabaseLike } {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const s of [...VIDEOS_CREATE_STATEMENTS, ...COMENTARIOS_VIDEOS_CREATE_STATEMENTS]) sqlite.exec(s);
  return { sqlite, db: d1Local(sqlite) };
}

async function migrar(db: D1DatabaseLike, rowsVideos: string[][], rowsComentarios: string[][]) {
  const v = validarLinhasVideosPlanilha(rowsVideos);
  const c = validarLinhasComentariosVideosPlanilha(rowsComentarios);
  if (v.erros.length || c.erros.length) return { bloqueado: [...v.erros, ...c.erros] };
  const rv = await executarEmLotes(
    db,
    v.registros.map((r) => ({ statement: buildVideoUpsertStatement(db, r), rotulo: `F=${r.valores.id_topico}` })),
  );
  await db.prepare("DELETE FROM comentarios_videos").run();
  const rc = await executarEmLotes(
    db,
    c.registros.map((r) => ({ statement: buildComentarioVideoInsertStatement(db, r), rotulo: `linha ${r.linhaPlanilha}` })),
  );
  return { v, c, rv, rc };
}

async function validar(db: D1DatabaseLike, rowsVideos: string[][], rowsComentarios: string[][]) {
  const dv = (await db.prepare("SELECT * FROM videos").all<Record<string, unknown>>()).results;
  const dc = (await db.prepare("SELECT * FROM comentarios_videos").all<Record<string, unknown>>()).results;
  return { videos: validarVideos(rowsVideos, dv), comentarios: validarComentariosVideos(rowsComentarios, dc) };
}

let falhou = false;
function checar(nome: string, cond: boolean, detalhe?: unknown) {
  console.log(`${cond ? "PASSOU" : "FALHOU"} — ${nome}`);
  if (!cond) {
    falhou = true;
    if (detalhe !== undefined) console.log(JSON.stringify(detalhe, null, 2).slice(0, 3000));
  }
}

const [csvVideos, csvComentarios] = process.argv.slice(2);
if (!csvVideos || !csvComentarios) {
  console.error("uso: bun scripts/validar-migracao-videos-local.ts <Music_Videos.csv> <Comentarios_MV.csv>");
  process.exit(2);
}
const videosCsv = parseCsv(readFileSync(csvVideos, "utf-8"));
const comentariosCsv = parseCsv(readFileSync(csvComentarios, "utf-8"));

for (const [rotulo, rowsV, rowsC] of [
  ["CSV como exportado", videosCsv, comentariosCsv],
  ["formato da API do Sheets (sem células vazias no fim)", comoApiDoSheets(videosCsv), comoApiDoSheets(comentariosCsv)],
] as const) {
  console.log(`\n=== Caminho feliz: ${rotulo} ===`);
  const { db } = novoBanco();
  const m = await migrar(db, rowsV as string[][], rowsC as string[][]);
  checar("pré-checagem não bloqueou", !("bloqueado" in m), m);
  if ("bloqueado" in m) continue;
  checar("0 falhas de gravação (vídeos)", m.rv.falhas.length === 0, m.rv.falhas);
  checar("0 falhas de gravação (comentários)", m.rc.falhas.length === 0, m.rc.falhas);
  const val = await validar(db, rowsV as string[][], rowsC as string[][]);
  const { divergencias: _dv, ...resV } = val.videos;
  const { divergencias: _dc, ...resC } = val.comentarios;
  console.log("vídeos:", JSON.stringify({ ...resV, resumoPorColuna: undefined }));
  console.log("comentários:", JSON.stringify({ ...resC, resumoPorColuna: undefined }));
  checar("vídeos idênticos célula a célula", val.videos.ok, val.videos);
  checar("comentários idênticos célula a célula", val.comentarios.ok, val.comentarios);

  // Idempotência: rodar de novo não duplica nem altera nada.
  await migrar(db, rowsV as string[][], rowsC as string[][]);
  const val2 = await validar(db, rowsV as string[][], rowsC as string[][]);
  checar("2ª rodada continua idêntica (sem duplicar)", val2.videos.ok && val2.comentarios.ok, val2);
}

console.log("\n=== Órfãos (migrados, só informativo) ===");
console.table(listarComentariosOrfaos(videosCsv, comentariosCsv));

console.log("\n=== Testes negativos (a validação/pré-checagem TEM que reclamar) ===");
{
  const { sqlite, db } = novoBanco();
  await migrar(db, videosCsv, comentariosCsv);
  sqlite.exec("UPDATE videos SET descricao = descricao || ' ' WHERE descricao IS NOT NULL AND rowid = (SELECT min(rowid) FROM videos WHERE descricao IS NOT NULL)");
  sqlite.exec("DELETE FROM comentarios_videos WHERE id = (SELECT max(id) FROM comentarios_videos)");
  sqlite.exec("UPDATE comentarios_videos SET reacoes_json = NULL WHERE id = (SELECT min(id) FROM comentarios_videos WHERE reacoes_json IS NOT NULL)");
  const val = await validar(db, videosCsv, comentariosCsv);
  checar("detecta 1 espaço a mais numa descrição", !val.videos.ok && val.videos.totalDivergencias === 1, val.videos.divergencias);
  checar(
    "detecta comentário apagado + reação perdida",
    !val.comentarios.ok && val.comentarios.faltandoNoD1.length === 1 && val.comentarios.totalDivergencias === 1,
    { faltando: val.comentarios.faltandoNoD1, div: val.comentarios.divergencias },
  );
}
{
  const dup = videosCsv.map((r) => [...r]);
  dup[2][5] = dup[1][5];
  const m = await migrar(novoBanco().db, dup, comentariosCsv);
  checar("bloqueia message_thread_id repetido", "bloqueado" in m, m);
}
{
  const deslocado = videosCsv.map((r) => [r[0], "", ...r.slice(1)]);
  const m = await migrar(novoBanco().db, deslocado, comentariosCsv);
  checar("bloqueia cabeçalho/colunas deslocadas", "bloqueado" in m);
}
{
  const comExtra = videosCsv.map((r, i) => [...r, i === 0 ? "Coluna Nova" : i === 3 ? "valor novo" : ""]);
  const { db } = novoBanco();
  await migrar(db, comExtra, comentariosCsv);
  const val = await validar(db, comExtra, comentariosCsv);
  checar("coluna nova depois de U é preservada (colunas_extra_json)", val.videos.ok, val.videos);
  const semExtra = await validar(db, videosCsv, comentariosCsv);
  checar("…e a validação percebe se ela sumir", !semExtra.videos.ok);
}

console.log(falhou ? "\nRESULTADO: FALHOU" : "\nRESULTADO: TUDO PASSOU");
process.exit(falhou ? 1 : 0);
