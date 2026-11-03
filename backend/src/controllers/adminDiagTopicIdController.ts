import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Diagnóstico read-only: acha a que linha (Musicas/Albuns/Music Videos)
// um "ID do tópico" específico pertence — incluindo os IDs antigos,
// numéricos puros (ex: "1152", "1715"), de antes do esquema
// "musica_<timestamp>_<rand>" — pra investigar comentário gravado com um
// ID de tópico que não bate (ou não bate mais) com nenhuma linha atual.
//
// GET /api/empire-play/admin/diag-topicid?id=1152
export async function adminDiagTopicIdController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const idAlvo = normalizeComparison(url.searchParams.get("id") || "");
  if (!idAlvo) {
    return new Response(JSON.stringify({ success: false, error: "Parâmetro id obrigatório." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const achados: { aba: string; linha: number; topicId: string; titulo: string; codigoUnico: string }[] = [];

  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:AE").catch(() => []);
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row) continue;
    if (normalizeComparison(row[1]) === idAlvo) {
      achados.push({ aba: "Musicas", linha: i + 1, topicId: normalizeText(row[1]), titulo: normalizeText(row[7]), codigoUnico: normalizeText(row[25]) });
    }
  }

  const albunsRows = await googleSheetsService.principal.readValues("Albuns", "A:Z").catch(() => []);
  for (let i = 1; i < albunsRows.length; i++) {
    const row = albunsRows[i];
    if (!row) continue;
    if (normalizeComparison(row[1]) === idAlvo) {
      achados.push({ aba: "Albuns", linha: i + 1, topicId: normalizeText(row[1]), titulo: normalizeText(row[6]), codigoUnico: normalizeText(row[11]) });
    }
  }

  const mvRows = await googleSheetsService.principal.readValues("Music Videos", "A:Z").catch(() => []);
  for (let i = 1; i < mvRows.length; i++) {
    const row = mvRows[i];
    if (!row) continue;
    if (normalizeComparison(row[5]) === idAlvo || normalizeComparison(row[1]) === idAlvo) {
      achados.push({ aba: "Music Videos", linha: i + 1, topicId: normalizeText(row[5] || row[1]), titulo: normalizeText(row[1]), codigoUnico: normalizeText(row[20]) });
    }
  }

  return new Response(JSON.stringify({ success: true, idBuscado: idAlvo, totalAchados: achados.length, achados }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
