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
  const albunsObjetos = await googleSheetsService.principal.readSheetObjects("Albuns").catch(() => []);
  const linhaFollia = albunsObjetos.find((rec) =>
    normalizeComparison(String((rec as any)["novo_nome"] || (rec as any)["g_novo_nome"] || "")).includes(
      normalizeComparison("Max Gorghan - FOLLIA"),
    ),
  );

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
        linhaFolliaViaReadSheetObjects: linhaFollia || null,
        chavesDisponiveis: linhaFollia ? Object.keys(linhaFollia) : [],
        comentariosDaniel,
        comentariosDoTopico,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
