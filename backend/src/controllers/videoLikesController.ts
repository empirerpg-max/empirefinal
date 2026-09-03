import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Roda pelo cron (ver server.ts "scheduled") a cada execução — é uma
// CORREÇÃO PONTUAL, não um recálculo perpétuo: só preenche a "Média Likes"
// (coluna O de "Music Videos") de quem ainda está vazio (o backlog de
// clipes que nunca recebeu média). A partir do momento que uma linha ganha
// um valor — seja por essa correção, seja por um like real que o jogador
// mandar junto do comentário dele — ela nunca mais é tocada por aqui. A
// única regra que continua valendo pra sempre é a combinação de pesos
// (comentário do jogador 70% / views do material principal 30%); ela só
// não é reaplicada automaticamente depois que a nota já existe. Só
// processa um lote pequeno por execução (a cada 10min) pra nunca estourar
// o tempo do Worker — o resto do backlog fica pras próximas rodadas.
//
// Fórmula (nota final 0-100, que o ScoreBadge multiplica por 300 pra virar
// a contagem de likes exibida):
//   nota_final = 0.7 * nota_jogador + 0.3 * nota_views
// - nota_jogador: lê o TEXTO de cada comentário real do vídeo no Fórum
//   (Comentarios_MV, casado pelo ID do tópico == coluna F de Music Videos),
//   não só conta quantos tem. Cada comentário pontua pela intensidade dele
//   (superlativos tipo "amei"/"perfeito"/"lendário"/"chocado", ênfase em
//   CAIXA ALTA, "!!!") — um elogio morno soma pouco, um "melhor clipe do
//   ano" empolgado soma bem mais. A soma de todos os comentários do vídeo
//   vira a nota 0-100 (35 sem nenhum comentário ainda).
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
const COL_COMENTARIOS_MV_TOPICO = 0; // Comentarios_MV A = ID do tópico
const COL_COMENTARIOS_MV_TEXTO = 3; // Comentarios_MV D = Comentário

// Termos que indicam um elogio mais entusiasmado (case-insensitive, sem
// acento) — coletados a partir da leitura real dos comentários do fórum de
// vídeos, que são quase todos positivos; a diferença real está na
// intensidade, não em elogio-vs-crítica.
const SUPERLATIVOS = [
  "amei",
  "perfeit",
  "incriv",
  "chocad",
  "lendari",
  "melhor",
  "obra de arte",
  "hit",
  "smash",
  "arrasou",
  "arrasa",
  "maravilhos",
  "impecav",
  "sensacional",
  "genial",
  "icônic",
  "iconic",
  "gritei",
  "morri",
  "morta",
];

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Pontua um único comentário pela intensidade percebida do texto — usado
// como proxy automático da leitura humana (feita manualmente uma vez pra
// calibrar essa lista de termos), já que um comentário novo chega sem
// ninguém aqui pra ler na hora.
function pontuarComentario(texto: string): number {
  if (!texto.trim()) return 0;
  const t = semAcento(texto.toLowerCase());
  let pontos = 3; // base: um comentário existe, é positivo (padrão da comunidade)
  for (const termo of SUPERLATIVOS) {
    if (t.includes(termo)) pontos += 1.3;
  }
  const exclamacoes = (texto.match(/!/g) || []).length;
  pontos += Math.min(exclamacoes * 0.3, 3);
  if (/[A-ZÀ-Ú]{4,}/.test(texto)) pontos += 1; // trecho em CAIXA ALTA = ênfase
  return pontos;
}

function calcularNotaPorComentarios(textosComentarios: string[]): number {
  if (textosComentarios.length === 0) return 35;
  const soma = textosComentarios.reduce((acc, texto) => acc + pontuarComentario(texto), 0);
  return Math.min(Math.round(35 + soma * 1.8), 98);
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

  const comentariosPorTopico = new Map<string, string[]>();
  for (let i = 1; i < commentRows.length; i++) {
    const topicoId = normalizeText(commentRows[i]?.[COL_COMENTARIOS_MV_TOPICO]);
    if (!topicoId) continue;
    const texto = normalizeText(commentRows[i]?.[COL_COMENTARIOS_MV_TEXTO]);
    const lista = comentariosPorTopico.get(topicoId) || [];
    lista.push(texto);
    comentariosPorTopico.set(topicoId, lista);
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

    const mediaAtual = normalizeText(row[COL_MEDIA_LIKES]);
    if (mediaAtual && Number(mediaAtual) > 0) continue;

    const topicoId = normalizeText(row[COL_THREAD_ID]);
    const textosComentarios = topicoId ? comentariosPorTopico.get(topicoId) || [] : [];
    const notaJogador = calcularNotaPorComentarios(textosComentarios);

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
