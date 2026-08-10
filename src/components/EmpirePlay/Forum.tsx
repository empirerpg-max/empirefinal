import React, { useState, useEffect, useMemo } from "react";
import {
  Music,
  Tv,
  Film,
  Disc,
  MessageSquare,
  Search,
  Play,
  Pause,
  ChevronLeft,
  Calendar,
  User,
  ListMusic,
  FileText,
  Volume2,
  Sparkles,
} from "lucide-react";
import { driveImg } from "@/lib/api";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { CommentModal } from "./CommentModal";
import { ScoreBadge } from "./ScoreBadge";
import { ReactionBar } from "./ReactionBar";

// "music-videos" foi consolidado dentro de "videos" — Vídeos e Music Videos
// vivem na mesma aba da planilha ("Music Videos"), diferenciados por tag
// ("Tipo de vídeo"), não mais por aba/submenu separado.
export type ForumSubmenu = "musicas" | "videos" | "albuns";

interface CommentItem {
  id: string;
  origem?: string;
  data: string;
  titulo: string;
  jogador: string;
  comentario: string;
  nota: string;
  // Linha real na planilha + aba de comentários — null quando o comentário
  // veio de uma fonte de fallback que não suporta reação.
  rowIndex: number | null;
  sheetComments: string | null;
  reactions: Record<string, number>;
  reactedBy: Record<string, string[]>;
}

interface ForumTopicItem {
  id: string;
  sheetName: string;
  title: string;
  artist: string;
  album: string | null;
  cover: string | null;
  link: string | null;
  videoSource?: string | null;
  releaseDate: string | null;
  telegramTopicId: string | null;
  // Tag do vídeo (coluna "Tipo de vídeo") — null pra músicas/álbuns.
  tipoVideo: string | null;
  fields: Record<string, string>;
}

const FORUM_SUBMENUS: ForumSubmenu[] = ["musicas", "videos", "albuns"];

export interface ForumProps {
  onPlayTrack?: (track: PlayableTrack, playlist: PlayableTrack[]) => void;
  onPlayVideo?: (video: PlayableVideo) => void;
  /** Aba inicial (deep link a partir do player/catálogo), ex: "musicas". */
  initialTab?: string;
  /** ID do item a abrir automaticamente assim que a aba carregar. */
  initialItemId?: string;
}

import { VideoPlayer, PlayableVideo } from "./VideoPlayer";
import { type PlayableTrack } from "./MusicPlayer";

function getEmbedMediaUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (/youtube\.com|youtu\.be/i.test(trimmed)) {
    let videoId = "";
    if (trimmed.includes("youtu.be/")) {
      videoId = trimmed.split("youtu.be/")[1]?.split("?")[0] || "";
    } else if (trimmed.includes("v=")) {
      videoId = trimmed.split("v=")[1]?.split("&")[0] || "";
    } else if (trimmed.includes("embed/")) {
      videoId = trimmed.split("embed/")[1]?.split("?")[0] || "";
    } else if (trimmed.includes("shorts/")) {
      videoId = trimmed.split("shorts/")[1]?.split("?")[0] || "";
    }
    return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0` : trimmed;
  }
  if (/drive\.google\.com|googleusercontent\.com/i.test(trimmed) || /^[-\w]{25,}$/.test(trimmed)) {
    const match = trimmed.match(/[-\w]{25,}/);
    return match ? `https://drive.google.com/file/d/${match[0]}/preview` : trimmed;
  }
  return trimmed;
}

export const Forum: React.FC<ForumProps> = ({
  onPlayTrack,
  onPlayVideo,
  initialTab,
  initialItemId,
}) => {
  const { user: telegramUser } = useTelegramUser();
  const myId = telegramUser?.id ? String(telegramUser.id) : "";

  const initialSubmenu: ForumSubmenu =
    initialTab && (FORUM_SUBMENUS as string[]).includes(initialTab)
      ? (initialTab as ForumSubmenu)
      : "musicas";
  const [activeSubmenu, setActiveSubmenu] = useState<ForumSubmenu>(initialSubmenu);
  const [items, setItems] = useState<ForumTopicItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedTopic, setSelectedTopic] = useState<ForumTopicItem | null>(null);
  // Evita reabrir o deep link se o jogador voltar pra lista manualmente.
  const [pendingDeepLinkId, setPendingDeepLinkId] = useState<string | undefined>(initialItemId);
  // Filtro de tag do submenu Vídeos (Music Video, Live, Video, etc).
  const [activeVideoTag, setActiveVideoTag] = useState<string>("Todos");

  // State para comentários do tópico selecionado
  const [topicComments, setTopicComments] = useState<CommentItem[]>([]);
  const [loadingComments, setLoadingComments] = useState<boolean>(false);
  // ID do tópico REAL da planilha (coluna "ID do tópico"), usado como chave
  // ao gravar comentários — nunca o id sintético gerado pelo app.
  const [resolvedTopicId, setResolvedTopicId] = useState<string>("");

  // State para o Modal de Comentário
  const [isCommentModalOpen, setIsCommentModalOpen] = useState<boolean>(false);

  // State para o Player de Vídeo Expandido
  const [activeVideo, setActiveVideo] = useState<PlayableVideo | null>(null);

  // Audio preview no tópico de álbum/música
  const [playingTrackUrl, setPlayingTrackUrl] = useState<string | null>(null);

  const handleVideoPlay = (topic: ForumTopicItem) => {
    const videoObj: PlayableVideo = {
      id: topic.id,
      titulo: topic.title,
      artista: topic.artist,
      link: topic.link || topic.id,
      fonte: topic.videoSource || undefined,
      poster_url: topic.cover || undefined,
      tipo_video: topic.tipoVideo || "Vídeo",
    };
    setActiveVideo(videoObj);
    onPlayVideo?.(videoObj);
  };

  // 1. Carregar itens do catálogo conforme submenu ativo
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setSelectedTopic(null);
    setActiveVideoTag("Todos");

    const endpointMap: Record<ForumSubmenu, string> = {
      musicas: "/api/empire-play/musicas",
      videos: "/api/empire-play/videos",
      albuns: "/api/empire-play/albuns",
    };

    fetch(endpointMap[activeSubmenu])
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted) return;
        let list: any[] = [];
        if (data && data.success && Array.isArray(data.data)) {
          list = data.data;
        } else if (Array.isArray(data)) {
          list = data;
        }
        // Mapeia estrutura amigável para ForumTopicItem
        const normalized = list.map((item: any) => ({
          id: item.id || item.title || item.titulo,
          sheetName: item.sheetName || activeSubmenu,
          title:
            item.title || item.titulo || item.nome_da_musica || item.nome_do_video || "Sem título",
          artist: item.artist || item.artista || item.act_principal || "Artista não informado",
          album: item.album || item.nome_do_album || null,
          cover:
            item.coverUrl ||
            item.cover ||
            item.capa_url ||
            item.capa_da_musica ||
            item.capa_do_album ||
            item.capa ||
            item.thumb ||
            null,
          link:
            item.audioUrl ||
            item.videoUrl ||
            item.link ||
            item.audio_url ||
            item.drive_url ||
            item.youtube_url ||
            item.id_do_arquivo ||
            null,
          videoSource: item.videoSource || null,
          releaseDate: item.releaseDate || item.data_lancamento || item.data || null,
          telegramTopicId: item.telegramTopicId || null,
          tipoVideo: item.category || item.tipo_video || null,
          lyrics: item.lyrics || item.letra || item.fields?.letra || null,
          fields: item.fields || {
            letra: item.lyrics || item.letra,
            metacritic: item.metacriticAvg || item.metacritic || item.nota,
            descricao: item.description || item.descricao,
          },
        }));
        setItems(normalized);
      })
      .catch((err) => {
        console.error("Erro ao carregar itens do fórum:", err);
        if (isMounted) setItems([]);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeSubmenu]);

  // 1.1 Deep link (player/catálogo → fórum): assim que os itens da aba
  // inicial carregam, abre direto o tópico pedido.
  useEffect(() => {
    if (!pendingDeepLinkId || loading) return;
    const match = items.find((item) => item.id === pendingDeepLinkId);
    if (match) {
      setSelectedTopic(match);
      setPendingDeepLinkId(undefined);
    }
  }, [pendingDeepLinkId, loading, items]);

  // 2. Carregar comentários quando um tópico é selecionado
  const fetchTopicComments = async (topicOrTitle: ForumTopicItem | string) => {
    setLoadingComments(true);
    const topic: ForumTopicItem =
      typeof topicOrTitle === "string"
        ? ({ id: topicOrTitle, title: topicOrTitle } as ForumTopicItem)
        : topicOrTitle;

    try {
      const topicIdentifier = topic.id || topic.title;
      const resForum = await fetch(
        `/api/empire-play/forum/${activeSubmenu}/${encodeURIComponent(topicIdentifier)}`,
      )
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      let commentsFromApi: CommentItem[] = [];

      setResolvedTopicId(resForum?.data?.media?.topicId || resForum?.data?.media?.id || topic.id || "");

      if (resForum && resForum.success && resForum.data && Array.isArray(resForum.data.comments)) {
        commentsFromApi = resForum.data.comments.map((c: any, idx: number) => ({
          id: c.id || `c_${idx}`,
          data: c.data || c.timestamp || c.data_hora || "",
          titulo: c.titulo || c.title || topic.title,
          jogador: c.jogador || c.player || c.nome_jogador || "Anônimo",
          comentario: c.comentario || c.comment || c.texto || "",
          nota: c.nota || c.rating || c.likes || "",
          rowIndex: c.rowIndex ?? null,
          sheetComments: c.sheetComments ?? null,
          reactions: c.reactions || {},
          reactedBy: c.reactedBy || {},
        }));
      }

      // Se a rota primária não tiver retornado comentários, busca no /api/forum/comments
      if (commentsFromApi.length === 0) {
        const tipoMediaMap: Record<ForumSubmenu, string> = {
          musicas: "musica",
          videos: "video",
          albuns: "album",
        };
        const tipoMedia = tipoMediaMap[activeSubmenu];
        const res = await fetch(
          `/api/forum/comments?titulo=${encodeURIComponent(topic.title)}&idTopico=${encodeURIComponent(topic.id || "")}&tipoMedia=${tipoMedia}`,
        );
        const json = await res.json();
        if (json && json.success && Array.isArray(json.data)) {
          commentsFromApi = json.data.map((c: any, idx: number) => ({
            id: c.id || `c_fallback_${idx}`,
            data: c.data || c.timestamp || "",
            titulo: c.titulo || c.title || topic.title,
            jogador: c.jogador || c.player || "Anônimo",
            comentario: c.comentario || c.comment || "",
            nota: c.nota || c.rating || "",
            rowIndex: null,
            sheetComments: null,
            reactions: {},
            reactedBy: {},
          }));
        }
      }

      setTopicComments(commentsFromApi);
    } catch (err) {
      console.error("Erro ao carregar comentários:", err);
      setTopicComments([]);
    } finally {
      setLoadingComments(false);
    }
  };

  useEffect(() => {
    if (selectedTopic) {
      fetchTopicComments(selectedTopic);
    } else {
      setTopicComments([]);
    }
  }, [selectedTopic]);

  // Alterna reação de emoji num comentário — atualiza local (otimista) e
  // reconcilia com a resposta real do servidor.
  const handleToggleReaction = async (comment: CommentItem, emoji: string) => {
    if (!comment.rowIndex || !comment.sheetComments || !myId) return;
    haptic.selection();

    const mineNow = (comment.reactedBy[emoji] || []).includes(myId);
    const optimisticReactedBy = { ...comment.reactedBy };
    optimisticReactedBy[emoji] = mineNow
      ? (optimisticReactedBy[emoji] || []).filter((id) => id !== myId)
      : [...(optimisticReactedBy[emoji] || []), myId];
    if (optimisticReactedBy[emoji].length === 0) delete optimisticReactedBy[emoji];
    const optimisticReactions: Record<string, number> = {};
    Object.entries(optimisticReactedBy).forEach(([e, ids]) => (optimisticReactions[e] = ids.length));

    setTopicComments((prev) =>
      prev.map((c) =>
        c.id === comment.id
          ? { ...c, reactions: optimisticReactions, reactedBy: optimisticReactedBy }
          : c,
      ),
    );

    try {
      const res = await fetch("/api/forum/comment-reaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetComments: comment.sheetComments,
          rowIndex: comment.rowIndex,
          emoji,
          jogadorId: myId,
        }),
      });
      const json = await res.json();
      if (json?.success && json.data) {
        setTopicComments((prev) =>
          prev.map((c) =>
            c.id === comment.id
              ? { ...c, reactions: json.data.reactions || {}, reactedBy: json.data.reactedBy || {} }
              : c,
          ),
        );
      }
    } catch (err) {
      console.error("Erro ao reagir ao comentário:", err);
    }
  };

  // Filtragem por busca + tag (Vídeos)
  const filteredItems = useMemo(() => {
    let list = items;
    if (activeSubmenu === "videos" && activeVideoTag !== "Todos") {
      list = list.filter((item) => item.tipoVideo === activeVideoTag);
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (item) =>
        item.title?.toLowerCase().includes(q) ||
        item.artist?.toLowerCase().includes(q) ||
        item.album?.toLowerCase().includes(q),
    );
  }, [items, searchQuery, activeSubmenu, activeVideoTag]);

  // Extrai nota ou likes dos campos do item — sem dado real, retorna vazio
  // (nunca inventa um número; o ScoreBadge simplesmente não renderiza).
  const getItemScore = (item: ForumTopicItem) => {
    const fields = item.fields || {};
    return (
      fields.metacritic_medio ||
      fields.metacritic ||
      fields.likes_medio ||
      fields.likes ||
      fields.nota ||
      ""
    );
  };

  // Helper de tipo de mídia para o modal
  const getMediaTypeForModal = (): "musica" | "video" | "album" => {
    if (activeSubmenu === "musicas") return "musica";
    if (activeSubmenu === "videos") return "video";
    return "album";
  };

  // Tags disponíveis pro filtro do submenu Vídeos (derivadas dos itens
  // carregados, igual ao catálogo em /empire-play/videos).
  const videoTags = useMemo(() => {
    if (activeSubmenu !== "videos") return [];
    const set = new Set<string>();
    items.forEach((item) => {
      if (item.tipoVideo) set.add(item.tipoVideo);
    });
    return ["Todos", ...Array.from(set).sort()];
  }, [items, activeSubmenu]);

  return (
    <div className="space-y-6 text-white">
      {/* HEADER DO FÓRUM */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 bg-neutral-900/80 border border-white/10 p-4 sm:p-6 rounded-2xl sm:rounded-3xl backdrop-blur-md">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 sm:py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-1 sm:mb-2">
            <MessageSquare className="size-3 sm:size-3.5" />
            Comunidade Empire Hub
          </div>
          <h2 className="text-xl sm:text-3xl font-black text-white">Fórum</h2>
          <p className="text-[11px] sm:text-xs text-neutral-400 mt-0.5">
            Comente o catálogo dos artistas
          </p>
        </div>

        {/* SUBMENUS / TABS */}
        <div className="flex items-center gap-1.5 sm:gap-2 bg-neutral-950/80 p-1 sm:p-1.5 rounded-xl sm:rounded-2xl border border-white/10 w-full sm:w-auto overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveSubmenu("musicas")}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-wider transition shrink-0 ${
              activeSubmenu === "musicas"
                ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <Music className="size-3.5" />
            Músicas
          </button>

          <button
            onClick={() => setActiveSubmenu("videos")}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-wider transition shrink-0 ${
              activeSubmenu === "videos"
                ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <Film className="size-3.5" />
            Vídeos
          </button>

          <button
            onClick={() => setActiveSubmenu("albuns")}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-wider transition shrink-0 ${
              activeSubmenu === "albuns"
                ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <Disc className="size-3.5" />
            Álbuns
          </button>
        </div>
      </div>

      {/* DETALHE DO TÓPICO SELECIONADO OU LISTA DE TÓPICOS */}
      {selectedTopic ? (
        /* VISÃO DE TÓPICO INDIVIDUAL */
        <div className="bg-neutral-900/90 border border-white/10 rounded-2xl sm:rounded-3xl p-4 sm:p-8 space-y-6 sm:space-y-8 backdrop-blur-md animate-fade-in">
          {/* Botão de Voltar */}
          <button
            onClick={() => setSelectedTopic(null)}
            className="inline-flex items-center gap-2 text-xs font-bold text-neutral-400 hover:text-white transition uppercase tracking-wider"
          >
            <ChevronLeft className="size-4" />
            Voltar para lista de {activeSubmenu}
          </button>

          {/* DADOS DO TÓPICO DEPENDENDO DA MÍDIA */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-start">
            {/* CAPA OU PLAYER */}
            <div className="lg:col-span-5 space-y-3 sm:space-y-4">
              {activeSubmenu === "videos" ? (
                /* PLAYER DE VÍDEO / MV */
                <div className="w-full max-w-sm sm:max-w-md mx-auto bg-black rounded-2xl overflow-hidden border border-white/10 relative shadow-xl group min-h-[250px] flex items-center justify-center">
                  {selectedTopic.link ? (
                    <iframe
                      src={getEmbedMediaUrl(selectedTopic.link)}
                      title={selectedTopic.title}
                      className="w-full aspect-video border-0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-neutral-950">
                      <Tv className="size-10 text-neutral-600 mb-2" />
                      <p className="text-xs text-neutral-400 font-medium">
                        Player indisponível no momento.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                /* CAPA DE MÚSICA / ÁLBUM */
                <div className="relative aspect-square w-full max-w-[130px] sm:max-w-[160px] md:max-w-[180px] mx-auto rounded-2xl sm:rounded-3xl overflow-hidden border border-white/10 shadow-xl bg-neutral-950 group">
                  <img
                    src={driveImg(selectedTopic.cover, 400) || "/placeholder.png"}
                    alt={selectedTopic.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80";
                    }}
                  />
                  {selectedTopic.link && (
                    <button
                      onClick={() =>
                        onPlayTrack?.(
                          {
                            titulo: selectedTopic.title,
                            artista: selectedTopic.artist,
                            capa_url: selectedTopic.cover || undefined,
                            url: selectedTopic.link || undefined,
                          },
                          [],
                        )
                      }
                      className="absolute inset-0 m-auto size-12 sm:size-16 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black flex items-center justify-center shadow-xl opacity-90 sm:opacity-0 group-hover:opacity-100 transition scale-90 group-hover:scale-100"
                    >
                      <Play className="size-6 sm:size-8 ml-0.5 sm:ml-1 fill-black" />
                    </button>
                  )}
                </div>
              )}

              {/* CARD DE AVALIAÇÃO OFICIAL — só aparece com nota/likes real */}
              {getItemScore(selectedTopic) && (
                <div className="bg-neutral-800/60 border border-white/10 rounded-xl sm:rounded-2xl p-3 sm:p-4 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] sm:text-[11px] font-bold text-neutral-400 uppercase tracking-wider block">
                      {activeSubmenu === "videos"
                        ? "Total de Likes Accum"
                        : "Nota Oficial Metacritic"}
                    </span>
                    <span className="text-[11px] sm:text-xs text-neutral-300 font-medium">
                      Média da comunidade do Empire Hub
                    </span>
                  </div>
                  <ScoreBadge
                    score={getItemScore(selectedTopic)}
                    variant={
                      activeSubmenu === "videos"
                        ? "likes"
                        : "metacritic"
                    }
                  />
                </div>
              )}
            </div>

            {/* INFORMAÇÕES DO TÓPICO / LETRA / FAIXAS */}
            <div className="lg:col-span-7 space-y-4 sm:space-y-6">
              <div>
                <h1 className="text-xl sm:text-4xl font-black text-white">{selectedTopic.title}</h1>
                <p className="text-sm sm:text-lg font-bold text-emerald-400 mt-1">
                  {selectedTopic.artist}
                </p>
                {selectedTopic.releaseDate && (
                  <div className="inline-flex items-center gap-1.5 text-xs text-neutral-400 mt-2">
                    <Calendar className="size-3.5" />
                    <span>Lançamento: {selectedTopic.releaseDate}</span>
                  </div>
                )}
              </div>

              {/* CASO ÁLBUM: EXIBIR LISTA DE FAIXAS */}
              {activeSubmenu === "albuns" && (
                <div className="bg-neutral-800/40 border border-white/10 rounded-2xl p-4 sm:p-5 space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                    <ListMusic className="size-4" />
                    Faixas do Álbum
                  </h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {selectedTopic.fields?.faixas ? (
                      selectedTopic.fields.faixas.split("\n").map((faixa, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-2.5 sm:p-3 bg-neutral-900/60 rounded-xl border border-white/5 text-xs text-neutral-200"
                        >
                          <span className="font-semibold line-clamp-1">{faixa}</span>
                          <button
                            onClick={() =>
                              onPlayTrack?.(
                                {
                                  titulo: faixa,
                                  artista: selectedTopic.artist,
                                  capa_url: selectedTopic.cover || undefined,
                                },
                                [],
                              )
                            }
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-emerald-500 hover:text-black transition text-neutral-400"
                          >
                            <Play className="size-3.5" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-neutral-500 italic">
                        Faixas em reprodução direta no catálogo do Empire Play.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* CASO MÚSICA: EXIBIR LETRA COMPLETA */}
              {activeSubmenu === "musicas" && (
                <div className="bg-neutral-800/40 border border-white/10 rounded-2xl p-4 sm:p-5 space-y-2">
                  <h3 className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                    <FileText className="size-4" />
                    Letra da Música
                  </h3>
                  <div className="text-xs text-neutral-300 font-mono leading-relaxed whitespace-pre-wrap max-h-60 sm:max-h-72 overflow-y-auto bg-neutral-950/60 p-3 sm:p-4 rounded-xl border border-white/5">
                    {selectedTopic.fields?.letra ||
                      selectedTopic.fields?.letra_da_musica ||
                      selectedTopic.fields?.lyrics ||
                      "Letra oficial em processamento no acervo do Empire Hub."}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* SEÇÃO DE COMENTÁRIOS E AVALIAÇÃO */}
          <div className="border-t border-white/10 pt-6 sm:pt-8 space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
                  <MessageSquare className="size-4 sm:size-5 text-emerald-400" />
                  Comentários da Comunidade ({topicComments.length})
                </h3>
                <p className="text-[11px] sm:text-xs text-neutral-400">
                  Participe do debate e contribua para os dados do Empire Play.
                </p>
              </div>

              <button
                onClick={() => setIsCommentModalOpen(true)}
                className="w-full sm:w-auto px-4 sm:px-5 py-2 sm:py-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2"
              >
                <Sparkles className="size-4" />
                Avaliar & Comentar
              </button>
            </div>

            {/* LISTA DE COMENTÁRIOS */}
            {loadingComments ? (
              <div className="p-6 text-center text-xs text-neutral-400 bg-neutral-800/30 rounded-2xl border border-white/5">
                Carregando comentários...
              </div>
            ) : topicComments.length === 0 ? (
              <div className="p-6 text-center text-xs text-neutral-500 bg-neutral-800/30 rounded-2xl border border-white/5">
                Nenhum comentário registrado ainda. Seja o primeiro a avaliar!
              </div>
            ) : (
              <div className="space-y-2.5 sm:space-y-3">
                {topicComments.map((c) => (
                  <div
                    key={c.id}
                    className="p-3.5 sm:p-5 bg-neutral-800/50 border border-white/5 rounded-2xl space-y-1.5 sm:space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                        <User className="size-3.5" />
                        {c.jogador}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] sm:text-[11px] text-neutral-500">
                          {c.data}
                        </span>
                        {c.nota && (
                          <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 font-bold text-[10px] sm:text-[11px] rounded-md border border-emerald-500/20">
                            {activeSubmenu === "videos"
                              ? `${c.nota} Likes`
                              : `Nota: ${c.nota}`}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs sm:text-sm text-neutral-200 leading-relaxed">
                      {c.comentario}
                    </p>
                    {c.rowIndex && (
                      <ReactionBar
                        reactions={c.reactions}
                        reactedBy={c.reactedBy}
                        myId={myId}
                        disabled={!myId}
                        onToggle={(emoji) => handleToggleReaction(c, emoji)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* VISÃO DA LISTA DE TÓPICOS */
        <div className="space-y-4 sm:space-y-6">
          {/* BARRA DE PESQUISA */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-neutral-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Pesquisar tópicos em ${activeSubmenu}...`}
              className="w-full pl-10 pr-4 py-2.5 sm:py-3.5 bg-neutral-900/80 border border-white/10 rounded-xl sm:rounded-2xl text-xs sm:text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 transition shadow-lg"
            />
          </div>

          {/* FILTRO DE TAG (só no submenu Vídeos) */}
          {activeSubmenu === "videos" && videoTags.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {videoTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setActiveVideoTag(tag)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-all shrink-0 border ${
                    activeVideoTag === tag
                      ? "bg-emerald-500 text-black border-emerald-400"
                      : "bg-white/5 text-neutral-400 border-white/10 hover:text-white hover:border-white/20"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          {/* GRID DE TÓPICOS COMPACTO E RESPONSIVO */}
          {loading ? (
            <div className="p-8 sm:p-12 text-center text-xs text-neutral-400 bg-neutral-900/60 rounded-2xl sm:rounded-3xl border border-white/10">
              Carregando tópicos da comunidade...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-8 sm:p-12 text-center text-xs text-neutral-500 bg-neutral-900/60 rounded-2xl sm:rounded-3xl border border-white/10">
              Nenhum tópico encontrado para esta categoria.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 sm:gap-4">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedTopic(item)}
                  className="bg-neutral-900/80 border border-white/10 rounded-xl sm:rounded-2xl p-2 sm:p-3 space-y-2 hover:border-emerald-500/50 hover:bg-neutral-800/80 transition duration-300 group cursor-pointer shadow-lg flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    {/* THUMBNAIL / CAPA REDUZIDA */}
                    <div className="aspect-square w-full max-h-36 sm:max-h-44 rounded-lg sm:rounded-xl overflow-hidden bg-neutral-950 relative border border-white/5 group-hover:border-emerald-500/30 transition">
                      <img
                        src={driveImg(item.cover, 250) || "/placeholder.png"}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80";
                        }}
                      />

                      {/* Botão de Play de Vídeo Acessível e Moderno */}
                      {(activeSubmenu === "videos") && (
                        <button
                          type="button"
                          aria-label={`Reproduzir vídeo ${item.title}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleVideoPlay(item);
                          }}
                          className="absolute inset-0 m-auto size-12 rounded-full bg-red-600/90 hover:bg-red-500 text-white flex items-center justify-center shadow-xl shadow-red-600/40 opacity-90 sm:opacity-0 group-hover:opacity-100 transition duration-300 scale-90 group-hover:scale-100 border border-white/20"
                        >
                          <Play className="size-6 ml-0.5 fill-white" />
                        </button>
                      )}

                      <div className="absolute top-2 right-2 sm:top-3 sm:right-3 pointer-events-none">
                        <ScoreBadge
                          score={getItemScore(item)}
                          variant={
                            activeSubmenu === "videos"
                              ? "likes"
                              : "metacritic"
                          }
                          className="!px-2 !py-0.5 sm:!px-3 sm:!py-1 !text-[10px] sm:!text-xs"
                        />
                      </div>
                    </div>

                    {/* METADADOS */}
                    <div>
                      <h3 className="font-bold text-xs sm:text-sm text-white line-clamp-1 group-hover:text-emerald-400 transition">
                        {item.title}
                      </h3>
                      <p className="text-[10px] sm:text-xs text-neutral-400 line-clamp-1 mt-0.5">
                        {item.artist}
                      </p>
                    </div>
                  </div>

                  {/* RODAPÉ DO TÓPICO */}
                  <div className="pt-2 sm:pt-3 border-t border-white/5 flex items-center justify-between text-[10px] sm:text-[11px] text-neutral-400">
                    <span className="flex items-center gap-1 text-emerald-400 font-bold uppercase tracking-wider">
                      <MessageSquare className="size-3" />
                      Acessar
                    </span>
                    {item.releaseDate && (
                      <span className="hidden sm:inline">{item.releaseDate}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL DE PLAYER DE VÍDEO EXPANDIDO */}
      {activeVideo && <VideoPlayer video={activeVideo} onClose={() => setActiveVideo(null)} />}

      {/* MODAL DE COMENTÁRIO E AVALIAÇÃO INTERATIVA */}
      {selectedTopic && (
        <CommentModal
          isOpen={isCommentModalOpen}
          onClose={() => setIsCommentModalOpen(false)}
          tipoMedia={getMediaTypeForModal()}
          tituloMedia={selectedTopic.title}
          topicId={resolvedTopicId || selectedTopic.id}
          onCommentSubmitted={() => {
            if (selectedTopic) fetchTopicComments(selectedTopic);
          }}
        />
      )}
    </div>
  );
};
