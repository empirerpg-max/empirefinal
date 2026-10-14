import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico read-only: pra cada topicId da lista fixa abaixo (os 12
// órfãos encontrados na migração de Comentarios_Musicas -> D1, 2026-10-14),
// procura em QUALQUER lugar que esse id possa estar — "ID do tópico" de
// Musicas, "Comentários para" de Musicas, "ID do tópico" de Albuns — pra
// achar a música/álbum de verdade dona do comentário antes de decidir como
// corrigir. Nunca assume: só reporta o que encontra.
const TOPIC_IDS = [
  "76",
  "2131",
  "2134",
  "musica_1786392477347_acjnry",
  "musicas_191",
  "musicas_197",
  "musica_1790776873735_5bxka4",
];

export async function adminDiagOrfaosComentariosController(): Promise<Response> {
  const [musicasRows, albunsRows] = await Promise.all([
    googleSheetsService.principal.readValues("Musicas", "A:AE").catch(() => []),
    googleSheetsService.principal.readValues("Albuns", "A:L").catch(() => []),
  ]);

  const resultado: Record<string, unknown> = {};

  for (const topicId of TOPIC_IDS) {
    const norm = normalizeComparison(topicId);
    const achados: Record<string, unknown>[] = [];

    // Musicas: coluna B (índice 1) = ID do tópico; coluna F (índice 5) = Comentários para
    for (let i = 1; i < musicasRows.length; i++) {
      const row = musicasRows[i];
      if (!row) continue;
      const idTopico = normalizeText(row[1]);
      const comentariosPara = normalizeText(row[5]);
      if (normalizeComparison(idTopico) === norm) {
        achados.push({
          onde: "Musicas — ID do tópico (B)",
          linha: i + 1,
          titulo: normalizeText(row[7]),
          artista: normalizeText(row[13]),
          idDoTopico: idTopico,
          comentariosPara,
        });
      }
      if (comentariosPara && normalizeComparison(comentariosPara) === norm) {
        achados.push({
          onde: "Musicas — Comentários para (F) aponta pra esse id",
          linha: i + 1,
          titulo: normalizeText(row[7]),
          artista: normalizeText(row[13]),
          idDoTopicoDestaLinha: idTopico,
        });
      }
    }

    // Albuns: coluna B (índice 1) = ID do tópico
    for (let i = 1; i < albunsRows.length; i++) {
      const row = albunsRows[i];
      if (!row) continue;
      const idTopico = normalizeText(row[1]);
      if (normalizeComparison(idTopico) === norm) {
        achados.push({
          onde: "Albuns — ID do tópico (B)",
          linha: i + 1,
          nomeAlbum: normalizeText(row[6]),
          idDoTopico: idTopico,
        });
      }
    }

    resultado[topicId] = achados.length > 0 ? achados : "NÃO ENCONTRADO em nenhum lugar (Musicas ID/Comentários-para, Albuns ID)";
  }

  return new Response(JSON.stringify({ success: true, resultado }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
