import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Film, Play } from "lucide-react";
import { driveImg } from "@/lib/api";
import { toPlayableVideo } from "@/components/EmpirePlay/mappers";
import { useEmpirePlayer } from "@/components/EmpirePlay/PlayerContext";
import { type PlayableVideo } from "@/components/EmpirePlay/VideoPlayer";
import { ScoreBadge } from "@/components/EmpirePlay/ScoreBadge";

export const Route = createFileRoute("/empire-play/music-videos")({
  component: EmpirePlayMusicVideos,
});

function EmpirePlayMusicVideos() {
  const { playVideo } = useEmpirePlayer();
  const [musicVideos, setMusicVideos] = useState<PlayableVideo[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/empire-play/music-videos")
      .then((r) => r.json())
      .then((res) => {
        if (res && res.success && !cancelled) setMusicVideos((res.data || []).map(toPlayableVideo));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-black text-white uppercase tracking-tight">Music Videos</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {musicVideos.map((mv, idx) => (
          <div
            key={mv.id || idx}
            onClick={() => playVideo(mv)}
            className="rounded-2xl bg-neutral-900/50 border border-white/10 p-3 hover:border-red-500/40 cursor-pointer transition-all group"
          >
            <div className="aspect-video rounded-xl overflow-hidden bg-neutral-950 mb-2 relative">
              {mv.capa_url || mv.poster_url ? (
                <img
                  src={driveImg(mv.capa_url || mv.poster_url, 400)}
                  alt={mv.titulo}
                  className="size-full object-cover group-hover:scale-105 transition-transform"
                />
              ) : (
                <div className="size-full grid place-items-center text-neutral-600">
                  <Film className="size-10" />
                </div>
              )}
              <span className="absolute inset-0 bg-black/40 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Play className="size-8 text-white fill-white" />
              </span>
              <div className="absolute top-2 right-2 pointer-events-none">
                <ScoreBadge score={mv.metacriticAvg} variant="likes" />
              </div>
            </div>
            <h4 className="font-bold text-xs text-white truncate group-hover:text-red-400">
              {mv.titulo}
            </h4>
            <p className="text-[11px] text-neutral-400 truncate">{mv.artista}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
