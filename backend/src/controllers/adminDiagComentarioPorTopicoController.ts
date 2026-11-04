import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico read-only: busca SEM limite de "últimos 15" (diferente de
// adminDiagComentarioSumidoGenericoController) — acha toda linha de
// Comentarios_Musicas/MV/Albuns cujo "ID do tópico" bate exatamente com o
// valor pedido, e/ou cujo jogador bate com o nome pedido. Pra confirmar se
// um comentário específico existe mesmo (e com qual topicId), sem o corte
// que escondia comentários mais antigos na ferramenta anterior.
//
// GET /api/empire-play/admin/diag-comentario-por-topico?topicId=musica_...&jogador=Weuller
export async function adminDiagComentarioPorTopicoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const topicIdAlvo = normalizeComparison(url.searchParams.get("topicId") || "");
  const jogadorAlvo = normalizeComparison(url.searchParams.get("jogador") || "");

  const porTopicId: Record<string, { linha: number; row: string[] }[]> = {};
  const porJogador: Record<string, { linha: number; topicId: string; data: string }[]> = {};
  for (const sheet of ["Comentarios_Musicas", "Comentarios_MV", "Comentarios_Albuns"]) {
    const rows = await googleSheetsService.principal.readValues(sheet).catch(() => []);
    const comIndice = rows.map((row, i) => ({ linha: i + 1, row }));
    if (topicIdAlvo) {
      porTopicId[sheet] = comIndice.filter(({ row }) => normalizeComparison((row || [])[0] || "") === topicIdAlvo);
    }
    if (jogadorAlvo) {
      porJogador[sheet] = comIndice
        .filter(({ row }) => normalizeComparison((row || [])[2] || "") === jogadorAlvo)
        .map(({ linha, row }) => ({ linha, topicId: row[0] || "", data: row[5] || row[3] || "" }));
    }
  }

  return new Response(JSON.stringify({ success: true, topicIdAlvo, jogadorAlvo, porTopicId, porJogador }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
