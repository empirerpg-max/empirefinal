import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Roda pelo cron (ver server.ts "scheduled") a cada execução — preenche a
// "Média Likes" (coluna O de "Music Videos") de qualquer clipe que ainda
// esteja sem nota. Só processa um lote pequeno por execução (a cada 10min)
// pra nunca estourar o tempo do Worker; o resto fica pra próxima rodada —
// então também cobre automaticamente qualquer vídeo novo publicado sem
// nota, não é só uma correção pontual. Como só escreve quando a célula
// ainda está vazia, cada linha só é calculada UMA vez (nunca reprocessa um
// valor já gravado, então não corre o risco de "misturar de novo" a cada
// execução).
//
// Fórmula (nota final 0-100, que o ScoreBadge multiplica por 300 pra virar
// a contagem de likes exibida):
//   nota_final = 0.7 * nota_jogador + 0.3 * nota_views
// - nota_jogador: quantos comentários reais o vídeo recebeu no Fórum
//   (Comentarios_MV, casado pelo ID do tópico == coluna F de Music Videos)
//   — 35 sem nenhum comentário, subindo ~6 pontos por comentário até 98.
// - nota_views: puxada do "YOUTUBE TOTAL DA SEMANA" (aba "EDIÇÃO CHARTS",
//   coluna AC) da MÚSICA original — a mesma regra do jogo de que um clipe
//   sem chart próprio (lyric video, live, dance video etc) sempre pontua
//   pro material original que ele referencia. O vínculo é por título+artista
//   ("Artist - Título" no vídeo bate com ACT PRINCIPAL + Nome da música em
//   "Musicas", que por sua vez tem o mesmo Código único usado em EDIÇÃO
//   CHARTS). Sem casar com nenhuma música, nota_views fica 0 e o peso cai
//   inteiro pro jogador (pedido explícito: "a média do jogador deve valer
//   mais").
const MUSICA_VIDEOS_SHEET = "Music Videos";
const COMENTARIOS_MV_SHEET = "Comentarios_MV";
const MUSICAS_SHEET = "Musicas";
const EDICAO_CHARTS_SHEET = "EDIÇÃO CHARTS";

const COL_THREAD_ID = 5; // Music Videos F = message_thread_id
const COL_MEDIA_LIKES = 14; // Music Videos O = Média Likes
const COL_TITULO_TOPICO = 1; // Music Videos B = Título do tópico ("Artist - Título")

const COL_MUSICAS_NOME = 7; // Musicas H = Nome da música
const COL_MUSICAS_ARTISTA = 13; // Musicas N = ACT PRINCIPAL
const COL_MUSICAS_CODIGO = 25; // Musicas Z = Código único

const COL_EDICAO_YOUTUBE_TOTAL = 28; // EDIÇÃO CHARTS AC = YOUTUBE TOTAL DA SEMANA
const COL_EDICAO_CODIGO = 55; // EDIÇÃO CHARTS BD = Código único

// Maior YOUTUBE TOTAL DA SEMANA observado gira em torno de ~1,1 bilhão —
// calibra o teto da nota_views (100) pra esse patamar, sem precisar de
// tabela de referência externa.
const YOUTUBE_TOTAL_PARA_NOTA_100 = 11_000_000;
const LOTE_MAX = 25;

function calcularNotaPorComentarios(qtdComentarios: number): number {
  if (qtdComentarios <= 0) return 35;
  return Math.min(35 + qtdComentarios * 6, 98);
}

function extrairArtistaTitulo(tituloTopico: string): { artista: string; titulo: string } | null {
  const match = tituloTopico.match(/^(.+?)\s[-–—]\s(.+)$/);
  if (!match) return null;
  return { artista: match[1].trim(), titulo: match[2].trim() };
}

export async function preencherLikesVideosSemMediaScheduled(): Promise<{ atualizados: number }> {
  const [videoRows, commentRows, musicasRows, edicaoRows] = await Promise.all([
    googleSheetsService.principal.readValues(MUSICA_VIDEOS_SHEET),
    googleSheetsService.principal.readValues(COMENTARIOS_MV_SHEET),
    googleSheetsService.principal.readValues(MUSICAS_SHEET),
    googleSheetsService.edicaoCharts.readValues(EDICAO_CHARTS_SHEET, "A2:BD5000"),
  ]);

  const contagemPorTopico = new Map<string, number>();
  for (let i = 1; i < commentRows.length; i++) {
    const topicoId = normalizeText(commentRows[i]?.[0]);
    if (!topicoId) continue;
    contagemPorTopico.set(topicoId, (contagemPorTopico.get(topicoId) || 0) + 1);
  }

  // codigoUnico -> YOUTUBE TOTAL DA SEMANA (número cru, sem separador).
  const youtubeTotalPorCodigo = new Map<string, number>();
  for (const row of edicaoRows) {
    const codigo = normalizeComparison(row?.[COL_EDICAO_CODIGO] || "");
    if (!codigo) continue;
    const raw = String(row?.[COL_EDICAO_YOUTUBE_TOTAL] || "").replace(/[.\s]/g, "").replace(",", ".");
    const valor = Number(raw);
    if (Number.isFinite(valor) && valor > 0) youtubeTotalPorCodigo.set(codigo, valor);
  }

  // (artista|título) normalizado -> Código único, a partir de Musicas.
  const codigoPorMusica = new Map<string, string>();
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    const artista = normalizeComparison(row?.[COL_MUSICAS_ARTISTA] || "");
    const nome = normalizeComparison(row?.[COL_MUSICAS_NOME] || "");
    const codigo = normalizeComparison(row?.[COL_MUSICAS_CODIGO] || "");
    if (!artista || !nome || !codigo) continue;
    codigoPorMusica.set(`${artista}|${nome}`, codigo);
  }

  function calcularNotaViews(tituloTopico: string): number {
    const parsed = extrairArtistaTitulo(tituloTopico);
    if (!parsed) return 0;
    const chave = `${normalizeComparison(parsed.artista)}|${normalizeComparison(parsed.titulo)}`;
    const codigo = codigoPorMusica.get(chave);
    if (!codigo) return 0;
    const total = youtubeTotalPorCodigo.get(codigo);
    if (!total) return 0;
    return Math.min(Math.round(total / YOUTUBE_TOTAL_PARA_NOTA_100), 100);
  }

  let atualizados = 0;
  for (let i = 1; i < videoRows.length && atualizados < LOTE_MAX; i++) {
    const row = videoRows[i];
    if (!row || !row.some((cell) => normalizeText(cell))) continue;

    const mediaAtual = normalizeText(row[COL_MEDIA_LIKES]);
    if (mediaAtual && Number(mediaAtual) > 0) continue;

    const topicoId = normalizeText(row[COL_THREAD_ID]);
    const qtdComentarios = topicoId ? contagemPorTopico.get(topicoId) || 0 : 0;
    const notaJogador = calcularNotaPorComentarios(qtdComentarios);

    const tituloTopico = normalizeText(row[COL_TITULO_TOPICO]);
    const notaViews = tituloTopico ? calcularNotaViews(tituloTopico) : 0;

    const notaFinal =
      notaViews > 0 ? Math.round(0.7 * notaJogador + 0.3 * notaViews) : notaJogador;

    await googleSheetsService.principal.updateValues(MUSICA_VIDEOS_SHEET, `O${i + 1}`, [[String(notaFinal)]]);
    atualizados++;
  }

  return { atualizados };
}
