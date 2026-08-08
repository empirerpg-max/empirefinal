import { createFileRoute } from "@tanstack/react-router";
import { Forum } from "@/components/EmpirePlay/Forum";
import { useEmpirePlayer } from "@/components/EmpirePlay/PlayerContext";

export const Route = createFileRoute("/empire-play/forum")({
  component: EmpirePlayForum,
});

function EmpirePlayForum() {
  const { playSong, playVideo } = useEmpirePlayer();
  return <Forum onPlayTrack={playSong} onPlayVideo={playVideo} />;
}
