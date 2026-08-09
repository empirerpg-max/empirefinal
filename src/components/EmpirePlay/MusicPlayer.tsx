import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  Maximize2,
  Minimize2,
  FileText,
  Disc,
} from "lucide-react";
import { driveImg } from "@/lib/api";

export interface PlayableTrack {
  id?: string;
  titulo: string;
  artista: string;
  capa_url?: string;
  drive_url?: string;
  stream_url?: string;
  audio_url?: string;
  letra?: string;
  duracao?: string;
  album?: string;
  url?: string;
  link?: string;
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

export function MusicPlayer({
  currentTrack,
  playlist = [],
  onClose,
  onTrackChange,
}: MusicPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [audioError, setAudioError] = useState(false);

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

  const togglePlay = () => {
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
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const playNext = () => {
    if (!currentTrack || playlist.length === 0) return;
    const idx = playlist.findIndex(
      (t) => t.titulo === currentTrack.titulo && t.artista === currentTrack.artista,
    );
    if (idx >= 0 && idx < playlist.length - 1) {
      onTrackChange?.(playlist[idx + 1]);
    } else if (playlist.length > 0) {
      onTrackChange?.(playlist[0]);
    }
  };

  const playPrev = () => {
    if (!currentTrack || playlist.length === 0) return;
    const idx = playlist.findIndex(
      (t) => t.titulo === currentTrack.titulo && t.artista === currentTrack.artista,
    );
    if (idx > 0) {
      onTrackChange?.(playlist[idx - 1]);
    } else if (playlist.length > 0) {
      onTrackChange?.(playlist[playlist.length - 1]);
    }
  };

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
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${ytAudioId}?autoplay=1&enablejsapi=1`}
          title={currentTrack.titulo}
          className="w-1 h-1 opacity-0 pointer-events-none fixed bottom-0 right-0 z-[-1]"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
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
        <div className="fixed inset-0 z-[120] bg-neutral-950/95 backdrop-blur-2xl flex flex-col justify-between p-6 animate-in fade-in duration-300">
          {/* Top Bar Modal */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setIsExpanded(false)}
              className="p-3 rounded-full bg-white/5 border border-white/10 text-white hover:bg-white/10"
            >
              <Minimize2 className="size-5" />
            </button>
            <div className="text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">
                Tocando Agora
              </p>
              <p className="text-xs font-bold text-neutral-400 truncate max-w-[200px]">
                {currentTrack.album || "Empire Play Studio"}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-3 rounded-full bg-white/5 border border-white/10 text-white hover:bg-white/10"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Arte de Capa, Vídeo ou Letra */}
          <div className="flex-1 flex flex-col items-center justify-center my-6 max-w-sm mx-auto w-full">
            {showLyrics ? (
              <div className="size-full bg-white/5 border border-white/10 rounded-3xl p-6 overflow-y-auto text-neutral-200 text-sm leading-relaxed text-center font-medium shadow-2xl">
                <h4 className="text-xs font-black uppercase tracking-widest text-emerald-400 mb-4">
                  Letra de {currentTrack.titulo}
                </h4>
                {currentTrack.letra ? (
                  <p className="whitespace-pre-line">{currentTrack.letra}</p>
                ) : (
                  <p className="text-neutral-500 italic py-12">
                    Nenhuma letra cadastrada para esta faixa.
                  </p>
                )}
              </div>
            ) : isYtAudio && ytAudioId ? (
              <div className="relative aspect-video w-full rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.8)]">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${ytAudioId}?autoplay=1&enablejsapi=1`}
                  title={currentTrack.titulo}
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
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
                <p className="text-sm font-bold text-emerald-400 truncate">
                  {currentTrack.artista}
                </p>
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

      {/* MINI PLAYER FLUTUANTE (BOTTOM BAR) */}
      {!isExpanded && (
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
              <p className="text-[11px] font-medium text-neutral-400 truncate">
                {currentTrack.artista}
              </p>
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
    </>
  );
}
