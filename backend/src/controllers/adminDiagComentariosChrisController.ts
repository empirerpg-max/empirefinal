import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico read-only: TODOS os comentários do Chris em Comentarios_Musicas
// (topicId cru, sem resolver título) — usado pra achar qual comentário dele
// não tem entrada em REGISTRO, já que a 1ª tentativa (topicId fixo de
// "nostalgic traveller") não achou nada — pode ser um comentário em outra
// música.
//
// GET /api/empire-play/admin/diagnostico-comentarios-chris
export async function adminDiagComentariosChrisController(): Promise<Response> {
  const comentariosRows = await googleSheetsService.principal.readValues("Comentarios_Musicas").catch(() => []);
  const comentarios: Record<string, unknown>[] = [];
  for (let i = 1; i < comentariosRows.length; i++) {
    const row = comentariosRows[i];
    if (!row) continue;
    if (normalizeComparison(normalizeText(row[2])) !== "chris") continue;
    comentarios.push({
      linha: i + 1,
      topicId: row[0] || "",
      comentario: normalizeText(row[3]).slice(0, 100),
      data: row[5] || "",
    });
  }

  // Resolve o título de cada topicId cruzando com Musicas (coluna B/F = id
  // do tópico, H = nome) pra facilitar comparar com REGISTRO.
  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:H").catch(() => []);
  const tituloPorTopicId = new Map<string, string>();
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row) continue;
    const id1 = normalizeText(row[1]);
    const id2 = normalizeText(row[5]);
    const nome = normalizeText(row[7]);
    if (id1) tituloPorTopicId.set(id1, nome);
    if (id2) tituloPorTopicId.set(id2, nome);
  }

  const comComTitulo = comentarios.map((c) => ({
    ...c,
    tituloResolvido: tituloPorTopicId.get(normalizeText(c.topicId as string)) || null,
  }));

  return new Response(JSON.stringify({ success: true, comentarios: comComTitulo }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
