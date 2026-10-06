import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico de EMERGÊNCIA (só leitura): usuário reportou que músicas que
// tinham comentário antes agora aparecem com 0 — precisa confirmar se o
// backfill de ID (adminBackfillTopicIdsController) causou isso de alguma
// forma, ou se o comentário realmente nunca existiu electronically.
//
// ?musica=<texto> busca por título (em Musicas, pra achar a linha e TODAS
// as colunas dela — não só B, pra ver se existe algum outro campo tipo
// ref_telegram_id/telegram_topic_id preenchido que o backfill ignorou) e
// por qualquer comentário em Comentarios_Musicas cujo texto ou jogador
// mencione o termo buscado (varredura ampla, não só por topicId).
export async function adminDiagComentarioPerdidoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const termo = normalizeComparison(url.searchParams.get("musica") || "");
  if (!termo) {
    return new Response(JSON.stringify({ success: false, error: "Use ?musica=<título ou trecho>" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const [musicasHeader, musicasRows, comentariosRows] = await Promise.all([
    googleSheetsService.principal.readValues("Musicas", "A1:AA1").catch(() => []),
    googleSheetsService.principal.readValues("Musicas", "A2:AA5000").catch(() => []),
    googleSheetsService.principal.readValues("Comentarios_Musicas").catch(() => []),
  ]);

  const header = musicasHeader[0] || [];

  // Acha a(s) linha(s) de Musicas cujo título (coluna H, índice 7) bate com
  // o termo buscado — mostra TODAS as colunas (não só B) pra ver se existe
  // algum ID de tópico "escondido" em outra coluna.
  const linhasMusica: { linha: number; colunas: Record<string, string> }[] = [];
  musicasRows.forEach((row, i) => {
    const titulo = normalizeComparison(row[7] || "");
    if (titulo.includes(termo)) {
      const colunas: Record<string, string> = {};
      header.forEach((h, idx) => {
        const label = normalizeText(h) || `coluna_${idx + 1}`;
        const val = normalizeText(row[idx]);
        if (val) colunas[label] = val;
      });
      linhasMusica.push({ linha: i + 2, colunas });
    }
  });

  // Varre TODOS os comentários de Comentarios_Musicas procurando qualquer
  // menção ao termo buscado no texto do comentário ou no nome do jogador —
  // não filtra por topicId, pra achar comentário mesmo que o vínculo esteja
  // quebrado/apontando pra um ID que não existe mais em lugar nenhum.
  const comentariosEncontrados: { linha: number; topicId: string; jogador: string; comentarioTrecho: string }[] = [];
  for (let i = 1; i < comentariosRows.length; i++) {
    const row = comentariosRows[i] || [];
    const comentario = normalizeComparison(row[3] || "");
    const jogador = normalizeComparison(row[2] || "");
    if (comentario.includes(termo) || jogador.includes(termo)) {
      comentariosEncontrados.push({
        linha: i + 1,
        topicId: normalizeText(row[0]),
        jogador: normalizeText(row[2]),
        comentarioTrecho: normalizeText(row[3]).slice(0, 200),
      });
    }
  }

  return new Response(
    JSON.stringify({ success: true, termo, linhasMusica, comentariosEncontrados }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
