import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Versão genérica do diagnóstico de "comentário sumiu" (não hardcoded
// pro DERBY) — recebe artista/jogador por query e varre Musicas, Music
// Videos e Albuns pra achar tópicos do artista, junto com as últimas
// linhas de Comentarios_Musicas/Comentarios_MV/Comentarios_Albuns que
// batem com o nome do jogador. Mesma causa suspeita de antes: comentário
// pode ter sido salvo com um topicId que não é mais o "oficial" daquele
// tópico (linha duplicada, ID reatribuído, etc).
//
// GET /api/empire-play/admin/diag-comentario-sumido-v2?artista=Amanda%20Brokne&jogador=Dani
export async function adminDiagComentarioSumidoGenericoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const artista = normalizeComparison(url.searchParams.get("artista") || "");
  const jogador = normalizeComparison(url.searchParams.get("jogador") || "");

  const topicosPorAba: Record<string, { linha: number; topicId: string; titulo: string }[]> = {};

  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A1:AE50000").catch(() => []);
  topicosPorAba["Musicas"] = musicasRows
    .map((row, i) => ({ linha: i + 1, topicId: normalizeText(row?.[1]), titulo: normalizeText(row?.[7]) }))
    .filter((t) => normalizeComparison(t.titulo).includes(artista));

  const albunsRows = await googleSheetsService.principal.readValues("Albuns", "A1:Z20000").catch(() => []);
  topicosPorAba["Albuns"] = albunsRows
    .map((row, i) => ({ linha: i + 1, topicId: normalizeText(row?.[1]), titulo: normalizeText(row?.[6]) }))
    .filter((t) => normalizeComparison(t.titulo).includes(artista));

  const mvRows = await googleSheetsService.principal.readValues("Music Videos", "A1:Z20000").catch(() => []);
  topicosPorAba["Music Videos"] = mvRows
    .map((row, i) => ({ linha: i + 1, topicId: normalizeText(row?.[5]), titulo: normalizeText(row?.[1]) }))
    .filter((t) => normalizeComparison(t.titulo).includes(artista));

  const comentarios: Record<string, { linha: number; row: string[] }[]> = {};
  for (const sheet of ["Comentarios_Musicas", "Comentarios_MV", "Comentarios_Albuns"]) {
    const rows = await googleSheetsService.principal.readValues(sheet).catch(() => []);
    comentarios[sheet] = rows
      .map((row, i) => ({ linha: i + 1, row }))
      .filter(({ row }) => {
        const texto = normalizeComparison((row || []).join(" | "));
        return (jogador && texto.includes(jogador)) || (artista && texto.includes(artista));
      })
      .slice(-15);
  }

  return new Response(
    JSON.stringify({ success: true, artista, jogador, topicosPorAba, comentarios }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
