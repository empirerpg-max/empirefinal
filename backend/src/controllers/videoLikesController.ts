import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Roda pelo cron (ver server.ts "scheduled") a cada execução — preenche a
// "Média Likes" (coluna O de "Music Videos") de qualquer clipe que ainda
// esteja sem nota. Fórmula: conta quantos comentários reais o vídeo recebeu
// no Fórum (Comentarios_MV, casado pelo ID do tópico == coluna F/
// message_thread_id de Music Videos) e converte isso numa nota 0-100
// (35 sem nenhum comentário ainda, subindo ~6 pontos por comentário até um
// teto de 98) — depois o ScoreBadge já multiplica essa nota por 300 pra
// virar a contagem de likes exibida. Só processa um lote pequeno por
// execução (a cada 10min) pra nunca estourar o tempo do Worker; o resto
// fica pra próxima rodada, então também cobre automaticamente qualquer
// vídeo novo publicado sem nota — não é só uma correção pontual.
const MUSICA_VIDEOS_SHEET = "Music Videos";
const COMENTARIOS_MV_SHEET = "Comentarios_MV";
const COL_THREAD_ID = 5; // F = message_thread_id
const COL_MEDIA_LIKES = 14; // O = Média Likes
const LOTE_MAX = 25;

function calcularNotaPorComentarios(qtdComentarios: number): number {
  if (qtdComentarios <= 0) return 35;
  return Math.min(35 + qtdComentarios * 6, 98);
}

export async function preencherLikesVideosSemMediaScheduled(): Promise<{ atualizados: number }> {
  const [videoRows, commentRows] = await Promise.all([
    googleSheetsService.principal.readValues(MUSICA_VIDEOS_SHEET),
    googleSheetsService.principal.readValues(COMENTARIOS_MV_SHEET),
  ]);

  const contagemPorTopico = new Map<string, number>();
  for (let i = 1; i < commentRows.length; i++) {
    const topicoId = normalizeText(commentRows[i]?.[0]);
    if (!topicoId) continue;
    contagemPorTopico.set(topicoId, (contagemPorTopico.get(topicoId) || 0) + 1);
  }

  let atualizados = 0;
  for (let i = 1; i < videoRows.length && atualizados < LOTE_MAX; i++) {
    const row = videoRows[i];
    if (!row || !row.some((cell) => normalizeText(cell))) continue;

    const mediaAtual = normalizeText(row[COL_MEDIA_LIKES]);
    if (mediaAtual && Number(mediaAtual) > 0) continue;

    const topicoId = normalizeText(row[COL_THREAD_ID]);
    const qtdComentarios = topicoId ? contagemPorTopico.get(topicoId) || 0 : 0;
    const nota = calcularNotaPorComentarios(qtdComentarios);

    await googleSheetsService.principal.updateValues(MUSICA_VIDEOS_SHEET, `O${i + 1}`, [[String(nota)]]);
    atualizados++;
  }

  return { atualizados };
}
