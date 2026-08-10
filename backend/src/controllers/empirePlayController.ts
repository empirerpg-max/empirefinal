import { sheetsService } from "../services/sheetsService";
import {
  normalizeComparison,
  normalizeHeader,
  normalizeText,
  dedupeHeaders,
  SheetRecord,
} from "../services/googleSheetsService";
import { getUserProfile } from "./userController";

/**
 * Igual a sheetsService.readSheetObjects, mas preserva o número real da
 * linha na planilha (1-based) em cada registro — necessário pra depois
 * conseguir escrever de volta na célula certa (ex: reações de comentário),
 * já que readSheetObjects descarta essa informação.
 */
async function readSheetObjectsWithRowIndex(
  sheetName: string,
): Promise<{ rec: SheetRecord; rowIndex: number }[]> {
  const rawRows = await sheetsService.readValues(sheetName).catch(() => []);
  if (!rawRows || rawRows.length < 2) return [];
  const headers = dedupeHeaders(
    sheetName,
    rawRows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const out: { rec: SheetRecord; rowIndex: number }[] = [];
  rawRows.slice(1).forEach((row, i) => {
    if (!row.some((cell) => normalizeText(cell))) return;
    const rec: SheetRecord = {};
    headers.forEach((h, hi) => {
      rec[h] = normalizeText(row[hi]);
    });
    out.push({ rec, rowIndex: i + 2 });
  });
  return out;
}

export interface EmpirePlayCleanItem {
  id: string;
  type: string;
  title: string;
  artist: string;
  album?: string | null;
  coverUrl?: string | null;
  audioUrl?: string | null;
  videoUrl?: string | null;
  videoSource?: "youtube" | "vimeo" | "drive" | "telegram" | null;
  // ID da mensagem no grupo de arquivo do Telegram (já resolvido com a
  // prioridade certa por resolveVideoUrlAndSource — inclui a versão
  // reconvertida quando existir). Usado pelo botão "Reportar problema".
  telegramMessageId?: string | null;
  // true enquanto o vídeo está com reprocessamento em andamento (coluna
  // "Reportado em" preenchida há menos de 6h) — desabilita o botão no app.
  reportPending?: boolean;
  telegramTopicId?: string | null;
  topicId?: string | null;
  releaseDate?: string | null;
  releaseDateIso?: string | null;
  releaseMonth?: string | null;
  position?: number | null;
  metacriticAvg?: number | string | null;
  lyrics?: string | null;
  description?: string | null;
  category?: string | null;
  trackOrder?: number | null;
}

export interface EmpirePlayCleanAlbumTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  trackOrder: number;
  coverUrl?: string | null;
  audioUrl?: string | null;
  releaseDate?: string | null;
  lyrics?: string | null;
}

export interface EmpirePlayCleanAlbum {
  id: string;
  title: string;
  artist: string;
  coverUrl?: string | null;
  releaseDate?: string | null;
  releaseDateIso?: string | null;
  metacriticAvg?: number | string | null;
  tracks: EmpirePlayCleanAlbumTrack[];
}

export interface ForumComment {
  id?: string;
  timestamp: string;
  title: string;
  player: string;
  comment: string;
  rating: number | string | null;
}

function getValue(record: SheetRecord, aliases: string[]): string | null {
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const value = record[normalizedAlias];
    if (normalizeText(value)) {
      return normalizeText(value);
    }
  }
  return null;
}

function getValueWithAlias(
  record: SheetRecord,
  aliases: string[],
): { value: string; alias: string } | null {
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const value = record[normalizedAlias];
    if (normalizeText(value)) {
      return { value: normalizeText(value) as string, alias };
    }
  }
  return null;
}

/**
 * Determina a fonte real do vídeo (youtube/drive/telegram) a partir do valor
 * bruto e de qual coluna da planilha ele veio. Usado apenas como fallback
 * quando a linha não tem a coluna "arquivo_fonte" preenchida.
 */
function resolveVideoSource(
  value: string,
  matchedAlias: string,
): "youtube" | "vimeo" | "drive" | "telegram" | null {
  if (/youtube\.com|youtu\.be/i.test(value)) return "youtube";
  if (/vimeo\.com/i.test(value)) return "vimeo";
  if (/drive\.google\.com/i.test(value)) return "drive";
  if (/^(https?:\/\/)?t\.me\//i.test(value)) return "telegram";

  const alias = matchedAlias.toLowerCase();
  if (alias.includes("telegram")) return "telegram";
  if (alias.includes("drive")) return "drive";
  if (alias.includes("vimeo")) return "vimeo";
  if (alias.includes("youtube")) return "youtube";

  return null;
}

/**
 * Resolve o link/token de reprodução do vídeo e sua fonte.
 *
 * Conforme o mapeamento oficial da planilha: a coluna "arquivo_fonte" é o
 * sinal AUTORITATIVO de qual coluna contém o dado certo — nunca deve ser
 * adivinhado por conteúdo. Na aba "Music Videos" cada fonte tem sua própria
 * coluna (telegram_file_id / drive_url / youtube_url); na aba "Videos" as
 * três fontes compartilham uma única coluna genérica ("ID do arquivo").
 */
function resolveVideoUrlAndSource(record: SheetRecord): {
  videoUrl: string | null;
  videoSource: "youtube" | "vimeo" | "drive" | "telegram" | null;
} {
  const explicitFonte = normalizeComparison(getValue(record, ["arquivo_fonte", "fonte"]) || "");

  if (
    explicitFonte === "telegram" ||
    explicitFonte === "drive" ||
    explicitFonte === "youtube" ||
    explicitFonte === "vimeo"
  ) {
    const specificAliases: Record<string, string[]> = {
      // "ID da mensagem (reconvertido)" é preenchida pelo script de
      // reconversão (telegram-media/scripts/retranscode-videos.ts): aponta
      // pra uma cópia leve/compatível do mesmo vídeo, já reenviada ao grupo
      // de arquivo. Tem prioridade máxima — assim que um vídeo é
      // reconvertido, o app passa a servir a cópia leve automaticamente.
      //
      // A aba "Music Videos" também tem DUAS colunas "ID da mensagem": a
      // primeira (logo após o título) é o ID no grupo ORIGINAL do Telegram;
      // a segunda (logo após "fonte", sufixada "id_da_mensagem_2" pelo
      // dedupeHeaders) é o ID no grupo de ARQUIVO — o único que o serviço
      // de streaming (telegram-media) realmente lê, já que o proxy do
      // Worker nunca envia um chatId alternativo. Por isso ela tem
      // prioridade sobre a primeira; a primeira coluna não serve pra tocar
      // o vídeo.
      telegram: [
        "id_da_mensagem_reconvertido",
        "id_da_mensagem_2",
        "message_id",
        "id_mensagem",
        "id_da_mensagem",
        "telegram_file_id",
        "id_do_arquivo",
      ],
      // "link_do_video" (coluna "Link do vídeo" da aba Music Videos) é onde
      // o Gestão grava o link de vídeos enviados direto pelo app ao Drive —
      // não há uma coluna "drive_url" dedicada nessa aba.
      drive: ["drive_url", "link_do_video", "id_do_arquivo"],
      youtube: ["youtube_url", "link_do_video", "id_do_arquivo"],
      vimeo: ["vimeo_url", "link_do_video", "id_do_arquivo"],
    };
    const value = getValue(record, specificAliases[explicitFonte]);
    return {
      videoUrl: value,
      videoSource: value ? (explicitFonte as "youtube" | "vimeo" | "drive" | "telegram") : null,
    };
  }

  // Sem "arquivo_fonte" preenchido: cai para a heurística por conteúdo/coluna
  const videoUrlAliases = [
    "id_do_arquivo",
    "youtube_url",
    "drive_url",
    "telegram_file_id",
    "video_url",
    "link_do_video",
    "link_video",
    "link",
  ];
  const match = getValueWithAlias(record, videoUrlAliases);
  if (!match) return { videoUrl: null, videoSource: null };
  return { videoUrl: match.value, videoSource: resolveVideoSource(match.value, match.alias) };
}

function parseDateToIso(value: string | null): string | null {
  if (!value) return null;

  const ddmmyyyy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const yyyymmdd = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (yyyymmdd) {
    return `${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

const REPORT_PENDING_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * A coluna "Reportado em" (ISO, gravada por reportVideoController) marca um
 * reprocessamento em andamento. O script de reconversão a limpa assim que
 * termina; a janela de 6h aqui é só uma rede de segurança caso o workflow
 * nunca rode ou falhe silenciosamente, pra o botão não travar pra sempre.
 */
function isReportPending(reportedAtRaw: string | null): boolean {
  if (!reportedAtRaw) return false;
  const reportedAt = new Date(reportedAtRaw);
  if (Number.isNaN(reportedAt.getTime())) return false;
  return Date.now() - reportedAt.getTime() < REPORT_PENDING_WINDOW_MS;
}

function extractReleaseMonth(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const [year, month] = isoDate.split("-");
  return `${month}/${year}`;
}

function matchesMonth(isoDate: string | null, requestedMonth?: string): boolean {
  if (!requestedMonth) return true;
  if (!isoDate) return false;

  const filter = requestedMonth.trim();
  const [year, month] = isoDate.split("-");
  const mmYyyy = `${month}/${year}`;
  const yyyyMm = `${year}-${month}`;

  return (
    filter === mmYyyy || filter === yyyyMm || filter === `${month}-${year}` || filter === month
  );
}

/**
 * Converte um registro bruto da planilha em objeto de domínio limpo do produto (camelCase)
 * sem metadados internos (telegram_file_id, drive_folder_id, etc)
 */
function buildCleanItem(
  sheetName: string,
  record: SheetRecord,
  index: number,
): EmpirePlayCleanItem {
  let title = getValue(record, [
    "nome_da_musica",
    "nome_do_video",
    "nome_do_album",
    "nome",
    "titulo",
    "titulo_do_video",
    "titulo_do_album",
    "musica",
  ]);

  let artist = getValue(record, [
    "act_principal",
    "artista",
    "nome_do_criador",
    "nome_do_artista",
    "act",
    "enviado_por",
    "id_do_criador",
  ]);

  // A aba "Music Videos" (Vídeos + Music Videos consolidados) não tem
  // colunas dedicadas de título/artista — o jogador nomeia o tópico do
  // Telegram como "Artista - Nome do vídeo" e é esse texto (coluna "Título
  // do tópico") que carrega os dois dados. Checa a presença da própria
  // coluna em vez do nome do sheetName (que agora também pode ser "Videos",
  // já que os dois catálogos foram unificados na mesma aba real).
  if (!title || !artist) {
    const topicTitle = getValue(record, ["titulo_do_topico"]);
    const dashMatch = topicTitle?.match(/^(.+?)\s[-–—]\s(.+)$/);
    if (dashMatch) {
      if (!artist) artist = dashMatch[1].trim();
      if (!title) title = dashMatch[2].trim();
    } else if (!title && topicTitle) {
      title = topicTitle;
    }
  }

  title = title || `Item ${index + 1}`;
  artist = artist || "Artista Independente";

  const album = getValue(record, ["album", "nome_do_album", "album_nome"]);
  const coverUrl = getValue(record, [
    "capa_da_musica",
    "capa_do_album",
    "thumb",
    "capa",
    "thumbnail_url",
    "imagem",
    "cover_url",
  ]);
  // "id_do_topico" NÃO deve entrar aqui: é um índice de referência interno,
  // nunca um link reproduzível. Usá-lo como fallback fazia linhas sem áudio/
  // vídeo preenchido (ex: aba Top_Videos_YT) tocarem o número do tópico como
  // se fosse uma URL — causa raiz de vídeos "quebrados" tipo "/28", "/30".
  const audioUrl = getValue(record, [
    "id_do_arquivo",
    "link_do_audio",
    "link_audio",
    "audio_url",
    "link",
    "drive_url",
    "youtube_url",
    "telegram_file_url",
  ]);
  const { videoUrl, videoSource } = resolveVideoUrlAndSource(record);
  const telegramMessageId = videoSource === "telegram" ? videoUrl : null;
  const reportPending = isReportPending(getValue(record, ["reportado_em"]));
  // Mesma prioridade do empireuploadsfinal/src/utils/mediaUtils.ts (getTelegramPostPath):
  // ref_telegram_id > telegram_topic_id > id.
  const telegramTopicId = getValue(record, [
    "ref_telegram_id",
    "telegram_topic_id",
    "id_do_topico",
    "message_thread_id",
  ]);
  const releaseDate = getValue(record, [
    "data_de_lancamento",
    "data_lancamento",
    "data",
    "data_de_publicacao",
    "data_do_envio",
  ]);
  const releaseDateIso = parseDateToIso(releaseDate);

  const positionValue = getValue(record, ["posicao", "posição"]);
  const position =
    positionValue && !Number.isNaN(Number(positionValue)) ? Number(positionValue) : null;

  const metacriticAvg = getValue(record, [
    "metacritic_avg",
    "metacritic",
    "media_metacritic",
    "media_critica",
    "nota_media",
    "media_likes",
    "media_like",
  ]);
  const lyrics = getValue(record, ["letra", "lyrics", "letra_da_musica"]);
  const description = getValue(record, ["descricao", "descrição", "description"]);
  const category = getValue(record, [
    "tipo_de_video",
    "categoria",
    "tipo_video",
    "categoria_video",
    "tipo",
  ]);

  const trackOrderValue = getValue(record, [
    "ordem",
    "ordem_da_faixa",
    "ordem_faixa",
    "track_number",
  ]);
  const trackOrder =
    trackOrderValue && !Number.isNaN(Number(trackOrderValue)) ? Number(trackOrderValue) : null;

  const item: EmpirePlayCleanItem = {
    id: `${sheetName.toLowerCase().replace(/\s+/g, "_")}_${index + 1}`,
    type: sheetName.toLowerCase().replace(/\s+/g, "-"),
    title,
    artist,
  };

  if (album) item.album = album;
  if (coverUrl) item.coverUrl = coverUrl;
  if (audioUrl) item.audioUrl = audioUrl;
  if (videoUrl) item.videoUrl = videoUrl;
  if (videoSource) item.videoSource = videoSource;
  if (telegramMessageId) item.telegramMessageId = telegramMessageId;
  if (reportPending) item.reportPending = true;
  if (telegramTopicId) item.telegramTopicId = telegramTopicId;
  if (releaseDate) item.releaseDate = releaseDate;
  if (releaseDateIso) {
    item.releaseDateIso = releaseDateIso;
    item.releaseMonth = extractReleaseMonth(releaseDateIso);
  }
  if (position !== null) item.position = position;
  if (metacriticAvg) item.metacriticAvg = metacriticAvg;
  if (lyrics) item.lyrics = lyrics;
  if (description) item.description = description;
  if (category) item.category = category;
  if (trackOrder !== null) item.trackOrder = trackOrder;

  return item;
}

/**
 * GET /api/empire-play/user
 * Lê o Telegram_ID do usuário autenticado no Empire Hub, faz a busca na Coluna B
 * da aba Jogadores e retorna apenas os dados do perfil (Nome do OFF e lista de Artistas).
 */
export async function getEmpirePlayUserController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("telegram_id") || url.searchParams.get("tgId");
  const fromHeader = request.headers.get("x-telegram-id");
  const telegramId = String(fromQuery || fromHeader || "").trim();

  try {
    const profile = await getUserProfile(telegramId);
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          playerName: profile.playerName,
          telegramId: profile.telegramId,
          artistName: profile.artistName,
          associatedArtists: profile.associatedArtists,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          playerName: "Jogador",
          telegramId: telegramId || "guest",
          artistName: "Artista Independente",
          associatedArtists: ["Artista Independente"],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

/**
 * GET /api/empire-play/home
 * Lê as abas Top_50_Spotify, Top_Songs_Apple_Music, Top_Videos_YT e os 30 lançamentos mais recentes
 * da aba Musicas (ordenados por data de lançamento).
 */
export async function getEmpirePlayHomeController(): Promise<Response> {
  try {
    const [spotifyRecords, appleRecords, youtubeRecords, musicaRecords] = await Promise.all([
      sheetsService.readSheetObjects("Top_50_Spotify").catch(() => []),
      sheetsService.readSheetObjects("Top_Songs_Apple_Music").catch(() => []),
      sheetsService.readSheetObjects("Top_Videos_YT").catch(() => []),
      sheetsService.readSheetObjects("Musicas").catch(() => []),
    ]);

    const topSpotify = spotifyRecords.map((rec, idx) => buildCleanItem("Top_50_Spotify", rec, idx));
    const topAppleMusic = appleRecords.map((rec, idx) =>
      buildCleanItem("Top_Songs_Apple_Music", rec, idx),
    );
    const topYoutube = youtubeRecords.map((rec, idx) => buildCleanItem("Top_Videos_YT", rec, idx));

    const recentMusicas = musicaRecords
      .map((rec, idx) => buildCleanItem("Musicas", rec, idx))
      .sort((a, b) => {
        if (a.releaseDateIso && b.releaseDateIso) {
          return b.releaseDateIso.localeCompare(a.releaseDateIso);
        }
        return b.id.localeCompare(a.id);
      })
      .slice(0, 100);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          topSpotify,
          topAppleMusic,
          topYoutube,
          recentMusicas,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Erro ao carregar dados da Home do Empire Play.",
      }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

/**
 * GET /api/empire-play/musicas
 * Lê a aba Musicas com suporte a busca textual e filtro por artista/mês.
 */
export async function getEmpirePlayMusicasController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const filterArtist = normalizeComparison(
    url.searchParams.get("artist") || url.searchParams.get("artista") || "",
  );
  const filterMonth = url.searchParams.get("month") || url.searchParams.get("mes") || "";
  const filterQuery = normalizeComparison(
    url.searchParams.get("q") ||
      url.searchParams.get("search") ||
      url.searchParams.get("busca") ||
      "",
  );

  try {
    const records = await sheetsService.readSheetObjects("Musicas");
    let items = records.map((rec, idx) => buildCleanItem("Musicas", rec, idx));

    if (filterArtist) {
      items = items.filter((item) => {
        const normArt = normalizeComparison(item.artist);
        return normArt.includes(filterArtist);
      });
    }

    if (filterMonth) {
      items = items.filter((item) => matchesMonth(item.releaseDateIso ?? null, filterMonth));
    }

    if (filterQuery) {
      items = items.filter((item) => {
        const haystack = normalizeComparison(
          [item.title, item.artist, item.album, item.lyrics, item.description]
            .filter(Boolean)
            .join(" "),
        );
        return haystack.includes(filterQuery);
      });
    }

    // Ordenar por data de lançamento (mais recente primeiro)
    items.sort((a, b) => {
      if (a.releaseDateIso && b.releaseDateIso) {
        return b.releaseDateIso.localeCompare(a.releaseDateIso);
      }
      return 0;
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: items,
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Erro ao buscar músicas.",
      }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

/**
 * GET /api/empire-play/videos
 * Lê a aba "Music Videos" — que, apesar do nome, hoje guarda TODOS os tipos
 * de vídeo (Music Video, Live, Video, Dance Video, Behind the Scenes,
 * Lyric Video, Visualizer, Trailer etc), diferenciados pela coluna "Tipo de
 * vídeo". As abas "Videos" e "Comentarios_Videos" que a spec original
 * previa não existem mais na planilha — foram todas consolidadas aqui. O
 * app trata isso como um catálogo único "Vídeos", filtrável por tag no
 * frontend (ou via ?category= aqui no backend).
 */
export async function getEmpirePlayVideosController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const filterArtist = normalizeComparison(
    url.searchParams.get("artist") || url.searchParams.get("artista") || "",
  );
  const filterQuery = normalizeComparison(
    url.searchParams.get("q") || url.searchParams.get("search") || "",
  );
  const filterCategory = normalizeComparison(
    url.searchParams.get("category") || url.searchParams.get("tipo_video") || "",
  );

  try {
    const records = await sheetsService.readSheetObjects("Music Videos");
    let items = records.map((rec, idx) => buildCleanItem("Videos", rec, idx));

    if (filterArtist) {
      items = items.filter((item) => normalizeComparison(item.artist).includes(filterArtist));
    }
    if (filterCategory) {
      items = items.filter((item) => normalizeComparison(item.category || "") === filterCategory);
    }
    if (filterQuery) {
      items = items.filter((item) => {
        const haystack = normalizeComparison(
          [item.title, item.artist, item.description].filter(Boolean).join(" "),
        );
        return haystack.includes(filterQuery);
      });
    }

    // Mais recente primeiro (Data do envio) — itens sem data ficam por
    // último, na ordem em que já vieram da planilha.
    items.sort((a, b) => {
      if (a.releaseDateIso && b.releaseDateIso) return b.releaseDateIso.localeCompare(a.releaseDateIso);
      if (a.releaseDateIso) return -1;
      if (b.releaseDateIso) return 1;
      return 0;
    });

    return new Response(JSON.stringify({ success: true, data: items }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao buscar vídeos." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

/**
 * GET /api/empire-play/albuns
 * Lê a aba Albuns e faz a junção com a aba Musicas onde a coluna ALBUM
 * for igual ao título do álbum, ordenando pela coluna Ordem.
 */
export async function getEmpirePlayAlbunsController(): Promise<Response> {
  try {
    const [albumRecords, songRecords] = await Promise.all([
      sheetsService.readSheetObjects("Albuns"),
      sheetsService.readSheetObjects("Musicas"),
    ]);

    const songs = songRecords.map((rec, idx) => buildCleanItem("Musicas", rec, idx));

    const albuns: EmpirePlayCleanAlbum[] = albumRecords.map((rec, idx) => {
      const albumTitle =
        getValue(rec, ["nome_do_album", "titulo_do_album", "titulo", "album", "nome"]) ||
        `Álbum ${idx + 1}`;
      const normAlbumTitle = normalizeComparison(albumTitle);

      const artist =
        getValue(rec, ["act_principal", "artista", "nome_do_criador", "nome_do_artista"]) || "";
      const coverUrl = getValue(rec, ["capa_do_album", "capa", "thumb", "imagem", "cover_url"]);
      const releaseDate = getValue(rec, ["data_de_lancamento", "data_lancamento", "data"]);
      const releaseDateIso = parseDateToIso(releaseDate);
      const metacriticAvg = getValue(rec, [
        "metacritic_avg",
        "metacritic",
        "media_metacritic",
        "nota_media",
      ]);

      // Junção com a aba Musicas
      const matchingSongs = songs.filter((s) => {
        if (!s.album) return false;
        const normSongAlbum = normalizeComparison(s.album);
        return normSongAlbum === normAlbumTitle || normAlbumTitle.includes(normSongAlbum);
      });

      // Ordenar faixas pela coluna Ordem
      matchingSongs.sort((a, b) => {
        const orderA = a.trackOrder ?? 999;
        const orderB = b.trackOrder ?? 999;
        return orderA - orderB;
      });

      const tracks: EmpirePlayCleanAlbumTrack[] = matchingSongs.map((s, songIdx) => ({
        id: s.id,
        title: s.title,
        artist: s.artist || artist,
        album: albumTitle,
        trackOrder: s.trackOrder || songIdx + 1,
        coverUrl: s.coverUrl || coverUrl,
        audioUrl: s.audioUrl,
        releaseDate: s.releaseDate,
        lyrics: s.lyrics,
      }));

      return {
        id: `album_${idx + 1}`,
        title: albumTitle,
        artist,
        coverUrl,
        releaseDate,
        releaseDateIso,
        metacriticAvg,
        tracks,
      };
    });

    return new Response(JSON.stringify({ success: true, data: albuns }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao buscar álbuns." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

/**
 * GET /api/empire-play/forum/:tipo/:topicId
 */
export async function getEmpirePlayForumTopicController(
  request: Request,
  routeParams?: { tipo?: string; topicId?: string },
): Promise<Response> {
  const url = new URL(request.url);

  let tipoParam = (routeParams?.tipo || url.searchParams.get("tipo") || "musicas").toLowerCase();
  let topicIdParam =
    routeParams?.topicId || url.searchParams.get("topicId") || url.searchParams.get("id") || "";

  if (!topicIdParam && url.pathname.includes("/api/empire-play/forum/")) {
    const parts = url.pathname.split("/api/empire-play/forum/")[1]?.split("/").filter(Boolean);
    if (parts && parts.length >= 2) {
      tipoParam = parts[0].toLowerCase();
      topicIdParam = parts[1];
    } else if (parts && parts.length === 1) {
      topicIdParam = parts[0];
    }
  }

  let sheetMedia = "Musicas";
  let sheetComments = "Comentarios_Musicas";
  // Rótulo usado só pra gerar o `id` do item via buildCleanItem — TEM que
  // ser idêntico ao rótulo usado em getEmpirePlayVideosController
  // ("Videos", não "Music Videos"), senão o id gerado aqui nunca bate com o
  // id que veio do catálogo/link "Ver no Fórum", a busca abaixo nunca
  // encontra o tópico certo e cai no fallback (primeira linha da planilha)
  // — todo vídeo clicado abria com a mídia/comentários errados.
  let sheetIdLabel = sheetMedia;

  if (tipoParam === "albuns" || tipoParam === "album") {
    sheetMedia = "Albuns";
    sheetComments = "Comentarios_Albuns";
    sheetIdLabel = sheetMedia;
  } else if (
    tipoParam === "videos" ||
    tipoParam === "video" ||
    tipoParam === "music-videos" ||
    tipoParam === "music-video" ||
    tipoParam === "mv"
  ) {
    // "Videos" e "Comentarios_Videos" não existem mais na planilha — Vídeos
    // e Music Videos foram consolidados em "Music Videos"/"Comentarios_MV".
    sheetMedia = "Music Videos";
    sheetComments = "Comentarios_MV";
    sheetIdLabel = "Videos";
  }

  try {
    const [mediaRecords, commentRecordsWithRow, genericComments, empireComments, topicCommentsSheet] =
      await Promise.all([
        sheetsService.readSheetObjects(sheetMedia).catch(() => []),
        readSheetObjectsWithRowIndex(sheetComments),
        sheetsService.readSheetObjects("Comentarios").catch(() => []),
        sheetsService.readSheetObjects("Comentarios_EmpirePlay").catch(() => []),
        sheetsService.readSheetObjects("Topicos_EmpirePlay").catch(() => []),
      ]);

    // Marca cada registro da aba de comentários principal com sua linha real
    // na planilha (__rowIndex) — é isso que permite reagir com emoji direto
    // na célula certa depois. Comentários vindos das abas de fallback
    // (Comentarios/Comentarios_EmpirePlay/Topicos_EmpirePlay) não suportam
    // reação, já que praticamente não têm uso real.
    const commentRecords = commentRecordsWithRow.map(({ rec, rowIndex }) => ({
      ...rec,
      __rowIndex: String(rowIndex),
    }));

    const allCommentRecords = [
      ...commentRecords,
      ...genericComments,
      ...empireComments,
      ...topicCommentsSheet,
    ];

    const normTopicSearch = normalizeComparison(topicIdParam);

    let targetMediaIndex = mediaRecords.findIndex((rec, idx) => {
      const item = buildCleanItem(sheetIdLabel, rec, idx);
      const recTopicId =
        getValue(rec, [
          "id_do_topico",
          "id_topico",
          "id",
          "topico_id",
          "topico",
          "message_thread_id",
        ]) || "";
      return (
        item.id === topicIdParam ||
        normalizeComparison(item.title) === normTopicSearch ||
        normalizeComparison(item.id) === normTopicSearch ||
        normalizeComparison(recTopicId) === normTopicSearch
      );
    });

    // Nunca cair pra "primeira linha da planilha" quando o id não bate — já
    // foi causa raiz de todo vídeo/tópico clicado abrir com a mídia e os
    // comentários de OUTRO item. Sem match real, retorna 404 em vez de
    // mostrar dado errado silenciosamente.
    if (targetMediaIndex === -1) {
      return new Response(
        JSON.stringify({ success: false, error: "Tópico não encontrado." }),
        { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } },
      );
    }

    const rawMedia = mediaRecords[targetMediaIndex];
    const mediaItem = rawMedia ? buildCleanItem(sheetIdLabel, rawMedia, targetMediaIndex) : null;

    // ID do tópico REAL da planilha (não o id sintético gerado pelo app) — é
    // esse valor que deve ser usado como chave nas abas Comentarios_*.
    const realTopicId = rawMedia
      ? getValue(rawMedia, [
          "id_do_topico",
          "id_topico",
          "topico_id",
          "topico",
          "message_thread_id",
        ]) || ""
      : "";
    const mediaTopicId = realTopicId || (mediaItem ? mediaItem.id : "");
    if (mediaItem && realTopicId) {
      mediaItem.topicId = realTopicId;
    }
    const normMediaTopicId = mediaTopicId ? normalizeComparison(mediaTopicId) : "";
    const normMediaTitle = mediaItem ? normalizeComparison(mediaItem.title) : normTopicSearch;

    const comments = allCommentRecords
      .filter((rec) => {
        const topicoVal =
          getValue(rec, [
            "id_do_topico",
            "id_topico",
            "topico_id",
            "id_media",
            "id_do_item",
            "id",
            "topico",
            "comentarios_para",
            "message_thread_id",
          ]) || "";
        const titleVal = getValue(rec, ["titulo", "title", "titulo_media", "nome", "info"]) || "";

        const normTopicoVal = topicoVal ? normalizeComparison(topicoVal) : "";
        const normTitle = titleVal ? normalizeComparison(titleVal) : "";

        // 1. Match por ID do Tópico (Coluna A)
        if (
          normTopicoVal &&
          (normTopicoVal === normMediaTopicId || normTopicoVal === normTopicSearch)
        ) {
          return true;
        }

        // 2. Match por Título da Mídia
        if (
          normMediaTitle &&
          normTitle &&
          (normTitle.includes(normMediaTitle) || normMediaTitle.includes(normTitle))
        ) {
          return true;
        }

        // 3. Fallback: Verifica se qualquer valor no registro bate com o ID
        if (normMediaTopicId || normTopicSearch) {
          const vals = Object.values(rec).map((v) => normalizeComparison(String(v)));
          if (vals.includes(normMediaTopicId) || vals.includes(normTopicSearch)) {
            return true;
          }
        }

        return false;
      })
      .map((rec, idx) => {
        const dataVal = getValue(rec, ["timestamp", "data_hora", "data", "date"]) || "";
        const titleVal =
          getValue(rec, ["titulo", "title", "info"]) || (mediaItem ? mediaItem.title : "");
        let playerVal =
          getValue(rec, [
            "nome_do_jogador",
            "nome_jogador",
            "nome",
            "jogador",
            "player",
            "off",
            "autor",
          ]) || "";
        if (!playerVal) playerVal = "Anônimo";

        const commentVal =
          getValue(rec, [
            "comentario",
            "comment",
            "texto",
            "mensagem",
            "conteudo",
            "comentarios_para",
          ]) || "";
        const ratingVal = getValue(rec, ["nota_likes", "nota", "rating", "likes"]) || "";

        // Reações (emoji → lista de jogadorIds que reagiram), gravadas como
        // JSON numa coluna própria da aba de comentários. Só existe pra
        // comentários vindos da aba principal (que carregam __rowIndex).
        const rowIndexVal = (rec as SheetRecord).__rowIndex
          ? parseInt((rec as SheetRecord).__rowIndex, 10)
          : null;
        const reactionsRaw = getValue(rec, ["reacoes", "reactions"]) || "";
        let reactionsMap: Record<string, string[]> = {};
        if (reactionsRaw) {
          try {
            const parsed = JSON.parse(reactionsRaw);
            if (parsed && typeof parsed === "object") reactionsMap = parsed;
          } catch {
            // ignora JSON inválido/legado
          }
        }
        const reactions: Record<string, number> = {};
        Object.entries(reactionsMap).forEach(([emoji, jogadorIds]) => {
          if (Array.isArray(jogadorIds) && jogadorIds.length > 0) reactions[emoji] = jogadorIds.length;
        });

        return {
          id: `comment_${idx + 1}`,
          data: dataVal,
          timestamp: dataVal,
          titulo: titleVal,
          title: titleVal,
          jogador: playerVal,
          player: playerVal,
          comentario: commentVal,
          comment: commentVal,
          nota: ratingVal,
          rating: ratingVal,
          rowIndex: rowIndexVal,
          sheetComments: rowIndexVal ? sheetComments : null,
          reactions,
          reactedBy: rowIndexVal ? reactionsMap : {},
        };
      });

    // Se o registro da mídia contiver o campo `comentarios_para` ou notas registradas por jogadores (ex: Hugo: 95)
    if (rawMedia) {
      const embeddedCommentsText = getValue(rawMedia, [
        "comentarios_para",
        "comentarios",
        "comentario_para",
        "forum_comentarios",
      ]);
      if (embeddedCommentsText && embeddedCommentsText.trim()) {
        comments.unshift({
          id: "comment_embedded_1",
          data: getValue(rawMedia, ["data", "release_date"]) || "",
          timestamp: "",
          titulo: mediaItem ? mediaItem.title : "",
          title: mediaItem ? mediaItem.title : "",
          jogador: getValue(rawMedia, ["artista", "autor"]) || "Comunidade Empire Play",
          player: getValue(rawMedia, ["artista", "autor"]) || "Comunidade Empire Play",
          comentario: embeddedCommentsText,
          comment: embeddedCommentsText,
          nota: "",
          rating: "",
          rowIndex: null,
          sheetComments: null,
          reactions: {},
          reactedBy: {},
        });
      }

      // Adiciona avaliações por jogador (ex: "Hugo: 90, Maria: 85") se existirem na coluna de notas/ratings
      const ratingsText = getValue(rawMedia, [
        "ratings_por_jogador",
        "avaliacoes",
        "notas_jogadores",
      ]);
      if (ratingsText && ratingsText.includes(":")) {
        const parts = ratingsText.split(",");
        parts.forEach((p, pIdx) => {
          const [jName, jScore] = p.split(":");
          if (jName && jScore) {
            comments.push({
              id: `comment_rating_${pIdx + 1}`,
              data: "",
              timestamp: "",
              titulo: mediaItem ? mediaItem.title : "",
              title: mediaItem ? mediaItem.title : "",
              jogador: jName.trim(),
              player: jName.trim(),
              comentario: `Avaliação do Tópico: ${jScore.trim()} pts.`,
              comment: `Avaliação do Tópico: ${jScore.trim()} pts.`,
              nota: jScore.trim(),
              rating: jScore.trim(),
              rowIndex: null,
              sheetComments: null,
              reactions: {},
              reactedBy: {},
            });
          }
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          media: mediaItem,
          comments,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Erro ao carregar tópicos do Fórum.",
      }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}
