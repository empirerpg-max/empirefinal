import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico read-only: comentário do Wesley em "Alerta Rojo" (vídeo) não
// apareceu no tópico nem gerou REGISTRO — checa Music Videos (linha,
// message_thread_id) e Comentarios_MV (achando por jogador+texto, já que
// o topicId gravado pode não bater, mesma classe de problema já vista em
// Comentarios_Musicas).
//
// GET /api/empire-play/admin/diagnostico-video-wesley
export async function adminDiagVideoWesleyController(): Promise<Response> {
  const videosRows = await googleSheetsService.principal.readValues("Music Videos").catch(() => []);
  const videoAchado: Record<string, unknown>[] = [];
  for (let i = 1; i < videosRows.length; i++) {
    const row = videosRows[i];
    if (!row) continue;
    const titulo = normalizeText(row[1]);
    if (!normalizeComparison(titulo).includes("alerta rojo")) continue;
    videoAchado.push({
      linha: i + 1,
      titulo,
      messageThreadId: row[5] || "",
      fonte: row[10] || "",
      codigoUnico: row[20] || "",
    });
  }

  const comentariosRows = await googleSheetsService.principal.readValues("Comentarios_MV").catch(() => []);
  const comentariosAchados: Record<string, unknown>[] = [];
  for (let i = 1; i < comentariosRows.length; i++) {
    const row = comentariosRows[i];
    if (!row) continue;
    const jogador = normalizeText(row[2]);
    const comentario = normalizeText(row[3]);
    if (
      !normalizeComparison(jogador).includes("wesley") &&
      !normalizeComparison(comentario).includes("alerta rojo")
    )
      continue;
    comentariosAchados.push({ linha: i + 1, topicId: row[0] || "", jogador, comentario: comentario.slice(0, 150) });
  }

  return new Response(
    JSON.stringify({ success: true, videoAchado, comentariosAchados }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
