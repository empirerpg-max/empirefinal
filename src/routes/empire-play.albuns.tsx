import { createFileRoute } from "@tanstack/react-router";
import { AlbumList } from "@/components/EmpirePlay/AlbumList";
import { useEmpirePlayer } from "@/components/EmpirePlay/PlayerContext";

export const Route = createFileRoute("/empire-play/albuns")({
  component: EmpirePlayAlbuns,
});

function EmpirePlayAlbuns() {
  const { playSong } = useEmpirePlayer();
  return <AlbumList onPlayTrack={playSong} />;
}
