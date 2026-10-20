import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico read-only: varre TODOS os comentários de HOJE em
// Comentarios_Musicas e Comentarios_MV e verifica se o topicId gravado
// bate com um tópico real (Musicas!B/F pra música, Music Videos!F pra
// vídeo) — sinaliza qualquer um que não bate (órfão), pra nenhum
// comentário de hoje ficar invisível sem a gente saber exatamente quais.
//
// GET /api/empire-play/admin/diagnostico-orfaos-hoje?data=20/10/2026
export async function adminDiagOrfaosHojeController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dataAlvo = url.searchParams.get("data") || new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

  // Conjunto de topicIds REAIS válidos pra música (Musicas!B e !F) e pra
  // vídeo (Music Videos!F) — um comentário é órfão se seu topicId não
  // estiver em nenhum desses conjuntos.
  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:H").catch(() => []);
  const topicIdsMusica = new Set<string>();
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row) continue;
    const id1 = normalizeText(row[1]);
    const id2 = normalizeText(row[5]);
    if (id1) topicIdsMusica.add(normalizeComparison(id1));
    if (id2) topicIdsMusica.add(normalizeComparison(id2));
  }

  const videosRows = await googleSheetsService.principal.readValues("Music Videos", "A:F").catch(() => []);
  const topicIdsVideo = new Set<string>();
  for (let i = 1; i < videosRows.length; i++) {
    const row = videosRows[i];
    if (!row) continue;
    const id = normalizeText(row[5]);
    if (id) topicIdsVideo.add(normalizeComparison(id));
  }

  const orfaosMusica: Record<string, unknown>[] = [];
  const comentariosMusicasRows = await googleSheetsService.principal.readValues("Comentarios_Musicas").catch(() => []);
  for (let i = 1; i < comentariosMusicasRows.length; i++) {
    const row = comentariosMusicasRows[i];
    if (!row) continue;
    const dataHora = normalizeText(row[5]);
    if (!dataHora.startsWith(dataAlvo)) continue;
    const topicId = normalizeText(row[0]);
    if (topicId && topicIdsMusica.has(normalizeComparison(topicId))) continue;
    orfaosMusica.push({
      linha: i + 1,
      topicId,
      jogador: row[2] || "",
      comentario: normalizeText(row[3]).slice(0, 100),
      dataHora,
    });
  }

  const orfaosVideo: Record<string, unknown>[] = [];
  const comentariosVideoRows = await googleSheetsService.principal.readValues("Comentarios_MV").catch(() => []);
  for (let i = 1; i < comentariosVideoRows.length; i++) {
    const row = comentariosVideoRows[i];
    if (!row) continue;
    const dataHora = normalizeText(row[4]);
    if (!dataHora.startsWith(dataAlvo)) continue;
    const topicId = normalizeText(row[0]);
    if (topicId && topicIdsVideo.has(normalizeComparison(topicId))) continue;
    orfaosVideo.push({
      linha: i + 1,
      topicId,
      jogador: row[2] || "",
      comentario: normalizeText(row[3]).slice(0, 100),
      dataHora,
    });
  }

  return new Response(
    JSON.stringify(
      {
        success: true,
        data: dataAlvo,
        totalOrfaosMusica: orfaosMusica.length,
        orfaosMusica,
        totalOrfaosVideo: orfaosVideo.length,
        orfaosVideo,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
