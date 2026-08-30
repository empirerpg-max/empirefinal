import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  Maximize2,
  Minimize2,
  FileText,
  FileWarning,
  Loader2,
  Disc,
  MessageSquare,
  Mic2,
} from "lucide-react";
import { toast } from "sonner";
import { api, driveImg } from "@/lib/api";
import { haptic, useTelegramUser } from "@/lib/telegram";
import { ScoreBadge } from "./ScoreBadge";
import { LyricSyncModal } from "./LyricSyncModal";
import { parseLrc, findCurrentLrcLineIndex } from "@/lib/lrc";
import { useEmpirePlayer } from "./PlayerContext";

export interface PlayableTrack {
  id?: string;
  titulo: string;
  artista: string;
  capa_url?: string;
  drive_url?: string;
  stream_url?: string;
  audio_url?: string;
  letra?: string;
  // LRC ("[mm:ss.cc]texto" por linha) — quando presente, a tela de letra
  // vira sincronizada (acompanha o áudio) em vez de texto estático.
  letraSincronizada?: string | null;
  // ID do tópico no Telegram — usado pra localizar a linha certa em Musicas
  // na hora de gravar a sincronização (ver LyricSyncModal).
  telegramTopicId?: string | null;
  duracao?: string;
  album?: string;
  url?: string;
  link?: string;
  metacriticAvg?: number | string | null;
  /** Aba do fórum onde este item aparece ("musicas", por padrão). */
  forumTab?: string;
  /** Foto de perfil do artista (aba ARTISTAS) — distinta de capa_url. */
  artista_foto_url?: string;
}

interface MusicPlayerProps {
  currentTrack: PlayableTrack | null;
  playlist?: PlayableTrack[];
  onClose: () => void;
  onTrackChange?: (track: PlayableTrack) => void;
}

/**
 * Extrai o ID do vídeo do YouTube a partir de diversas variações de URL
 */
export function extractYouTubeId(url: string | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const ytRegex = /(?:youtu\.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|&v=)([^#&?]*)/;
  const match = trimmed.match(ytRegex);
  if (match && match[1] && match[1].length === 11) {
    return match[1];
  }
  return null;
}

/**
 * Extrai o ID do arquivo do Google Drive
 */
export function extractDriveFileId(url: string | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (!trimmed.startsWith("http") && !trimmed.includes("/") && /^[-\w]{25,}$/.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(/[-\w]{25,}/);
  return match ? match[0] : null;
}

// Carrega a IFrame API do YouTube uma única vez (mesmo com vários
// componentes montando/desmontando) — resolve assim que window.YT.Player
// existir.
let youtubeApiPromise: Promise<void> | null = null;
function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as any).YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve) => {
    const prevCallback = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      prevCallback?.();
      resolve();
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
  return youtubeApiPromise;
}

export function MusicPlayer({
  currentTrack,
  playlist = [],
  onClose,
  onTrackChange,
}: MusicPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [reportingWrong, setReportingWrong] = useState(false);
  const [wrongReported, setWrongReported] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const { user } = useTelegramUser();
  // Espelha posição/estado no contexto global pra outras telas (Fórum)
  // conseguirem renderizar karaoke sem precisar remontar o player.
  const { setPlaybackTime, setPlaybackPlaying } = useEmpirePlayer();
  useEffect(() => {
    setPlaybackTime(currentTime);
  }, [currentTime, setPlaybackTime]);
  useEffect(() => {
    setPlaybackPlaying(isPlaying);
  }, [isPlaying, setPlaybackPlaying]);
  // Só o dono do artista da faixa pode sincronizar a letra — confere contra
  // a lista de artistas do próprio jogador (mesmo padrão usado no perfil do
  // artista e nos posts de Social).
  const [ownedArtists, setOwnedArtists] = useState<string[]>([]);
  useEffect(() => {
    if (!user || user.id === "guest") {
      setOwnedArtists([]);
      return;
    }
    let alive = true;
    api
      .meusArtistas(user.id)
      .then((arts) => alive && setOwnedArtists(arts.map((a) => a.nome?.trim().toLowerCase()).filter(Boolean)))
      .catch(() => alive && setOwnedArtists([]));
    return () => {
      alive = false;
    };
  }, [user]);
  const isOwnerOfTrack = !!currentTrack && ownedArtists.includes(currentTrack.artista?.trim().toLowerCase());

  // Sobrepõe o LRC gravado na hora, sem esperar o catálogo recarregar do
  // zero — currentTrack é controlado por quem chama o player, então não dá
  // pra mutar a prop diretamente depois de salvar.
  const [justSyncedLrc, setJustSyncedLrc] = useState<string | null>(null);
  useEffect(() => setJustSyncedLrc(null), [currentTrack?.id]);
  const syncedLines = useMemo(
    () => parseLrc(justSyncedLrc ?? currentTrack?.letraSincronizada),
    [justSyncedLrc, currentTrack?.letraSincronizada],
  );
  const currentSyncedLineIndex = useMemo(
    () => findCurrentLrcLineIndex(syncedLines, currentTime),
    [syncedLines, currentTime],
  );
  const syncedLineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  useEffect(() => {
    if (currentSyncedLineIndex < 0) return;
    syncedLineRefs.current[currentSyncedLineIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [currentSyncedLineIndex]);
  // Pode sincronizar quando já tem áudio (a tela precisa tocar) e letra
  // normal cadastrada (é o que vira linha por linha na tela de sincronia).
  const canSyncLyrics =
    !!currentTrack?.letra &&
    !!(currentTrack?.audio_url || currentTrack?.stream_url || currentTrack?.drive_url);

  async function handleReportWrongContent() {
    if (!currentTrack?.id || reportingWrong || wrongReported) return;
    haptic.selection();
    setReportingWrong(true);
    try {
      const res = await fetch("/api/empire-play/report-wrong-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: currentTrack.id,
          title: currentTrack.titulo,
          artist: currentTrack.artista,
        }),
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

  // Estado de carregamento do áudio (Drive serve via proxy do backend,
  // que evita bloqueio de CORS do fetch direto ao drive.google.com)
  const [isBlobLoading, setIsBlobLoading] = useState(false);

  // Resolve candidato de link
  const rawCandidate = currentTrack
    ? currentTrack.audio_url ||
      currentTrack.stream_url ||
      currentTrack.drive_url ||
      currentTrack.url ||
      currentTrack.link ||
      (currentTrack as any).audioUrl ||
      (currentTrack as any).videoUrl ||
      (currentTrack as any).media_url
    : undefined;

  const audioSrc = rawCandidate ? rawCandidate.trim() : undefined;

  // Extração de IDs
  const ytAudioId = extractYouTubeId(audioSrc);
  const isYtAudio = Boolean(ytAudioId);

  const driveFileId = extractDriveFileId(audioSrc);
  const isDriveAudio = Boolean(
    audioSrc &&
    (audioSrc.includes("drive.google.com") ||
      audioSrc.includes("googleusercontent.com") ||
      audioSrc.includes("docs.google.com") ||
      driveFileId),
  );

  // Reseta erro ao trocar de faixa
  useEffect(() => {
    setAudioError(false);
  }, [audioSrc]);

  // Fonte efetiva para a tag <audio>: áudio do Drive vai sempre pelo proxy
  // /api/media/audio do backend (suporta Range/206) — um fetch direto do
  // navegador para drive.google.com é bloqueado por CORS na maioria dos
  // casos, o que fazia a faixa nunca carregar.
  const effectiveAudioSrc =
    isDriveAudio && driveFileId ? `/api/media/audio?id=${driveFileId}` : audioSrc;

  // Atualiza e carrega a tag <audio>
  useEffect(() => {
    if (!audioRef.current || !effectiveAudioSrc || isYtAudio) return;

    audioRef.current.src = effectiveAudioSrc;
    audioRef.current.load();
    setIsPlaying(true);

    const playPromise = audioRef.current.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn("[MusicPlayer] Autoplay prevenido ou erro na reprodução:", err);
        setIsPlaying(false);
      });
    }
  }, [effectiveAudioSrc, isYtAudio]);

  // Mantém a ref sempre com a versão mais recente de playNext, pra o
  // player do YouTube (criado uma vez por faixa) poder chamar "próxima"
  // no fim do vídeo sem precisar recriar o player a cada render.
  const playNextRef = useRef<() => void>(() => {});

  // Cria/reaproveita o player do YouTube via IFrame API — controlado
  // pelos mesmos botões/barra de progresso do resto do player, pra tocar
  // e mostrar o tempo exatamente igual às faixas do Drive.
  useEffect(() => {
    if (!isYtAudio || !ytAudioId) {
      if (ytPlayerRef.current) {
        ytPlayerRef.current.destroy?.();
        ytPlayerRef.current = null;
      }
      return;
    }
    let cancelled = false;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    loadYouTubeIframeApi().then(() => {
      if (cancelled || !ytContainerRef.current) return;
      const YT = (window as any).YT;
      if (ytPlayerRef.current?.loadVideoById) {
        ytPlayerRef.current.loadVideoById(ytAudioId);
        return;
      }
      // A IFrame API substitui o elemento que recebe pelo iframe dela
      // mesma — se fosse um nó que o React está de olho (via ref direta
      // num elemento do JSX), o React tentava remover esse nó depois
      // achando que ainda é dele, e quebrava com "removeChild... not a
      // child of this node". Criando o alvo manualmente (fora da árvore
      // que o React controla) e só anexando dentro do container, o
      // React nunca fica sabendo que ele foi trocado.
      ytContainerRef.current.innerHTML = "";
      const mountEl = document.createElement("div");
      ytContainerRef.current.appendChild(mountEl);
      ytPlayerRef.current = new YT.Player(mountEl, {
        videoId: ytAudioId,
        playerVars: { autoplay: 1, controls: 0, playsinline: 1 },
        events: {
          onReady: (e: any) => {
            if (cancelled) return;
            e.target.playVideo();
            setDuration(e.target.getDuration() || 0);
          },
          onStateChange: (e: any) => {
            if (e.data === YT.PlayerState.PLAYING) setIsPlaying(true);
            else if (e.data === YT.PlayerState.PAUSED) setIsPlaying(false);
            else if (e.data === YT.PlayerState.ENDED) {
              setIsPlaying(false);
              playNextRef.current();
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, [isYtAudio, ytAudioId]);

  // Destrói o player do YouTube quando o componente desmonta de vez.
  useEffect(() => {
    return () => {
      ytPlayerRef.current?.destroy?.();
      ytPlayerRef.current = null;
    };
  }, []);

  // Enquanto uma faixa do YouTube está tocando, a IFrame API não dispara
  // eventos contínuos de tempo (como o "timeupdate" do <audio>) — precisa
  // perguntar o tempo atual de tempos em tempos pra barra de progresso
  // andar igual à das faixas do Drive.
  useEffect(() => {
    if (!isYtAudio || !isPlaying) return;
    const id = setInterval(() => {
      const p = ytPlayerRef.current;
      if (p?.getCurrentTime) {
        setCurrentTime(p.getCurrentTime());
        setDuration(p.getDuration() || 0);
      }
    }, 500);
    return () => clearInterval(id);
  }, [isYtAudio, isPlaying]);

  const togglePlay = () => {
    if (isYtAudio) {
      const p = ytPlayerRef.current;
      if (!p) return;
      if (isPlaying) p.pauseVideo?.();
      else p.playVideo?.();
      return;
    }
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {});
    }
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    setCurrentTime(audioRef.current.currentTime);
    setDuration(audioRef.current.duration || 0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (isYtAudio) {
      ytPlayerRef.current?.seekTo?.(time, true);
    } else if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  // Prefere casar pelo "id" (estável, único por faixa) quando disponível —
  // casar só por título+artista pode achar a ocorrência ERRADA (índice
  // "congelado" no primeiro match) sempre que duas faixas da mesma lista
  // têm título/artista iguais, o que trava avançar/voltar na mesma faixa.
  const findCurrentIndex = () => {
    if (!currentTrack || playlist.length === 0) return -1;
    if (currentTrack.id) {
      const byId = playlist.findIndex((t) => t.id === currentTrack.id);
      if (byId >= 0) return byId;
    }
    return playlist.findIndex(
      (t) => t.titulo === currentTrack.titulo && t.artista === currentTrack.artista,
    );
  };

  const playNext = () => {
    if (!currentTrack || playlist.length === 0) return;
    const idx = findCurrentIndex();
    if (idx >= 0 && idx < playlist.length - 1) {
      onTrackChange?.(playlist[idx + 1]);
    } else if (playlist.length > 0) {
      onTrackChange?.(playlist[0]);
    }
  };

  useEffect(() => {
    playNextRef.current = playNext;
  });

  const playPrev = () => {
    if (!currentTrack || playlist.length === 0) return;
    const idx = findCurrentIndex();
    if (idx > 0) {
      onTrackChange?.(playlist[idx - 1]);
    } else if (playlist.length > 0) {
      onTrackChange?.(playlist[playlist.length - 1]);
    }
  };

  // Media Session API — dá ao navegador/SO os controles de mídia (tela de
  // bloqueio, notificação, fones bluetooth) e é o que faz o áudio continuar
  // tocando em segundo plano de forma "oficial" fora do Telegram (dentro do
  // WebView do Telegram, a suspensão de JS ao minimizar é uma limitação da
  // própria plataforma, fora do nosso controle).
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (!currentTrack) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.titulo || "Empire Hub",
      artist: currentTrack.artista || "",
      artwork: currentTrack.capa_url
        ? [{ src: currentTrack.capa_url, sizes: "512x512", type: "image/jpeg" }]
        : [],
    });
    navigator.mediaSession.setActionHandler("play", () => togglePlay());
    navigator.mediaSession.setActionHandler("pause", () => togglePlay());
    navigator.mediaSession.setActionHandler("previoustrack", () => playPrev());
    navigator.mediaSession.setActionHandler("nexttrack", () => playNext());
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, currentTrack?.titulo]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  if (!currentTrack) return null;

  const cover = currentTrack.capa_url ? driveImg(currentTrack.capa_url, 300) : undefined;

  return (
    <>
      {isYtAudio && ytAudioId ? (
        // A IFrame API substitui essa div pelo iframe dela mesma — fica
        // fora de tela; o play/pause/progresso reais vêm da API (efeitos
        // acima), controlados pelos mesmos botões do resto do player.
        <div
          ref={ytContainerRef}
          className="w-1 h-1 opacity-0 pointer-events-none fixed bottom-0 right-0 z-[-1]"
        />
      ) : (
        <audio
          ref={audioRef}
          onTimeUpdate={handleTimeUpdate}
          onEnded={playNext}
          onError={() => {
            console.warn("[MusicPlayer] Erro na reprodução do áudio.");
            setAudioError(true);
          }}
        />
      )}

      {/* MODAL EXPANDIDO DE REPRODUÇÃO */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-[120] bg-neutral-950/95 backdrop-blur-2xl flex flex-col justify-between px-6 pb-6 animate-in fade-in duration-300"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 24px)" }}
        >
          {/* Top Bar Modal — empurrado abaixo do notch/status bar (padding
              acima) pra nunca ficar sob a área do sistema, onde os botões
              renderizavam mas ficavam inclicáveis (relato: "cliquei e nada
              aconteceu"). */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button
              onClick={() => setIsExpanded(false)}
              className="p-3 rounded-full bg-white/5 border border-white/10 text-white hover:bg-white/10 shrink-0"
            >
              <Minimize2 className="size-5" />
            </button>
            <div className="text-center min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">
                Tocando Agora
              </p>
              <p className="text-xs font-bold text-neutral-400 truncate max-w-[160px] sm:max-w-[200px]">
                {currentTrack.album || "Empire Play Studio"}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {currentTrack.id && (
                <Link
                  to="/empire-play/forum"
                  search={{ tab: currentTrack.forumTab || "musicas", id: currentTrack.id }}
                  onClick={() => {
                    haptic.selection();
                    // Recolhe pro mini player (a música continua tocando)
                    // pra revelar o Fórum por baixo do modal em tela cheia.
                    setIsExpanded(false);
                  }}
                  title="Ver no Fórum"
                  className="p-3 rounded-full bg-white/5 border border-white/10 text-neutral-400 hover:text-white hover:bg-white/10"
                >
                  <MessageSquare className="size-5" />
                </Link>
              )}
              {currentTrack.id && (
                <button
                  onClick={handleReportWrongContent}
                  disabled={reportingWrong || wrongReported}
                  title={
                    wrongReported
                      ? "Já reportado, obrigado!"
                      : "Essa não é a música correta (arquivo errado)"
                  }
                  className="p-3 rounded-full bg-white/5 border border-white/10 text-neutral-400 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {reportingWrong ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <FileWarning className="size-5" />
                  )}
                </button>
              )}
              <button
                onClick={onClose}
                className="p-3 rounded-full bg-white/5 border border-white/10 text-white hover:bg-white/10"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>

          {/* Arte de Capa, Vídeo ou Letra */}
          <div className="flex-1 flex flex-col items-center justify-center my-6 max-w-sm mx-auto w-full">
            {showLyrics ? (
              <div className="size-full bg-white/5 border border-white/10 rounded-3xl p-6 overflow-y-auto text-neutral-200 text-sm leading-relaxed text-center font-medium shadow-2xl">
                <h4 className="text-xs font-black uppercase tracking-widest text-emerald-400 mb-4">
                  Letra de {currentTrack.titulo}
                </h4>
                {syncedLines.length > 0 ? (
                  <div className="space-y-3">
                    {syncedLines.map((line, i) => (
                      <p
                        key={i}
                        ref={(el) => {
                          syncedLineRefs.current[i] = el;
                        }}
                        className={
                          i === currentSyncedLineIndex
                            ? "text-white font-black text-base transition-colors"
                            : i < currentSyncedLineIndex
                              ? "text-neutral-600 transition-colors"
                              : "text-neutral-400 transition-colors"
                        }
                      >
                        {line.text}
                      </p>
                    ))}
                  </div>
                ) : currentTrack.letra ? (
                  <p className="whitespace-pre-line">{currentTrack.letra}</p>
                ) : (
                  <p className="text-neutral-500 italic py-12">
                    Nenhuma letra cadastrada para esta faixa.
                  </p>
                )}
              </div>
            ) : (
              <div className="relative aspect-square w-full rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.8)] group">
                {cover ? (
                  <img src={cover} alt={currentTrack.titulo} className="size-full object-cover" />
                ) : (
                  <div className="size-full grid place-items-center bg-gradient-to-br from-neutral-800 to-neutral-950">
                    <Disc className="size-24 text-emerald-500/30 animate-spin-slow" />
                  </div>
                )}
                {isBlobLoading && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                    <div className="text-center space-y-2">
                      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
                      <p className="text-xs font-semibold text-emerald-400">Carregando áudio...</p>
                    </div>
                  </div>
                )}
                {audioError && (
                  <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <p className="text-xs text-center font-semibold text-red-400">
                      Não foi possível carregar o áudio. Tente novamente em instantes.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Informações e Controles Expandidos */}
          <div className="max-w-md mx-auto w-full space-y-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <h3 className="text-xl font-black text-white truncate tracking-tight">
                  {currentTrack.titulo}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-sm font-bold text-emerald-400 truncate">
                    {currentTrack.artista}
                  </p>
                  <ScoreBadge score={currentTrack.metacriticAvg} variant="metacritic" />
                </div>
              </div>
              {currentTrack.letra && (
                <button
                  onClick={() => setShowLyrics(!showLyrics)}
                  className={`p-3 rounded-2xl border transition-all ${
                    showLyrics
                      ? "bg-emerald-500 text-black border-emerald-400"
                      : "bg-white/5 border-white/10 text-neutral-300 hover:text-white"
                  }`}
                  title="Ver Letra"
                >
                  <FileText className="size-5" />
                </button>
              )}
              {isOwnerOfTrack && canSyncLyrics && (
                <button
                  onClick={() => setShowSyncModal(true)}
                  className="p-3 rounded-2xl border bg-white/5 border-white/10 text-neutral-300 hover:text-white transition-all"
                  title={currentTrack.letraSincronizada ? "Editar sincronização" : "Sincronizar Letra"}
                >
                  <Mic2 className="size-5" />
                </button>
              )}
            </div>

            {/* Seek Bar */}
            <div className="space-y-1">
              <input
                type="range"
                min={0}
                max={duration || 100}
                value={currentTime}
                onChange={handleSeek}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <div className="flex justify-between text-[11px] font-mono text-neutral-400">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Controles Principais */}
            <div className="flex items-center justify-center gap-6 pt-2">
              <button
                onClick={playPrev}
                className="p-3 text-neutral-300 hover:text-white active:scale-90 transition-transform"
              >
                <SkipBack className="size-7" />
              </button>
              <button
                onClick={togglePlay}
                className="size-16 rounded-full bg-emerald-500 text-black grid place-items-center shadow-lg shadow-emerald-500/30 active:scale-95 transition-transform"
              >
                {isPlaying ? <Pause className="size-8" /> : <Play className="size-8 ml-1" />}
              </button>
              <button
                onClick={playNext}
                className="p-3 text-neutral-300 hover:text-white active:scale-90 transition-transform"
              >
                <SkipForward className="size-7" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MINI PLAYER FLUTUANTE (BOTTOM BAR) — nunca junto com o Estúdio de
          Sincronização: se o modal ficar aberto e o player minimizar, as
          duas barras fixas no rodapé sobrepunham (seek bar do estúdio por
          cima do mini player). */}
      {!isExpanded && !showSyncModal && (
        <div className="fixed bottom-20 inset-x-3 z-[100] max-w-xl mx-auto rounded-2xl bg-neutral-900/90 border border-white/15 p-3 backdrop-blur-xl shadow-[0_10px_30px_rgba(0,0,0,0.8)] flex items-center justify-between gap-3 animate-in slide-in-from-bottom-5 duration-300">
          {/* Arte + Infos */}
          <button
            onClick={() => setIsExpanded(true)}
            className="flex items-center gap-3 min-w-0 flex-1 text-left group"
          >
            <div className="size-12 rounded-xl bg-neutral-800 overflow-hidden flex-shrink-0 border border-white/10 relative">
              {cover ? (
                <img src={cover} alt={currentTrack.titulo} className="size-full object-cover" />
              ) : (
                <div className="size-full grid place-items-center bg-neutral-800">
                  <Disc className="size-6 text-emerald-400" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h4 className="text-xs font-black text-white truncate group-hover:text-emerald-400 transition-colors">
                {currentTrack.titulo}
              </h4>
              <div className="flex items-center gap-1.5">
                <p className="text-[11px] font-medium text-neutral-400 truncate">
                  {currentTrack.artista}
                </p>
                <ScoreBadge
                  score={currentTrack.metacriticAvg}
                  variant="metacritic"
                  className="!px-1.5 !py-0 !text-[10px] shrink-0"
                />
              </div>
            </div>
          </button>

          {/* Controles do Mini Player */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={togglePlay}
              className="size-10 rounded-full bg-emerald-500 text-black grid place-items-center active:scale-90 transition-transform shadow-md"
            >
              {isPlaying ? <Pause className="size-5" /> : <Play className="size-5 ml-0.5" />}
            </button>

            <button
              onClick={playNext}
              className="p-2 text-neutral-400 hover:text-white active:scale-90 transition-transform"
            >
              <SkipForward className="size-5" />
            </button>

            <button
              onClick={() => setIsExpanded(true)}
              title="Expandir Player"
              className="p-2 text-neutral-400 hover:text-white"
            >
              <Maximize2 className="size-4" />
            </button>

            <button
              onClick={onClose}
              title="Fechar Player"
              className="p-2 text-neutral-400 hover:text-red-400"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {showSyncModal && currentTrack && (
        <LyricSyncModal
          track={currentTrack}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          onTogglePlay={togglePlay}
          onSeek={(time) => {
            setCurrentTime(time);
            if (audioRef.current) audioRef.current.currentTime = time;
          }}
          onClose={() => setShowSyncModal(false)}
          onSaved={(lrc) => {
            setJustSyncedLrc(lrc);
            setShowSyncModal(false);
          }}
        />
      )}
    </>
  );
}
