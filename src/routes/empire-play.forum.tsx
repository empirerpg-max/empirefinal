import { createFileRoute } from "@tanstack/react-router";
import { Forum } from "@/components/EmpirePlay/Forum";
import { useEmpirePlayer } from "@/components/EmpirePlay/PlayerContext";

export const Route = createFileRoute("/empire-play/forum")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: s.tab ? String(s.tab) : undefined,
    id: s.id ? String(s.id) : undefined,
  }),
  component: EmpirePlayForum,
});

function EmpirePlayForum() {
  const { playSong, playVideo } = useEmpirePlayer();
  const { tab, id } = Route.useSearch();
  return <Forum onPlayTrack={playSong} onPlayVideo={playVideo} initialTab={tab} initialItemId={id} />;
}
