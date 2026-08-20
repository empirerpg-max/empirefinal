import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";
import { DRIVE_FOLDERS, uploadFileToDrive } from "../services/googleDriveService";
import { registrarAuditLog } from "./registroLogController";
import { somarPrestigio } from "../services/prestigioService";

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
  musicaVinculada?: string;
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
  | "acervo";

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
    try {
      await googleSheetsService.principal.appendRow("Musicas", [
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

    // 3. Gravar Audit Log na aba REGISTRO
    try {
      await registrarAuditLog({
        nomeJogador,
        titulo: fullTitle,
        tipo: "COMENTÁRIOS (SINGLES, VÍDEOS, MÚSICAS)",
      });
    } catch (err) {
      console.warn("[createSongController] Erro ao gravar no Audit Log REGISTRO:", err);
    }

    await somarPrestigio({ telegramId: jogadorId, usuario: nomeJogador }, "publicar_lancamento").catch(() => {});

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          titulo: fullTitle,
          artistaPrincipal,
          nomeJogador,
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
async function marcarVideoclipeNaPontos(musicaVinculada: string, dataFormatada: string) {
  if (!musicaVinculada.trim()) return;
  try {
    const matches = await googleSheetsService.registrosCharts.findRows(
      "Pontos",
      (row) => (row[3] || "").trim().toLowerCase() === musicaVinculada.trim().toLowerCase(),
    );
    if (matches.length === 0) {
      console.warn(`[marcarVideoclipeNaPontos] Música não encontrada na aba Pontos: ${musicaVinculada}`);
      return;
    }
    for (const { rowIndex } of matches) {
      await googleSheetsService.registrosCharts.updateValues("Pontos", `N${rowIndex}:O${rowIndex}`, [
        ["TRUE", dataFormatada],
      ]);
    }
  } catch (err) {
    console.warn("[marcarVideoclipeNaPontos] Erro ao atualizar aba Pontos:", err);
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

    const nowStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const dataFormatada = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const fullTitle = tituloVideo.includes(" - ")
      ? tituloVideo
      : `${artistaResponsavel} - ${tituloVideo}`;
    const topicId = `video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tipo = tipoVideo || categoriaVideo || "Video";

    // 1. Gravar em Music Videos na planilha principal — "Videos" e "Music
    // Video" foram unificados numa única aba/formulário de Gestão; a tag
    // ("Tipo de vídeo") vinda do formulário define a categoria exibida no
    // catálogo (incluindo "Music Video" como uma das opções).
    try {
      await googleSheetsService.principal.appendRow("Music Videos", [
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
        musicaVinculada || fullTitle, // P - Nome original nos charts
        "", // Q - ID da mensagem (reconvertido)
        "", // R - Status da reconversão
        "", // S - Reportado em
        capaUrl || "", // T - Thumb (vira a capa/fundo do vídeo no catálogo)
      ]);
    } catch (err) {
      console.warn("[createVideoController] Erro ao gravar em Music Videos:", err);
    }

    // 2. Audit Log em REGISTRO
    try {
      await registrarAuditLog({
        nomeJogador,
        titulo: fullTitle,
        tipo: "COMENTÁRIOS (SINGLES, VÍDEOS, MÚSICAS)",
      });
    } catch (err) {
      console.warn("[createVideoController] Erro no audit log:", err);
    }

    await somarPrestigio({ usuario: nomeJogador }, "publicar_lancamento").catch(() => {});

    // 3. Quando o tipo selecionado for "Music Video", marcar o lançamento
    // do videoclipe na aba "Pontos" (coluna N) com a data de envio (coluna O).
    if (tipo.trim().toLowerCase() === "music video" && musicaVinculada) {
      await marcarVideoclipeNaPontos(musicaVinculada, dataFormatada);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          titulo: fullTitle,
          artistaResponsavel,
          mensagem: "Vídeo cadastrado com sucesso!",
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

    try {
      await googleSheetsService.principal.appendRow("Musicas", [
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
    } catch (faixaErr) {
      console.warn("[processarFaixasDoAlbum] Erro ao registrar faixa inédita em Musicas:", faixaErr);
    }

    // REGISTRO DE MÚSICA — mesmo mapeamento B:P do createSongController,
    // mas com E = nome do álbum (aqui nunca fica em branco, diferente do
    // registro de música avulsa).
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

      await googleSheetsService.registrosCharts.updateValues(
        "REGISTRO DE MÚSICA",
        `B${targetRow}:P${targetRow}`,
        [
          [
            songTitle, // B - Título
            faixa.tipoSingle || "TRACKLIST ALBUM", // C - Tipo de Single
            faixa.tipoMusica || "SOLO", // D - Tipo de Música
            albumFullTitle, // E - ÁLBUM
            "", // F
            "", // G
            artistaAlbum, // H - ACT PRINCIPAL
            participantesLimpos[0] || "", // I - Artista 2
            participantesLimpos[1] || "", // J - Artista 3
            participantesLimpos[2] || "", // K - Artista 4
            participantesLimpos[3] || "", // L - Artista 5
            participantesLimpos[4] || "", // M - Artista 6
            "Não", // N - SUBSTITUIR NOS CHARTS?
            "", // O - Por qual música?
            "OK", // P - ENVIAR
          ],
        ],
      );
    } catch (err) {
      console.warn("[processarFaixasDoAlbum] Erro ao gravar em REGISTRO DE MÚSICA:", err);
    }
  }

  return resultadosFaixasExistentes;
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
    };
    const musicaRowIndex = Number(body.musicaRowIndex);
    const nomeJogador = (body.nomeJogador || "").trim();
    const jogadorId = (body.jogadorId || "").trim();

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

    try {
      await registrarAuditLog({
        nomeJogador,
        titulo: fullTitle,
        tipo: "COMENTÁRIOS (SINGLES, VÍDEOS, MÚSICAS)",
      });
    } catch (err) {
      console.warn("[publicarFaixaPendenteController] Erro ao gravar Audit Log:", err);
    }

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
      resultadosFaixasExistentes = await processarFaixasDoAlbum(
        novasFaixas,
        albumFullTitle,
        artistaAlbum,
        novaCapaUrl,
        jogadorId,
        dataFormatada,
      );

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

    // Só grava em REGISTRO quando pelo menos uma faixa INÉDITA foi
    // publicada — isso sim é um lançamento de conteúdo novo. Editar o
    // álbum (trocar capa/encarte) ou só vincular uma faixa que já existia
    // no chart não é lançamento nenhum, e não deve gerar registro.
    const temFaixaInedita = novasFaixas.some((f) => f.inedita);
    if (temFaixaInedita) {
      try {
        await registrarAuditLog({
          nomeJogador,
          titulo: albumFullTitle,
          tipo: "COMENTÁRIOS (TODOS OS TIPOS DE ÁLBUM)",
          isAlbum: true,
        });
      } catch (err) {
        console.warn("[substituirAlbumController] Erro ao gravar Audit Log:", err);
      }
    }

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
    await processarFaixasDoAlbum(faixas, albumFullTitle, artistaAlbum, capaUrl, jogadorId, dataFormatada);

    // 2. Gravar Álbum na planilha principal.
    try {
      await googleSheetsService.principal.appendRow("Albuns", [
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
      ]);
    } catch (err) {
      console.warn("[createAlbumController] Erro ao gravar em Albuns (Principal):", err);
    }

    // 3. Gravar em "EDIÇÃO CHARTS ÁLBUMS" (edicaoCharts) — aba separada da
    // "EDIÇÃO CHARTS" usada pelas faixas, confirmada via dump ao vivo.
    try {
      const tipoNum = tipoAlbum.trim().toUpperCase() === "EP" ? "1" : "2";
      await googleSheetsService.edicaoCharts.appendRow("EDIÇÃO CHARTS ÁLBUMS", [
        artistaAlbum, // A - ARTISTA
        dataFormatada, // B - DATA DE LANÇAMENTO
        "1", // C - NÚMERO DE SEMANAS
        albumFullTitle, // D - NOME DO ALBUM
        String(faixas.length), // E - NÚMERO DE FAIXAS
        tipoNum, // F - TIPO DE ÁLBUM (2 = Álbum/Deluxe, 1 = EP)
      ]);
    } catch (err) {
      console.warn("[createAlbumController] Erro ao gravar em EDIÇÃO CHARTS ÁLBUMS:", err);
    }

    // 4. Gravar Audit Log na planilha de Registros
    try {
      await registrarAuditLog({
        nomeJogador,
        titulo: albumFullTitle,
        tipo: "COMENTÁRIOS (TODOS OS TIPOS DE ÁLBUM)",
        isAlbum: true,
      });
    } catch (err) {
      console.warn("[createAlbumController] Erro ao gravar Audit Log de Álbum:", err);
    }

    await somarPrestigio({ telegramId: jogadorId, usuario: nomeJogador }, "publicar_lancamento").catch(() => {});

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          titulo: albumFullTitle,
          artista: artistaAlbum,
          totalFaixas: faixas.length,
          mensagem: "Álbum e faixas registrados com sucesso!",
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
                          // Sem pasta própria ainda — reaproveita a de fotos
                          // de perfil de jogador até existir uma dedicada.
                          ? DRIVE_FOLDERS.playerAvatars
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
