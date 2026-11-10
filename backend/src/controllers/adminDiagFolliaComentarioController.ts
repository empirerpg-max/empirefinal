import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico pontual (2026-11-10): jogador Daniel comentou no álbum
// "Max Gorghan - FOLLIA" e o comentário não aparece. /api/empire-play/forum/
// albuns/album_1792551638543_utb9mi (topicId real, confirmado via dump bruto
// de "Albuns") devolveu 404 "Tópico não encontrado" — a busca de
// getEmpirePlayForumTopicController não está achando a linha por esse id.
// Dump via readSheetObjects("Albuns") (MESMA leitura que o controller usa,
// com headers normalizados) pra ver exatamente que chave de coluna guarda
// o ID do tópico nessa linha, e também lê Comentarios_Albuns crua pra ver
// se o comentário do Daniel está lá, com qual topicId gravado.
//
// GET /api/empire-play/admin/diagnostico-follia-comentario
export async function adminDiagFolliaComentarioController(): Promise<Response> {
  const headerRow = await googleSheetsService.principal.readValues("Albuns", "A1:L1").catch(() => []);
  const albunsObjetos = await googleSheetsService.principal.readSheetObjects("Albuns").catch(() => []);
  const linhaFollia = albunsObjetos.find((rec) =>
    Object.values(rec as Record<string, unknown>).some((v) =>
      normalizeComparison(String(v || "")).includes(normalizeComparison("FOLLIA")),
    ),
  );
  // linha 101 crua = índice 99 na lista de objetos (se readSheetObjects
  // começar em A2 igual readValues) — pega direto pelo índice também, caso
  // o find acima não bata por nome de chave nenhum.
  const porIndice = albunsObjetos[99];

  const comentariosRows = await googleSheetsService.principal.readValues("Comentarios_Albuns").catch(() => []);
  const comentariosDaniel = comentariosRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ row }) => normalizeComparison(row[1] || row[2] || "").includes("daniel"));

  const comentariosDoTopico = comentariosRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ row }) => normalizeComparison(row[0] || "") === normalizeComparison("album_1792551638543_utb9mi"));

  return new Response(
    JSON.stringify(
      {
        success: true,
        headerRow: headerRow[0] || [],
        totalAlbunsObjetos: albunsObjetos.length,
        linhaFolliaViaReadSheetObjects: linhaFollia || null,
        porIndice99: porIndice || null,
        comentariosDaniel,
        comentariosDoTopico,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
