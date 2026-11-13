import { googleSheetsService } from "../services/googleSheetsService";
import { getCatalogoDb } from "../services/catalogoDbService";

// Diagnóstico SOMENTE LEITURA (2026-11-13): de onde vieram os 13
// comentários de Comentarios_MV cujo "ID do tópico" não existe mais em
// "Music Videos" (1628, 1638, 1685, videos_idx215,
// video_1792668710470_e8nwqc + 4 testes de debug).
//
// Cruza 3 fontes que guardam o PASSADO (a planilha atual só tem o
// presente):
//   1. D1 `midia` (tabela legada da Fase 1, migrada em 2026-10-06 e
//      alimentada desde então por upsertMidiaD1) — guardou título/data/
//      código dos vídeos com o ID ANTIGO, inclusive dos que depois tiveram
//      a linha reescrita na planilha. Lista TODO vídeo que está em `midia`
//      mas cujo ID não existe mais em "Music Videos"!F.
//   2. LOGS (planilha logsSistema) — linhas que citam algum dos termos.
//   3. LOG_EXCLUSOES_TOPICOS — exclusões de tópico feitas pelo admin.
//
// GET /api/empire-play/admin/diagnostico-comentarios-videos-orfaos
const IDS_ALVO = ["1628", "1638", "1685", "videos_idx215", "video_1792668710470_e8nwqc"];
const TERMOS_LOG = [...IDS_ALVO, "alchimia", "cowboy fresh", "corazones rotos", "abigail"];

function idCru(idMidia: string): string {
  return idMidia.replace(/^video_legado_/, "");
}

export async function adminDiagComentariosVideosOrfaosController(): Promise<Response> {
  const out: Record<string, unknown> = {};

  const videosRows = await googleSheetsService.principal.readValues("Music Videos", "A:U").catch(() => []);
  const idsAtuais = new Set(videosRows.slice(1).map((r) => (r?.[5] || "").trim()).filter(Boolean));
  out.videosNaPlanilhaHoje = idsAtuais.size;

  // 1. D1 midia
  const db = getCatalogoDb();
  if (db) {
    try {
      const r = await db
        .prepare(
          `SELECT id, titulo, artista, categoria, data_lancamento, codigo_unico, video_url,
                  nome_original_charts, thumb_url, criado_em, atualizado_em
             FROM midia WHERE tipo = 'video'`,
        )
        .all<Record<string, unknown>>();
      const todos = r.results || [];
      out.midiaVideosTotal = todos.length;
      out.midiaAlvos = todos.filter((m) => IDS_ALVO.includes(idCru(String(m.id))));
      out.midiaVideosQueNaoExistemMaisNaPlanilha = todos
        .filter((m) => !idsAtuais.has(idCru(String(m.id))))
        .map((m) => ({ ...m, idCru: idCru(String(m.id)) }));
    } catch (err) {
      out.midiaErro = (err as Error).message;
    }
  } else {
    out.midiaErro = "Binding CATALOGO_DB indisponível";
  }

  const filtrar = (rows: string[][]) =>
    rows
      .map((row, i) => ({ linha: i + 1, row }))
      .filter(({ row }) => {
        const t = (row || []).join(" | ").toLowerCase();
        return TERMOS_LOG.some((termo) => t.includes(termo));
      })
      .map(({ linha, row }) => ({ linha, row: row.map((c) => (c.length > 600 ? `${c.slice(0, 600)}…` : c)) }));

  // 2. LOGS
  try {
    out.logs = filtrar(await googleSheetsService.logsSistema.readValues("LOGS", "A:G"));
  } catch (err) {
    out.logsErro = (err as Error).message;
  }

  // 3. LOG_EXCLUSOES_TOPICOS
  try {
    out.exclusoes = filtrar(await googleSheetsService.logsSistema.readValues("LOG_EXCLUSOES_TOPICOS", "A:H"));
  } catch (err) {
    out.exclusoesErro = (err as Error).message;
  }

  // 4. Notificacoes — guarda, por comentário, {autor, TÍTULO da mídia,
  // trecho, ID do tópico usado} no momento do post (ver
  // adminFixOrphanCommentsController.ts). Fonte de verdade pra saber a QUE
  // vídeo cada comentário órfão se referia.
  try {
    const notif = await googleSheetsService.principal.readValues("Notificacoes", "A:Z");
    const header = notif[0] || [];
    out.notificacoesHeader = header;
    out.notificacoesTotal = notif.length - 1;
    const comentarios = await googleSheetsService.principal.readValues("Comentarios_MV", "A:G");
    const orfaos = comentarios
      .map((row, i) => ({ linha: i + 1, row }))
      .slice(1)
      .filter(({ row }) => row?.[0] !== undefined && !idsAtuais.has((row[0] || "").trim()) && (row[0] || "").trim() !== "");
    const norm = (v: string) => (v || "").toLowerCase().replace(/\s+/g, " ").trim();
    out.notificacoesPorOrfao = orfaos.map(({ linha, row }) => {
      const id = (row[0] || "").trim();
      const trecho = norm(row[3] || "").slice(0, 40);
      const achadas = notif
        .map((r, i) => ({ linha: i + 1, r }))
        .slice(1)
        .filter(({ r }) => {
          const t = norm((r || []).join(" | "));
          return r.some((c) => (c || "").trim() === id) || (trecho.length >= 12 && t.includes(trecho));
        })
        .map(({ linha: l, r }) => ({ linha: l, row: r.map((c) => (c.length > 300 ? `${c.slice(0, 300)}…` : c)) }));
      return { linhaComentario: linha, idTopico: id, autor: row[2], inicio: (row[3] || "").slice(0, 60), notificacoes: achadas };
    });
  } catch (err) {
    out.notificacoesErro = (err as Error).message;
  }

  try {
    const logsAll = await googleSheetsService.logsSistema.readValues("LOGS", "A:A");
    out.logsTotalLinhas = logsAll.length;
  } catch (err) {
    out.logsTotalErro = (err as Error).message;
  }

  return new Response(JSON.stringify({ success: true, ...out }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
