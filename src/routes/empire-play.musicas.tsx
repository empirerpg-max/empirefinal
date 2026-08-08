import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Music, Play } from "lucide-react";
import { driveImg } from "@/lib/api";
import { toPlayableTrack } from "@/components/EmpirePlay/mappers";
import { useEmpirePlayer } from "@/components/EmpirePlay/PlayerContext";
import { type PlayableTrack } from "@/components/EmpirePlay/MusicPlayer";

export const Route = createFileRoute("/empire-play/musicas")({
  component: EmpirePlayMusicas,
});

function EmpirePlayMusicas() {
  const { playSong } = useEmpirePlayer();
  const [musicas, setMusicas] = useState<PlayableTrack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchMusicas() {
      setLoading(true);
      try {
        const res = await fetch("/api/empire-play/musicas")
          .then((r) => r.json())
          .catch(() => null);
        if (res && res.success) {
          if (!cancelled) setMusicas((res.data || []).map(toPlayableTrack));
        } else {
          const fallback = await fetch("/api/musicas")
            .then((r) => r.json())
            .catch(() => null);
          if (fallback && fallback.success && !cancelled)
            setMusicas((fallback.data || []).map(toPlayableTrack));
        }
      } catch {}
      if (!cancelled) setLoading(false);
    }
    fetchMusicas();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black text-white uppercase tracking-tight">
          Catálogo de Músicas ({musicas.length})
        </h2>
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-16 bg-neutral-900/60 rounded-2xl animate-pulse border border-white/5"
            />
          ))}
        </div>
      ) : musicas.length === 0 ? (
        <div className="text-center py-12 text-neutral-500 text-xs italic">
          Nenhuma música disponível no momento.
        </div>
      ) : (
        <div className="space-y-2">
          {musicas.slice(0, 100).map((m, idx) => (
            <div
              key={m.id || idx}
              onClick={() => playSong(m, musicas)}
              className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-neutral-900/50 hover:bg-neutral-800 border border-white/10 cursor-pointer transition-all group"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="font-mono text-xs text-neutral-500 w-6 text-center shrink-0">
                  {idx + 1}
                </span>
                <div className="size-12 rounded-xl bg-neutral-950 overflow-hidden shrink-0 border border-white/10">
                  {m.capa_url ? (
                    <img
                      src={driveImg(m.capa_url, 200)}
                      alt={m.titulo}
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="size-full grid place-items-center text-neutral-600">
                      <Music className="size-5" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 pr-2">
                  <p className="font-bold text-xs sm:text-sm text-white break-words leading-snug group-hover:text-emerald-400">
                    {m.titulo}
                  </p>
                  <p className="text-[11px] sm:text-xs text-neutral-400 break-words mt-0.5">
                    {m.artista}
                  </p>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  playSong(m, musicas);
                }}
                className="p-2.5 rounded-xl bg-white/5 hover:bg-emerald-500 hover:text-black text-white transition-all shrink-0"
              >
                <Play className="size-4 fill-current" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
