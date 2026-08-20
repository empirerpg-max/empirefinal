import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Flame, Sparkles, Music, Film, Play, Search, ChevronLeft, X } from "lucide-react";
import { driveImg } from "@/lib/api";
import { DynamicCoverCard } from "@/components/EmpirePlay/DynamicCoverCard";
import { ScoreBadge } from "@/components/EmpirePlay/ScoreBadge";
import { toPlayableTrack, toPlayableVideo } from "@/components/EmpirePlay/mappers";
import { useEmpirePlayer } from "@/components/EmpirePlay/PlayerContext";
import { type PlayableTrack } from "@/components/EmpirePlay/MusicPlayer";
import { type PlayableVideo } from "@/components/EmpirePlay/VideoPlayer";
import { haptic } from "@/lib/telegram";

export const Route = createFileRoute("/empire-play/")({
  component: EmpirePlayInicio,
});

function EmpirePlayInicio() {
  const { currentTrack, currentVideo, playSong, playVideo } = useEmpirePlayer();

  // Estado da Tela Deslizante de Playlist (Estilo Spotify) — é a ÚNICA forma
  // de ver a lista completa: a Início mostra só os cards de destaque, a
  // lista só abre depois do clique (igual Spotify/Apple Music).
  const [activeSlidingPlaylist, setActiveSlidingPlaylist] = useState<
    "spotify" | "apple" | "youtube" | "lancamentos" | null
  >(null);
  const [slidingSearchQuery, setSlidingSearchQuery] = useState("");

  // Dados das APIs
  const [topPlaylists, setTopPlaylists] = useState<{
    spotify?: any[];
    apple?: any[];
    youtube?: any[];
  }>({});

  const [lancamentos, setLancamentos] = useState<PlayableTrack[]>([]);
  const [musicas, setMusicas] = useState<PlayableTrack[]>([]);
  const [musicVideos, setMusicVideos] = useState<PlayableVideo[]>([]);

  // Helper para buscar itens da Tela Deslizante
  const getSlidingPlaylistItems = (): any[] => {
    if (!activeSlidingPlaylist) return [];
    let list: any[] = [];
    if (activeSlidingPlaylist === "spotify") {
      list =
        topPlaylists.spotify && topPlaylists.spotify.length > 0
          ? topPlaylists.spotify
          : lancamentos;
    } else if (activeSlidingPlaylist === "apple") {
      list = topPlaylists.apple && topPlaylists.apple.length > 0 ? topPlaylists.apple : lancamentos;
    } else if (activeSlidingPlaylist === "youtube") {
      list =
        topPlaylists.youtube && topPlaylists.youtube.length > 0
          ? topPlaylists.youtube
          : musicVideos;
    } else if (activeSlidingPlaylist === "lancamentos") {
      list = lancamentos.slice(0, 30);
    }

    if (slidingSearchQuery.trim()) {
      const q = slidingSearchQuery.toLowerCase().trim();
      list = list.filter((item) => (item.titulo || "").toLowerCase().includes(q));
    }

    return activeSlidingPlaylist === "lancamentos" ? list.slice(0, 30) : list.slice(0, 100);
  };

  // Busca dados de Início (Top Playlists + Lançamentos) via /api/empire-play/home
  useEffect(() => {
    async function loadInicioData() {
      try {
        const resHome = await fetch("/api/empire-play/home")
          .then((r) => r.json())
          .catch(() => null);

        if (resHome && resHome.success && resHome.data) {
          const spotify = (resHome.data.topSpotify || []).map(toPlayableTrack);
          const apple = (resHome.data.topAppleMusic || []).map(toPlayableTrack);
          const youtube = (resHome.data.topYoutube || []).map(toPlayableVideo);
          const recent = (resHome.data.recentMusicas || []).map(toPlayableTrack);

          setTopPlaylists({ spotify, apple, youtube });
          // Garantir exatamente os 30 primeiros nos lançamentos
          setLancamentos(recent.slice(0, 30));
        } else {
          // Fallback para rotas legadas se necessário
          const [resTop, resLanc] = await Promise.all([
            fetch("/api/top-playlists")
              .then((r) => r.json())
              .catch(() => null),
            fetch("/api/lancamentos")
              .then((r) => r.json())
              .catch(() => null),
          ]);
          if (resTop && resTop.success) setTopPlaylists(resTop.data || {});
          if (resLanc && resLanc.success)
            setLancamentos((resLanc.data || []).map(toPlayableTrack).slice(0, 30));
        }
      } catch (err) {
        console.warn("[EmpirePlayInicio] Erro ao carregar início:", err);
      }
    }
    loadInicioData();

    // Busca leve de fallback para os cards de Lançamentos/YouTube quando as
    // playlists de charts vêm vazias.
    fetch("/api/empire-play/musicas")
      .then((r) => r.json())
      .then((res) => {
        if (res && res.success) setMusicas((res.data || []).map(toPlayableTrack));
      })
      .catch(() => {});
    // Vídeos e Music Videos foram consolidados num catálogo único
    // ("Music Videos" na planilha, com tag por tipo) — filtra só a tag
    // "Music Video" aqui, já que esse fallback é especificamente pro
    // card "YouTube Hits".
    fetch("/api/empire-play/videos")
      .then((r) => r.json())
      .then((res) => {
        if (res && res.success) {
          const all: PlayableVideo[] = (res.data || []).map(toPlayableVideo);
          setMusicVideos(all.filter((v) => v.tipo_video === "Music Video"));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      {/* Seção de Ícones/Cards de Vidro na Tela (Glassmorphism) - Ao Clicar, abre em Tela Deslizante estilo Spotify */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Top 100 Spotify */}
        <div
          onClick={() => {
            haptic.selection();
            setActiveSlidingPlaylist("spotify");
          }}
          className="relative overflow-hidden rounded-3xl border backdrop-blur-xl cursor-pointer transition-all duration-300 group aspect-square border-white/10 hover:border-emerald-500/40 active:scale-[0.98]"
        >
          <DynamicCoverCard
            platform="spotify"
            artistName={topPlaylists.spotify?.[0]?.artista}
            artistPhotoUrl={topPlaylists.spotify?.[0]?.artista_foto_url}
            className="absolute inset-0"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/20" />
          <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
            <h3 className="font-black text-sm sm:text-base text-white tracking-tight leading-tight group-hover:text-emerald-400 transition-colors">
              Spotify Global
            </h3>
          </div>
        </div>

        {/* Card 2: Top 100 Apple Music */}
        <div
          onClick={() => {
            haptic.selection();
            setActiveSlidingPlaylist("apple");
          }}
          className="relative overflow-hidden rounded-3xl border backdrop-blur-xl cursor-pointer transition-all duration-300 group aspect-square border-white/10 hover:border-rose-500/40 active:scale-[0.98]"
        >
          <DynamicCoverCard
            platform="apple"
            artistName={topPlaylists.apple?.[0]?.artista}
            artistPhotoUrl={topPlaylists.apple?.[0]?.artista_foto_url}
            coverUrl={topPlaylists.apple?.[0]?.capa_url}
            className="absolute inset-0"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/20" />
          <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
            <h3 className="font-black text-sm sm:text-base text-white tracking-tight leading-tight group-hover:text-rose-400 transition-colors">
              Apple Music
            </h3>
          </div>
        </div>

        {/* Card 3: Top 100 YouTube Videos */}
        <div
          onClick={() => {
            haptic.selection();
            setActiveSlidingPlaylist("youtube");
          }}
          className="relative overflow-hidden rounded-3xl border backdrop-blur-xl cursor-pointer transition-all duration-300 group aspect-square border-white/10 hover:border-red-600/40 active:scale-[0.98]"
        >
          <DynamicCoverCard
            platform="youtube"
            artistName={topPlaylists.youtube?.[0]?.artista}
            artistPhotoUrl={topPlaylists.youtube?.[0]?.artista_foto_url}
            className="absolute inset-0"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/20" />
          <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
            <h3 className="font-black text-sm sm:text-base text-white tracking-tight leading-tight group-hover:text-red-400 transition-colors">
              YouTube Hits
            </h3>
          </div>
        </div>

        {/* Card 4: Hot (Lançamentos Recentes) */}
        <div
          onClick={() => {
            haptic.selection();
            setActiveSlidingPlaylist("lancamentos");
          }}
          className="relative overflow-hidden rounded-3xl border backdrop-blur-xl cursor-pointer transition-all duration-300 group aspect-square border-white/10 hover:border-purple-500/40 active:scale-[0.98]"
        >
          <DynamicCoverCard
            platform="hot"
            artistName={lancamentos?.[0]?.artista}
            coverUrl={lancamentos?.[0]?.capa_url}
            className="absolute inset-0"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/20" />
          <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
            <h3 className="font-black text-sm sm:text-base text-white tracking-tight leading-tight group-hover:text-purple-400 transition-colors">
              Hot
            </h3>
          </div>
        </div>
      </div>

      {/* TELA DESLIZANTE DE PLAYLIST (ESTILO SPOTIFY) */}
      {activeSlidingPlaylist && (
        <div className="fixed inset-0 z-[140] bg-neutral-950/98 backdrop-blur-3xl flex flex-col transition-all duration-300 ease-out animate-in slide-in-from-right overflow-hidden">
          {/* Top Bar / Header */}
          <div className="p-4 sm:p-6 border-b border-white/10 flex items-center justify-between bg-neutral-900/90 shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setActiveSlidingPlaylist(null)}
                className="p-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white transition flex items-center gap-1.5 text-xs font-black uppercase tracking-wider"
              >
                <ChevronLeft className="size-5" />
                <span>Voltar</span>
              </button>

              <div className="flex items-center gap-2">
                {activeSlidingPlaylist === "spotify" && (
                  <Flame className="size-6 text-emerald-400 fill-emerald-400" />
                )}
                {activeSlidingPlaylist === "apple" && <Music className="size-6 text-rose-400" />}
                {activeSlidingPlaylist === "youtube" && <Film className="size-6 text-red-500" />}
                {activeSlidingPlaylist === "lancamentos" && (
                  <Sparkles className="size-6 text-purple-400" />
                )}

                <div>
                  <span className="text-[10px] font-mono font-black uppercase text-neutral-400 block">
                    {activeSlidingPlaylist === "lancamentos" ? "30 Recentes" : "Top 100"}
                  </span>
                  <h2 className="text-base sm:text-xl font-black text-white">
                    {activeSlidingPlaylist === "spotify" && "Top 100 Spotify Global"}
                    {activeSlidingPlaylist === "apple" && "Top 100 Apple Music"}
                    {activeSlidingPlaylist === "youtube" && "Top 100 YouTube Hits"}
                    {activeSlidingPlaylist === "lancamentos" && "Hot (30 Primeiros)"}
                  </h2>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {activeSlidingPlaylist !== "youtube" && (
                <button
                  onClick={() => {
                    const list = getSlidingPlaylistItems();
                    if (list.length > 0) playSong(list[0], list);
                  }}
                  className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs uppercase tracking-wider transition flex items-center gap-2 shadow-lg shadow-emerald-500/20"
                >
                  <Play className="size-4 fill-black" />
                  <span>Tocar Tudo</span>
                </button>
              )}
              <button
                onClick={() => setActiveSlidingPlaylist(null)}
                className="p-2.5 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition ml-2"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>

          {/* Busca na Tela Deslizante */}
          <div className="px-4 sm:px-6 py-3 bg-neutral-900/60 border-b border-white/5 flex items-center gap-3 shrink-0">
            <Search className="size-4 text-neutral-500 shrink-0" />
            <input
              type="text"
              placeholder="Pesquisar nesta lista por título..."
              value={slidingSearchQuery}
              onChange={(e) => setSlidingSearchQuery(e.target.value)}
              className="w-full bg-transparent text-xs text-white placeholder-neutral-500 focus:outline-none"
            />
          </div>

          {/* Conteúdo de Faixas ou Vídeos */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2">
            {getSlidingPlaylistItems().length === 0 ? (
              <div className="text-center py-20 text-neutral-500 font-bold text-xs">
                Nenhum item encontrado nesta lista.
              </div>
            ) : (
              getSlidingPlaylistItems().map((item, idx) => {
                const isPlayingThis = currentTrack?.id === item.id || currentVideo?.id === item.id;

                // SE FOR TOP 100 (SPOTIFY, APPLE, YOUTUBE): EXIBE APENAS TÍTULO + RANK (SEU PEDIDO EXAUSTIVO)
                if (
                  activeSlidingPlaylist === "spotify" ||
                  activeSlidingPlaylist === "apple" ||
                  activeSlidingPlaylist === "youtube"
                ) {
                  return (
                    <div
                      key={item.id || idx}
                      onClick={() => {
                        if (activeSlidingPlaylist === "youtube") {
                          playVideo(item);
                        } else {
                          playSong(item, getSlidingPlaylistItems());
                        }
                      }}
                      className={`flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all cursor-pointer border ${
                        isPlayingThis
                          ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
                          : "bg-neutral-900/60 hover:bg-neutral-800 border-white/5 hover:border-white/15 text-white"
                      }`}
                    >
                      {/* Posição Rank */}
                      <span className="font-mono font-black text-xs text-neutral-400 min-w-[32px] text-center">
                        #{idx + 1}
                      </span>

                      {/* Capa */}
                      <div className="size-11 rounded-xl bg-neutral-950 border border-white/10 overflow-hidden shrink-0 relative">
                        {item.capa_url || item.poster_url ? (
                          <img
                            src={driveImg(item.capa_url || item.poster_url, 150)}
                            alt={item.titulo}
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="size-full grid place-items-center text-neutral-600">
                            <Music className="size-5" />
                          </div>
                        )}
                      </div>

                      {/* Título + selo de nota/likes quando o item tem avaliação real */}
                      <div className="flex-1 min-w-0 flex items-center gap-2.5">
                        <h4 className="font-extrabold text-sm text-white break-words leading-tight flex-1 min-w-0">
                          {item.titulo}
                        </h4>
                        <ScoreBadge
                          score={item.metacriticAvg}
                          variant={activeSlidingPlaylist === "youtube" ? "likes" : "metacritic"}
                          className="shrink-0 !text-[10px] !px-2 !py-1"
                        />
                      </div>

                      {/* Botão de Ação */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (activeSlidingPlaylist === "youtube") {
                            playVideo(item);
                          } else {
                            playSong(item, getSlidingPlaylistItems());
                          }
                        }}
                        className="p-2.5 rounded-xl bg-white/5 hover:bg-emerald-500 hover:text-black text-white transition-all shrink-0"
                      >
                        <Play className="size-4 fill-current" />
                      </button>
                    </div>
                  );
                }

                // SE FOR LANÇAMENTOS (30 PRIMEIROS): EXIBE COM ARTISTA
                return (
                  <div
                    key={item.id || idx}
                    onClick={() => playSong(item, getSlidingPlaylistItems())}
                    className={`flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all cursor-pointer border ${
                      isPlayingThis
                        ? "bg-purple-500/10 border-purple-500/40 text-purple-300"
                        : "bg-neutral-900/60 hover:bg-neutral-800 border-white/5 hover:border-white/15 text-white"
                    }`}
                  >
                    <span className="font-mono font-black text-xs text-neutral-500 min-w-[28px] text-center">
                      {idx + 1}
                    </span>

                    <div className="size-12 rounded-xl bg-neutral-950 border border-white/10 overflow-hidden shrink-0">
                      {item.capa_url ? (
                        <img
                          src={driveImg(item.capa_url, 150)}
                          alt={item.titulo}
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="size-full grid place-items-center text-neutral-600">
                          <Music className="size-5" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-xs sm:text-sm text-white break-words leading-tight">
                        {item.titulo}
                      </h4>
                      <p className="text-[11px] text-neutral-400 break-words mt-0.5">
                        {item.artista}
                      </p>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        playSong(item, getSlidingPlaylistItems());
                      }}
                      className="p-2.5 rounded-xl bg-white/5 hover:bg-purple-500 hover:text-black text-white transition-all shrink-0"
                    >
                      <Play className="size-4 fill-current" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
