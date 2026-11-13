import { test, expect, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
// Teste do espelho em tempo real + reconciliação (videosD1Sync.ts) num
// SQLite de verdade, com a planilha simulada em memória a partir dos CSVs
// exportados de "Music Videos" e "Comentarios_MV".
//
// Uso:
//   CSV_VIDEOS=Music_Videos.csv CSV_COMENTARIOS=Comentarios_MV.csv bun test scripts/testar-espelho-videos-d1.test.ts
import { fileURLToPath } from "node:url";
const R = fileURLToPath(new URL("../backend/src/services/", import.meta.url));
const CSV_VIDEOS = process.env.CSV_VIDEOS || "";
const CSV_COMENTARIOS = process.env.CSV_COMENTARIOS || "";

// --- planilha falsa em memória ---
function parseCsv(t: string): string[][] { const out: string[][] = []; let row: string[] = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i+1] === "\n") i++; row.push(f); out.push(row); row = []; f = ""; } else f += c; }
  if (f !== "" || row.length) { row.push(f); out.push(row); } return out; }
const trim = (rows: string[][]) => rows.map(r => { const c = [...r]; while (c.length && c[c.length-1] === "") c.pop(); return c; });
const sheets: Record<string, string[][]> = {
  "Music Videos": trim(parseCsv(readFileSync(CSV_VIDEOS, "utf-8"))),
  "Comentarios_MV": trim(parseCsv(readFileSync(CSV_COMENTARIOS, "utf-8"))),
};
let leituras = 0;
function lerRange(aba: string, range: string): string[][] {
  leituras++;
  const rows = sheets[aba]; const m = range.match(/^[A-Z]+(\d+)?:[A-Z]+(\d+)?$/);
  if (!m || !m[1]) return rows.map(r => [...r]);
  const a = +m[1], b = m[2] ? +m[2] : rows.length;
  return rows.slice(a - 1, b).map(r => [...r]);
}
mock.module(R + "googleSheetsService.ts", () => ({
  readValuesFresh: async (_k: string, aba: string, range = "A:ZZ") => lerRange(aba, range),
  googleSheetsService: { principal: { readValues: async (aba: string, range = "A:ZZ") => lerRange(aba, range) } },
  linhasParaObjetos: () => [],
  normalizeText: (v: unknown) => String(v ?? "").trim(),
  // cópia fiel de googleSheetsService.normalizeComparison
  normalizeComparison: (v: unknown) =>
    String(v ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " "),
}));
mock.module(R + "logSistemaService.ts", () => ({ registrarLogSistema: async () => {} }));

// --- D1 falso sobre sqlite ---
const sqlite = new Database(":memory:");
const prep = (sql: string, b: unknown[] = []): any => ({ bind: (...v: unknown[]) => prep(sql, v),
  run: async () => { sqlite.query(sql).run(...(b as never[])); return { results: [], success: true }; },
  all: async () => ({ results: sqlite.query(sql).all(...(b as never[])), success: true }) });
const db: any = { prepare: (s: string) => prep(s),
  batch: async (st: any[]) => { const out = []; sqlite.exec("BEGIN"); try { for (const s of st) out.push(await s.run()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return out; } };
(globalThis as any).__CATALOGO_DB__ = db;

const { VIDEOS_CREATE_STATEMENTS } = await import(R + "videosDbService.ts");
const { COMENTARIOS_VIDEOS_CREATE_STATEMENTS } = await import(R + "comentariosVideosDbService.ts");
for (const s of [...VIDEOS_CREATE_STATEMENTS, ...COMENTARIOS_VIDEOS_CREATE_STATEMENTS]) sqlite.exec(s);
const S = await import(R + "videosD1Sync.ts");
const V = await import(R + "videosD1Validacao.ts");
const validar = async () => ({
  v: V.validarVideos(sheets["Music Videos"], sqlite.query("SELECT * FROM videos").all() as any),
  c: V.validarComentariosVideos(sheets["Comentarios_MV"], sqlite.query("SELECT * FROM comentarios_videos").all() as any),
});

test("carga inicial completa (troca atômica) fica idêntica", async () => {
  expect((await S.sincronizarVideosCompleto()).ok).toBe(true);
  expect((await S.sincronizarComentariosCompleto()).ok).toBe(true);
  const r = await validar(); expect(r.v.ok).toBe(true); expect(r.c.ok).toBe(true);
  expect(r.c.linhasD1).toBe(864);
  expect(sqlite.query("SELECT name FROM sqlite_master WHERE name='comentarios_videos_rascunho'").all().length).toBe(0);
});

test("linhasDoIntervalo", () => {
  expect(S.linhasDoIntervalo("O12")).toEqual([12, 12]);
  expect(S.linhasDoIntervalo("A265:T265")).toEqual([265, 265]);
  expect(S.linhasDoIntervalo("B2:B5000")).toEqual([2, 5000]);
  expect(S.linhasDoIntervalo("A:G")).toBe(null);
  expect(S.linhasDoIntervalo("'Music Videos'!U264")).toEqual([264, 264]);
});

test("comentário novo (append) aparece no D1 na hora, com 1 leitura só da linha", async () => {
  sheets["Comentarios_MV"].push(["video_1793150491662_k8usr6", "123", "Fulano", "Que clipe!", "13/11/2026, 16:00:00", "", ""]);
  const linha = sheets["Comentarios_MV"].length;
  leituras = 0;
  await S.aposEscritaNaPlanilha({ sheetName: "Comentarios_MV", tipo: "append", linhas: [linha] });
  expect(leituras).toBeLessThanOrEqual(2); // linha + cabeçalho
  expect((await validar()).c.ok).toBe(true);
});

test("reação (update F) e troca de tópico (update A) espelham", async () => {
  sheets["Comentarios_MV"][5][5] = '{"🔥":["1"]}';
  await S.aposEscritaNaPlanilha({ sheetName: "Comentarios_MV", tipo: "update", range: "F6" });
  sheets["Comentarios_MV"][9][0] = "video_1789829384327_dmoybe";
  await S.aposEscritaNaPlanilha({ sheetName: "Comentarios_MV", tipo: "update", range: "A10" });
  expect((await validar()).c.ok).toBe(true);
});

test("vídeo novo (A:T + U), likes (O), ID novo em F e F limpa", async () => {
  const novo = Array(21).fill(""); novo[1] = "Teste - Clipe"; novo[5] = "video_999_teste"; novo[7] = "Music Video"; novo[9] = "13/11/2026"; novo[10] = "drive";
  sheets["Music Videos"].push(novo); const n = sheets["Music Videos"].length;
  await S.aposEscritaNaPlanilha({ sheetName: "Music Videos", tipo: "update", range: `A${n}:T${n}` });
  sheets["Music Videos"][n-1][20] = "EMP1"; await S.aposEscritaNaPlanilha({ sheetName: "Music Videos", tipo: "update", range: `U${n}` });
  sheets["Music Videos"][10][14] = "77"; await S.aposEscritaNaPlanilha({ sheetName: "Music Videos", tipo: "update", range: "O11" });
  sheets["Music Videos"][20][5] = "video_novo_id"; await S.aposEscritaNaPlanilha({ sheetName: "Music Videos", tipo: "update", range: "F21" });
  expect((await validar()).v.ok).toBe(true);
  sheets["Music Videos"][20][5] = ""; await S.aposEscritaNaPlanilha({ sheetName: "Music Videos", tipo: "update", range: "F21" });
  // F vazia: continua no D1 com chave provisória e a validação segue idêntica
  expect(sqlite.query("SELECT id_topico FROM videos WHERE linha_planilha = 21").get()).toEqual({ id_topico: "__sem_id__linha_21" });
  expect((await validar()).v.ok).toBe(true);
  expect((await S.reconciliarVideosD1()).videosOk).toBe(true);
  sheets["Music Videos"][20][5] = "video_novo_id"; await S.aposEscritaNaPlanilha({ sheetName: "Music Videos", tipo: "update", range: "F21" });
  expect((await validar()).v.ok).toBe(true);
});

test("apagar linhas (deleteRows) desloca tudo -> ressincroniza e fica idêntico", async () => {
  sheets["Comentarios_MV"].splice(99, 3);
  await S.aposEscritaNaPlanilha({ sheetName: "Comentarios_MV", tipo: "delete", linhas: [102, 101, 100] });
  sheets["Music Videos"].splice(49, 1);
  await S.aposEscritaNaPlanilha({ sheetName: "Music Videos", tipo: "delete", linhas: [50] });
  const r = await validar(); expect(r.c.ok).toBe(true); expect(r.v.ok).toBe(true);
});

test("reconciliação do cron conserta escrita feita direto na planilha (sem gancho)", async () => {
  sheets["Comentarios_MV"][200][3] = "editado à mão na planilha";
  sheets["Music Videos"][30][8] = "descrição editada à mão";
  sheets["Comentarios_MV"].push(["1637", "9", "X", "comentário manual", "13/11/2026", "", ""]);
  const antes = await validar(); expect(antes.c.ok).toBe(false); expect(antes.v.ok).toBe(false);
  const r = await S.reconciliarVideosD1();
  expect(r.corrigiuVideos?.ok).toBe(true); expect(r.corrigiuComentarios?.ok).toBe(true);
  const depois = await validar(); expect(depois.v.ok).toBe(true); expect(depois.c.ok).toBe(true);
  const r2 = await S.reconciliarVideosD1(); expect(r2.videosOk && r2.comentariosOk).toBe(true);
});

test("falha no meio da carga de comentários NÃO troca a tabela real", async () => {
  const antes = sqlite.query("SELECT count(*) n FROM comentarios_videos").get();
  const ruim = sheets["Comentarios_MV"].map(r => [...r]); ruim[0][0] = "Cabeçalho errado";
  const r = await S.sincronizarComentariosCompleto(ruim);
  expect(r.ok).toBe(false);
  expect(sqlite.query("SELECT count(*) n FROM comentarios_videos").get()).toEqual(antes);
});

// ---------------------------------------------------------------------------
// Fase 3 — leitura pelo D1: as linhas remontadas têm que ser as da planilha
// ---------------------------------------------------------------------------
const L = await import(R + "videosD1Leitura.ts");
const kv = new Map<string, string>();
(globalThis as any).__FLAGS_KV__ = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v) };

function semVaziasNoFim(rows: string[][]) { const c = rows.map(r => { const x = [...r]; while (x.length && x[x.length-1] === "") x.pop(); return x; }); while (c.length && c[c.length-1].length === 0) c.pop(); return c; }

test("leitura D1: linhas de vídeos e comentários idênticas às da planilha (posição + conteúdo)", async () => {
  await S.sincronizarVideosCompleto(); await S.sincronizarComentariosCompleto();
  const v = await L.linhasVideosD1(); const c = await L.linhasComentariosVideosD1();
  expect(JSON.stringify(semVaziasNoFim(v!))).toBe(JSON.stringify(semVaziasNoFim(sheets["Music Videos"])));
  expect(JSON.stringify(semVaziasNoFim(c!))).toBe(JSON.stringify(semVaziasNoFim(sheets["Comentarios_MV"])));
  // Sem normalizar o lado do D1: cada linha remontada tem que vir EXATAMENTE
  // como a API do Sheets devolve (sem células vazias no fim) — o cabeçalho
  // de Comentarios_MV tem 6 colunas, não 7 (pego em produção).
  expect(c![0]).toEqual(sheets["Comentarios_MV"][0]);
  expect(v![0]).toEqual(sheets["Music Videos"][0]);
  for (const [d1, plan] of [[v!, sheets["Music Videos"]], [c!, sheets["Comentarios_MV"]]] as const) {
    // a API do Sheets nunca devolve células vazias no fim da linha
    const comoApi = (r: string[] | undefined) => { const x = [...(r ?? [])]; while (x.length && x[x.length - 1] === "") x.pop(); return x; };
    for (let i = 0; i < d1.length; i++) expect(d1[i]).toEqual(comoApi(plan[i]));
  }
});

test("chave desligada lê da planilha; ligada lê do D1; D1 falhando volta pra planilha", async () => {
  leituras = 0;
  await L.definirLeituraVideosD1(false);
  await L.linhasDaAbaDeVideo("Music Videos"); expect(leituras).toBe(1);
  await L.definirLeituraVideosD1(true);
  leituras = 0; const d = await L.linhasDaAbaDeVideo("Comentarios_MV"); expect(leituras).toBe(0); expect(d.length).toBeGreaterThan(800);
  const real = (globalThis as any).__CATALOGO_DB__;
  (globalThis as any).__CATALOGO_DB__ = { prepare: () => ({ all: async () => { throw new Error("D1 fora"); } }) };
  leituras = 0; const f = await L.linhasDaAbaDeVideo("Music Videos"); expect(leituras).toBe(1); expect(f.length).toBeGreaterThan(200);
  (globalThis as any).__CATALOGO_DB__ = real;
  await L.definirLeituraVideosD1(false);
});

// ---------------------------------------------------------------------------
// Fase 3b — busca de comentários por tópico: superconjunto exato do filtro
// ---------------------------------------------------------------------------
test("busca por tópico traz TODO comentário que o filtro do Fórum poderia aceitar, pra todo vídeo", async () => {
  await S.sincronizarComentariosCompleto();
  const norm = (v: unknown) => String(v ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ");
  const plan = sheets["Comentarios_MV"];
  const largura = plan[0].length; // o registro só tem as colunas do cabeçalho
  let verificados = 0;
  const videos = sheets["Music Videos"].slice(1).filter((r) => r.some((c) => c));
  for (let i = 0; i < videos.length; i++) {
    const id = videos[i][5] || "";
    for (const busca of [norm(id), norm(`videos_${id}`), norm(`videos_idx${i + 1}`)].filter(Boolean)) {
      const linhas = await L.linhasComentariosVideosDoTopicoD1([busca]);
      expect(linhas).not.toBeNull();
      const encontradas = new Set(linhas!.map((r, idx) => (r.length ? idx + 1 : 0)).filter(Boolean));
      for (let n = 2; n <= plan.length; n++) {
        const row = plan[n - 1] || [];
        if (!row.some((c) => String(c ?? "").trim())) continue;
        const valores = row.slice(0, largura).map((c) => String(c ?? "").trim());
        const filtroAceitaria = valores.some((v) => v.length > 0 && v.length <= 100 && norm(v) === busca);
        if (filtroAceitaria) { expect(encontradas.has(n)).toBe(true); verificados++; }
      }
    }
  }
  expect(verificados).toBeGreaterThan(800);
});

test("busca por tópico recusa (null) ID vazio, e linhas sem chaves_busca", async () => {
  expect(await L.linhasComentariosVideosDoTopicoD1([""])).toBeNull();
});
