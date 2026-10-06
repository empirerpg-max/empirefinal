import { googleSheetsService, normalizeText } from "../services/googleSheetsService";
import { upsertMidiaD1, insertComentarioD1 } from "../services/catalogoDbService";

// Fase 1 da migração Google Sheets -> D1: migração em LOTE de tudo que já
// existe hoje (músicas/vídeos/álbuns + seus comentários) pro banco D1
// (espelho em paralelo — Sheets continua sendo a fonte de verdade).
// Idempotente: roda de novo sem duplicar nada (midia usa INSERT ... ON
// CONFLICT DO UPDATE; comentario é limpo e regravado do zero a cada rodada,
// já que não tem um ID estável vindo do Sheets pra fazer upsert por linha).
//
// GET /api/empire-play/admin/migrar-catalogo-d1
function parseDateToIso(dataBR: string | null): string | null {
  if (!dataBR) return null;
  const m = dataBR.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export async function adminMigrarCatalogoD1Controller(): Promise<Response> {
  const resultado = {
    musicas: { lidas: 0, migradas: 0 },
    videos: { lidas: 0, migradas: 0 },
    albuns: { lidas: 0, migradas: 0 },
    comentariosMusicas: { lidas: 0, migradas: 0 },
    comentariosVideos: { lidas: 0, migradas: 0 },
    comentariosAlbuns: { lidas: 0, migradas: 0 },
  };

  // --- Músicas ---
  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:AA").catch(() => []);
  const idsPorTituloMusica = new Map<string, string>(); // título normalizado -> id (pra resolver comentário -> midia_id)
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    resultado.musicas.lidas++;
    const topicId = normalizeText(row[1]); // B
    if (!topicId) continue; // sem ID estável ainda — fica pra próxima rodada depois de comentado/backfillado
    const titulo = normalizeText(row[7]) || "Sem título"; // H
    const dataLancamento = normalizeText(row[0]) || null; // A
    await upsertMidiaD1({
      id: `musica_${topicId}`.startsWith("musica_") ? topicId : topicId, // topicId já vem com prefixo "musica_" quando gerado pelo app; preserva como está
      tipo: "musica",
      titulo,
      artista: normalizeText(row[13]) || "Artista não informado", // N — ACT PRINCIPAL
      capaUrl: normalizeText(row[3]) || null, // D
      audioUrl: normalizeText(row[2]) || null, // C
      letra: normalizeText(row[4]) || null, // E
      dataLancamento,
      dataLancamentoIso: parseDateToIso(dataLancamento),
      codigoUnico: normalizeText(row[25]) || null, // Z
      descricao: null,
      genero: normalizeText(row[19]) || null, // T
      trackOrder: Number(normalizeText(row[20])) || null, // U
      pendente: normalizeText(row[23]).toLowerCase() === "sim",
    });
    idsPorTituloMusica.set(titulo.toLowerCase(), topicId);
    resultado.musicas.migradas++;
  }

  // --- Music Videos ---
  const videosRows = await googleSheetsService.principal.readValues("Music Videos", "A:T").catch(() => []);
  for (let i = 1; i < videosRows.length; i++) {
    const row = videosRows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    resultado.videos.lidas++;
    const topicId = normalizeText(row[5]); // F — message_thread_id
    if (!topicId) continue;
    const titulo = normalizeText(row[1]) || "Sem título"; // B
    const dataEnvio = normalizeText(row[9]) || null; // J
    await upsertMidiaD1({
      id: topicId,
      tipo: "video",
      titulo,
      artista: "", // Music Videos não tem coluna própria de artista — resolvido via "Nome original nos charts" (P) quando necessário
      videoUrl: normalizeText(row[12]) || null, // M
      categoria: normalizeText(row[7]) || null, // H — Tipo de vídeo
      descricao: normalizeText(row[8]) || null, // I
      dataLancamento: dataEnvio,
      dataLancamentoIso: parseDateToIso(dataEnvio),
    });
    resultado.videos.migradas++;
  }

  // --- Álbuns ---
  const albunsRows = await googleSheetsService.principal.readValues("Albuns", "A:L").catch(() => []);
  for (let i = 1; i < albunsRows.length; i++) {
    const row = albunsRows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    resultado.albuns.lidas++;
    const topicId = normalizeText(row[1]); // B
    if (!topicId) continue;
    const nomeAlbum = normalizeText(row[6]) || "Sem título"; // G — Novo Nome
    const dashMatch = nomeAlbum.match(/^(.+?)\s[-–—]\s(.+)$/);
    const dataLancamento = normalizeText(row[0]) || null; // A
    await upsertMidiaD1({
      id: topicId,
      tipo: "album",
      titulo: dashMatch ? dashMatch[2].trim() : nomeAlbum,
      artista: dashMatch ? dashMatch[1].trim() : normalizeText(row[5]) || "Artista não informado", // F — Nome do criador (fallback)
      capaUrl: normalizeText(row[2]) || null, // C
      dataLancamento,
      dataLancamentoIso: parseDateToIso(dataLancamento),
      codigoUnico: normalizeText(row[11]) || null, // L
    });
    resultado.albuns.migradas++;
  }

  // --- Comentários (limpa e regrava do zero a cada rodada — idempotente) ---
  const limparComentarios = async () => {
    const db = (globalThis as Record<string, unknown>).__CATALOGO_DB__ as
      | { prepare: (q: string) => { run: () => Promise<unknown> } }
      | undefined;
    if (!db) return;
    await db.prepare("DELETE FROM comentario").run();
  };
  await limparComentarios();

  const migrarComentarios = async (
    sheet: string,
    colTopicId: number,
    colJogadorId: number,
    colJogador: number,
    colTexto: number,
    contador: { lidas: number; migradas: number },
  ) => {
    const rows = await googleSheetsService.principal.readValues(sheet).catch(() => []);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row.some((c) => normalizeText(c))) continue;
      contador.lidas++;
      const topicId = normalizeText(row[colTopicId]);
      const texto = normalizeText(row[colTexto]);
      if (!topicId || !texto) continue;
      await insertComentarioD1({
        midiaId: topicId,
        jogadorId: normalizeText(row[colJogadorId]) || "desconhecido",
        jogadorNome: normalizeText(row[colJogador]) || "Anônimo",
        texto,
      });
      contador.migradas++;
    }
  };

  await migrarComentarios("Comentarios_Musicas", 0, 1, 2, 3, resultado.comentariosMusicas);
  await migrarComentarios("Comentarios_MV", 0, 1, 2, 3, resultado.comentariosVideos);
  await migrarComentarios("Comentarios_Albuns", 0, 1, 2, 3, resultado.comentariosAlbuns);

  return new Response(JSON.stringify({ success: true, resultado }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
