import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";
import { DRIVE_FOLDERS, uploadFileToDrive } from "../services/googleDriveService";
import { somarPrestigio } from "../services/prestigioService";
import { registrarLogSistema } from "../services/logSistemaService";
import { getOwnerIdForArtist } from "./artistasController";

// Gera o próximo "Código único" (padrão EMPALBM001 pra álbum, EMP001 pra
// música) — acha a coluna "Código único" pelo cabeçalho (não por letra
// fixa, porque cada aba tem ela numa posição diferente), pega o maior
// número já usado com esse prefixo e devolve o próximo, com o mesmo
// zero-padding. Nunca reaproveita número: mesmo que uma linha seja
// apagada, o próximo código continua a partir do maior já visto.
async function gerarProximoCodigoUnico(
  sheetName: string,
  prefixo: string,
  digitos: number,
): Promise<string> {
  const rows = await googleSheetsService.edicaoCharts.readValues(sheetName, "A1:BZ5000").catch(() => []);
  if (!rows || rows.length < 1) return `${prefixo}${"1".padStart(digitos, "0")}`;
  const headers = rows[0].map((h) => normalizeComparison(h));
  const col = headers.findIndex((h) => h.startsWith("codigo unico"));
  let maior = 0;
  if (col >= 0) {
    const re = new RegExp(`^${prefixo}(\\d+)$`, "i");
    for (let i = 1; i < rows.length; i++) {
      const val = (rows[i][col] || "").trim();
      const m = val.match(re);
      if (m) maior = Math.max(maior, parseInt(m[1], 10));
    }
  }
  return `${prefixo}${String(maior + 1).padStart(digitos, "0")}`;
}

// Registra a música lançada em "EDIÇÃO CHARTS" (edicaoCharts) — a aba real
// de cálculo semanal dos charts, confirmada com o usuário. Só escreve A-Q;
// nunca toca na coluna G ("não mexer") nem em nada depois de Q — a coluna
// "Código único" (lá longe, na BD) tem uma ARRAYFORMULA própria na planilha
// que já preenche sozinha ("=ARRAYFORMULA(IF(B2:B=\"\";\"\";\"EMP\"&TEXT(ROW(B2:B)-1;\"000\")))")
// assim que a coluna B (título) é preenchida — escrever nela por cima
// quebraria a fórmula.
export async function registrarNaEdicaoCharts(params: {
  dataFormatada: string;
  fullTitle: string; // "Artista - Título"
  tipoSingle: string;
  tipoMusica: string;
  album?: string;
  artistaPrincipal: string;
  participantes?: string[]; // até 5 (ARTISTA 2-6)
  albunsExtras?: string[]; // até 4 (ALBUM 2-5) — música em mais de um álbum
}): Promise<number | null> {
  const participantesLimpos = (params.participantes || []).filter(Boolean).slice(0, 5);
  const albunsExtrasLimpos = (params.albunsExtras || []).filter(Boolean).slice(0, 4);
  try {
    // NÃO usa appendRow/:append aqui — mesmo com faixa explícita (A:Q),
    // confirmado ao vivo que o Sheets continua achando a "próxima linha
    // livre" olhando a linha mais alta ocupada em QUALQUER coluna da
    // planilha inteira, não só nas colunas pedidas. Como as colunas de
    // cálculo semanal (streams/vendas, bem à direita) têm fórmula
    // preenchida em milhares de linhas, isso sempre jogava a música pra
    // longe da faixa de dados real (ex: linha 3254 quando a última música
    // de verdade estava na 655) — fora do alcance de qualquer
    // fórmula/cálculo de chart limitado a um intervalo de linhas comum.
    // Em vez disso, acha a última linha com título de verdade na coluna B
    // e escreve direto na linha seguinte via updateValues — mesmo padrão
    // já usado (e confirmado funcionando) pra corrigir REGISTRO.
    const rows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A2:B20000");
    let ultimaLinhaComTitulo = 1; // linha 1 = cabeçalho
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i]?.[1] || "").trim()) ultimaLinhaComTitulo = i + 2;
    }
    const linhaAlvo = ultimaLinhaComTitulo + 1;

    await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS", `A${linhaAlvo}:Q${linhaAlvo}`, [
      [
        params.dataFormatada, // A - Data de lançamento
        params.fullTitle, // B - Nome (Artista - Título)
        params.tipoSingle || "", // C - TIPO DE SINGLE
        params.tipoMusica || "", // D - TIPO DE MÚSICA
        params.album || "", // E - ALBUM
        "1", // F - WEEKS
        "", // G - não mexer
        params.artistaPrincipal, // H - ACT PRINCIPAL
        participantesLimpos[0] || "", // I - ARTISTA 2
        participantesLimpos[1] || "", // J - ARTISTA 3
        participantesLimpos[2] || "", // K - ARTISTA 4
        participantesLimpos[3] || "", // L - ARTISTA 5
        participantesLimpos[4] || "", // M - ARTISTA 6
        albunsExtrasLimpos[0] || "", // N - ALBUM 2
        albunsExtrasLimpos[1] || "", // O - ALBUM 3
        albunsExtrasLimpos[2] || "", // P - ALBUM 4
        albunsExtrasLimpos[3] || "", // Q - ALBUM 5
      ],
    ]);
    return linhaAlvo;
  } catch (err) {
    console.warn("[registrarNaEdicaoCharts] Erro ao gravar em EDIÇÃO CHARTS:", err);
    return null;
  }
}

// Lê de volta o "Código único" gerado por ARRAYFORMULA (EDIÇÃO CHARTS,
// coluna BD) logo após o appendRow que disparou a fórmula — o Sheets
// normalmente já recalcula na mesma escrita, mas por segurança tenta de
// novo uma vez com um pequeno atraso antes de desistir (nunca bloqueia o
// fluxo principal: se não achar, quem chama só deixa o código em branco).
async function lerCodigoUnicoGerado(rowIndex: number): Promise<string> {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const rows = await googleSheetsService.edicaoCharts.readValues(
        "EDIÇÃO CHARTS",
        `BD${rowIndex}:BD${rowIndex}`,
      );
      const codigo = (rows?.[0]?.[0] || "").trim();
      if (codigo) return codigo;
    } catch (err) {
      console.warn("[lerCodigoUnicoGerado] Erro ao ler código único:", err);
    }
    if (tentativa === 1) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return "";
}

const INFOS_MUSICAS_SHEET = "INFOS MÚSICAS";

// INFOS MÚSICAS (planilha registrosCharts) é a aba de onde os CHARTS puxam
// a capa de cada música (via fórmula própria da planilha) — totalmente
// desconectada de "Musicas!D" (nosso catálogo) até agora. Cria a linha já
// na criação da música, pra ela nascer pronta pro chart puxar uma capa:
// D "IMAGEM" (capa oficial) e G "Link da Capa" (efetiva) começam iguais à
// capa escolhida pelo artista — o ADM pode sobrescrever D à mão quando
// quiser. F ("nova capa solicitada") fica em branco, reservada pro fluxo
// de troca de capa (ver propagarCapaParaInfosMusicas em editController.ts).
async function registrarInfosMusicas(params: {
  fullTitle: string; // "Artista - Título"
  capaUrl: string;
  genero?: string;
}): Promise<void> {
  if (!params.capaUrl) return;
  try {
    await googleSheetsService.registrosCharts.appendRow(INFOS_MUSICAS_SHEET, [
      params.fullTitle, // A - MÚSICA
      "", // B
      "SIM", // C - CAPA TEM LINK PUBLICADO PELA ADM?
      params.capaUrl, // D - IMAGEM
      "", // E
      "", // F - Caso deseje uma nova capa...
      params.capaUrl, // G - Link da Capa
      params.genero || "", // H - GÊNERO DA MÚSICA
      "", // I
      "", // J
      "", // K - Código único (não mexer — formula/curadoria própria)
    ]);
  } catch (err) {
    console.warn("[registrarInfosMusicas] Erro ao gravar em INFOS MÚSICAS:", err);
  }
}

export interface CreateSongPayload {
  opcaoChart: string; // "a) Registrar essa música em chart" | "b) Substituir música no chart" | "c) Os comentários desse tópico devem valer para uma música já lançada"
  tituloMusica: string;
  nomeMusica: string;
  artistaPrincipal: string;
  participantes?: string[]; // Artistas 2 a 6
  tipoSingle: string;
  tipoMusica: string;
  capaUrl: string;
  mediaUrl?: string;
  letra?: string;
  nomeJogador: string;
  jogadorId?: string;
  pendente?: string; // "Sim" | "Não"
  // "Artista - Título" da música existente referenciada, obrigatório quando
  // opcaoChart é (b) substituir ou (c) vincular comentários.
  musicaReferencia?: string;
}

export interface CreateVideoPayload {
  tituloVideo: string;
  artistaResponsavel: string;
  // Tag do vídeo (coluna "Tipo de vídeo" da aba Music Videos) — Live, Video,
  // Dance Video, Behind the Scenes, Lyric Video, Visualizer, Performance,
  // Trailer etc. "categoriaVideo" é o nome antigo do mesmo campo, mantido
  // por compatibilidade com o formulário existente.
  tipoVideo?: string;
  categoriaVideo?: string;
  participantes?: string[];
  capaUrl: string;
  mediaUrl?: string;
  // Música(s) vinculada(s) — sempre obrigatório pelo menos uma, pra nunca
  // mais cair no caso WISDOM/CURSED BLESSED (vídeo cadastrado sem vínculo
  // nenhum com a música, código único e caixinha de PONTOS ficando soltos).
  // "Music Video" só aceita 1 (é o clipe oficial de uma música só); outros
  // tipos (Live, Behind the Scenes etc) aceitam até 3, já que podem cobrir
  // mais de uma faixa. Mantém `musicaVinculada` (string única) por
  // compatibilidade com chamadores antigos — o controller aceita qualquer
  // um dos dois.
  musicaVinculada?: string;
  musicasVinculadas?: string[];
  nomeJogador: string;
}

export interface TrackItemPayload {
  num: number;
  inedita: boolean;
  // Faixa existente: "Artista - Título" selecionado na busca da aba Pontos
  // (charts). Faixa inédita: título digitado pelo jogador.
  titulo: string;
  tipoSingle?: string;
  tipoMusica?: string;
  participantes?: string[]; // Artistas 2 a 6 — só se aplica a faixas inéditas
  mediaUrl?: string; // link do Drive/YouTube — só se aplica a faixas inéditas
  letra?: string; // só se aplica a faixas inéditas
  // Só pra faixas inéditas: se true, a faixa vira tópico próprio no fórum
  // (Pendente? = "Não"); se false, fica invisível até o jogador decidir
  // abrir (Pendente? = "Sim").
  abrirTopico?: boolean;
}

export interface CreateAlbumPayload {
  tituloAlbum: string;
  artistaAlbum: string;
  tipoAlbum?: string; // "EP" | "Álbum" | "Deluxe"
  capaUrl: string;
  encartesUrls?: string[];
  nomeJogador: string;
  jogadorId?: string;
  faixas: TrackItemPayload[];
}

export type UploadFolderType =
  | "musica"
  | "musicaAudio"
  | "album"
  | "video"
  | "musicVideo"
  | "socialPosts"
  | "socialStories"
  | "socialAvatars"
  | "socialNews"
  | "playerAvatars"
  | "artistPhotos"
  | "playlistTracks"
  | "tvChatGifs"
  | "turnes"
  | "acervo"
  | "materiaisMusica"
  | "materiaisAlbum";

export interface UploadPayload {
  fileName: string;
  mimeType: string;
  base64Data: string;
  folderType: UploadFolderType;
}

// Controller para Criar / Registrar Música
export async function createSongController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as CreateSongPayload;

    const {
      opcaoChart,
      tituloMusica,
      nomeMusica,
      artistaPrincipal,
      participantes = [],
      tipoSingle,
      tipoMusica,
      capaUrl,
      mediaUrl = "",
      letra = "",
      nomeJogador,
      jogadorId = "",
      pendente = "Não",
      musicaReferencia = "",
    } = body;

    if (!tituloMusica || !artistaPrincipal || !nomeJogador) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Campos obrigatórios ausentes: tituloMusica, artistaPrincipal, nomeJogador.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const nowStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const dataFormatada = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const participantesLimpos = participantes.filter(Boolean);
    // Rede de segurança contra "Artista - Artista - Nome": se o título
    // recebido já vier com o prefixo do artista duplicado (cliente antigo,
    // ou o jogador digitou o artista de novo no campo de nome), remove a
    // repetição em vez de empilhar o prefixo de novo.
    const artistPrefix = `${artistaPrincipal} - `;
    const tituloSemPrefixoDuplicado = tituloMusica.toLowerCase().startsWith(artistPrefix.toLowerCase())
      ? tituloMusica.slice(artistPrefix.length).trim()
      : tituloMusica;
    const fullTitle = tituloSemPrefixoDuplicado.includes(" - ")
      ? tituloSemPrefixoDuplicado
      : `${artistaPrincipal} - ${nomeMusica || tituloSemPrefixoDuplicado}`;

    // ID único do tópico gerado para essa música — usado tanto como chave do
    // registro em Musicas (Coluna B) quanto como "Comentários para" (Coluna F).
    const topicId = `musica_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 1. Gravar em Musicas na planilha principal — mapeamento exato do
    // cabeçalho oficial (Data, ID do tópico, ID do arquivo, Capa, Letra,
    // Comentários para, ID do Criador, Nome, TIPO DE SINGLE, TIPO DE MÚSICA,
    // ALBUM, WEEKS, WEEKS VIDEO, ACT PRINCIPAL, ARTISTA 2-6, GÊNERO, Ordem,
    // Metacritic por jogador, Média Metacritic, Pendente?, Referência
    // (Substituição/Vínculo) — só preenchida quando opcaoChart é (b) ou (c)).
    let musicaRowIndexNova: number | null = null;
    try {
      musicaRowIndexNova = await googleSheetsService.principal.appendRow("Musicas", [
        dataFormatada, // A - Data de lançamento
        topicId, // B - ID do tópico
        mediaUrl || "", // C - ID do arquivo (link do Drive ou YouTube)
        capaUrl || "", // D - Capa da música
        letra || "", // E - Letra
        topicId, // F - Comentários para (referente ao tópico)
        jogadorId || "", // G - ID do Criador
        fullTitle, // H - Nome da música
        tipoSingle || "LEAD SINGLE", // I - TIPO DE SINGLE
        tipoMusica || "SOLO", // J - TIPO DE MÚSICA
        "", // K - ALBUM
        "", // L - WEEKS
        "", // M - WEEKS VIDEO
        artistaPrincipal, // N - ACT PRINCIPAL
        participantesLimpos[0] || "", // O - ARTISTA 2
        participantesLimpos[1] || "", // P - ARTISTA 3
        participantesLimpos[2] || "", // Q - ARTISTA 4
        participantesLimpos[3] || "", // R - ARTISTA 5
        participantesLimpos[4] || "", // S - ARTISTA 6
        "", // T - GÊNERO
        "", // U - Ordem
        "", // V - Metacritic por jogador
        "", // W - Média Metacritic
        pendente, // X - Pendente?
        musicaReferencia || "", // Y - Referência (Substituição/Vínculo)
      ]);
    } catch (err) {
      console.warn("[createSongController] Erro ao gravar em Musicas (Principal):", err);
    }

    // Opção (c): essa música NÃO é um lançamento próprio nos charts — os
    // comentários dela devem contar pra uma música já lançada. Nesse caso
    // não registra em EDIÇÃO CHARTS/INFOS MÚSICAS (senão contaria em
    // dobro); em vez disso, busca o Código único da música referenciada e
    // copia direto pra Musicas!Z — mesmo padrão já usado por vídeos
    // vinculados (ver createVideoController). É esse código, resolvido de
    // volta pro título em forumController.ts, que faz um comentário nessa
    // música cair no REGISTRO com o nome exato da música referenciada.
    const optionIsC = (opcaoChart || "").trim().startsWith("c)");
    let codigoUnicoGerado = "";
    if (optionIsC && musicaReferencia) {
      try {
        const rows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS");
        const alvo = normalizeComparison(musicaReferencia);
        const linhaReferencia = rows.slice(1).find((r) => normalizeComparison(r[1]) === alvo);
        codigoUnicoGerado = linhaReferencia ? (linhaReferencia[55] || "").trim() : "";
      } catch (err) {
        console.warn("[createSongController] Erro ao buscar Código único da música referenciada:", err);
      }
    } else {
      // 1.5 Registrar em "EDIÇÃO CHARTS" (edicaoCharts) — aba real de cálculo
      // semanal dos charts. Antes disso nenhuma música lançada pelo app
      // entrava nessa aba, então nunca ganhava o "Código único" (EMP00X, que
      // é gerado sozinho por uma ARRAYFORMULA na coluna BD assim que a
      // coluna B é preenchida).
      const edicaoChartsRowIndex = await registrarNaEdicaoCharts({
        dataFormatada,
        fullTitle,
        tipoSingle: tipoSingle || "LEAD SINGLE",
        tipoMusica: tipoMusica || "SOLO",
        artistaPrincipal,
        participantes: participantesLimpos,
      });
      if (musicaRowIndexNova && edicaoChartsRowIndex) {
        codigoUnicoGerado = await lerCodigoUnicoGerado(edicaoChartsRowIndex);
      }
      if (pendente !== "Sim") {
        await registrarInfosMusicas({ fullTitle, capaUrl });
      }
    }
    // Leva o Código único de volta pro catálogo (Musicas!Z) — é essa cópia
    // que permite achar o conteúdo certo do chart a partir de um comentário
    // no fórum sem depender de comparar título como texto (ver
    // registroLogController.ts). Também devolvido na resposta — o front usa
    // pra já poder salvar Shop/Info/Visual (extraMaterialController.ts) na
    // hora da criação, se o jogador ativar algum desses botões no formulário.
    if (musicaRowIndexNova && codigoUnicoGerado) {
      await googleSheetsService.principal
        .updateValues("Musicas", `Z${musicaRowIndexNova}`, [[codigoUnicoGerado]])
        .catch((err) => console.warn("[createSongController] Erro ao copiar Código único pra Musicas!Z:", err));
    }

    // 2. Gravar em REGISTRO DE MÚSICA na planilha de Registros — só as
    // colunas definidas no documento oficial (B, C, D, H, I-L, N, P), na
    // primeira linha vazia (verificada pela Coluna B).
    try {
      const registroRows =
        await googleSheetsService.registrosCharts.readValues("REGISTRO DE MÚSICA");
      let targetRow = (registroRows?.length || 0) + 1;
      if (registroRows && registroRows.length > 1) {
        for (let i = 1; i < registroRows.length; i++) {
          if (!(registroRows[i][1] || "").trim()) {
            targetRow = i + 1;
            break;
          }
        }
      } else if (!registroRows || registroRows.length === 0) {
        targetRow = 2;
      }

      // Coluna N espera "Sim"/"Não" — antes ficava em branco quando não era
      // opção b), em vez de gravar "Não" explicitamente.
      const substituir = (opcaoChart || "").trim().startsWith("b)") ? "Sim" : "Não";

      // Cabeçalho real confirmado (linha 1 da aba): "", Título, Tipo de
      // Single, Tipo de Música, ÁLBUM, "", "", ACT PRINCIPAL, ARTISTA 2..6,
      // SUBSTITUIR NOS CHARTS?, Por qual música?, ENVIAR.
      // B, C, D, E, F, G, H, I, J, K, L, M, N, O, P
      await googleSheetsService.registrosCharts.updateValues(
        "REGISTRO DE MÚSICA",
        `B${targetRow}:P${targetRow}`,
        [
          [
            fullTitle, // B - Título
            tipoSingle || "LEAD SINGLE", // C - Tipo de Single
            tipoMusica || "SOLO", // D - Tipo de Música
            "", // E - ÁLBUM (não coletado neste formulário)
            "", // F
            "", // G
            artistaPrincipal, // H - ACT PRINCIPAL
            participantesLimpos[0] || "", // I - Artista 2
            participantesLimpos[1] || "", // J - Artista 3
            participantesLimpos[2] || "", // K - Artista 4
            participantesLimpos[3] || "", // L - Artista 5
            participantesLimpos[4] || "", // M - Artista 6
            substituir, // N - SUBSTITUIR NOS CHARTS?
            musicaReferencia || "", // O - Por qual música?
            "OK", // P - ENVIAR
          ],
        ],
      );
    } catch (err) {
      console.warn("[createSongController] Erro ao gravar em REGISTRO DE MÚSICA:", err);
    }

    // REGISTRO é só pra comentários de OUTROS jogadores nesse conteúdo (ver
    // forumController.ts) — lançar a própria música não é um comentário, e
    // registrar isso aqui como se fosse um inflava indevidamente a aba.

    await somarPrestigio({ telegramId: jogadorId, usuario: nomeJogador }, "publicar_lancamento").catch(() => {});

    registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Música "${fullTitle}" lançada por ${nomeJogador} (${artistaPrincipal}).`,
      onde: "createSongController",
    }).catch(() => {});

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          titulo: fullTitle,
          artistaPrincipal,
          nomeJogador,
          codigoUnico: codigoUnicoGerado,
          mensagem: "Música registrada com sucesso nos charts e banco de dados!",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[createSongController] Erro:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Erro ao processar lançamento de música.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

// Controller para Criar / Registrar Vídeo
// Marca o lançamento de um Music Video na aba "Pontos" da planilha de
// registrosCharts (colunas confirmadas via dump ao vivo: D = "MÚSICA" no
// formato "Artista - Título", N = checkbox "VIDEOCLIPE", O = "DATA DE
// LANÇAMENTO" no formato DD/MM/AAAA). Busca a linha por igualdade exata em D.
// Devolve false quando a caixinha NÃO foi marcada (música não encontrada em
// Pontos, ou erro na escrita) — o chamador usa isso pra avisar quem lançou o
// vídeo em vez de deixar a falha 100% silenciosa (foi assim que WISDOM e
// CURSED BLESSED passaram batido: o tipo selecionado não era "Music Video",
// então essa função nem chegava a rodar, e o formulário dizia "sucesso"
// mesmo assim).
async function marcarVideoclipeNaPontos(musicaVinculada: string, dataFormatada: string): Promise<boolean> {
  if (!musicaVinculada.trim()) return false;
  try {
    const matches = await googleSheetsService.registrosCharts.findRows(
      "Pontos",
      (row) => (row[3] || "").trim().toLowerCase() === musicaVinculada.trim().toLowerCase(),
    );
    if (matches.length === 0) {
      console.warn(`[marcarVideoclipeNaPontos] Música não encontrada na aba Pontos: ${musicaVinculada}`);
      return false;
    }
    for (const { rowIndex } of matches) {
      await googleSheetsService.registrosCharts.updateValues("Pontos", `N${rowIndex}:O${rowIndex}`, [
        ["TRUE", dataFormatada],
      ]);
    }
    return true;
  } catch (err) {
    console.warn("[marcarVideoclipeNaPontos] Erro ao atualizar aba Pontos:", err);
    return false;
  }
}

export async function createVideoController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as CreateVideoPayload;
    const {
      tituloVideo,
      artistaResponsavel,
      tipoVideo,
      categoriaVideo,
      musicaVinculada = "",
      musicasVinculadas: musicasVinculadasRaw,
      capaUrl = "",
      mediaUrl = "",
      nomeJogador,
    } = body;

    if (!tituloVideo || !artistaResponsavel || !nomeJogador) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Campos obrigatórios ausentes: tituloVideo, artistaResponsavel, nomeJogador.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const tipo = tipoVideo || categoriaVideo || "Video";
    const isMusicVideoTipo = tipo.trim().toLowerCase() === "music video";

    // Música vinculada agora é sempre obrigatória — foi cadastrar um vídeo
    // sem vínculo nenhum (WISDOM) que deixou o código único e a caixinha de
    // PONTOS soltos, sem nenhum aviso. "Music Video" só aceita 1 música (é o
    // clipe oficial dela); outros tipos aceitam até 3 (podem cobrir mais de
    // uma faixa, ex: um Behind the Scenes de um EP inteiro).
    const musicasVinculadas = (
      musicasVinculadasRaw && musicasVinculadasRaw.length > 0
        ? musicasVinculadasRaw
        : musicaVinculada
          ? [musicaVinculada]
          : []
    )
      .map((m) => m.trim())
      .filter(Boolean);

    if (musicasVinculadas.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Selecione pelo menos uma música vinculada ao vídeo." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    if (isMusicVideoTipo && musicasVinculadas.length > 1) {
      return new Response(
        JSON.stringify({ success: false, error: "Music Video só pode vincular uma única música." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    if (musicasVinculadas.length > 3) {
      return new Response(
        JSON.stringify({ success: false, error: "No máximo 3 músicas vinculadas por vídeo." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const nowStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const dataFormatada = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const fullTitle = tituloVideo.includes(" - ")
      ? tituloVideo
      : `${artistaResponsavel} - ${tituloVideo}`;
    const topicId = `video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 1. Gravar em Music Videos na planilha principal — "Videos" e "Music
    // Video" foram unificados numa única aba/formulário de Gestão; a tag
    // ("Tipo de vídeo") vinda do formulário define a categoria exibida no
    // catálogo (incluindo "Music Video" como uma das opções).
    //
    // NÃO usa appendRow aqui de propósito: o append nativo do Sheets decide
    // onde encaixar a linha olhando a última linha com QUALQUER célula
    // preenchida no range inteiro (A:ZZ) — e a coluna T (Thumb) já vem
    // pré-preenchida com uma imagem padrão em várias linhas "vazias" mais
    // acima (pra quando ninguém envia thumb própria). Isso fazia o append
    // pular todo esse bloco de linhas realmente livres e cair bem mais
    // embaixo do que devia. A linha livre de verdade é sempre a primeira em
    // que a coluna B (Título) está vazia — é isso que acha e escreve abaixo.
    const rowValues = [
      "", // A - ID do usuário
      fullTitle, // B - Título do tópico
      "", // C - ID da mensagem (grupo original)
      "", // D - chat_id
      "", // E - chat_id_interno
      topicId, // F - message_thread_id
      "", // G - Link direto (t.me)
      tipo, // H - Tipo de vídeo
      "", // I - Descrição
      dataFormatada, // J - Data do envio
      "drive", // K - fonte
      "", // L - ID da mensagem (grupo de arquivo — não aplicável a upload via Drive)
      mediaUrl || "", // M - Link do vídeo
      "", // N - Likes por jogador
      "", // O - Média Likes
      musicasVinculadas.join("; "), // P - Nome original nos charts (múltiplas, separadas por "; ")
      "", // Q - ID da mensagem (reconvertido)
      "", // R - Status da reconversão
      "", // S - Reportado em
      capaUrl || "", // T - Thumb (vira a capa/fundo do vídeo no catálogo)
    ];
    let videoRowIndexNovo: number | null = null;
    try {
      const colunaB = await googleSheetsService.principal.readValues("Music Videos", "B2:B5000");
      const idxVazio = colunaB.findIndex((r) => !(r[0] || "").trim());
      const linhaLivre = idxVazio >= 0 ? idxVazio + 2 : colunaB.length + 2;
      await googleSheetsService.principal.updateValues("Music Videos", `A${linhaLivre}:T${linhaLivre}`, [
        rowValues,
      ]);
      videoRowIndexNovo = linhaLivre;
    } catch (err) {
      console.warn("[createVideoController] Erro ao gravar em Music Videos:", err);
    }

    const warnings: string[] = [];

    // Music Videos não gera Código único próprio — sempre usa o da (primeira)
    // música vinculada em EDIÇÃO CHARTS (coluna P aponta pro título de lá).
    // Acha essa linha por título e copia o código pra Music Videos!U. Antes
    // disso, sem música vinculada preenchida, caía pro título do próprio
    // vídeo — que só batia por acaso quando o título do vídeo era idêntico
    // ao da música nos charts (ex: WISDOM x "WISDOM TOOTH" nos charts não
    // batiam, então o código único ficava vazio, sem nenhum aviso). Agora
    // música vinculada é sempre obrigatória, então isso não deve mais
    // acontecer — mas o aviso continua aqui como rede de segurança.
    if (videoRowIndexNovo) {
      try {
        const nomeNosCharts = normalizeComparison(musicasVinculadas[0]);
        const rows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS");
        const linhaMusica = rows.slice(1).find((r) => normalizeComparison(r[1]) === nomeNosCharts);
        const codigoDaMusica = linhaMusica ? (linhaMusica[55] || "").trim() : "";
        if (codigoDaMusica) {
          await googleSheetsService.principal
            .updateValues("Music Videos", `U${videoRowIndexNovo}`, [[codigoDaMusica]])
            .catch((err) => console.warn("[createVideoController] Erro ao copiar Código único pra Music Videos!U:", err));
        } else {
          warnings.push(
            `Vídeo cadastrado, mas não achei "${musicasVinculadas[0]}" em EDIÇÃO CHARTS — o Código único não foi copiado pra Music Videos, confira o vínculo com a música.`,
          );
        }
      } catch (err) {
        console.warn("[createVideoController] Erro ao buscar Código único da música vinculada:", err);
      }
    }

    // REGISTRO é só pra comentários de OUTROS jogadores (ver
    // forumController.ts) — lançar o próprio vídeo não é comentário.

    await somarPrestigio({ usuario: nomeJogador }, "publicar_lancamento").catch(() => {});

    // 3. Quando o tipo selecionado for "Music Video", marcar o lançamento
    // do videoclipe na aba "Pontos" (coluna N) com a data de envio (coluna O).
    // Music Video só aceita 1 música vinculada (validado lá em cima), então
    // sempre existe exatamente uma pra marcar aqui.
    if (isMusicVideoTipo) {
      const marcou = await marcarVideoclipeNaPontos(musicasVinculadas[0], dataFormatada);
      if (!marcou) {
        warnings.push(`Vídeo cadastrado, mas não achei "${musicasVinculadas[0]}" na aba Pontos — a caixinha de lançamento não foi marcada, confira o vínculo.`);
      }
    }
    const warning = warnings.length > 0 ? warnings.join(" ") : undefined;

    registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Vídeo "${fullTitle}" lançado por ${artistaResponsavel}.`,
      onde: "createVideoController",
    }).catch(() => {});

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          titulo: fullTitle,
          artistaResponsavel,
          mensagem: "Vídeo cadastrado com sucesso!",
          warning,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[createVideoController] Erro:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Erro ao registrar vídeo.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

// Lista as músicas disponíveis nos charts pra busca por faixa no cadastro de
// álbum — fonte é a aba "Pontos" (registrosCharts), coluna D, cujo cabeçalho
// real fica na linha 3 (confirmado via dump ao vivo); os dados começam na
// linha 4. Cada valor já vem no formato "Artista - Título".
export async function getMusicasEmChartController(): Promise<Response> {
  try {
    const rows = await googleSheetsService.registrosCharts.readValues("Pontos", "D4:D5000");
    const seen = new Set<string>();
    const musicas: { label: string; artist: string; title: string }[] = [];
    for (const row of rows) {
      const label = (row[0] || "").trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      const sepIdx = label.indexOf(" - ");
      musicas.push({
        label,
        artist: sepIdx >= 0 ? label.slice(0, sepIdx).trim() : label,
        title: sepIdx >= 0 ? label.slice(sepIdx + 3).trim() : "",
      });
    }
    return new Response(JSON.stringify({ success: true, data: musicas }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[getMusicasEmChartController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao buscar músicas em chart." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

// Lista faixas do artista prontas pra vincular a um álbum: precisam ter um
// tópico de verdade no fórum (Musicas!B não vazio — senão não tem o que
// "vincular", a música ainda nem existe como conteúdo publicado) e ainda
// não pertencer a nenhum álbum (Musicas!K vazio — senão a gente "roubaria"
// silenciosamente a faixa de outro álbum). Faixas "Pendente" (sem tópico
// ainda, aguardando serem publicadas) ficam de fora de propósito — hoje
// isso só é possível fora deste app; quando existir um fluxo de "publicar
// faixa pendente" aqui dentro, aí sim elas passam a aparecer aqui.
export async function getFaixasSemAlbumController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const artista = (url.searchParams.get("artista") || "").trim();
    if (!artista) {
      return new Response(JSON.stringify({ success: false, error: "Parâmetro 'artista' é obrigatório." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = await googleSheetsService.principal.readValues("Musicas");
    const normArtista = normalizeComparison(artista);
    const faixas: { label: string; title: string }[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const topicId = (row[1] || "").trim(); // B - ID do tópico
      const albumAtual = (row[10] || "").trim(); // K - ALBUM
      const actPrincipal = (row[13] || "").trim(); // N - ACT PRINCIPAL
      const titulo = (row[7] || "").trim(); // H - Nome da música

      if (!topicId || albumAtual || !titulo) continue;
      if (normalizeComparison(actPrincipal) !== normArtista) continue;

      faixas.push({ label: titulo, title: titulo });
    }

    return new Response(JSON.stringify({ success: true, data: faixas }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[getFaixasSemAlbumController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao buscar faixas sem álbum." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

// Vincula uma faixa já lançada (selecionada nos charts) ao álbum: grava o
// nome do álbum e a ordem na aba Musicas (colunas K e U, buscando a música
// pelo título na coluna H) e o nome do álbum na aba "EDIÇÃO CHARTS" da
// planilha edicaoCharts (coluna E, buscando pela coluna B) — mapeamento
// confirmado via dump ao vivo, não adivinhado. Usa normalizeComparison (tira
// acento/caixa) em vez de comparação exata, pra não falhar por diferença
// boba de formatação entre o título mostrado na busca e o gravado na
// planilha. Devolve o que NÃO foi encontrado em cada aba, pra quem chamou
// poder avisar o jogador em vez de deixar a faixa "meio vinculada" sem
// ninguém perceber.
async function vincularFaixaExistenteAoAlbum(
  musicaSelecionada: string,
  albumFullTitle: string,
  ordem: number,
  artistaAlbum: string,
  jogadorId: string,
  dataFormatada: string,
): Promise<{ musicasOk: boolean; edicaoChartsOk: boolean; criada: boolean }> {
  const alvoNorm = normalizeComparison(musicaSelecionada);
  let musicasOk = false;
  let edicaoChartsOk = false;
  let criada = false;

  try {
    const musicasMatches = await googleSheetsService.principal.findRows(
      "Musicas",
      (row) => normalizeComparison(row[7] || "") === alvoNorm,
    );
    for (const { rowIndex } of musicasMatches) {
      await googleSheetsService.principal.updateValues("Musicas", `K${rowIndex}`, [
        [albumFullTitle],
      ]);
      await googleSheetsService.principal.updateValues("Musicas", `U${rowIndex}`, [
        [String(ordem)],
      ]);
    }
    musicasOk = musicasMatches.length > 0;
    // Migração antiga: algumas faixas de álbum contabilizavam vendas/streams
    // pro total do álbum nos charts, mas nunca tiveram linha própria em
    // "Musicas" (só existiam como tópico do álbum, sem tópico individual).
    // Selecionar essa faixa como "existente" não tem o que vincular — sem
    // isso, a ação falhava calada e a UI dizia "sucesso" mesmo sem
    // acontecer nada. Agora cria a linha faltante como faixa PENDENTE (sem
    // tópico ainda, mesmo estado de quem lança faixa nova sem publicar) —
    // dali em diante ela aparece na lista de faixas do álbum, pronta pra
    // "Publicar" quando alguém quiser abrir o tópico dela de verdade.
    if (!musicasOk) {
      try {
        await googleSheetsService.principal.appendRow("Musicas", [
          dataFormatada, // A - Data
          "", // B - ID do tópico (pendente)
          "", // C - ID do arquivo
          "", // D - Capa
          "", // E - Letra
          "", // F - Comentários para
          jogadorId || "", // G - ID do Criador
          musicaSelecionada, // H - Nome da música
          "", // I - TIPO DE SINGLE
          "", // J - TIPO DE MÚSICA
          albumFullTitle, // K - ALBUM
          "", // L - WEEKS
          "", // M - WEEKS VIDEO
          artistaAlbum, // N - ACT PRINCIPAL
          "", "", "", "", "", // O-S - ARTISTA 2-6
          "", // T - GÊNERO
          String(ordem), // U - Ordem
          "", // V - Metacritic por jogador
          "", // W - Média Metacritic
          "Sim", // X - Pendente?
          "", // Y - Referência
        ]);
        musicasOk = true;
        criada = true;
      } catch (err) {
        console.warn(`[vincularFaixaExistenteAoAlbum] Erro ao criar linha pendente pra "${musicaSelecionada}":`, err);
      }
    }
  } catch (err) {
    console.warn("[vincularFaixaExistenteAoAlbum] Erro ao atualizar Musicas:", err);
  }

  try {
    const edicaoMatches = await googleSheetsService.edicaoCharts.findRows(
      "EDIÇÃO CHARTS",
      (row) => normalizeComparison(row[1] || "") === alvoNorm,
    );
    for (const { rowIndex } of edicaoMatches) {
      await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS", `E${rowIndex}`, [
        [albumFullTitle],
      ]);
    }
    edicaoChartsOk = edicaoMatches.length > 0;
    if (!edicaoChartsOk) {
      console.warn(`[vincularFaixaExistenteAoAlbum] Música não encontrada em EDIÇÃO CHARTS: ${musicaSelecionada}`);
    }
  } catch (err) {
    console.warn("[vincularFaixaExistenteAoAlbum] Erro ao atualizar EDIÇÃO CHARTS:", err);
  }

  return { musicasOk, edicaoChartsOk, criada };
}

// Registra uma faixa (avulsa ou de álbum) em EDIÇÃO CHARTS + REGISTRO DE
// MÚSICA — essas duas entram SEMPRE, mesmo faixa pendente sem tópico ainda,
// porque são os dados que alimentam a fórmula de vendas do álbum. Já INFOS
// MÚSICAS (capa pro chart puxar) só entra quando a faixa já é lançamento de
// verdade (tem tópico) — controlado por `pendente`. Extraído de
// processarFaixasDoAlbum pra ser reaproveitado ali (na criação do álbum,
// pra toda faixa inédita) e em publicarFaixaPendenteController (que agora
// só precisa acionar a parte de INFOS MÚSICAS, ver
// atualizarFaixaNosChartsAoPublicar).
async function registrarFaixaNosCharts(params: {
  dataFormatada: string;
  songTitle: string;
  tipoSingle: string;
  tipoMusica: string;
  album: string;
  artistaPrincipal: string;
  participantes: string[];
  capaUrl: string;
  pendente?: boolean;
}): Promise<number | null> {
  const { dataFormatada, songTitle, tipoSingle, tipoMusica, album, artistaPrincipal, participantes, capaUrl, pendente } = params;

  const edicaoChartsRowIndex = await registrarNaEdicaoCharts({
    dataFormatada,
    fullTitle: songTitle,
    tipoSingle,
    tipoMusica,
    album,
    artistaPrincipal,
    participantes,
  });

  if (!pendente) {
    await registrarInfosMusicas({ fullTitle: songTitle, capaUrl });
  }

  try {
    const registroRows = await googleSheetsService.registrosCharts.readValues("REGISTRO DE MÚSICA");
    let targetRow = (registroRows?.length || 0) + 1;
    if (registroRows && registroRows.length > 1) {
      for (let i = 1; i < registroRows.length; i++) {
        if (!(registroRows[i][1] || "").trim()) {
          targetRow = i + 1;
          break;
        }
      }
    } else if (!registroRows || registroRows.length === 0) {
      targetRow = 2;
    }

    await googleSheetsService.registrosCharts.updateValues("REGISTRO DE MÚSICA", `B${targetRow}:P${targetRow}`, [
      [
        songTitle, // B - Título
        tipoSingle, // C - Tipo de Single
        tipoMusica, // D - Tipo de Música
        album, // E - ÁLBUM
        "", // F
        "", // G
        artistaPrincipal, // H - ACT PRINCIPAL
        participantes[0] || "", // I - Artista 2
        participantes[1] || "", // J - Artista 3
        participantes[2] || "", // K - Artista 4
        participantes[3] || "", // L - Artista 5
        participantes[4] || "", // M - Artista 6
        "Não", // N - SUBSTITUIR NOS CHARTS?
        "", // O - Por qual música?
        "OK", // P - ENVIAR
      ],
    ]);
  } catch (err) {
    console.warn("[registrarFaixaNosCharts] Erro ao gravar em REGISTRO DE MÚSICA:", err);
  }

  return edicaoChartsRowIndex;
}

// Faixa de álbum que nasceu pendente já tem uma linha em EDIÇÃO CHARTS
// (gravada na criação do álbum, ver processarFaixasDoAlbum) — publicar não
// cria uma linha nova, só acha essa linha (pelo título, coluna B) e
// atualiza tipo (C/D) e data (A) pra agora, que é quando ela de fato passa
// a valer como lançamento. Varre de baixo pra cima pra pegar a ocorrência
// mais recente em caso de título repetido.
async function atualizarFaixaNosChartsAoPublicar(params: {
  fullTitle: string;
  tipoSingle: string;
  tipoMusica: string;
  dataFormatada: string;
}): Promise<number | null> {
  const { fullTitle, tipoSingle, tipoMusica, dataFormatada } = params;
  try {
    const rows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "B2:B20000");
    let linhaAlvo: number | null = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      if ((rows[i]?.[0] || "").trim() === fullTitle.trim()) {
        linhaAlvo = i + 2;
        break;
      }
    }
    if (!linhaAlvo) {
      console.warn("[atualizarFaixaNosChartsAoPublicar] Linha não encontrada em EDIÇÃO CHARTS pra:", fullTitle);
      return null;
    }
    await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS", `A${linhaAlvo}`, [[dataFormatada]]);
    await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS", `C${linhaAlvo}:D${linhaAlvo}`, [
      [tipoSingle, tipoMusica],
    ]);
    return linhaAlvo;
  } catch (err) {
    console.warn("[atualizarFaixaNosChartsAoPublicar] Erro ao atualizar EDIÇÃO CHARTS:", err);
    return null;
  }
}

// Processa a lista de faixas de um álbum (criação ou substituição): faixa
// existente vincula na aba Musicas/EDIÇÃO CHARTS; faixa inédita registra do
// zero em Musicas + REGISTRO DE MÚSICA, pendente até virar tópico próprio.
async function processarFaixasDoAlbum(
  faixas: TrackItemPayload[],
  albumFullTitle: string,
  artistaAlbum: string,
  capaUrl: string,
  jogadorId: string,
  dataFormatada: string,
) {
  const resultadosFaixasExistentes: { titulo: string; ok: boolean; criada: boolean }[] = [];
  let faixasIneditasEsperadas = 0;
  let faixasIneditasGravadas = 0;

  for (const faixa of faixas) {
    if (!faixa.inedita) {
      // Faixa existente, selecionada na busca da aba Pontos.
      try {
        const resultado = await vincularFaixaExistenteAoAlbum(
          faixa.titulo,
          albumFullTitle,
          faixa.num,
          artistaAlbum,
          jogadorId,
          dataFormatada,
        );
        resultadosFaixasExistentes.push({
          titulo: faixa.titulo,
          ok: resultado.musicasOk,
          criada: resultado.criada,
        });
      } catch (faixaErr) {
        console.warn("[processarFaixasDoAlbum] Erro ao vincular faixa existente:", faixaErr);
        resultadosFaixasExistentes.push({ titulo: faixa.titulo, ok: false, criada: false });
      }
      continue;
    }

    // Faixa inédita.
    const participantesLimpos = (faixa.participantes || []).filter(Boolean);
    const songTitle = faixa.titulo.includes(" - ")
      ? faixa.titulo
      : `${artistaAlbum} - ${faixa.titulo}`;
    const abrirTopico = !!faixa.abrirTopico;
    const pendente = abrirTopico ? "Não" : "Sim";
    const trackTopicId = abrirTopico
      ? `musica_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${faixa.num}`
      : "";

    faixasIneditasEsperadas++;
    let faixaRowIndex: number | null = null;
    try {
      faixaRowIndex = await googleSheetsService.principal.appendRow("Musicas", [
        dataFormatada, // A - Data de lançamento
        trackTopicId, // B - ID do tópico (só se abrir tópico próprio)
        faixa.mediaUrl || "", // C - ID do arquivo (link do Drive ou YouTube)
        capaUrl || "", // D - Capa da música
        faixa.letra || "", // E - Letra
        trackTopicId, // F - Comentários para
        jogadorId || "", // G - ID do Criador
        songTitle, // H - Nome da música
        faixa.tipoSingle || "TRACKLIST ALBUM", // I - TIPO DE SINGLE
        faixa.tipoMusica || "SOLO", // J - TIPO DE MÚSICA
        albumFullTitle, // K - ALBUM
        "", // L - WEEKS
        "", // M - WEEKS VIDEO
        artistaAlbum, // N - ACT PRINCIPAL
        participantesLimpos[0] || "", // O - ARTISTA 2
        participantesLimpos[1] || "", // P - ARTISTA 3
        participantesLimpos[2] || "", // Q - ARTISTA 4
        participantesLimpos[3] || "", // R - ARTISTA 5
        participantesLimpos[4] || "", // S - ARTISTA 6
        "", // T - GÊNERO
        String(faixa.num || ""), // U - Ordem
        "", // V - Metacritic por jogador
        "", // W - Média Metacritic
        pendente, // X - Pendente?
      ]);
      faixasIneditasGravadas++;
    } catch (faixaErr) {
      console.warn("[processarFaixasDoAlbum] Erro ao registrar faixa inédita em Musicas:", faixaErr);
      continue;
    }

    // Toda faixa inédita de álbum entra em EDIÇÃO CHARTS já na criação do
    // álbum, pendente ou não — são esses dados que alimentam a fórmula de
    // vendas do álbum. O que muda quando a faixa está pendente é só que
    // INFOS MÚSICAS (capa pro chart puxar) fica de fora até ela virar
    // lançamento de verdade (ver publicarFaixaPendenteController, que
    // atualiza tipo e data na MESMA linha em vez de criar uma nova).
    const edicaoChartsRowIndex = await registrarFaixaNosCharts({
      dataFormatada,
      songTitle,
      tipoSingle: faixa.tipoSingle || "TRACKLIST ALBUM",
      tipoMusica: faixa.tipoMusica || "SOLO",
      album: albumFullTitle,
      artistaPrincipal: artistaAlbum,
      participantes: participantesLimpos,
      capaUrl,
      pendente: pendente === "Sim",
    });
    // Mesma cópia de Código único feita em createSongController — sem
    // isso, faixa inédita de álbum nunca tinha o código pra cruzar com
    // comentários/REGISTRO/Shop-Info-Visual.
    if (faixaRowIndex && edicaoChartsRowIndex) {
      const codigoGerado = await lerCodigoUnicoGerado(edicaoChartsRowIndex);
      if (codigoGerado) {
        await googleSheetsService.principal
          .updateValues("Musicas", `Z${faixaRowIndex}`, [[codigoGerado]])
          .catch((err) => console.warn("[processarFaixasDoAlbum] Erro ao copiar Código único:", err));
      }
    }
  }

  return { resultadosFaixasExistentes, faixasIneditasEsperadas, faixasIneditasGravadas };
}

// Lista os álbuns já lançados na aba Albuns (planilha principal) — usado na
// busca de "qual álbum substituir". Coluna G = "Artista - Título", B = ID do
// tópico (chave), C = Capa, J = Encarte (URLs separadas por ", ").
export async function getMeusAlbunsController(): Promise<Response> {
  try {
    const rows = await googleSheetsService.principal.readValues("Albuns");
    const albuns: { topicId: string; label: string; artist: string; title: string; capaUrl: string }[] =
      [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const label = (row[6] || "").trim(); // G
      const topicId = (row[1] || "").trim(); // B
      if (!label || !topicId) continue;
      const sepIdx = label.indexOf(" - ");
      albuns.push({
        topicId,
        label,
        artist: sepIdx >= 0 ? label.slice(0, sepIdx).trim() : label,
        title: sepIdx >= 0 ? label.slice(sepIdx + 3).trim() : "",
        capaUrl: (row[2] || "").trim(), // C
      });
    }
    return new Response(JSON.stringify({ success: true, data: albuns }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[getMeusAlbunsController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao buscar álbuns." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

// Lista as faixas de um álbum específico, em ordem — usado na tela de
// edição (Editar Lançamentos) pra permitir reordenar ou conferir o que já
// está vinculado antes de adicionar novas faixas. Resolve o título completo
// do álbum pelo ID do tópico (Albuns!B) e busca em Musicas por K igual.
export async function getAlbumFaixasController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const topicId = (url.searchParams.get("topicId") || "").trim();
    if (!topicId) {
      return new Response(JSON.stringify({ success: false, error: "Parâmetro 'topicId' é obrigatório." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const albumRows = await googleSheetsService.principal.readValues("Albuns");
    const albumRow = albumRows.slice(1).find((r) => (r[1] || "").trim() === topicId);
    if (!albumRow) {
      return new Response(JSON.stringify({ success: false, error: "Álbum não encontrado." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const albumFullTitle = (albumRow[6] || "").trim();
    const albumNorm = albumFullTitle.toLowerCase();

    const musicasMatches = await googleSheetsService.principal.findRows(
      "Musicas",
      (row) => (row[10] || "").trim().toLowerCase() === albumNorm,
    );

    const faixas = musicasMatches
      .map(({ rowIndex, row }) => ({
        musicaRowIndex: rowIndex,
        titulo: row[7] || "",
        ordem: parseInt(row[20] || "999", 10) || 999,
        audioUrl: row[2] || "",
        letra: row[4] || "",
        letraSincronizada: row[30] || "",
        pendente: !(row[1] || "").trim(), // sem tópico (coluna B vazia) = pendente
      }))
      .sort((a, b) => a.ordem - b.ordem);

    return new Response(
      JSON.stringify({ success: true, data: { albumFullTitle, faixas } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[getAlbumFaixasController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao buscar faixas do álbum." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

// Grava/edita a letra (Musicas!E) de uma faixa já lançada — tanto pra uma
// música avulsa quanto pra uma faixa dentro de um álbum (mesma aba, mesma
// coluna, só muda de onde a tela chama).
export async function updateFaixaLetraController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { musicaRowIndex?: number; letra?: string };
    const musicaRowIndex = Number(body.musicaRowIndex);
    if (!musicaRowIndex || musicaRowIndex < 2) {
      return new Response(
        JSON.stringify({ success: false, error: "musicaRowIndex é obrigatório." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    await googleSheetsService.principal.updateValues("Musicas", `E${musicaRowIndex}`, [
      [body.letra || ""],
    ]);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[updateFaixaLetraController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao gravar letra." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

// Grava a letra SINCRONIZADA (Musicas!AE, formato LRC "[mm:ss.cc]texto" por
// linha) de uma faixa — só o dono do artista da faixa pode fazer isso.
// Localiza a linha pelo ID do tópico (Musicas!B) em vez de exigir rowIndex
// do chamador, porque a tela de sincronização só tem acesso ao item do
// catálogo (que carrega telegramTopicId), não ao índice bruto da planilha.
export async function updateFaixaLetraSincronizadaController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      topicId?: string;
      musicaRowIndex?: number;
      telegramId?: string;
      lrc?: string;
    };
    const topicId = normalizeText(body.topicId);
    const telegramId = normalizeText(body.telegramId);
    const rowIndexFromBody = Number(body.musicaRowIndex) || 0;
    if ((!topicId && rowIndexFromBody < 2) || !telegramId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "musicaRowIndex ou topicId, e telegramId, são obrigatórios.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const rows = await googleSheetsService.principal.readValues("Musicas");
    // Preferimos o rowIndex direto quando informado (Estúdio de Sincronização
    // na Gestão) — funciona mesmo pra faixa de álbum sem tópico publicado
    // ainda (coluna B vazia), onde não existe topicId pra buscar por ele.
    const rowIndex =
      rowIndexFromBody >= 2
        ? rowIndexFromBody
        : rows.findIndex((r, i) => i > 0 && normalizeText(r[1]) === topicId) + 1;
    if (rowIndex < 2) {
      return new Response(JSON.stringify({ success: false, error: "Faixa não encontrada." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Coluna N (index 13) = ACT PRINCIPAL — mesmo mapeamento usado no resto
    // do arquivo pra achar o dono do artista da faixa.
    const artista = normalizeText(rows[rowIndex - 1][13]);
    const donoId = artista ? await getOwnerIdForArtist(artista) : "";
    if (!donoId || donoId !== telegramId) {
      return new Response(
        JSON.stringify({ success: false, error: "Só o dono do artista pode sincronizar a letra." }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    await googleSheetsService.principal.updateValues("Musicas", `AE${rowIndex}`, [
      [body.lrc || ""],
    ]);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[updateFaixaLetraSincronizadaController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao gravar letra sincronizada." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

// Publica o tópico de uma faixa pendente (adicionada a um álbum sem "abrir
// tópico" no momento) — gera o topicId, grava nas colunas B e F de Musicas
// (mesmo par que createSongController usa pra faixa avulsa) e vira
// "Pendente? = Não". Só a partir daqui a faixa pode receber comentário.
// Mesma regra da faixa avulsa: soma prestígio e grava Audit Log em
// REGISTRO nesse momento — é aqui que ela vira conteúdo publicado de
// verdade, mesmo já estando no chart desde que foi adicionada ao álbum.
export async function publicarFaixaPendenteController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      musicaRowIndex?: number;
      nomeJogador?: string;
      jogadorId?: string;
      tipoSingle?: string;
    };
    const musicaRowIndex = Number(body.musicaRowIndex);
    const nomeJogador = (body.nomeJogador || "").trim();
    const jogadorId = (body.jogadorId || "").trim();
    const tipoSingleEscolhido = (body.tipoSingle || "").trim();

    if (!musicaRowIndex || musicaRowIndex < 2 || !nomeJogador) {
      return new Response(
        JSON.stringify({ success: false, error: "musicaRowIndex e nomeJogador são obrigatórios." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const rows = await googleSheetsService.principal.readValues("Musicas", `A${musicaRowIndex}:Y${musicaRowIndex}`);
    const row = rows?.[0];
    if (!row) {
      return new Response(JSON.stringify({ success: false, error: "Faixa não encontrada." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if ((row[1] || "").trim()) {
      return new Response(JSON.stringify({ success: false, error: "Essa faixa já tem tópico publicado." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const fullTitle = row[7] || "";
    const topicId = `musica_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await googleSheetsService.principal.updateValues("Musicas", `B${musicaRowIndex}`, [[topicId]]);
    await googleSheetsService.principal.updateValues("Musicas", `F${musicaRowIndex}`, [[topicId]]);
    await googleSheetsService.principal.updateValues("Musicas", `X${musicaRowIndex}`, [["Não"]]);

    // A linha em EDIÇÃO CHARTS já existe desde a criação do álbum (ver
    // processarFaixasDoAlbum) — publicar só atualiza tipo e data pra agora,
    // que é quando a faixa de fato passa a valer como lançamento, e libera
    // INFOS MÚSICAS (capa pro chart puxar), que até aqui ficava de fora.
    const dataFormatada = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    // Tipo escolhido na hora de publicar (ex: virou "LEAD SINGLE") tem
    // prioridade — sem isso, publicar sempre reescrevia o mesmo tipo que a
    // faixa já tinha desde a criação do álbum ("TRACKLIST ALBUM"), o que não
    // refletia a intenção real de lançar aquela faixa como single.
    const tipoSingle = tipoSingleEscolhido || row[8] || "TRACKLIST ALBUM";
    const tipoMusica = row[9] || "SOLO";
    if (tipoSingleEscolhido && tipoSingleEscolhido !== row[8]) {
      await googleSheetsService.principal
        .updateValues("Musicas", `I${musicaRowIndex}`, [[tipoSingle]])
        .catch((err) => console.warn("[publicarFaixaPendenteController] Erro ao atualizar tipo em Musicas:", err));
    }
    const edicaoChartsRowIndex = await atualizarFaixaNosChartsAoPublicar({
      fullTitle,
      tipoSingle,
      tipoMusica,
      dataFormatada,
    });
    await registrarInfosMusicas({ fullTitle, capaUrl: row[3] || "" });
    // Mesma cópia de Código único feita na criação normal (createSongController)
    // — sem isso, uma faixa que nasceu pendente nunca teria o código pra
    // cruzar com comentários/REGISTRO/Shop-Info-Visual depois de publicada.
    if (edicaoChartsRowIndex) {
      const codigoGerado = await lerCodigoUnicoGerado(edicaoChartsRowIndex);
      if (codigoGerado) {
        await googleSheetsService.principal
          .updateValues("Musicas", `Z${musicaRowIndex}`, [[codigoGerado]])
          .catch((err) => console.warn("[publicarFaixaPendenteController] Erro ao copiar Código único:", err));
      }
    }

    // REGISTRO é só pra comentários de OUTROS jogadores (ver
    // forumController.ts) — publicar a própria faixa não é comentário.

    await somarPrestigio({ telegramId: jogadorId, usuario: nomeJogador }, "publicar_lancamento").catch(() => {});

    return new Response(JSON.stringify({ success: true, data: { topicId, titulo: fullTitle } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[publicarFaixaPendenteController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao publicar faixa pendente." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export interface ReordenarFaixasPayload {
  ordens: { musicaRowIndex: number; ordem: number }[];
}

// Atualiza a coluna Ordem (Musicas!U) de cada faixa informada — usado pra
// reordenar a tracklist de um álbum na tela de edição.
export async function reordenarAlbumFaixasController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as ReordenarFaixasPayload;
    const ordens = body.ordens || [];

    if (ordens.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Nenhuma faixa informada para reordenar." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    for (const { musicaRowIndex, ordem } of ordens) {
      if (!musicaRowIndex || musicaRowIndex < 2) continue;
      await googleSheetsService.principal.updateValues("Musicas", `U${musicaRowIndex}`, [
        [String(ordem)],
      ]);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[reordenarAlbumFaixasController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao reordenar faixas." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export interface SubstituirAlbumPayload {
  albumTopicId: string;
  novaCapaUrl?: string;
  novosEncartesUrls?: string[];
  novasFaixas?: TrackItemPayload[];
  nomeJogador: string;
  jogadorId?: string;
}

// Controller para Substituir álbum já lançado: troca capa/encarte e/ou
// adiciona faixas a um álbum existente, sem duplicar o registro em Albuns
// nem em EDIÇÃO CHARTS ÁLBUMS (só atualiza a linha já existente).
export async function substituirAlbumController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as SubstituirAlbumPayload;
    const {
      albumTopicId,
      novaCapaUrl = "",
      novosEncartesUrls = [],
      novasFaixas = [],
      nomeJogador,
      jogadorId = "",
    } = body;

    if (!albumTopicId || !nomeJogador) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Campos obrigatórios ausentes: albumTopicId, nomeJogador.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const rows = await googleSheetsService.principal.readValues("Albuns");
    let rowIndex = -1;
    let albumFullTitle = "";
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][1] || "").trim() === albumTopicId.trim()) {
        rowIndex = i + 1;
        albumFullTitle = (rows[i][6] || "").trim();
        break;
      }
    }

    if (rowIndex === -1 || !albumFullTitle) {
      return new Response(
        JSON.stringify({ success: false, error: "Álbum não encontrado." }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const artistaAlbum = albumFullTitle.includes(" - ")
      ? albumFullTitle.slice(0, albumFullTitle.indexOf(" - ")).trim()
      : albumFullTitle;
    const nowStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const dataFormatada = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

    if (novaCapaUrl) {
      try {
        await googleSheetsService.principal.updateValues("Albuns", `C${rowIndex}`, [[novaCapaUrl]]);
      } catch (err) {
        console.warn("[substituirAlbumController] Erro ao atualizar capa:", err);
      }
    }

    if (novosEncartesUrls.length > 0) {
      try {
        await googleSheetsService.principal.updateValues("Albuns", `J${rowIndex}`, [
          [novosEncartesUrls.join(", ")],
        ]);
      } catch (err) {
        console.warn("[substituirAlbumController] Erro ao atualizar encarte:", err);
      }
    }

    let resultadosFaixasExistentes: { titulo: string; ok: boolean; criada: boolean }[] = [];
    if (novasFaixas.length > 0) {
      ({ resultadosFaixasExistentes } = await processarFaixasDoAlbum(
        novasFaixas,
        albumFullTitle,
        artistaAlbum,
        novaCapaUrl,
        jogadorId,
        dataFormatada,
      ));

      // Soma a quantidade de faixas novas ao total já registrado em
      // "EDIÇÃO CHARTS ÁLBUMS" (coluna E), em vez de sobrescrever.
      try {
        const edicaoMatches = await googleSheetsService.edicaoCharts.findRows(
          "EDIÇÃO CHARTS ÁLBUMS",
          (row) => (row[3] || "").trim().toLowerCase() === albumFullTitle.toLowerCase(),
        );
        for (const { rowIndex: edicaoRowIndex, row } of edicaoMatches) {
          const totalAtual = parseInt((row[4] || "0").replace(/\D/g, ""), 10) || 0;
          await googleSheetsService.edicaoCharts.updateValues(
            "EDIÇÃO CHARTS ÁLBUMS",
            `E${edicaoRowIndex}`,
            [[String(totalAtual + novasFaixas.length)]],
          );
        }
      } catch (err) {
        console.warn("[substituirAlbumController] Erro ao atualizar EDIÇÃO CHARTS ÁLBUMS:", err);
      }
    }

    // REGISTRO é só pra comentários de OUTROS jogadores (ver
    // forumController.ts) — adicionar faixa/lançar conteúdo não é
    // comentário, então não gera mais registro aqui (correção de um
    // desenho anterior que tratava lançamento como se fosse comentário).

    const faixasCriadas = resultadosFaixasExistentes.filter((f) => f.criada).map((f) => f.titulo);
    const faixasFalhas = resultadosFaixasExistentes.filter((f) => !f.ok).map((f) => f.titulo);
    let mensagem = "Álbum atualizado com sucesso!";
    if (faixasCriadas.length > 0) {
      mensagem += ` Atenção: "${faixasCriadas.join('", "')}" não tinha registro individual (migração antiga) — foi criada como faixa pendente, sem tópico ainda; publique quando quiser abrir o tópico dela.`;
    }
    if (faixasFalhas.length > 0) {
      mensagem += ` Falha ao vincular: "${faixasFalhas.join('", "')}".`;
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: { titulo: albumFullTitle, mensagem, faixasCriadas, faixasFalhas },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[substituirAlbumController] Erro:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Erro ao substituir álbum.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

// Controller para Criar / Registrar Álbum
export async function createAlbumController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as CreateAlbumPayload;

    const {
      tituloAlbum,
      artistaAlbum,
      tipoAlbum = "Álbum",
      capaUrl,
      encartesUrls = [],
      nomeJogador,
      jogadorId = "",
      faixas = [],
    } = body;

    if (!tituloAlbum || !artistaAlbum || !nomeJogador) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Campos obrigatórios ausentes: tituloAlbum, artistaAlbum, nomeJogador.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const nowStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const dataFormatada = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    // Mesma rede de segurança contra "Artista - Artista - Título" das
    // demais categorias.
    const albumArtistPrefix = `${artistaAlbum} - `;
    const tituloAlbumLimpo = tituloAlbum.toLowerCase().startsWith(albumArtistPrefix.toLowerCase())
      ? tituloAlbum.slice(albumArtistPrefix.length).trim()
      : tituloAlbum;
    const albumFullTitle = `${artistaAlbum} - ${tituloAlbumLimpo}`;
    const encartesStr = encartesUrls.join(", ");
    const albumTopicId = `album_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 1. Processar cada faixa (existente ou inédita).
    const { faixasIneditasEsperadas, faixasIneditasGravadas } = await processarFaixasDoAlbum(
      faixas,
      albumFullTitle,
      artistaAlbum,
      capaUrl,
      jogadorId,
      dataFormatada,
    );

    // 2. Gravar Álbum na planilha principal — SEM engolir erro: se isso
    // falhar, o álbum não existe de verdade no app (some do catálogo/Fórum
    // mesmo as faixas tendo sido processadas), então precisa propagar pro
    // catch de fora e responder success:false — antes isso era só um
    // console.warn e a resposta final sempre dizia "sucesso", mesmo com o
    // álbum nunca tendo sido de fato registrado.
    // Range explícito (A:K) — mesma classe de bug de "próxima linha livre"
    // corrigida em registrarNaEdicaoCharts logo abaixo.
    const albumRowIndexNovo = await googleSheetsService.principal.appendRow(
      "Albuns",
      [
        dataFormatada, // A - Data de lançamento
        albumTopicId, // B - ID do tópico
        capaUrl || "", // C - Capa
        albumTopicId, // D - Comentários para / Referente ao tópico
        jogadorId || "", // E - ID do Criador
        nomeJogador, // F - Nome do criador
        albumFullTitle, // G - Novo Nome
        "", // H - Metacritic por jogador
        "", // I - Média Metacritic
        encartesStr, // J - Encarte
        tipoAlbum, // K - Tipo (EP/Álbum/Deluxe)
      ],
      "A:K",
    );

    // 3. Gravar em "EDIÇÃO CHARTS ÁLBUMS" (edicaoCharts) — aba separada da
    // "EDIÇÃO CHARTS" usada pelas faixas, confirmada via dump ao vivo. Já
    // inclui o "Código único" (coluna R, padrão EMPALBM001, EMPALBM002...)
    // — antes essa coluna ficava sempre em branco pra álbum lançado pelo
    // app, só os legados/manuais tinham código.
    let codigoUnicoAlbum = "";
    try {
      const tipoNum = tipoAlbum.trim().toUpperCase() === "EP" ? "1" : "2";
      const codigoUnico = await gerarProximoCodigoUnico("EDIÇÃO CHARTS ÁLBUMS", "EMPALBM", 3);
      codigoUnicoAlbum = codigoUnico;
      // NÃO usa appendRow/:append — mesmo motivo de registrarNaEdicaoCharts
      // acima (confirmado ao vivo: faixa de coluna explícita não impede o
      // Sheets de pular pra longe por causa das colunas de cálculo à
      // direita). Acha a última linha com NOME DO ALBUM de verdade
      // (coluna D) e escreve direto na seguinte via updateValues.
      const albunsRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS", "A2:D20000");
      let ultimaLinhaComAlbum = 1;
      for (let i = 0; i < albunsRows.length; i++) {
        if ((albunsRows[i]?.[3] || "").trim()) ultimaLinhaComAlbum = i + 2;
      }
      const linhaAlvoAlbum = ultimaLinhaComAlbum + 1;
      await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS ÁLBUMS", `A${linhaAlvoAlbum}:R${linhaAlvoAlbum}`, [
        [
          artistaAlbum, // A - ARTISTA
          dataFormatada, // B - DATA DE LANÇAMENTO
          "1", // C - NÚMERO DE SEMANAS
          albumFullTitle, // D - NOME DO ALBUM
          String(faixas.length), // E - NÚMERO DE FAIXAS
          tipoNum, // F - TIPO DE ÁLBUM (2 = Álbum/Deluxe, 1 = EP)
          "", "", "", "", "", "", "", "", "", "", // G-P (streams/vendas/certificação/multiplicador — calculados à parte)
          "", // Q - CÁLCULO 1
          codigoUnico, // R - Código único
        ],
      ]);
      // Como esse código é gerado pelo próprio app (não por fórmula), já
      // temos o valor em mãos — leva a mesma cópia pro catálogo (Albuns!L),
      // sem precisar reler nada.
      if (albumRowIndexNovo) {
        await googleSheetsService.principal
          .updateValues("Albuns", `L${albumRowIndexNovo}`, [[codigoUnico]])
          .catch((err) => console.warn("[createAlbumController] Erro ao copiar Código único pra Albuns!L:", err));
      }
    } catch (err) {
      console.warn("[createAlbumController] Erro ao gravar em EDIÇÃO CHARTS ÁLBUMS:", err);
    }

    // REGISTRO é só pra comentários de OUTROS jogadores (ver
    // forumController.ts) — lançar o próprio álbum não é comentário.

    await somarPrestigio({ telegramId: jogadorId, usuario: nomeJogador }, "publicar_lancamento").catch(() => {});

    // Se alguma faixa inédita falhou ao gravar, o álbum FOI registrado (ele
    // existe), mas com menos faixas do que o pedido — avisa isso na
    // resposta em vez de dizer "sucesso" sem ressalva, pra não esconder
    // faixa que sumiu silenciosamente.
    const faixasIneditasFalharam = faixasIneditasEsperadas - faixasIneditasGravadas;

    registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Álbum "${albumFullTitle}" lançado por ${artistaAlbum} (${faixas.length} faixa(s)).`,
      onde: "createAlbumController",
    }).catch(() => {});

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          titulo: albumFullTitle,
          artista: artistaAlbum,
          totalFaixas: faixas.length,
          faixasIneditasGravadas,
          faixasIneditasEsperadas,
          codigoUnico: codigoUnicoAlbum,
          mensagem:
            faixasIneditasFalharam > 0
              ? `Álbum registrado, mas ${faixasIneditasFalharam} faixa(s) inédita(s) falharam ao gravar — confira e adicione de novo se precisar.`
              : "Álbum e faixas registrados com sucesso!",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[createAlbumController] Erro:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Erro ao processar lançamento de álbum.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

// Controller para Upload de Capa / Encartes no Google Drive
export async function uploadDriveController(request: Request): Promise<Response> {
  try {
    let fileName = "";
    let mimeType = "image/jpeg";
    let base64Data = "";
    let folderType: UploadFolderType = "musica";

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      fileName = String(formData.get("fileName") || file?.name || `file_${Date.now()}.jpg`);
      folderType = (formData.get("folderType") as any) || "musica";
      mimeType = file?.type || "image/jpeg";

      if (file && file.size > 0) {
        const arrayBuffer = await file.arrayBuffer();
        base64Data = Buffer.from(arrayBuffer).toString("base64");
      }
    } else {
      const body = (await request.json().catch(() => ({}))) as UploadPayload;
      fileName = body.fileName || "";
      mimeType = body.mimeType || "image/jpeg";
      base64Data = body.base64Data || "";
      folderType = body.folderType || "musica";
    }

    if (!fileName && !base64Data) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Arquivo ou dados do upload são obrigatórios.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const folderId =
      folderType === "album"
        ? DRIVE_FOLDERS.albuns
        : folderType === "musicVideo"
          ? DRIVE_FOLDERS.musicVideos
          : folderType === "video"
            ? DRIVE_FOLDERS.videos
            : folderType === "musicaAudio"
              ? DRIVE_FOLDERS.musicasAudio
              : folderType === "socialPosts"
                ? DRIVE_FOLDERS.socialPosts
                : folderType === "socialStories"
                  ? DRIVE_FOLDERS.socialStories
                  : folderType === "socialAvatars"
                    ? DRIVE_FOLDERS.socialAvatars
                    : folderType === "socialNews"
                      ? DRIVE_FOLDERS.socialNews
                      : folderType === "playerAvatars"
                        ? DRIVE_FOLDERS.playerAvatars
                        : folderType === "artistPhotos"
                          ? DRIVE_FOLDERS.artistPhotos
                          : folderType === "playlistTracks"
                          ? DRIVE_FOLDERS.playlistTracks
                          : folderType === "tvChatGifs"
                            ? DRIVE_FOLDERS.tvChatGifs
                            : folderType === "turnes"
                              // Sem pasta própria ainda — reaproveita a de
                              // posts sociais (mesmo padrão do artistPhotos
                              // acima) até existir uma pasta dedicada.
                              ? DRIVE_FOLDERS.socialPosts
                              : folderType === "acervo"
                                ? DRIVE_FOLDERS.acervo
                                : folderType === "materiaisMusica"
                                  ? DRIVE_FOLDERS.materiaisMusica
                                  : folderType === "materiaisAlbum"
                                    ? DRIVE_FOLDERS.materiaisAlbum
                                    : DRIVE_FOLDERS.musicas;

    const fileUrl = base64Data
      ? await uploadFileToDrive(fileName, folderId, mimeType, base64Data)
      : `https://drive.google.com/drive/folders/${folderId}`;

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          fileName,
          fileUrl,
          folderType,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[uploadDriveController] Erro:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Falha ao enviar o arquivo para o Google Drive.",
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}
