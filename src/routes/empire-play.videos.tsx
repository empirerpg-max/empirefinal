import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Tv } from "lucide-react";
import { driveImg } from "@/lib/api";
import { toPlayableVideo } from "@/components/EmpirePlay/mappers";
import { useEmpirePlayer } from "@/components/EmpirePlay/PlayerContext";
import { type PlayableVideo } from "@/components/EmpirePlay/VideoPlayer";
import { ScoreBadge } from "@/components/EmpirePlay/ScoreBadge";

export const Route = createFileRoute("/empire-play/videos")({
  component: EmpirePlayVideos,
});

function EmpirePlayVideos() {
  const { playVideo } = useEmpirePlayer();
  const [videos, setVideos] = useState<PlayableVideo[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/empire-play/videos")
      .then((r) => r.json())
      .then((res) => {
        if (res && res.success && !cancelled) setVideos((res.data || []).map(toPlayableVideo));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-black text-white uppercase tracking-tight">Vídeos Gerais</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {videos.map((v, idx) => (
          <div
            key={v.id || idx}
            onClick={() => playVideo(v)}
            className="rounded-2xl bg-neutral-900/50 border border-white/10 p-3 hover:border-red-500/40 cursor-pointer transition-all group"
          >
            <div className="aspect-video rounded-xl overflow-hidden bg-neutral-950 mb-2 relative">
              {v.capa_url || v.poster_url ? (
                <img
                  src={driveImg(v.capa_url || v.poster_url, 400)}
                  alt={v.titulo}
                  className="size-full object-cover group-hover:scale-105 transition-transform"
                />
              ) : (
                <div className="size-full grid place-items-center text-neutral-600">
                  <Tv className="size-10" />
                </div>
              )}
              <div className="absolute top-2 right-2 pointer-events-none">
                <ScoreBadge score={v.metacriticAvg} variant="likes" />
              </div>
            </div>
            <h4 className="font-bold text-xs text-white truncate group-hover:text-red-400">
              {v.titulo}
            </h4>
            <p className="text-[11px] text-neutral-400 truncate">{v.artista}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
