import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Flame, Sparkles, Music, Film, Play, Search, ChevronLeft, X } from "lucide-react";
import { driveImg } from "@/lib/api";
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

  // Estado da Tela Deslizante de Playlist (Estilo Spotify)
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
  const [loading, setLoading] = useState(false);

  // Filtros da Playlist Estilo Spotify (Top 100)
  const [selectedPlaylistCategory, setSelectedPlaylistCategory] = useState<
    "spotify" | "apple" | "youtube" | "lancamentos"
  >("spotify");
  const [homeSearchQuery, setHomeSearchQuery] = useState("");

  const getPlaylistSource = (): PlayableTrack[] => {
    if (selectedPlaylistCategory === "spotify") {
      return topPlaylists.spotify && topPlaylists.spotify.length > 0
        ? topPlaylists.spotify
        : lancamentos;
    }
    if (selectedPlaylistCategory === "apple") {
      return topPlaylists.apple && topPlaylists.apple.length > 0 ? topPlaylists.apple : lancamentos;
    }
    return lancamentos.length > 0 ? lancamentos.slice(0, 30) : musicas;
  };

  const getFilteredPlaylist = (): PlayableTrack[] => {
    let list = getPlaylistSource();
    if (homeSearchQuery.trim()) {
      const q = homeSearchQuery.toLowerCase().trim();
      list = list.filter(
        (item) =>
          (item.titulo || "").toLowerCase().includes(q) ||
          (item.artista || "").toLowerCase().includes(q) ||
          (item.album || "").toLowerCase().includes(q),
      );
    }
    return selectedPlaylistCategory === "lancamentos" ? list.slice(0, 30) : list.slice(0, 100);
  };

  const getFilteredVideos = (): PlayableVideo[] => {
    let list =
      topPlaylists.youtube && topPlaylists.youtube.length > 0 ? topPlaylists.youtube : musicVideos;
    if (homeSearchQuery.trim()) {
      const q = homeSearchQuery.toLowerCase().trim();
      list = list.filter(
        (item) =>
          (item.titulo || "").toLowerCase().includes(q) ||
          (item.artista || "").toLowerCase().includes(q),
      );
    }
    return list.slice(0, 100);
  };

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
      setLoading(true);
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
      } finally {
        setLoading(false);
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
    fetch("/api/empire-play/music-videos")
      .then((r) => r.json())
      .then((res) => {
        if (res && res.success) setMusicVideos((res.data || []).map(toPlayableVideo));
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
            setSelectedPlaylistCategory("spotify");
            setActiveSlidingPlaylist("spotify");
          }}
          className={`relative overflow-hidden rounded-3xl p-4 sm:p-5 border backdrop-blur-xl cursor-pointer transition-all duration-300 group ${
            selectedPlaylistCategory === "spotify"
              ? "bg-emerald-950/60 border-emerald-400 shadow-xl shadow-emerald-500/20 scale-[1.02]"
              : "bg-white/5 border-white/10 hover:border-emerald-500/40 hover:bg-white/10"
          }`}
        >
          <div className="absolute top-0 right-0 -mr-6 -mt-6 size-24 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all" />
          <div className="flex items-center justify-between mb-3">
            <div className="size-11 sm:size-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 grid place-items-center text-emerald-400 group-hover:scale-110 transition-transform">
              <Flame className="size-6 fill-current" />
            </div>
            <span className="text-[10px] font-mono font-black uppercase px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Abrir Tela
            </span>
          </div>
          <h3 className="font-black text-sm sm:text-base text-white tracking-tight leading-tight group-hover:text-emerald-400 transition-colors">
            Spotify Global
          </h3>
          <p className="text-[11px] text-neutral-400 mt-1 font-medium">
            {(topPlaylists.spotify && topPlaylists.spotify.length) || 100} Faixas em Alta
          </p>
        </div>

        {/* Card 2: Top 100 Apple Music */}
        <div
          onClick={() => {
            haptic.selection();
            setSelectedPlaylistCategory("apple");
            setActiveSlidingPlaylist("apple");
          }}
          className={`relative overflow-hidden rounded-3xl p-4 sm:p-5 border backdrop-blur-xl cursor-pointer transition-all duration-300 group ${
            selectedPlaylistCategory === "apple"
              ? "bg-rose-950/60 border-rose-400 shadow-xl shadow-rose-500/20 scale-[1.02]"
              : "bg-white/5 border-white/10 hover:border-rose-500/40 hover:bg-white/10"
          }`}
        >
          <div className="absolute top-0 right-0 -mr-6 -mt-6 size-24 bg-rose-500/10 rounded-full blur-2xl group-hover:bg-rose-500/20 transition-all" />
          <div className="flex items-center justify-between mb-3">
            <div className="size-11 sm:size-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 grid place-items-center text-rose-400 group-hover:scale-110 transition-transform">
              <Music className="size-6" />
            </div>
            <span className="text-[10px] font-mono font-black uppercase px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
              Abrir Tela
            </span>
          </div>
          <h3 className="font-black text-sm sm:text-base text-white tracking-tight leading-tight group-hover:text-rose-400 transition-colors">
            Apple Music
          </h3>
          <p className="text-[11px] text-neutral-400 mt-1 font-medium">
            {(topPlaylists.apple && topPlaylists.apple.length) || 100} Faixas em Alta
          </p>
        </div>

        {/* Card 3: Top 100 YouTube Videos */}
        <div
          onClick={() => {
            haptic.selection();
            setSelectedPlaylistCategory("youtube");
            setActiveSlidingPlaylist("youtube");
          }}
          className={`relative overflow-hidden rounded-3xl p-4 sm:p-5 border backdrop-blur-xl cursor-pointer transition-all duration-300 group ${
            selectedPlaylistCategory === "youtube"
              ? "bg-red-950/60 border-red-500 shadow-xl shadow-red-600/20 scale-[1.02]"
              : "bg-white/5 border-white/10 hover:border-red-600/40 hover:bg-white/10"
          }`}
        >
          <div className="absolute top-0 right-0 -mr-6 -mt-6 size-24 bg-red-600/10 rounded-full blur-2xl group-hover:bg-red-600/20 transition-all" />
          <div className="flex items-center justify-between mb-3">
            <div className="size-11 sm:size-12 rounded-2xl bg-red-600/20 border border-red-600/40 grid place-items-center text-red-500 group-hover:scale-110 transition-transform">
              <Film className="size-6" />
            </div>
            <span className="text-[10px] font-mono font-black uppercase px-2.5 py-1 rounded-full bg-red-600/20 text-red-300 border border-red-600/30">
              Abrir Tela
            </span>
          </div>
          <h3 className="font-black text-sm sm:text-base text-white tracking-tight leading-tight group-hover:text-red-400 transition-colors">
            YouTube Hits
          </h3>
          <p className="text-[11px] text-neutral-400 mt-1 font-medium">
            {(topPlaylists.youtube && topPlaylists.youtube.length) || musicVideos.length} Vídeos
          </p>
        </div>

        {/* Card 4: Lançamentos Recentes */}
        <div
          onClick={() => {
            haptic.selection();
            setSelectedPlaylistCategory("lancamentos");
            setActiveSlidingPlaylist("lancamentos");
          }}
          className={`relative overflow-hidden rounded-3xl p-4 sm:p-5 border backdrop-blur-xl cursor-pointer transition-all duration-300 group ${
            selectedPlaylistCategory === "lancamentos"
              ? "bg-purple-950/60 border-purple-400 shadow-xl shadow-purple-500/20 scale-[1.02]"
              : "bg-white/5 border-white/10 hover:border-purple-500/40 hover:bg-white/10"
          }`}
        >
          <div className="absolute top-0 right-0 -mr-6 -mt-6 size-24 bg-purple-500/10 rounded-full blur-2xl group-hover:bg-purple-500/20 transition-all" />
          <div className="flex items-center justify-between mb-3">
            <div className="size-11 sm:size-12 rounded-2xl bg-purple-500/20 border border-purple-500/40 grid place-items-center text-purple-400 group-hover:scale-110 transition-transform">
              <Sparkles className="size-6" />
            </div>
            <span className="text-[10px] font-mono font-black uppercase px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
              30 Recentes
            </span>
          </div>
          <h3 className="font-black text-sm sm:text-base text-white tracking-tight leading-tight group-hover:text-purple-400 transition-colors">
            Lançamentos
          </h3>
          <p className="text-[11px] text-neutral-400 mt-1 font-medium">
            {lancamentos.length || 30} Novidades da Rede
          </p>
        </div>
      </div>

      {/* Bar de Ações & Busca */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-neutral-900/60 p-3.5 rounded-2xl border border-white/10">
        {selectedPlaylistCategory !== "youtube" ? (
          <button
            onClick={() => {
              const items = getFilteredPlaylist();
              if (items.length > 0) playSong(items[0], items);
            }}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 shrink-0"
          >
            <Play className="size-4 fill-black" /> Tocar Tudo
          </button>
        ) : (
          <div className="flex items-center gap-2 text-xs font-bold text-red-400 uppercase tracking-wider px-2">
            <Film className="size-4" /> Clipe de Vídeos em Alta
          </div>
        )}

        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-neutral-500" />
          <input
            type="text"
            placeholder="Filtrar por nome ou artista..."
            value={homeSearchQuery}
            onChange={(e) => setHomeSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-neutral-950 border border-white/10 rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 transition-all"
          />
        </div>
      </div>

      {/* VISUALIZAÇÃO SE FOR SELECIONADO TOP YOUTUBE */}
      {selectedPlaylistCategory === "youtube" ? (
        loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-48 bg-neutral-900/60 rounded-2xl animate-pulse border border-white/5"
              />
            ))}
          </div>
        ) : getFilteredVideos().length === 0 ? (
          <div className="text-center py-16 bg-neutral-900/30 rounded-3xl border border-white/5">
            <Film className="size-10 text-neutral-600 mx-auto mb-3" />
            <p className="text-xs font-bold text-neutral-400">
              Nenhum vídeo do YouTube encontrado nesta categoria.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {getFilteredVideos().map((v, idx) => (
              <div
                key={v.id || idx}
                onClick={() => playVideo(v)}
                className="flex flex-col bg-neutral-900/60 border border-white/10 hover:border-red-500/40 rounded-2xl p-3 cursor-pointer transition-all group hover:scale-[1.01]"
              >
                <div className="relative aspect-video rounded-xl overflow-hidden bg-neutral-950 mb-3">
                  {v.capa_url || v.poster_url ? (
                    <img
                      src={driveImg(v.capa_url || v.poster_url, 400)}
                      alt={v.titulo}
                      className="size-full object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="size-full grid place-items-center bg-neutral-800 text-neutral-600">
                      <Film className="size-10" />
                    </div>
                  )}
                  <span className="absolute top-2 left-2 bg-black/80 text-red-400 font-mono font-black text-xs px-2 py-0.5 rounded-md border border-white/10">
                    #{idx + 1}
                  </span>
                  <div className="absolute inset-0 bg-black/40 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="size-12 rounded-full bg-red-600 grid place-items-center shadow-lg">
                      <Play className="size-6 text-white fill-white ml-0.5" />
                    </div>
                  </div>
                </div>
                <h4 className="font-bold text-xs sm:text-sm text-white break-words leading-snug group-hover:text-red-400">
                  {v.titulo}
                </h4>
                <p className="text-[11px] sm:text-xs text-neutral-400 mt-1 break-words">
                  {v.artista}
                </p>
              </div>
            ))}
          </div>
        )
      ) : /* VISUALIZAÇÃO SE FOR MÚSICAS (SPOTIFY / APPLE / LANÇAMENTOS) */
      loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-16 bg-neutral-900/60 rounded-2xl animate-pulse border border-white/5"
            />
          ))}
        </div>
      ) : getFilteredPlaylist().length === 0 ? (
        <div className="text-center py-16 bg-neutral-900/30 rounded-3xl border border-white/5">
          <Music className="size-10 text-neutral-600 mx-auto mb-3" />
          <p className="text-xs font-bold text-neutral-400">
            Nenhuma música encontrada nesta categoria.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Header da Tabela */}
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] font-mono font-bold text-neutral-500 uppercase border-b border-white/5">
            <div className="col-span-1 text-center">#</div>
            <div className="col-span-8 sm:col-span-7">Música / Artista</div>
            <div className="hidden sm:block sm:col-span-3">Álbum</div>
            <div className="col-span-3 sm:col-span-1 text-right">Tocar</div>
          </div>

          {/* Faixas da Playlist (Exibe até 100 itens sem cortar título) */}
          {getFilteredPlaylist().map((track, idx) => {
            const isPlayingThis = currentTrack?.id === track.id;
            return (
              <div
                key={track.id || idx}
                onClick={() => playSong(track, getFilteredPlaylist())}
                className={`grid grid-cols-12 gap-2 items-center px-3 sm:px-4 py-3 rounded-2xl transition-all cursor-pointer border ${
                  isPlayingThis
                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
                    : "bg-neutral-900/50 hover:bg-neutral-800/80 border-white/5 hover:border-white/20 text-white"
                }`}
              >
                {/* Rank Number */}
                <div className="col-span-1 text-center font-mono font-black text-xs text-neutral-400">
                  {isPlayingThis ? (
                    <span className="size-2 rounded-full bg-emerald-500 inline-block animate-ping" />
                  ) : (
                    idx + 1
                  )}
                </div>

                {/* Artwork + Full Song Title (Sem '...' e sem ID do criador) + Artist */}
                <div className="col-span-8 sm:col-span-7 flex items-center gap-3 min-w-0">
                  <div className="size-12 rounded-xl bg-neutral-950 border border-white/10 overflow-hidden shrink-0 relative group">
                    {track.capa_url ? (
                      <img
                        src={driveImg(track.capa_url, 200)}
                        alt={track.titulo}
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="size-full grid place-items-center text-neutral-600">
                        <Music className="size-5" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/40 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play className="size-4 text-emerald-400 fill-emerald-400" />
                    </div>
                  </div>

                  <div className="min-w-0 flex-1 pr-2">
                    <h4 className="font-extrabold text-xs sm:text-sm text-white leading-snug break-words">
                      {track.titulo}
                    </h4>
                    {/* Exibe artista apenas se NÃO for Top 100 (Spotify ou Apple) */}
                    {selectedPlaylistCategory !== "spotify" &&
                      selectedPlaylistCategory !== "apple" && (
                        <p className="text-[11px] sm:text-xs text-neutral-400 leading-normal break-words mt-0.5">
                          {track.artista}
                        </p>
                      )}
                  </div>
                </div>

                {/* Album / Single (Oculto se for Top 100) */}
                <div className="hidden sm:block sm:col-span-3 text-xs text-neutral-400 font-mono break-words">
                  {selectedPlaylistCategory !== "spotify" && selectedPlaylistCategory !== "apple"
                    ? track.album || "Single"
                    : ""}
                </div>

                {/* Action */}
                <div className="col-span-3 sm:col-span-1 flex items-center justify-end">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      playSong(track, getFilteredPlaylist());
                    }}
                    className="p-2 rounded-xl bg-white/5 hover:bg-emerald-500 hover:text-black text-white transition-all"
                  >
                    <Play className="size-4 fill-current" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
                    {activeSlidingPlaylist === "lancamentos" && "Lançamentos (30 Primeiros)"}
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

                      {/* APENAS O TÍTULO (NENHUMA INFORMAÇÃO EXTRA) */}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-extrabold text-sm text-white break-words leading-tight">
                          {item.titulo}
                        </h4>
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
