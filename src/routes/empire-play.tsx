import { createFileRoute, Outlet } from "@tanstack/react-router";
import { EmpirePlayHeader } from "@/components/EmpirePlay/Header";
import { EmpirePlayTabNav } from "@/components/EmpirePlay/TabNav";
import { EmpirePlayerProvider, useEmpirePlayer } from "@/components/EmpirePlay/PlayerContext";
import { MusicPlayer } from "@/components/EmpirePlay/MusicPlayer";
import { VideoPlayer } from "@/components/EmpirePlay/VideoPlayer";

export const Route = createFileRoute("/empire-play")({
  head: () => ({
    meta: [
      { title: "Empire Play — Empire Hub" },
      { name: "description", content: "Músicas, vídeos, álbuns e o fórum do Empire Play." },
    ],
  }),
  component: EmpirePlayLayout,
});

function EmpirePlayLayout() {
  return (
    <EmpirePlayerProvider>
      <div className="w-full max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6 pb-28 min-w-0 max-w-full overflow-x-hidden">
        <EmpirePlayHeader />
        <EmpirePlayTabNav />
        <Outlet />
        <EmpirePlayPersistentPlayers />
      </div>
    </EmpirePlayerProvider>
  );
}

/**
 * Players montados fora do <Outlet/>, na rota-layout: navegar entre as abas
 * (rotas-filha) não os desmonta, então a reprodução de áudio/vídeo continua
 * ao trocar de aba.
 */
function EmpirePlayPersistentPlayers() {
  const { currentTrack, activePlaylist, currentVideo, closeTrack, closeVideo, setCurrentTrack } =
    useEmpirePlayer();

  return (
    <>
      <MusicPlayer
        currentTrack={currentTrack}
        playlist={activePlaylist}
        onClose={closeTrack}
        onTrackChange={setCurrentTrack}
      />
      <VideoPlayer video={currentVideo} onClose={closeVideo} />
    </>
  );
}
