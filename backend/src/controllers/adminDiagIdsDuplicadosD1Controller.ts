import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Diagnóstico SÓ LEITURA (não grava nada no D1 — não gasta cota de
// rows_written): varre Musicas/Music Videos/Albuns e aponta "ID do tópico"
// que se repete entre linhas, mesmo de abas diferentes (midia.id é PRIMARY
// KEY só pela coluna id, sem tipo — um ID numérico legado de música pode
// colidir com o mesmo número usado por um vídeo/álbum).
//
// GET /api/empire-play/admin/diagnostico-ids-duplicados-d1
export async function adminDiagIdsDuplicadosD1Controller(): Promise<Response> {
  const ocorrencias = new Map<string, { tipo: string; titulo: string; linha: number }[]>();

  const registrar = (id: string, tipo: string, titulo: string, linha: number) => {
    const lista = ocorrencias.get(id) ?? [];
    lista.push({ tipo, titulo, linha });
    ocorrencias.set(id, lista);
  };

  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:AA").catch(() => []);
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    const topicId = normalizeText(row[1]); // B
    if (!topicId) continue;
    registrar(topicId, "musica", normalizeText(row[7]) || "Sem título", i + 1);
  }

  const videosRows = await googleSheetsService.principal.readValues("Music Videos", "A:T").catch(() => []);
  for (let i = 1; i < videosRows.length; i++) {
    const row = videosRows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    const topicId = normalizeText(row[5]); // F
    if (!topicId) continue;
    registrar(topicId, "video", normalizeText(row[1]) || "Sem título", i + 1);
  }

  const albunsRows = await googleSheetsService.principal.readValues("Albuns", "A:L").catch(() => []);
  for (let i = 1; i < albunsRows.length; i++) {
    const row = albunsRows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    const topicId = normalizeText(row[1]); // B
    if (!topicId) continue;
    registrar(topicId, "album", normalizeText(row[6]) || "Sem título", i + 1);
  }

  const duplicados = Array.from(ocorrencias.entries())
    .filter(([, lista]) => lista.length > 1)
    .map(([id, lista]) => ({ id, ocorrencias: lista }));

  return new Response(
    JSON.stringify({ success: true, totalDuplicados: duplicados.length, duplicados }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
