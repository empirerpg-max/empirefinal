import type { PlayableTrack } from "./MusicPlayer";
import type { PlayableVideo } from "./VideoPlayer";

/** Normaliza um item bruto da API em uma faixa de áudio tocável. */
export function toPlayableTrack(item: any): PlayableTrack {
  return {
    id:
      item.id ||
      item.id_do_topico ||
      item.id_do_arquivo ||
      item.nome_da_musica ||
      item.title ||
      item.titulo,
    titulo: item.title || item.titulo || item.nome_da_musica || item.nome || "Música sem título",
    artista:
      item.artist ||
      item.artista ||
      item.act_principal ||
      item.nome_do_criador ||
      item.enviado_por ||
      "Artista não informado",
    capa_url:
      item.coverUrl ||
      item.capa_da_musica ||
      item.capa_do_album ||
      item.capa ||
      item.cover ||
      item.thumb ||
      item.capa_url,
    audio_url:
      item.audioUrl ||
      item.id_do_arquivo ||
      item.link_do_audio ||
      item.link ||
      item.audio_url ||
      item.stream_url ||
      item.link_audio ||
      item.drive_url,
    drive_url: item.audioUrl || item.id_do_arquivo || item.link || item.drive_url,
    letra: item.lyrics || item.letra,
    album: item.album || item.nome_do_album || "Single",
    metacriticAvg: item.metacriticAvg ?? item.metacritic ?? item.nota,
    forumTab: item.type || "musicas",
    artista_foto_url: item.artistPhotoUrl || item.artista_foto_url,
  };
}

/** Normaliza um item bruto da API em um vídeo tocável. */
export function toPlayableVideo(item: any): PlayableVideo {
  return {
    id: item.id || item.nome_do_video || item.id_do_topico,
    titulo: item.title || item.titulo || item.nome_do_video || item.nome || "Vídeo sem título",
    artista:
      item.artist ||
      item.artista ||
      item.act_principal ||
      item.nome_do_criador ||
      item.enviado_por ||
      "Artista não informado",
    capa_url:
      item.coverUrl ||
      item.thumb ||
      item.capa_da_musica ||
      item.capa ||
      item.capa_url ||
      item.poster_url,
    poster_url: item.coverUrl || item.thumb || item.poster_url || item.capa_url,
    // Vídeos são servidos do Google Drive/YouTube direto, ou do Telegram
    // (grupo de vídeos grandes) via proxy do próprio Worker — nesse caso a
    // planilha guarda só o ID da mensagem, não uma URL tocável.
    link: (() => {
      const source = item.videoSource || item.fonte;
      const raw =
        item.videoUrl ||
        item.audioUrl ||
        item.link ||
        item.youtube_url ||
        item.id_do_arquivo ||
        item.link_do_video;
      if (source === "telegram" && raw) return `/api/telegram-video/${encodeURIComponent(raw)}`;
      if (source === "drive" && raw) {
        const match = raw.match(/[-\w]{25,}/);
        const fileId = match ? match[0] : raw;
        return `/api/media/video?id=${fileId}`;
      }
      return raw;
    })(),
    youtube_url: item.videoUrl || item.audioUrl || item.youtube_url || item.link,
    descricao: item.description || item.descricao || "",
    tipo_video: item.category || item.tipo_video || item.tipo || "Vídeo",
    fonte: item.videoSource || item.fonte,
    telegramMessageId: item.telegramMessageId || null,
    reportPending: !!item.reportPending,
    metacriticAvg: item.metacriticAvg ?? item.likes ?? item.nota,
    forumTab: item.type || "videos",
    artista_foto_url: item.artistPhotoUrl || item.artista_foto_url,
  };
}
