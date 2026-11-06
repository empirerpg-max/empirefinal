import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  X,
  Tv,
  Sparkles,
  AlertCircle,
  Flag,
  Loader2,
  FileWarning,
  MessageSquare,
  Play,
  PictureInPicture2,
} from "lucide-react";
import { toast } from "sonner";
import { driveImg } from "@/lib/api";
import { haptic } from "@/lib/telegram";
import { ScoreBadge } from "./ScoreBadge";
import { SmartImg } from "@/components/SmartImg";

export interface PlayableVideo {
  id?: string;
  titulo: string;
  artista: string;
  tipo_video?: string;
  descricao?: string;
  capa_url?: string;
  poster_url?: string;
  youtube_url?: string;
  link?: string;
  fonte?: "youtube" | "drive" | string;
  metodo_exibicao?: "iframe_drive" | "iframe_youtube" | string;
  url_final_player?: string;
  telegramMessageId?: string | null;
  reportPending?: boolean;
  metacriticAvg?: number | string | null;
  /** Aba do fórum onde este item aparece ("videos" ou "music-videos"). */
  forumTab?: string;
  /** Foto de perfil do artista (aba ARTISTAS) — distinta de capa_url. */
  artista_foto_url?: string;
}

interface VideoPlayerProps {
  video: PlayableVideo | null;
  onClose: () => void;
  // Vídeos do mesmo artista pra lateral "Mais de {artista}" — opcional:
  // quem abre um vídeo avulso (Fórum, link direto) simplesmente não passa
  // nada e a lateral some, em vez de quebrar.
  relatedVideos?: PlayableVideo[];
  onSelectVideo?: (video: PlayableVideo) => void;
}

export function VideoPlayer({ video, onClose, relatedVideos = [], onSelectVideo }: VideoPlayerProps) {
  const [streamError, setStreamError] = useState(false);
  const nativeVideoRef = useRef<HTMLVideoElement | null>(null);
  const [reporting, setReporting] = useState(false);
  // Otimista: assim que o report é aceito, já reflete no botão sem esperar
  // o próximo carregamento da lista (que traria reportPending do servidor).
  const [justReported, setJustReported] = useState(false);
  const [reportingWrong, setReportingWrong] = useState(false);
  const [wrongReported, setWrongReported] = useState(false);

  if (!video) return null;

  const reportPending = justReported || !!video.reportPending;

  async function handleReportIssue() {
    if (!video?.telegramMessageId || reporting || reportPending) return;
    haptic.selection();
    setReporting(true);
    try {
      const res = await fetch("/api/empire-play/report-video-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: video.telegramMessageId }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setJustReported(true);
        toast.success("Problema reportado!", {
          description:
            "Em até 6 horas o vídeo estará reprocessado, volte quando sentir que já deu certo.",
        });
      } else {
        toast.error(json.error || "Não foi possível reportar o problema.");
      }
    } catch {
      toast.error("Erro de conexão ao reportar o problema.");
    } finally {
      setReporting(false);
    }
  }

  async function handleReportWrongContent() {
    if (!video?.id || reportingWrong || wrongReported) return;
    haptic.selection();
    setReportingWrong(true);
    try {
      const res = await fetch("/api/empire-play/report-wrong-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: video.id, title: video.titulo, artist: video.artista }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setWrongReported(true);
        toast.success("Reportado!", {
          description: "Avisamos a equipe que esse conteúdo pode estar incorreto.",
        });
      } else {
        toast.error(json.error || "Não foi possível reportar.");
      }
    } catch {
      toast.error("Erro de conexão ao reportar.");
    } finally {
      setReportingWrong(false);
    }
  }

  // Mesmo "popup" que o usuário pediu: Picture-in-Picture nativo do
  // navegador, só disponível pra <video> nativo (Drive/Telegram) — iframe do
  // YouTube/Vimeo já declara allow="picture-in-picture" mais abaixo, mas
  // quem controla isso aí é o player deles, não dá pra disparar daqui.
  async function handlePictureInPicture() {
    const el = nativeVideoRef.current;
    if (!el) return;
    haptic.selection();
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await el.requestPictureInPicture();
      }
    } catch {
      toast.error("Não foi possível abrir o mini player.");
    }
  }

  const outrosDoArtista = relatedVideos.filter((v) => v.id !== video.id && v.artista === video.artista);

  const rawLink =
    video.url_final_player || video.link || (video as any).videoUrl || video.youtube_url || "";

  // 1. YouTube
  const isYouTubeUrl = (url?: string) => {
    if (!url) return false;
    return /youtube\.com|youtu\.be/i.test(url);
  };

  const getYouTubeEmbedUrl = (url: string) => {
    let videoId = "";
    if (url.includes("youtu.be/")) {
      videoId = url.split("youtu.be/")[1]?.split("?")[0] || "";
    } else if (url.includes("v=")) {
      videoId = url.split("v=")[1]?.split("&")[0] || "";
    } else if (url.includes("embed/")) {
      videoId = url.split("embed/")[1]?.split("?")[0] || "";
    } else if (url.includes("shorts/")) {
      videoId = url.split("shorts/")[1]?.split("?")[0] || "";
    }
    // modestbranding/iv_load_policy/rel reduzem ao máximo a marca do
    // YouTube (logo grande, vídeos relacionados de outros canais) — o
    // objetivo é a experiência parecer o mais uniforme possível com o
    // player nativo (Drive/Telegram), já que tecnicamente um vídeo do
    // YouTube só pode ser tocado via iframe deles, nunca via <video>.
    return videoId
      ? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3&playsinline=1`
      : url;
  };

  // Vimeo, assim como YouTube, é a plataforma oficial embutida via iframe —
  // não tem como evitar mostrar o player dela.
  const isVimeoUrl = (url?: string) => {
    if (!url) return false;
    return /vimeo\.com/i.test(url);
  };

  const getVimeoEmbedUrl = (url: string) => {
    const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    // title/byline/portrait=0 tiram a marca do Vimeo (nome do canal, avatar,
    // título sobreposto) — mesmo motivo do modestbranding do YouTube acima.
    return match
      ? `https://player.vimeo.com/video/${match[1]}?autoplay=1&title=0&byline=0&portrait=0`
      : url;
  };

  // Drive e Telegram tocam via <video> nativo apontando pro proxy do próprio
  // Worker (/api/media/video, /api/telegram-video) — o jogador nunca vê a
  // interface do Drive, só o player do app, como o resto da mídia.
  const isYt = video.metodo_exibicao === "iframe_youtube" || isYouTubeUrl(rawLink);
  const isVimeo = !isYt && (video.fonte === "vimeo" || isVimeoUrl(rawLink));

  const poster =
    video.poster_url || video.capa_url
      ? driveImg(video.poster_url || video.capa_url, 800)
      : undefined;

  return (
    <div className="fixed inset-0 z-[130] bg-black/95 backdrop-blur-2xl flex flex-col justify-between animate-in fade-in duration-300 overflow-y-auto">
      {/* Top Header */}
      <div className="p-4 sm:p-6 flex items-center justify-between border-b border-white/10 bg-neutral-950/80 sticky top-0 z-10 backdrop-blur-md">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-10 rounded-xl bg-red-600/20 border border-red-500/30 grid place-items-center flex-shrink-0 text-red-500">
            <Tv className="size-5" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-black uppercase tracking-widest text-red-500 block">
              {video.tipo_video || "Video Streaming"}
            </span>
            <h2 className="text-sm sm:text-base font-black text-white truncate">{video.titulo}</h2>
          </div>
        </div>

        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
          {video.id && (
            <Link
              to="/empire-play/forum"
              search={{ tab: video.forumTab || "videos", id: video.id }}
              onClick={() => {
                haptic.selection();
                // Fecha o player (overlay fixo em tela cheia) pra revelar o
                // Fórum por baixo — sem isso a navegação acontece mas fica
                // escondida atrás do player ainda aberto.
                onClose();
              }}
              title="Ver no Fórum"
              className="size-9 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 grid place-items-center text-neutral-400 hover:text-white active:scale-90 transition-all"
            >
              <MessageSquare className="size-4" />
            </Link>
          )}
          {video.fonte === "telegram" && video.telegramMessageId && (
            <button
              onClick={handleReportIssue}
              disabled={reporting || reportPending}
              title={
                reportPending
                  ? "Já reportado — reprocessando"
                  : "Reportar problema neste vídeo (travando ou não abrindo)"
              }
              className="size-9 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 grid place-items-center text-neutral-400 hover:text-white active:scale-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {reporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Flag className="size-4" />
              )}
            </button>
          )}
          {video.id && (
            <button
              onClick={handleReportWrongContent}
              disabled={reportingWrong || wrongReported}
              title={
                wrongReported
                  ? "Já reportado, obrigado!"
                  : "Esse não é o vídeo correto (arquivo errado/fora de posição)"
              }
              className="size-9 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 grid place-items-center text-neutral-400 hover:text-white active:scale-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {reportingWrong ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileWarning className="size-4" />
              )}
            </button>
          )}
          <button
            onClick={onClose}
            className="size-11 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 grid place-items-center text-white active:scale-90 transition-all flex-shrink-0"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      {/* Área Central do Player — player+detalhes à esquerda, "Mais de
          {artista}" na lateral direita (só quando há relacionados; some em
          telas estreitas e volta pra baixo da coluna principal). */}
      <div className="flex-1 w-full max-w-[1500px] mx-auto p-4 sm:p-8">
        <div className="flex flex-wrap items-start gap-6">
          {/* Coluna principal: nunca menor que 640px, cresce pra preencher */}
          <div className="flex-[999_1_640px] min-w-0 flex flex-col gap-6">
            <div className="w-full min-h-[300px] rounded-3xl overflow-hidden bg-neutral-900 border border-white/10 shadow-[0_25px_60px_rgba(0,0,0,0.9)] relative group flex items-center justify-center">
              {isYt ? (
                <iframe
                  src={getYouTubeEmbedUrl(rawLink)}
                  title={video.titulo}
                  className="w-full aspect-video border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : isVimeo ? (
                <iframe
                  src={getVimeoEmbedUrl(rawLink)}
                  title={video.titulo}
                  className="w-full aspect-video border-0"
                  allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
                  allowFullScreen
                />
              ) : (
                <>
                  <video
                    ref={nativeVideoRef}
                    src={rawLink}
                    controls
                    autoPlay
                    poster={poster}
                    onError={() => setStreamError(true)}
                    className="w-full aspect-video object-contain bg-black"
                  >
                    Seu navegador não suporta reprodução de vídeo nativa.
                  </video>

                  {streamError && (
                    <div className="absolute inset-0 bg-neutral-950/90 flex flex-col items-center justify-center p-6 text-center">
                      <AlertCircle className="size-12 text-red-500 mb-3 animate-bounce" />
                      <h3 className="text-base font-black text-white uppercase tracking-tight mb-1">
                        Não foi possível carregar o vídeo
                      </h3>
                      <p className="text-xs text-neutral-400 max-w-md mb-4">
                        O vídeo pode estar indisponível no momento. Tente novamente em instantes.
                      </p>
                      {rawLink && (
                        <a
                          href={rawLink}
                          target="_blank"
                          rel="noreferrer"
                          className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-emerald-500/20"
                        >
                          Abrir link original
                        </a>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Detalhes do Vídeo */}
            <div className="w-full bg-neutral-900/60 border border-white/10 rounded-3xl p-6 backdrop-blur-md">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/10 pb-4 mb-4">
                <div>
                  <h1 className="text-lg sm:text-2xl font-black text-white tracking-tight">
                    {video.titulo}
                  </h1>
                  <div className="flex items-center gap-2 mt-1.5">
                    <p className="text-sm font-bold text-red-400">{video.artista}</p>
                    <ScoreBadge score={video.metacriticAvg} variant="likes" />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!isYt && !isVimeo && (
                    <button
                      onClick={handlePictureInPicture}
                      title="Abrir em mini player (popup)"
                      className="size-9 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 grid place-items-center text-neutral-400 hover:text-white active:scale-90 transition-all"
                    >
                      <PictureInPicture2 className="size-4" />
                    </button>
                  )}
                  {/* Sempre "Empire Play HD" — a fonte real (YouTube/Vimeo/Drive)
                      é um detalhe interno, o layout deve parecer o mesmo pro
                      jogador independente de onde o vídeo veio. */}
                  <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-neutral-300 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="size-3.5 text-red-500" />
                    Empire Play HD
                  </span>
                </div>
              </div>

              {video.descricao && (
                <div className="text-neutral-300 text-xs sm:text-sm leading-relaxed whitespace-pre-line">
                  {video.descricao}
                </div>
              )}
            </div>
          </div>

          {/* Lateral: outros vídeos do mesmo artista */}
          {outrosDoArtista.length > 0 && (
            <div className="flex-[1_1_300px] min-w-[260px] max-w-[380px] flex flex-col gap-3">
              <h3 className="px-0.5 text-[11px] font-black uppercase tracking-wider text-neutral-300">
                Mais de {video.artista}
              </h3>
              {outrosDoArtista.map((v, idx) => (
                <button
                  key={v.id || idx}
                  onClick={() => {
                    haptic.selection();
                    onSelectVideo?.(v);
                  }}
                  className="flex gap-2.5 p-2 rounded-xl hover:bg-white/5 transition-colors text-left group"
                >
                  <div className="w-[140px] aspect-video rounded-lg overflow-hidden bg-neutral-950 shrink-0 relative">
                    {v.capa_url || v.poster_url ? (
                      <SmartImg
                        src={v.capa_url || v.poster_url}
                        size={300}
                        alt={v.titulo}
                        className="size-full object-cover group-hover:scale-105 transition-transform"
                        fallback={
                          <div className="size-full grid place-items-center text-neutral-600">
                            <Tv className="size-6" />
                          </div>
                        }
                      />
                    ) : (
                      <div className="size-full grid place-items-center text-neutral-600">
                        <Tv className="size-6" />
                      </div>
                    )}
                    <span className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors grid place-items-center">
                      <span className="size-8 rounded-full bg-red-600/0 group-hover:bg-red-500/85 backdrop-blur-sm text-white grid place-items-center transition-colors">
                        <Play className="size-3.5 ml-0.5 fill-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </span>
                    </span>
                  </div>
                  <div className="min-w-0 flex flex-col gap-0.5 pt-0.5">
                    <span className="text-xs font-bold text-neutral-100 group-hover:text-red-400 leading-snug line-clamp-2 transition-colors">
                      {v.titulo}
                    </span>
                    <span className="text-[11px] text-neutral-500">{v.artista}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 text-center text-[10px] font-black uppercase tracking-[0.2em] text-neutral-600">
        Empire Play • Media Streaming Engine
      </div>
    </div>
  );
}
