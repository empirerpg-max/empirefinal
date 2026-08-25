import { sheetsService } from "../services/sheetsService";
import { findFileByName } from "../services/googleDriveService";
import {
  googleSheetsService,
  normalizeComparison,
  normalizeHeader,
  normalizeText,
  dedupeHeaders,
  SheetRecord,
} from "../services/googleSheetsService";
import { getUserProfile } from "./userController";

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Corrige erro de digitação no nome do artista vindo das abas de chart
// (ex: "Abigal" na planilha, "Abigail" cadastrada de verdade em ARTISTAS) —
// só corrige quando existe exatamente UM nome cadastrado muito próximo
// (distância de edição <= 2), pra nunca trocar o nome de um artista
// diferente por engano.
function correctArtistName(rawName: string, knownNames: string[]): string {
  const normalized = normalizeComparison(rawName);
  if (!normalized) return rawName;
  let best: { name: string; dist: number }[] = [];
  for (const known of knownNames) {
    const dist = levenshtein(normalized, normalizeComparison(known));
    if (dist === 0) return known;
    if (dist <= 2) best.push({ name: known, dist });
  }
  if (best.length === 0) return rawName;
  best.sort((a, b) => a.dist - b.dist);
  if (best.length > 1 && best[0].dist === best[1].dist) return rawName;
  return best[0].name;
}

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
  // Artistas participantes/feat (ARTISTA 2-6), além do "artist" principal.
  featArtists?: string[];
  // "Artista Principal, Feat 1, Feat 2" já pronto pro padrão de exibição
  // Spotify — só existe quando há pelo menos um feat.
  displayArtists?: string;
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
  // Foto de perfil do artista (aba ARTISTAS, planilha "usuarios") — distinta
  // de coverUrl, que é a capa da música/vídeo. Usada nas capas dinâmicas de
  // Catálogo > Início (nº1 de cada chart com o rosto do artista).
  artistPhotoUrl?: string | null;
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
  // Imagens do encarte (coluna "Encarte" da aba Albuns, URLs separadas por
  // ", " no cadastro) — exibidas na página do álbum junto com as faixas.
  encarte: string[];
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

function itemMatchesArtist(item: EmpirePlayCleanItem, filterArtist: string): boolean {
  if (normalizeComparison(item.artist).includes(filterArtist)) return true;
  return (item.featArtists || []).some((a) => normalizeComparison(a).includes(filterArtist));
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

  // As abas de chart (Top_50_Spotify/Top_Songs_Apple_Music/Top_Videos_YT)
  // não têm coluna própria de artista — o fallback de "artist" acima ou vem
  // vazio, ou cai no id_do_criador (um ID numérico do Telegram, não um
  // nome), e sem essa checagem esse valor vazava como se fosse o nome do
  // artista (ou virava "Artista Independente" perdendo o dado de verdade).
  // O "Título" da própria aba já vem como "Artista - Música" nesses casos,
  // então reusa o mesmo split abaixo.
  const looksLikeRawId = (v: string | null | undefined) => !!v && /^\d+$/.test(v.trim());
  if (title && (!artist || looksLikeRawId(artist))) {
    const dashMatch = title.match(/^(.+?)\s[-–—]\s(.+)$/);
    if (dashMatch) {
      artist = dashMatch[1].trim();
      title = dashMatch[2].trim();
    }
  }

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

  // A coluna "Nome da música"/título do tópico sempre chega como
  // "Artista - Título" (é o texto digitado pelo jogador). Antes só se fazia
  // esse split quando "artist" vinha vazio (fallback) — como o act_principal
  // normalmente já existe, o título nunca era limpo e a UI mostrava
  // "Artista - Título" inteiro repetido junto do nome do artista. Agora
  // sempre remove esse prefixo do título, independente de já ter "artist".
  const cleanDashMatch = title.match(/^(.+?)\s[-–—]\s(.+)$/);
  if (cleanDashMatch) {
    title = cleanDashMatch[2].trim();
  }

  // ARTISTA 2-6 (colunas O-S em Musicas, I-M em faixas de álbum) — artistas
  // participantes/feat. além do ACT PRINCIPAL. Precisa aparecer no perfil de
  // TODOS os artistas envolvidos, não só do principal, e formar o
  // "Artista, Feat 1, Feat 2" padrão Spotify na exibição.
  const featArtists = [
    getValue(record, ["artista_2"]),
    getValue(record, ["artista_3"]),
    getValue(record, ["artista_4"]),
    getValue(record, ["artista_5"]),
    getValue(record, ["artista_6"]),
  ].filter((v): v is string => !!v && v.trim().length > 0);

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

  if (featArtists.length > 0) {
    item.featArtists = featArtists;
    item.displayArtists = [artist, ...featArtists].join(", ");
  }

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
// Pasta "Capa Playlist" no Drive (dentro de Empire Hub) — guarda os moldes
// das capas dinâmicas e a foto "Substituta" usada quando o artista não tem
// foto cadastrada na aba ARTISTAS. Resolvido por nome (não ID fixo), porque
// apagar+subir de novo no Drive gera um ID novo mesmo com o mesmo nome.
const CAPA_PLAYLIST_FOLDER_ID = "1KgGwing62UB9bf6MqhNlbi9mREs70sUJ";

export async function getEmpirePlayHomeController(): Promise<Response> {
  try {
    const [
      spotifyRecords,
      appleRecords,
      youtubeRecords,
      musicaRecords,
      videoRecords,
      artistRecords,
      fallbackPhotoFile,
    ] = await Promise.all([
      sheetsService.readSheetObjects("Top_50_Spotify").catch(() => []),
      sheetsService.readSheetObjects("Top_Songs_Apple_Music").catch(() => []),
      sheetsService.readSheetObjects("Top_Videos_YT").catch(() => []),
      sheetsService.readSheetObjects("Musicas").catch(() => []),
      sheetsService.readSheetObjects("Music Videos").catch(() => []),
      // ARTISTAS vive na planilha "usuarios" (diferente da "principal" usada
      // acima) — é de lá que vem a foto de perfil de verdade do artista,
      // pra distinguir da capa da música/vídeo.
      googleSheetsService.usuarios.readSheetObjects("ARTISTAS").catch(() => []),
      findFileByName(CAPA_PLAYLIST_FOLDER_ID, "substituta").catch(() => null),
    ]);
    const fallbackPhotoUrl = fallbackPhotoFile
      ? `https://drive.google.com/uc?export=view&id=${fallbackPhotoFile.id}`
      : null;

    // Nunca mostra faixa Pendente (sem tópico ainda) na playlist Hot — ela
    // não é conteúdo publicado de verdade, só existe internamente até
    // alguém decidir abrir o tópico.
    const recentMusicas = musicaRecords
      .filter((rec) => (getValue(rec, ["pendente"]) || "").trim().toLowerCase() !== "sim")
      .map((rec, idx) => buildCleanItem("Musicas", rec, idx))
      .sort((a, b) => {
        if (a.releaseDateIso && b.releaseDateIso) {
          return b.releaseDateIso.localeCompare(a.releaseDateIso);
        }
        return b.id.localeCompare(a.id);
      })
      .slice(0, 100);

    // Nomes cadastrados de verdade em ARTISTAS — usados abaixo pra corrigir
    // erro de digitação no nome do artista vindo das abas de chart (elas não
    // têm coluna própria de artista, então herdam o texto livre do Título,
    // que às vezes tem erro, ex: "Abigal" em vez de "Abigail"). Corrigir
    // ANTES de qualquer cruzamento é essencial: sem isso nem a capa do
    // catálogo nem a foto do artista são encontradas, porque o nome errado
    // não bate com o cadastro.
    const knownArtistNames: string[] = [];
    for (const rec of artistRecords) {
      const nomeRaw = normalizeText(rec["nome"]);
      if (nomeRaw) knownArtistNames.push(nomeRaw);
    }
    const correctArtistNames = (items: EmpirePlayCleanItem[]): EmpirePlayCleanItem[] =>
      items.map((item) => ({ ...item, artist: correctArtistName(item.artist, knownArtistNames) }));

    // As abas de chart (Top_50_Spotify/Top_Songs_Apple_Music/Top_Videos_YT)
    // só guardam posição/título — não têm coluna própria de nota Metacritic
    // nem de likes, então esse dado nunca aparecia nos cards de destaque.
    // Cruza cada entrada do chart com o catálogo real (Musicas/Music Videos)
    // por artista+título pra herdar a nota/likes já calculados lá.
    const musicaAllItems = correctArtistNames(
      musicaRecords.map((rec, idx) => buildCleanItem("Musicas", rec, idx)),
    );
    const videoAllItems = correctArtistNames(
      videoRecords.map((rec, idx) => buildCleanItem("Videos", rec, idx)),
    );

    const buildScoreIndex = (items: EmpirePlayCleanItem[]) => {
      const map = new Map<string, string>();
      for (const it of items) {
        if (!it.metacriticAvg) continue;
        const key = `${normalizeComparison(it.artist)}::${normalizeComparison(it.title)}`;
        if (!map.has(key)) map.set(key, String(it.metacriticAvg));
      }
      return map;
    };
    const musicaScoreIndex = buildScoreIndex(musicaAllItems);
    const videoScoreIndex = buildScoreIndex(videoAllItems);

    const enrichWithScore = (
      chartItems: EmpirePlayCleanItem[],
      scoreIndex: Map<string, string>,
    ): EmpirePlayCleanItem[] =>
      chartItems.map((item) => {
        if (item.metacriticAvg) return item;
        const key = `${normalizeComparison(item.artist)}::${normalizeComparison(item.title)}`;
        const score = scoreIndex.get(key);
        return score ? { ...item, metacriticAvg: score } : item;
      });

    // Top_Songs_Apple_Music/Top_Videos_YT também não têm coluna própria de
    // capa — mesmo cruzamento por artista+título com o catálogo real, agora
    // pra herdar coverUrl (capa do single/vídeo), usada nos quadrados
    // laterais da capa dinâmica do Apple Music.
    const buildCoverIndex = (items: EmpirePlayCleanItem[]) => {
      const map = new Map<string, string>();
      for (const it of items) {
        if (!it.coverUrl) continue;
        const key = `${normalizeComparison(it.artist)}::${normalizeComparison(it.title)}`;
        if (!map.has(key)) map.set(key, it.coverUrl);
      }
      return map;
    };
    const musicaCoverIndex = buildCoverIndex(musicaAllItems);
    const videoCoverIndex = buildCoverIndex(videoAllItems);

    const enrichWithCover = (
      chartItems: EmpirePlayCleanItem[],
      coverIndex: Map<string, string>,
    ): EmpirePlayCleanItem[] =>
      chartItems.map((item) => {
        if (item.coverUrl) return item;
        const key = `${normalizeComparison(item.artist)}::${normalizeComparison(item.title)}`;
        const cover = coverIndex.get(key);
        return cover ? { ...item, coverUrl: cover } : item;
      });

    // Foto de PERFIL do artista (aba ARTISTAS) — cruzada por nome normalizado,
    // diferente de coverUrl (capa da música/vídeo). Usada nas capas dinâmicas
    // de Catálogo > Início.
    const artistPhotoIndex = new Map<string, string>();
    for (const rec of artistRecords) {
      const nome = normalizeComparison(rec["nome"]);
      const foto = normalizeText(rec["foto"]);
      if (nome && foto && !artistPhotoIndex.has(nome)) artistPhotoIndex.set(nome, foto);
    }
    const enrichWithArtistPhoto = (items: EmpirePlayCleanItem[]): EmpirePlayCleanItem[] =>
      items.map((item) => {
        const foto = artistPhotoIndex.get(normalizeComparison(item.artist)) || fallbackPhotoUrl;
        return foto ? { ...item, artistPhotoUrl: foto } : item;
      });

    const topSpotify = enrichWithArtistPhoto(
      enrichWithCover(
        enrichWithScore(
          correctArtistNames(spotifyRecords.map((rec, idx) => buildCleanItem("Top_50_Spotify", rec, idx))),
          musicaScoreIndex,
        ),
        musicaCoverIndex,
      ),
    );
    const topAppleMusic = enrichWithArtistPhoto(
      enrichWithCover(
        enrichWithScore(
          correctArtistNames(
            appleRecords.map((rec, idx) => buildCleanItem("Top_Songs_Apple_Music", rec, idx)),
          ),
          musicaScoreIndex,
        ),
        musicaCoverIndex,
      ),
    );
    const topYoutube = enrichWithArtistPhoto(
      enrichWithCover(
        enrichWithScore(
          correctArtistNames(youtubeRecords.map((rec, idx) => buildCleanItem("Top_Videos_YT", rec, idx))),
          videoScoreIndex,
        ),
        videoCoverIndex,
      ),
    );
    const recentMusicasWithPhoto = enrichWithArtistPhoto(recentMusicas);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          topSpotify,
          topAppleMusic,
          topYoutube,
          recentMusicas: recentMusicasWithPhoto,
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
    // Faixa "Pendente" (Sim) nunca aparece no Fórum — só existe internamente
    // até alguém decidir lançar oficialmente nos charts (mesma regra já
    // aplicada na playlist Hot, ver getEmpirePlayHomeController).
    let items = records
      .filter((rec) => (getValue(rec, ["pendente"]) || "").trim().toLowerCase() !== "sim")
      .map((rec, idx) => buildCleanItem("Musicas", rec, idx));

    if (filterArtist) {
      items = items.filter((item) => itemMatchesArtist(item, filterArtist));
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

    // Ordenar por data de lançamento (mais recente primeiro) — itens sem
    // data ficam por último, na ordem em que já vieram da planilha, em vez
    // de espalhados aleatoriamente entre os datados (bug antigo: retornar 0
    // pra qualquer par onde um dos dois não tinha data deixava o array
    // praticamente na ordem crua da planilha).
    items.sort((a, b) => {
      if (a.releaseDateIso && b.releaseDateIso) return b.releaseDateIso.localeCompare(a.releaseDateIso);
      if (a.releaseDateIso) return -1;
      if (b.releaseDateIso) return 1;
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
      items = items.filter((item) => itemMatchesArtist(item, filterArtist));
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
 * GET /api/empire-play/lancamentos-recentes
 * Usado no widget "Lançamentos Recentes" do Início: lê a coluna A (Data de
 * lançamento) da aba "EDIÇÃO CHARTS" (músicas) e a coluna B da aba "EDIÇÃO
 * CHARTS ÁLBUMS" (álbuns) — as duas fontes confirmadas pelo usuário como a
 * data real de lançamento nos charts — e junta as mais recentes das duas,
 * cruzando cada título com o catálogo (Musicas/Albuns) pra pegar capa e id.
 *
 * Existia um bug de verdade que corrompia essa data: editar o título de uma
 * música gravava o texto do novo título por cima da coluna A de EDIÇÃO
 * CHARTS (era pra ser a coluna B — ver o fix em editController.ts), fazendo
 * a data de lançamento virar lixo. Corrigido; esta função volta a confiar
 * na coluna A/B como fonte real de "quando foi lançado".
 */
export async function getEmpirePlayLancamentosRecentesController(): Promise<Response> {
  try {
    const [edicaoMusicasRows, edicaoAlbunsRows, musicaRecords, albumRecords, musicasRawRows, albunsRawRows] =
      await Promise.all([
        // BD = coluna 56 (índice 55) — "Código único" gerado por fórmula.
        googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A2:BD5000"),
        // R = coluna 18 (índice 17) — "Código único".
        googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS", "A2:R5000"),
        sheetsService.readSheetObjects("Musicas"),
        sheetsService.readSheetObjects("Albuns"),
        googleSheetsService.principal.readValues("Musicas"),
        googleSheetsService.principal.readValues("Albuns"),
      ]);

    const musicaItems = musicaRecords
      .filter((rec) => (getValue(rec, ["pendente"]) || "").trim().toLowerCase() !== "sim")
      .map((rec, idx) => buildCleanItem("Musicas", rec, idx));
    const albumItems = albumRecords.map((rec, idx) => buildCleanItem("Albuns", rec, idx));

    // Código único é a chave real de cruzamento entre EDIÇÃO CHARTS/EDIÇÃO
    // CHARTS ÁLBUMS e o catálogo — mesma lógica de buscarNomeCanonico em
    // registroLogController.ts. Muito mais confiável que casar por texto de
    // título (que quebra com qualquer diferença de acento/"feat."/espaço).
    // Musicas!Z (índice 25) e Albuns!L (índice 11) — alinhados por posição
    // com musicaItems/albumItems porque vêm da mesma leitura em ordem.
    const codigoParaMusica = new Map<string, EmpirePlayCleanItem>();
    musicasRawRows.slice(1).forEach((row, i) => {
      const codigo = normalizeComparison(row[25] || "");
      if (codigo && musicaItems[i]) codigoParaMusica.set(codigo, musicaItems[i]);
    });
    const codigoParaAlbum = new Map<string, EmpirePlayCleanItem>();
    albunsRawRows.slice(1).forEach((row, i) => {
      const codigo = normalizeComparison(row[11] || "");
      if (codigo && albumItems[i]) codigoParaAlbum.set(codigo, albumItems[i]);
    });

    type Candidato = { dataIso: string; titulo: string; codigoUnico: string; isAlbum: boolean };

    const candidatosMusicas: Candidato[] = edicaoMusicasRows
      .map((row) => ({
        dataIso: parseDateToIso(row[0] || null),
        titulo: (row[1] || "").trim(),
        codigoUnico: normalizeComparison(row[55] || ""),
        isAlbum: false,
      }))
      .filter((c): c is Candidato => !!c.dataIso && !!c.titulo);

    // EDIÇÃO CHARTS ÁLBUMS: A = artista, B = data de lançamento, D = nome do
    // álbum — remonta "Artista - Álbum" pra casar com o mesmo formato usado
    // em EDIÇÃO CHARTS e no catálogo (só usado no fallback por título).
    const candidatosAlbuns: Candidato[] = edicaoAlbunsRows
      .map((row) => {
        const artista = (row[0] || "").trim();
        const nomeAlbum = (row[3] || "").trim();
        const titulo = artista && nomeAlbum && !nomeAlbum.includes(" - ") ? `${artista} - ${nomeAlbum}` : nomeAlbum;
        return {
          dataIso: parseDateToIso(row[1] || null),
          titulo,
          codigoUnico: normalizeComparison(row[17] || ""),
          isAlbum: true,
        };
      })
      .filter((c): c is Candidato => !!c.dataIso && !!c.titulo);

    const candidatos = [...candidatosMusicas, ...candidatosAlbuns].sort((a, b) => b.dataIso.localeCompare(a.dataIso));

    const matchByTituloCompleto = (m: EmpirePlayCleanItem, tituloCompleto: string) =>
      normalizeComparison(`${m.artist} - ${m.title}`) === normalizeComparison(tituloCompleto) ||
      normalizeComparison(tituloCompleto).endsWith(normalizeComparison(m.title));

    const titulosVistos = new Set<string>();
    const lancamentos: { id: string; titulo: string; artista: string; coverUrl: string | null; dataIso: string }[] = [];
    for (const c of candidatos) {
      if (lancamentos.length >= 3) break;
      const norm = normalizeComparison(c.titulo);
      if (titulosVistos.has(norm)) continue;
      const catalogo = c.isAlbum ? albumItems : musicaItems;
      const mapaCodigo = c.isAlbum ? codigoParaAlbum : codigoParaMusica;
      const match = (c.codigoUnico && mapaCodigo.get(c.codigoUnico)) || catalogo.find((m) => matchByTituloCompleto(m, c.titulo));
      if (!match) continue;
      titulosVistos.add(norm);
      lancamentos.push({
        id: match.id,
        titulo: match.title,
        artista: match.artist,
        coverUrl: match.coverUrl || null,
        dataIso: c.dataIso,
      });
    }

    return new Response(JSON.stringify({ success: true, data: lancamentos }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Erro ao buscar lançamentos recentes.",
      }),
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
      const encarteRaw = getValue(rec, ["encarte"]);
      const encarte = encarteRaw
        ? encarteRaw
            .split(",")
            .map((u) => u.trim())
            .filter(Boolean)
        : [];

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
        encarte,
        tracks,
      };
    });

    // Álbuns não tinham NENHUMA ordenação — voltavam na ordem crua da
    // planilha. Mais recente primeiro, igual Músicas/Vídeos.
    albuns.sort((a, b) => {
      if (a.releaseDateIso && b.releaseDateIso) return b.releaseDateIso.localeCompare(a.releaseDateIso);
      if (a.releaseDateIso) return -1;
      if (b.releaseDateIso) return 1;
      return 0;
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
    // getEmpirePlayAlbunsController gera o id do álbum como "album_N"
    // (singular, hardcoded) — não "albuns_N" que buildCleanItem geraria
    // aqui usando o nome da aba ("Albuns", plural). Com o rótulo errado, o
    // id nunca batia com o item clicado no catálogo/fórum, a busca do
    // tópico caía sempre no 404 e os comentários pareciam não existir.
    sheetIdLabel = "Album";
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

        // ID do jogador que comentou (coluna B nas abas Comentarios_*) — usado
        // pra saber se o usuário logado pode editar esse comentário.
        const jogadorIdVal =
          getValue(rec, ["id_do_jogador", "id_jogador", "jogador_id", "jogadorid", "telegram_id"]) || "";

        // "comentarios_para" NUNCA deve virar texto do comentário — é a
        // coluna de referência ao ID do tópico (usada só pra achar o
        // registro certo, no topicoVal acima). Um bug antigo aqui a
        // reaproveitava como fallback de texto quando o registro vinha de
        // uma aba legada sem coluna de comentário de verdade, fazendo o
        // próprio ID do tópico (ex: "46", "815") aparecer como se fosse o
        // comentário de um jogador "Anônimo".
        const commentVal =
          getValue(rec, ["comentario", "comment", "texto", "mensagem", "conteudo"]) || "";
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
          jogadorId: jogadorIdVal,
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

    // Se o registro da mídia contiver notas registradas por jogadores (ex: Hugo: 95)
    if (rawMedia) {
      // "comentarios_para" NÃO entra aqui — na aba de mídia (Musicas/Albuns)
      // essa coluna guarda o próprio ID do tópico (igual à coluna B), nunca
      // texto de comentário. Usá-la aqui fazia o ID do tópico (ex: "46",
      // "815") aparecer como se fosse um comentário real de "Comunidade
      // Empire Play".
      const embeddedCommentsText = getValue(rawMedia, [
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
          jogadorId: "",
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
              jogadorId: "",
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

    // Nunca devolver "comentário" vazio — registros que só bateram pelo id
    // do tópico (rule 1/3 acima) mas não têm texto de comentário de verdade
    // não devem virar bolha vazia no Fórum.
    const commentsWithText = comments.filter((c) => c.comentario && c.comentario.trim());

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          media: mediaItem,
          comments: commentsWithText,
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
