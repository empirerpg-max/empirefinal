import { createContext, useContext, useState, type ReactNode } from "react";
import { type PlayableTrack } from "./MusicPlayer";
import { type PlayableVideo } from "./VideoPlayer";
import { haptic } from "@/lib/telegram";

interface EmpirePlayerContextValue {
  currentTrack: PlayableTrack | null;
  activePlaylist: PlayableTrack[];
  currentVideo: PlayableVideo | null;
  // Lista de onde esse vídeo veio (ex.: catálogo inteiro da tela de Vídeos) —
  // usada pro VideoPlayer montar "Mais de {artista}" na lateral, sem cada
  // tela precisar saber disso. Sem lista explícita, cai pra [video] (sem
  // relacionados pra mostrar, mas sem quebrar os chamadores existentes).
  activeVideoList: PlayableVideo[];
  playSong: (track: PlayableTrack, list: PlayableTrack[]) => void;
  playVideo: (video: PlayableVideo, list?: PlayableVideo[]) => void;
  closeTrack: () => void;
  closeVideo: () => void;
  setCurrentTrack: (track: PlayableTrack) => void;
  // Posição/estado de reprodução, espelhados pelo MusicPlayer a cada tick —
  // permite que outras telas (ex.: Fórum) renderizem karaoke sincronizado
  // com o áudio tocando em segundo plano, sem precisar do player montado ali.
  currentTime: number;
  isPlaying: boolean;
  setPlaybackTime: (time: number) => void;
  setPlaybackPlaying: (playing: boolean) => void;
}

const EmpirePlayerContext = createContext<EmpirePlayerContextValue | null>(null);

/**
 * Mantém o estado de reprodução (áudio/vídeo) fora das rotas-filha da aba
 * ativa. As rotas de cada aba (Início, Músicas, etc.) desmontam ao navegar
 * entre elas; este provider vive na rota-layout `/empire-play`, então o
 * player nunca é desmontado ao trocar de aba.
 */
export function EmpirePlayerProvider({ children }: { children: ReactNode }) {
  const [currentTrack, setCurrentTrack] = useState<PlayableTrack | null>(null);
  const [activePlaylist, setActivePlaylist] = useState<PlayableTrack[]>([]);
  const [currentVideo, setCurrentVideo] = useState<PlayableVideo | null>(null);
  const [activeVideoList, setActiveVideoList] = useState<PlayableVideo[]>([]);
  const [currentTime, setPlaybackTime] = useState(0);
  const [isPlaying, setPlaybackPlaying] = useState(false);

  const playSong = (track: PlayableTrack, list: PlayableTrack[]) => {
    haptic.selection();
    setCurrentTrack(track);
    setActivePlaylist(list);
  };

  const playVideo = (video: PlayableVideo, list: PlayableVideo[] = [video]) => {
    haptic.selection();
    setCurrentVideo(video);
    setActiveVideoList(list);
  };

  return (
    <EmpirePlayerContext.Provider
      value={{
        currentTrack,
        activePlaylist,
        currentVideo,
        activeVideoList,
        playSong,
        playVideo,
        closeTrack: () => setCurrentTrack(null),
        closeVideo: () => setCurrentVideo(null),
        setCurrentTrack,
        currentTime,
        isPlaying,
        setPlaybackTime,
        setPlaybackPlaying,
      }}
    >
      {children}
    </EmpirePlayerContext.Provider>
  );
}

export function useEmpirePlayer(): EmpirePlayerContextValue {
  const ctx = useContext(EmpirePlayerContext);
  if (!ctx) {
    throw new Error("useEmpirePlayer deve ser usado dentro de <EmpirePlayerProvider>");
  }
  return ctx;
}
