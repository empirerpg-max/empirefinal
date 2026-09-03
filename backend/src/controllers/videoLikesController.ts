import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Roda pelo cron (ver server.ts "scheduled") a cada execução — recalcula a
// "Média Likes" (coluna O de "Music Videos") de TODOS os vídeos com essa
// fórmula, não só os que estão sem nota (inclusive o único que já tinha um
// valor manual antes). Como a fórmula é determinística (mesmos comentários
// + mesmas views = mesmo resultado), recalcular todo mundo de novo a cada
// execução é seguro — e é o que mantém a nota viva conforme comentários
// novos chegam ou o YOUTUBE TOTAL DA SEMANA muda. Só processa um lote
// pequeno por execução (a cada 10min) pra nunca estourar o tempo do
// Worker; o resto (e qualquer vídeo novo) fica pras próximas rodadas.
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

interface FlagsKvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

const CURSOR_KV_KEY = "video-likes-cursor";

export async function preencherLikesVideosSemMediaScheduled(
  flags?: FlagsKvLike,
): Promise<{ atualizados: number }> {
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

  // Cursor persistido em KV — cada execução continua de onde a anterior
  // parou, girando por toda a planilha ao longo do tempo em vez de sempre
  // reprocessar só as primeiras linhas (que nunca deixaria as últimas
  // serem alcançadas).
  const cursorSalvo = flags ? Number(await flags.get(CURSOR_KV_KEY).catch(() => null)) : NaN;
  const inicio = Number.isFinite(cursorSalvo) && cursorSalvo >= 1 && cursorSalvo < videoRows.length ? cursorSalvo : 1;

  let atualizados = 0;
  let i = inicio;
  let voltas = 0;
  while (atualizados < LOTE_MAX && voltas < 2) {
    if (i >= videoRows.length) {
      i = 1;
      voltas++;
      continue;
    }
    const row = videoRows[i];
    const linhaPlanilha = i + 1; // videoRows[0] é o cabeçalho (linha 1)
    i++;
    if (!row || !row.some((cell) => normalizeText(cell))) continue;

    const topicoId = normalizeText(row[COL_THREAD_ID]);
    const qtdComentarios = topicoId ? contagemPorTopico.get(topicoId) || 0 : 0;
    const notaJogador = calcularNotaPorComentarios(qtdComentarios);

    const tituloTopico = normalizeText(row[COL_TITULO_TOPICO]);
    const notaViews = tituloTopico ? calcularNotaViews(tituloTopico) : 0;

    const notaFinal =
      notaViews > 0 ? Math.round(0.7 * notaJogador + 0.3 * notaViews) : notaJogador;

    await googleSheetsService.principal.updateValues(MUSICA_VIDEOS_SHEET, `O${linhaPlanilha}`, [
      [String(notaFinal)],
    ]);
    atualizados++;
  }

  if (flags) await flags.put(CURSOR_KV_KEY, String(i)).catch(() => {});

  return { atualizados };
}
