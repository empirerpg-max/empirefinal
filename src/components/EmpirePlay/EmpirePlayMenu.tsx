import { useEffect, useState } from "react";
import {
  Flame,
  Sparkles,
  Music,
  Tv,
  Film,
  Disc3,
  MessageSquare,
  Upload,
  Play,
  TrendingUp,
  Search,
  Plus,
  Send,
  Loader2,
  ListMusic,
  Radio,
  Share2,
  ChevronLeft,
  X,
  Server,
} from "lucide-react";
import { driveImg } from "@/lib/api";
import { EmpirePlayHeader } from "./Header";
import { MusicPlayer, type PlayableTrack } from "./MusicPlayer";
import { VideoPlayer, type PlayableVideo } from "./VideoPlayer";
import { AlbumList } from "./AlbumList";
import { Forum } from "./Forum";
import { Gestao } from "./Gestao";
import { useTelegramUser, haptic } from "@/lib/telegram";

type MainTab = "inicio" | "musicas" | "music-videos" | "videos" | "albuns" | "forum" | "gestao";

type InicioSubTab = "em-alta" | "lancamentos";

export function EmpirePlayMenu() {
  const { user } = useTelegramUser();
  const [activeTab, setActiveTab] = useState<MainTab>("inicio");
  const [inicioSubTab, setInicioSubTab] = useState<InicioSubTab>("em-alta");

  // Estados dos Players
  const [currentTrack, setCurrentTrack] = useState<PlayableTrack | null>(null);
  const [activePlaylist, setActivePlaylist] = useState<PlayableTrack[]>([]);
  const [currentVideo, setCurrentVideo] = useState<PlayableVideo | null>(null);

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
  const [videos, setVideos] = useState<PlayableVideo[]>([]);
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

  // Estado do formulário de Upload de Vídeo
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitulo, setUploadTitulo] = useState("");
  const [uploadArtista, setUploadArtista] = useState("");
  const [uploadTipo, setUploadTipo] = useState("Music Video");
  const [uploadDescricao, setUploadDescricao] = useState("");
  const [uploadReferente, setUploadReferente] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );

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

          setTopPlaylists({
            spotify,
            apple,
            youtube,
          });
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
        console.warn("[EmpirePlayMenu] Erro ao carregar início:", err);
      } finally {
        setLoading(false);
      }
    }
    loadInicioData();
  }, []);

  // Helper de conversão para faixas de áudio
  function toPlayableTrack(item: any): PlayableTrack {
    return {
      id:
        item.id ||
        item.id_do_topico ||
        item.id_do_arquivo ||
        item.nome_da_musica ||
        item.title ||
        item.titulo,
      titulo: item.title || item.titulo || item.nome_da_musica || item.nome || "Música sem título",
      artista:
        item.artist ||
        item.artista ||
        item.act_principal ||
        item.nome_do_criador ||
        item.enviado_por ||
        "Artista não informado",
      capa_url:
        item.coverUrl ||
        item.capa_da_musica ||
        item.capa_do_album ||
        item.capa ||
        item.cover ||
        item.thumb ||
        item.capa_url,
      audio_url:
        item.audioUrl ||
        item.id_do_arquivo ||
        item.link_do_audio ||
        item.link ||
        item.audio_url ||
        item.stream_url ||
        item.link_audio ||
        item.drive_url,
      drive_url: item.audioUrl || item.id_do_arquivo || item.link || item.drive_url,
      letra: item.lyrics || item.letra,
      album: item.album || item.nome_do_album || "Single",
    };
  }

  // Helper de conversão para vídeos
  function toPlayableVideo(item: any): PlayableVideo {
    return {
      id: item.id || item.nome_do_video || item.id_do_topico,
      titulo: item.title || item.titulo || item.nome_do_video || item.nome || "Vídeo sem título",
      artista:
        item.artist ||
        item.artista ||
        item.act_principal ||
        item.nome_do_criador ||
        item.enviado_por ||
        "Artista não informado",
      capa_url:
        item.coverUrl ||
        item.thumb ||
        item.capa_da_musica ||
        item.capa ||
        item.capa_url ||
        item.poster_url,
      poster_url: item.coverUrl || item.thumb || item.poster_url || item.capa_url,
      // Vídeos são servidos do Google Drive/YouTube direto, ou do Telegram
      // (grupo de vídeos grandes) via proxy do próprio Worker — nesse caso a
      // planilha guarda só o ID da mensagem, não uma URL tocável.
      link: (() => {
        const source = item.videoSource || item.fonte;
        const raw =
          item.videoUrl || item.audioUrl || item.link || item.youtube_url || item.id_do_arquivo || item.link_do_video;
        if (source === "telegram" && raw) return `/api/telegram-video/${encodeURIComponent(raw)}`;
        return raw;
      })(),
      youtube_url: item.videoUrl || item.audioUrl || item.youtube_url || item.link,
      descricao: item.description || item.descricao || "",
      tipo_video: item.category || item.tipo_video || item.tipo || "Vídeo",
      fonte: item.videoSource || item.fonte,
    };
  }

  // Busca Músicas em /api/empire-play/musicas
  const fetchMusicas = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/empire-play/musicas")
        .then((r) => r.json())
        .catch(() => null);
      if (res && res.success) {
        setMusicas((res.data || []).map(toPlayableTrack));
      } else {
        const fallback = await fetch("/api/musicas")
          .then((r) => r.json())
          .catch(() => null);
        if (fallback && fallback.success) setMusicas((fallback.data || []).map(toPlayableTrack));
      }
    } catch {}
    setLoading(false);
  };

  // Busca Music Videos & Videos em /api/empire-play/*
  const fetchVideosData = async () => {
    setLoading(true);
    try {
      const [resMV, resV] = await Promise.all([
        fetch("/api/empire-play/music-videos")
          .then((r) => r.json())
          .catch(() => null),
        fetch("/api/empire-play/videos")
          .then((r) => r.json())
          .catch(() => null),
      ]);
      if (resMV && resMV.success) setMusicVideos((resMV.data || []).map(toPlayableVideo));
      if (resV && resV.success) setVideos((resV.data || []).map(toPlayableVideo));
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchMusicas();
    fetchVideosData();
  }, []);

  useEffect(() => {
    if (activeTab === "musicas") fetchMusicas();
    if (activeTab === "music-videos" || activeTab === "videos") fetchVideosData();
  }, [activeTab]);

  // Handler do Upload de Vídeo: envia o arquivo para o Google Drive
  // (/api/gestao/upload) e registra o link retornado no catálogo
  // (/api/gestao/video ou /api/gestao/music-video).
  const handleVideoUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      setUploadMsg({ type: "error", text: "Selecione um arquivo de vídeo." });
      return;
    }
    if (!uploadTitulo.trim() || !uploadArtista.trim()) {
      setUploadMsg({ type: "error", text: "Título e Artista são obrigatórios." });
      return;
    }

    setUploading(true);
    setUploadMsg(null);

    try {
      const isMusicVideo = uploadTipo === "Music Video";

      const driveFormData = new FormData();
      driveFormData.append("file", uploadFile);
      driveFormData.append("fileName", uploadFile.name);
      driveFormData.append("folderType", isMusicVideo ? "musicVideo" : "video");

      const uploadRes = await fetch("/api/gestao/upload", {
        method: "POST",
        body: driveFormData,
      });
      const uploadJson = await uploadRes.json();

      if (!uploadRes.ok || !uploadJson.success || !uploadJson.data?.fileUrl) {
        setUploadMsg({
          type: "error",
          text: uploadJson.error || "Erro ao enviar o arquivo para o Google Drive.",
        });
        return;
      }

      const mediaUrl = uploadJson.data.fileUrl as string;

      const registerRes = await fetch(isMusicVideo ? "/api/gestao/music-video" : "/api/gestao/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isMusicVideo
            ? {
                tituloMusicVideo: uploadTitulo.trim(),
                artistaResponsavel: uploadArtista.trim(),
                musicaVinculada: uploadReferente.trim(),
                mediaUrl,
                capaUrl: "",
                nomeJogador: user?.name || user?.username || "Jogador",
              }
            : {
                tituloVideo: uploadTitulo.trim(),
                artistaResponsavel: uploadArtista.trim(),
                categoriaVideo: uploadTipo,
                mediaUrl,
                capaUrl: "",
                nomeJogador: user?.name || user?.username || "Jogador",
              },
        ),
      });
      const registerJson = await registerRes.json();

      if (registerRes.ok && registerJson.success) {
        setUploadMsg({
          type: "success",
          text: "Vídeo enviado para o Google Drive e registrado no catálogo!",
        });
        setUploadFile(null);
        setUploadTitulo("");
        setUploadArtista("");
        setUploadDescricao("");
        setUploadReferente("");
        fetchVideosData();
      } else {
        setUploadMsg({
          type: "error",
          text: registerJson.error || "Erro ao registrar o vídeo no catálogo.",
        });
      }
    } catch (err: any) {
      setUploadMsg({
        type: "error",
        text: "Erro de conexão ao servidor: " + err.message,
      });
    } finally {
      setUploading(false);
    }
  };

  const playSong = (track: PlayableTrack, list: PlayableTrack[]) => {
    haptic.selection();
    setCurrentTrack(track);
    setActivePlaylist(list);
  };

  const playVideo = (vid: PlayableVideo) => {
    haptic.selection();
    setCurrentVideo(vid);
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6 pb-28 min-w-0 max-w-full overflow-x-hidden">
      {/* Header do Empire Play */}
      <EmpirePlayHeader />

      {/* Navegação Principal por Abas com Rolagem Fluida no Mobile */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <nav className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-2 scrollbar-hide border-b border-white/10 touch-pan-x flex-nowrap flex-1">
          {[
            { id: "inicio", label: "Início", icon: Flame },
            { id: "musicas", label: "Músicas", icon: Music },
            { id: "music-videos", label: "Music Videos", icon: Film },
            { id: "videos", label: "Videos", icon: Tv },
            { id: "albuns", label: "Álbuns", icon: Disc3 },
            { id: "forum", label: "Fórum", icon: MessageSquare },
            { id: "gestao", label: "Gestão", icon: Upload },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  haptic.selection();
                  setActiveTab(tab.id as MainTab);
                }}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl text-[11px] sm:text-xs font-black uppercase tracking-wider whitespace-nowrap transition-all shrink-0 ${
                  isActive
                    ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20 scale-102"
                    : "bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white"
                }`}
              >
                <Icon className="size-3.5 sm:size-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* CONTEÚDO DA ABA INÍCIO - CARDS DE VIDRO + PLAYLIST ESTILO SPOTIFY / YOUTUBE (TOP 100) */}
      {activeTab === "inicio" && (
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
                    {/* Título sem truncar e sem ID de criador */}
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
                      {selectedPlaylistCategory !== "spotify" &&
                      selectedPlaylistCategory !== "apple"
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
        </div>
      )}

      {/* CONTEÚDO DA ABA MÚSICAS */}
      {activeTab === "musicas" && (
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
      )}

      {/* CONTEÚDO DA ABA MUSIC VIDEOS */}
      {activeTab === "music-videos" && (
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
                </div>
                <h4 className="font-bold text-xs text-white truncate group-hover:text-red-400">
                  {mv.titulo}
                </h4>
                <p className="text-[11px] text-neutral-400 truncate">{mv.artista}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CONTEÚDO DA ABA VIDEOS */}
      {activeTab === "videos" && (
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
                </div>
                <h4 className="font-bold text-xs text-white truncate group-hover:text-red-400">
                  {v.titulo}
                </h4>
                <p className="text-[11px] text-neutral-400 truncate">{v.artista}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CONTEÚDO DA ABA ÁLBUNS */}
      {activeTab === "albuns" && <AlbumList onPlayTrack={playSong} />}

      {/* CONTEÚDO DA ABA FÓRUM */}
      {activeTab === "forum" && <Forum onPlayTrack={playSong} onPlayVideo={playVideo} />}

      {/* CONTEÚDO DA ABA GESTÃO */}
      {activeTab === "gestao" && (
        <div className="space-y-8">
          <Gestao />

          {/* Upload Direto de Vídeos via Telegram Storage */}
          <div className="bg-neutral-900 border border-white/10 rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-white/10 pb-4 mb-6">
              <div className="size-10 rounded-2xl bg-emerald-500/20 text-emerald-400 grid place-items-center">
                <Upload className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-white uppercase tracking-tight">
                  Upload de Mídia de Vídeo (Google Drive)
                </h3>
                <p className="text-xs text-neutral-400">
                  Envie clipes e vídeos diretamente para o Google Drive da comunidade.
                </p>
              </div>
            </div>

            {uploadMsg && (
              <div
                className={`p-4 rounded-2xl text-xs font-bold mb-6 border ${
                  uploadMsg.type === "success"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
                }`}
              >
                {uploadMsg.text}
              </div>
            )}

            <form onSubmit={handleVideoUpload} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-neutral-400 mb-1 block">
                    Título do Vídeo *
                  </label>
                  <input
                    value={uploadTitulo}
                    onChange={(e) => setUploadTitulo(e.target.value)}
                    placeholder="Ex: Anti-Hero (Official Video)"
                    className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-emerald-500/50"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase text-neutral-400 mb-1 block">
                    Artista *
                  </label>
                  <input
                    value={uploadArtista}
                    onChange={(e) => setUploadArtista(e.target.value)}
                    placeholder="Ex: Taylor Swift"
                    className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-neutral-400 mb-1 block">
                    Tipo de Vídeo
                  </label>
                  <select
                    value={uploadTipo}
                    onChange={(e) => setUploadTipo(e.target.value)}
                    className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-emerald-500/50"
                  >
                    <option value="Music Video">Music Video</option>
                    <option value="Visualizer">Visualizer</option>
                    <option value="Behind The Scenes">Behind The Scenes</option>
                    <option value="Live Performance">Live Performance</option>
                    <option value="Outros">Outros</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase text-neutral-400 mb-1 block">
                    Referente à Música (Opcional)
                  </label>
                  <input
                    value={uploadReferente}
                    onChange={(e) => setUploadReferente(e.target.value)}
                    placeholder="Ex: ID ou Nome da música"
                    className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-neutral-400 mb-1 block">
                  Descrição
                </label>
                <textarea
                  value={uploadDescricao}
                  onChange={(e) => setUploadDescricao(e.target.value)}
                  placeholder="Detalhes sobre o clipe..."
                  rows={3}
                  className="w-full bg-neutral-950 border border-white/10 rounded-xl p-4 text-xs text-white outline-none focus:border-emerald-500/50"
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-neutral-400 mb-1 block">
                  Arquivo de Vídeo *
                </label>
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="w-full bg-neutral-950 border border-white/10 rounded-xl p-3 text-xs text-neutral-300 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-emerald-500 file:text-black cursor-pointer"
                />
              </div>

              <button
                type="submit"
                disabled={uploading}
                className="w-full py-4 rounded-2xl bg-emerald-500 text-black font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
              >
                {uploading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Enviando Mídia para o Drive...
                  </>
                ) : (
                  <>
                    <Send className="size-4" /> Publicar Mídia
                  </>
                )}
              </button>
            </form>
          </div>
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

      {/* Media Players Ativos */}
      <MusicPlayer
        currentTrack={currentTrack}
        playlist={activePlaylist}
        onClose={() => setCurrentTrack(null)}
        onTrackChange={(track) => setCurrentTrack(track)}
      />

      <VideoPlayer video={currentVideo} onClose={() => setCurrentVideo(null)} />
    </div>
  );
}
