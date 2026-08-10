import { googleSheetsService } from "../services/googleSheetsService";
import { DRIVE_FOLDERS, uploadFileToDrive } from "../services/googleDriveService";

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
  titulo: string;
  inedita: boolean;
  tipoSingle?: string;
  tipoMusica?: string;
}

export interface CreateAlbumPayload {
  tituloAlbum: string;
  artistaAlbum: string;
  capaUrl: string;
  encartesUrls?: string[];
  nomeJogador: string;
  jogadorId?: string;
  faixas: TrackItemPayload[];
}

export interface UploadPayload {
  fileName: string;
  mimeType: string;
  base64Data: string;
  folderType: "musica" | "album" | "video" | "musicVideo";
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
      await googleSheetsService.registrosCharts.appendRow("REGISTRO", [
        nowStr,
        nomeJogador,
        fullTitle,
        "COMENTÁRIOS (SINGLES, VÍDEOS, MÚSICAS)",
        musicaReferencia || "",
      ]);
    } catch (err) {
      console.warn("[createSongController] Erro ao gravar no Audit Log REGISTRO:", err);
    }

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
      ]);
    } catch (err) {
      console.warn("[createVideoController] Erro ao gravar em Music Videos:", err);
    }

    // 2. Audit Log em REGISTRO
    try {
      await googleSheetsService.registrosCharts.appendRow("REGISTRO", [
        nowStr,
        nomeJogador,
        fullTitle,
        "COMENTÁRIOS (SINGLES, VÍDEOS, MÚSICAS)",
      ]);
    } catch (err) {
      console.warn("[createVideoController] Erro no audit log:", err);
    }

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

// Controller para Criar / Registrar Álbum
export async function createAlbumController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as CreateAlbumPayload;

    const {
      tituloAlbum,
      artistaAlbum,
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
    // demais categorias — aqui não havia nenhuma checagem antes.
    const albumArtistPrefix = `${artistaAlbum} - `;
    const tituloAlbumLimpo = tituloAlbum.toLowerCase().startsWith(albumArtistPrefix.toLowerCase())
      ? tituloAlbum.slice(albumArtistPrefix.length).trim()
      : tituloAlbum;
    const albumFullTitle = `${artistaAlbum} - ${tituloAlbumLimpo}`;
    const encartesStr = encartesUrls.join(", ");
    const albumTopicId = `album_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 1. Processar faixas inéditas: registrar em 'Musicas' com Pendente? = "Sim".
    // Mesmo mapeamento de 24 colunas do createSongController, mas com o nome
    // do álbum na coluna K (ALBUM) em vez de referência a tópico em F — a
    // faixa fica pendente até o jogador promovê-la a tópico próprio.
    for (const faixa of faixas) {
      if (faixa.inedita) {
        const songTitle = faixa.titulo.includes(" - ")
          ? faixa.titulo
          : `${artistaAlbum} - ${faixa.titulo}`;

        try {
          await googleSheetsService.principal.appendRow("Musicas", [
            dataFormatada, // A - Data de lançamento
            "", // B - ID do tópico (nenhum: faixa não vira tópico próprio ainda)
            "", // C - ID do arquivo
            capaUrl || "", // D - Capa da música
            "", // E - Letra
            "", // F - Comentários para
            "", // G - ID do Criador
            songTitle, // H - Nome da música
            faixa.tipoSingle || "TRACKLIST ALBUM", // I - TIPO DE SINGLE
            faixa.tipoMusica || "SOLO", // J - TIPO DE MÚSICA
            albumFullTitle, // K - ALBUM
            "", // L - WEEKS
            "", // M - WEEKS VIDEO
            artistaAlbum, // N - ACT PRINCIPAL
            "", // O - ARTISTA 2
            "", // P - ARTISTA 3
            "", // Q - ARTISTA 4
            "", // R - ARTISTA 5
            "", // S - ARTISTA 6
            "", // T - GÊNERO
            String(faixa.num || ""), // U - Ordem
            "", // V - Metacritic por jogador
            "", // W - Média Metacritic
            "Sim", // X - Pendente?
          ]);

          await googleSheetsService.registrosCharts.appendRow("REGISTRO DE MÚSICA", [
            nowStr,
            nomeJogador,
            songTitle,
            "Música Inédita do Álbum",
            capaUrl || "",
          ]);
        } catch (faixaErr) {
          console.warn("[createAlbumController] Erro ao registrar faixa inédita:", faixaErr);
        }
      }
    }

    // 2. Gravar Álbum na planilha principal — mapeamento exato do cabeçalho
    // oficial (Data, ID do tópico, Capa, Comentários para, ID do Criador,
    // Nome do criador, Nome, Metacritic por jogador, Média Metacritic,
    // Encarte, Tipo).
    try {
      await googleSheetsService.principal.appendRow("Albuns", [
        dataFormatada, // A - Data de lançamento
        albumTopicId, // B - ID do tópico
        capaUrl || "", // C - Capa
        albumTopicId, // D - Comentários para
        jogadorId || "", // E - ID do Criador
        nomeJogador, // F - Nome do criador
        albumFullTitle, // G - Nome
        "", // H - Metacritic por jogador
        "", // I - Média Metacritic
        encartesStr, // J - Encarte
        "", // K - Tipo (EP/Álbum/Deluxe — não informado no formulário atual)
      ]);
    } catch (err) {
      console.warn("[createAlbumController] Erro ao gravar em Albuns (Principal):", err);
    }

    // 3. Gravar Audit Log na planilha de Registros
    try {
      await googleSheetsService.registrosCharts.appendRow("REGISTRO", [
        nowStr,
        nomeJogador,
        `(ALBUM) — ${albumFullTitle}`,
        "COMENTÁRIOS (TODOS OS TIPOS DE ÁLBUM)",
      ]);
    } catch (err) {
      console.warn("[createAlbumController] Erro ao gravar Audit Log de Álbum:", err);
    }

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
    let folderType: "musica" | "musicaAudio" | "album" | "video" | "musicVideo" = "musica";

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
