import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Tv, Play, MessageSquare, Search } from "lucide-react";
import { driveImg } from "@/lib/api";
import { toPlayableVideo } from "@/components/EmpirePlay/mappers";
import { useEmpirePlayer } from "@/components/EmpirePlay/PlayerContext";
import { type PlayableVideo } from "@/components/EmpirePlay/VideoPlayer";
import { ScoreBadge } from "@/components/EmpirePlay/ScoreBadge";
import { LoadErrorState } from "@/components/LoadErrorState";

export const Route = createFileRoute("/empire-play/videos")({
  component: EmpirePlayVideos,
});

function EmpirePlayVideos() {
  const { playVideo } = useEmpirePlayer();
  const [videos, setVideos] = useState<PlayableVideo[]>([]);
  const [activeTag, setActiveTag] = useState<string>("Todos");
  // Antes não existia loading/erro nenhum aqui — a tela renderizava o grid
  // vazio desde o primeiro instante (parecendo "sem vídeos" por um
  // instante) e uma falha real de rede também virava silenciosamente "sem
  // vídeos", sem diferença nenhuma pro jogador.
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  function fetchVideos() {
    let cancelled = false;
    setLoading(true);
    setErro(false);
    fetch("/api/empire-play/videos")
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (res && res.success) setVideos((res.data || []).map(toPlayableVideo));
        else setErro(true);
      })
      .catch(() => {
        if (!cancelled) setErro(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }

  useEffect(() => fetchVideos(), []);

  // Tags derivadas dos próprios dados (coluna "Tipo de vídeo") — Vídeos e
  // Music Videos foram consolidados num catálogo único, filtrável por tag
  // em vez de duas telas separadas.
  const tags = useMemo(() => {
    const set = new Set<string>();
    videos.forEach((v) => {
      if (v.tipo_video) set.add(v.tipo_video);
    });
    return ["Todos", ...Array.from(set).sort()];
  }, [videos]);

  const porTag = activeTag === "Todos" ? videos : videos.filter((v) => v.tipo_video === activeTag);
  const filtered = searchQuery.trim()
    ? porTag.filter((v) => {
        const q = searchQuery.toLowerCase();
        return v.titulo?.toLowerCase().includes(q) || v.artista?.toLowerCase().includes(q);
      })
    : porTag;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-black text-white uppercase tracking-tight">
          Vídeos ({filtered.length})
        </h2>
      </div>

      {!loading && !erro && videos.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-neutral-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Pesquisar vídeos ou artistas..."
            className="w-full pl-10 pr-4 py-2.5 bg-neutral-900/80 border border-white/10 rounded-xl text-xs sm:text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-red-500 transition"
          />
        </div>
      )}

      {tags.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag(tag)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-all shrink-0 border ${
                activeTag === tag
                  ? "bg-red-500 text-black border-red-400"
                  : "bg-white/5 text-neutral-400 border-white/10 hover:text-white hover:border-white/20"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-video rounded-2xl bg-neutral-900/60 animate-pulse border border-white/5" />
          ))}
        </div>
      ) : erro ? (
        <LoadErrorState onRetry={fetchVideos} />
      ) : videos.length === 0 ? (
        <div className="text-center py-12 text-neutral-500 text-xs italic">
          Nenhum vídeo disponível no momento.
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-neutral-500 text-xs italic">
          Nenhum vídeo encontrado pra "{searchQuery}".
        </div>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {filtered.map((v, idx) => (
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
              <span className="absolute inset-0 bg-black/0 sm:group-hover:bg-black/40 transition-colors grid place-items-center">
                <span className="size-11 rounded-full bg-red-600/70 sm:group-hover:bg-red-500/85 backdrop-blur-sm text-white grid place-items-center transition-colors">
                  <Play className="size-5 ml-0.5 fill-white" />
                </span>
              </span>
              {v.tipo_video && (
                <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/80 text-[10px] font-black uppercase tracking-wider text-neutral-300 border border-white/10">
                  {v.tipo_video}
                </span>
              )}
              <div className="absolute top-2 right-2 pointer-events-none">
                <ScoreBadge score={v.metacriticAvg} variant="likes" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h4 className="font-bold text-xs text-white truncate group-hover:text-red-400">
                  {v.titulo}
                </h4>
                <p className="text-[11px] text-neutral-400 truncate">{v.artista}</p>
              </div>
              {v.id && (
                <Link
                  to="/empire-play/forum"
                  search={{ tab: v.forumTab || "videos", id: v.id }}
                  onClick={(e) => e.stopPropagation()}
                  title="Ver no Fórum"
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-all shrink-0"
                >
                  <MessageSquare className="size-3.5" />
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
