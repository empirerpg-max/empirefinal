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
  ListMusic,
  FileText,
  Volume2,
  Sparkles,
  Pencil,
  X,
  Check,
  ChevronDown,
  ExternalLink,
  Maximize2,
} from "lucide-react";
import { driveImg, driveRawImg } from "@/lib/api";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { useBackClose } from "@/hooks/use-back-close";
import { CommentModal } from "./CommentModal";
import { ScoreBadge } from "./ScoreBadge";
import { ReactionBar } from "./ReactionBar";
import { RichTextToolbar } from "./RichTextToolbar";
import { renderRichText } from "@/lib/richText";

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
  jogadorId: string;
  comentario: string;
  nota: string;
  // Linha real na planilha + aba de comentários — null quando o comentário
  // veio de uma fonte de fallback que não suporta reação.
  rowIndex: number | null;
  sheetComments: string | null;
  reactions: Record<string, number>;
  reactedBy: Record<string, string[]>;
}

interface ForumAlbumTrack {
  id: string;
  title: string;
  artist: string;
  trackOrder: number;
  coverUrl?: string | null;
  audioUrl?: string | null;
  lyrics?: string | null;
  letraSincronizada?: string | null;
  telegramTopicId?: string | null;
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
  // Só pra álbuns: faixas de verdade (com áudio próprio) e encarte.
  tracks?: ForumAlbumTrack[];
  encarte?: string[];
  // Código único (Musicas!Z / Albuns!L) — chave dos botões Shop/Info/Visual
  // (ver ExtraMaterial.tsx). Ausente em conteúdo legado sem código gerado.
  codigoUnico?: string | null;
  // Letra estática e sincronizada (LRC) da faixa — usadas pro bloco de
  // letra/karaoke exibido no tópico da música.
  lyrics?: string | null;
  letraSincronizada?: string | null;
}

const FORUM_SUBMENUS: ForumSubmenu[] = ["musicas", "videos", "albuns"];

// Telegram atribui uma cor fixa por usuário (derivada do id) pro nome e pro
// avatar em grupos/tópicos — replicamos a mesma ideia aqui com a paleta do
// app (emerald como cor "própria" de destaque continua reservada ao score).
const TELEGRAM_NAME_COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#C084FC",
  "#F7B733",
  "#5B9BFF",
  "#FF8FB1",
  "#6FCF97",
];

function nameColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return TELEGRAM_NAME_COLORS[Math.abs(hash) % TELEGRAM_NAME_COLORS.length];
}

function initialsFor(name: string): string {
  const clean = (name || "?").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/);
  const first = parts[0]?.[0] || "?";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] || "" : "";
  return (first + second).toUpperCase();
}

// Thumbnail com fallback pra ícone neutro quando a capa falha ao carregar —
// antes trocava por uma foto de banco de imagens (Unsplash) sem nenhuma
// relação com o conteúdo, o que enganava o jogador fazendo parecer que
// aquela era a capa de verdade.
function TopicThumbImg({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={`${className || ""} grid place-items-center bg-neutral-900`}>
        <Music className="size-8 text-neutral-700" />
      </div>
    );
  }
  return (
    <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />
  );
}

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
import { ExtraMaterialButtons, useExtraMaterial, VisualBlocosView } from "./ExtraMaterial";
import { useEmpirePlayer } from "./PlayerContext";
import { parseLrc, findCurrentLrcLineIndex } from "@/lib/lrc";

// Lista de letra sincronizada com auto-scroll até a linha atual — sem isso,
// quando a linha destacada saía da área visível, era preciso arrastar a
// barra de rolagem manualmente pra achar onde a música estava.
function KaraokeLines({
  lines,
  activeIndex,
  lineClassName,
}: {
  lines: { time: number; text: string }[];
  activeIndex: number;
  lineClassName: (index: number) => string;
}) {
  const lineRefs = React.useRef<(HTMLParagraphElement | null)[]>([]);
  useEffect(() => {
    if (activeIndex < 0) return;
    lineRefs.current[activeIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex]);

  return (
    <>
      {lines.map((line, i) => (
        <p
          key={i}
          ref={(el) => {
            lineRefs.current[i] = el;
          }}
          className={lineClassName(i)}
        >
          {line.text}
        </p>
      ))}
    </>
  );
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
  // Capa quebrada/sem link do tópico aberto — mostra um ícone neutro em vez
  // de trocar por uma foto de banco de imagens (Unsplash) que não tem nada
  // a ver com o conteúdo real, além de vazar dado do visitante pro Unsplash.
  const [heroCoverFailed, setHeroCoverFailed] = useState(false);
  // Evita reabrir o deep link se o jogador voltar pra lista manualmente.
  const [pendingDeepLinkId, setPendingDeepLinkId] = useState<string | undefined>(initialItemId);
  // Filtro de tag do submenu Vídeos (Music Video, Live, Video, etc).
  const [activeVideoTag, setActiveVideoTag] = useState<string>("Todos");
  // IDs de tópico (telegramTopicId) em que EU já comentei — pra marcar um
  // "✓ você comentou" na listagem, sem precisar abrir cada tópico.
  const [commentedTopicIds, setCommentedTopicIds] = useState<Set<string>>(new Set());

  // State para comentários do tópico selecionado
  const [topicComments, setTopicComments] = useState<CommentItem[]>([]);
  const [loadingComments, setLoadingComments] = useState<boolean>(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const editTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  // ID do tópico REAL da planilha (coluna "ID do tópico"), usado como chave
  // ao gravar comentários — nunca o id sintético gerado pelo app.
  const [resolvedTopicId, setResolvedTopicId] = useState<string>("");

  // State para o Modal de Comentário
  const [isCommentModalOpen, setIsCommentModalOpen] = useState<boolean>(false);

  // State para o Player de Vídeo Expandido
  const [activeVideo, setActiveVideo] = useState<PlayableVideo | null>(null);

  // Audio preview no tópico de álbum/música
  const [playingTrackUrl, setPlayingTrackUrl] = useState<string | null>(null);
  // Letra expandida inline na lista de faixas do álbum (sem sair da tela).
  const [expandedTrackId, setExpandedTrackId] = useState<string | null>(null);
  // Capa do álbum em tela cheia (lightbox).
  const [coverExpanded, setCoverExpanded] = useState(false);
  useEffect(() => {
    setCoverExpanded(false);
  }, [selectedTopic?.id]);

  // Modo "Visual" do tópico — em vez de popup, substitui o corpo normal
  // (faixas/encarte/letra) pelo conteúdo montado em Extra_Musicas/Extra_Albuns,
  // mantendo sempre a capa e o título/artista fixos. Fecha ao trocar de tópico.
  const extraMaterialTipo = activeSubmenu === "albuns" ? "album" : "musica";
  const extraMaterial = useExtraMaterial(
    activeSubmenu === "musicas" || activeSubmenu === "albuns" ? selectedTopic?.codigoUnico : null,
    extraMaterialTipo,
  );
  const [visualAberto, setVisualAberto] = useState(false);
  useEffect(() => {
    setVisualAberto(false);
  }, [selectedTopic?.id]);

  // "Voltar" (botão físico Android, swipe do iOS ou o BackButton do app)
  // fecha o tópico aberto e volta pra lista do fórum, em vez de sair da
  // rota do fórum inteira — ver src/hooks/use-back-close.ts.
  useBackClose(!!selectedTopic, () => setSelectedTopic(null));

  useEffect(() => {
    setHeroCoverFailed(false);
  }, [selectedTopic?.id]);

  const handleVideoPlay = (topic: ForumTopicItem) => {
    // Drive e Telegram nunca são tocáveis pelo link/id cru — precisam passar
    // pelo proxy do próprio Worker (mesma conversão de mappers.ts/toPlayableVideo),
    // senão o <video> tenta carregar um link do Drive/ID do Telegram direto e falha.
    const raw = topic.link || topic.id;
    const source = topic.videoSource || undefined;
    let resolvedLink = raw || "";
    if (source === "telegram" && raw) {
      resolvedLink = `/api/telegram-video/${encodeURIComponent(raw)}`;
    } else if (source === "drive" && raw) {
      const match = raw.match(/[-\w]{25,}/);
      const fileId = match ? match[0] : raw;
      resolvedLink = `/api/media/video?id=${fileId}`;
    }

    const videoObj: PlayableVideo = {
      id: topic.id,
      titulo: topic.title,
      artista: topic.artist,
      link: resolvedLink,
      fonte: source,
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
            // Álbum não tem link próprio — usa o áudio da primeira faixa,
            // igual "Tocar Álbum" no catálogo.
            (Array.isArray(item.tracks) && item.tracks[0]?.audioUrl) ||
            null,
          videoSource: item.videoSource || null,
          releaseDate: item.releaseDate || item.data_lancamento || item.data || null,
          telegramTopicId: item.telegramTopicId || null,
          tipoVideo: item.category || item.tipo_video || null,
          lyrics: item.lyrics || item.letra || item.fields?.letra || null,
          letraSincronizada: item.syncedLyrics || item.letra_sincronizada || null,
          fields: item.fields || {
            letra: item.lyrics || item.letra,
            metacritic: item.metacriticAvg || item.metacritic || item.nota,
            descricao: item.description || item.descricao,
          },
          tracks: Array.isArray(item.tracks)
            ? item.tracks.map((t: any) => ({
                id: t.id,
                title: t.title,
                artist: t.artist,
                trackOrder: t.trackOrder,
                coverUrl: t.coverUrl,
                audioUrl: t.audioUrl,
                lyrics: t.lyrics,
                letraSincronizada: t.syncedLyrics || t.letra_sincronizada || null,
                telegramTopicId: t.telegramTopicId || t.id_do_topico || null,
              }))
            : undefined,
          encarte: Array.isArray(item.encarte) ? item.encarte : undefined,
          codigoUnico: item.codigoUnico || null,
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

  // 1.2 Carrega os tópicos que eu já comentei, pra marcar o "✓" na listagem.
  useEffect(() => {
    if (!myId) return;
    let isMounted = true;
    fetch(`/api/forum/meus-comentarios?tgId=${encodeURIComponent(myId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (isMounted && json?.success && Array.isArray(json.data)) {
          setCommentedTopicIds(new Set(json.data));
        }
      })
      .catch((err) => console.error("Erro ao carregar meus comentários:", err));
    return () => {
      isMounted = false;
    };
  }, [myId]);

  // 1.1 Deep link (player/catálogo → fórum): assim que os itens da aba
  // inicial carregam, abre direto o tópico pedido.
  useEffect(() => {
    if (!pendingDeepLinkId || loading) return;
    // Notificações (e outros deep links vindos de fora do fórum) mandam o ID
    // REAL do tópico (mesmo valor gravado nas abas Comentarios_*), não o id
    // sintético que os endpoints de listagem geram — por isso também casa
    // por telegramTopicId, não só por item.id.
    const match = items.find(
      (item) => item.id === pendingDeepLinkId || item.telegramTopicId === pendingDeepLinkId,
    );
    if (match) {
      setSelectedTopic(match);
      setPendingDeepLinkId(undefined);
    }
  }, [pendingDeepLinkId, loading, items]);

  // 2. Carregar comentários quando um tópico é selecionado
  // Troca rápida de tópico (ex: clicar em "Ver tópico" dentro de outro
  // tópico já aberto) podia disparar duas buscas em paralelo — se a mais
  // antiga respondesse depois da mais nova, ela sobrescrevia os comentários
  // certos com os do tópico errado. O token abaixo garante que só a busca
  // mais recente é aplicada.
  const commentsFetchToken = React.useRef(0);
  const fetchTopicComments = async (topicOrTitle: ForumTopicItem | string) => {
    const myToken = ++commentsFetchToken.current;
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

      if (myToken !== commentsFetchToken.current) return;
      setResolvedTopicId(resForum?.data?.media?.topicId || resForum?.data?.media?.id || topic.id || "");

      if (resForum && resForum.success && resForum.data && Array.isArray(resForum.data.comments)) {
        commentsFromApi = resForum.data.comments.map((c: any, idx: number) => ({
          id: c.id || `c_${idx}`,
          data: c.data || c.timestamp || c.data_hora || "",
          titulo: c.titulo || c.title || topic.title,
          jogador: c.jogador || c.player || c.nome_jogador || "Anônimo",
          jogadorId: c.jogadorId || "",
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
            jogadorId: "",
            comentario: c.comentario || c.comment || "",
            nota: c.nota || c.rating || "",
            rowIndex: null,
            sheetComments: null,
            reactions: {},
            reactedBy: {},
          }));
        }
      }

      if (myToken !== commentsFetchToken.current) return;
      setTopicComments(commentsFromApi);
    } catch (err) {
      console.error("Erro ao carregar comentários:", err);
      if (myToken === commentsFetchToken.current) setTopicComments([]);
    } finally {
      if (myToken === commentsFetchToken.current) setLoadingComments(false);
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
    if (comment.rowIndex == null || !comment.sheetComments || !myId) return;
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

  function startEditComment(comment: CommentItem) {
    haptic.selection();
    setEditingCommentId(comment.id);
    setEditText(comment.comentario);
  }

  function cancelEditComment() {
    setEditingCommentId(null);
    setEditText("");
  }

  async function saveEditComment(comment: CommentItem) {
    if (comment.rowIndex == null || !comment.sheetComments || !myId || !editText.trim()) return;
    setSavingEdit(true);
    try {
      const res = await fetch("/api/forum/comment-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetComments: comment.sheetComments,
          rowIndex: comment.rowIndex,
          jogadorId: myId,
          novoTexto: editText.trim(),
        }),
      });
      const json = await res.json();
      if (json?.success) {
        setTopicComments((prev) =>
          prev.map((c) => (c.id === comment.id ? { ...c, comentario: editText.trim() } : c)),
        );
        setEditingCommentId(null);
        setEditText("");
      }
    } catch (err) {
      console.error("Erro ao editar comentário:", err);
    } finally {
      setSavingEdit(false);
    }
  }

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

  const { currentTrack: playingTrack, currentTime: playingTime } = useEmpirePlayer();

  return (
    <div className={`space-y-6 text-white ${playingTrack ? "pb-24" : ""}`}>
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
        /* VISÃO DE TÓPICO INDIVIDUAL — hero com fundo desfocado a partir da
           própria capa, estilo Spotify/Apple Music. */
        <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-white/10 animate-fade-in">
          {/* Fundo desfocado (capa ampliada + blur + degradê escuro por cima) */}
          {selectedTopic.cover && (
            <div className="absolute inset-0 -z-10">
              <img
                src={driveImg(selectedTopic.cover, 100) || undefined}
                alt=""
                aria-hidden="true"
                className="w-full h-full object-cover scale-125 blur-3xl opacity-40 saturate-150"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-neutral-950/60 via-neutral-950/85 to-neutral-950" />
            </div>
          )}
          <div className="bg-neutral-900/70 backdrop-blur-md p-4 sm:p-8 space-y-6 sm:space-y-8">
            {/* Botão de Voltar */}
            <button
              onClick={() => setSelectedTopic(null)}
              className="inline-flex items-center gap-2 text-xs font-bold text-neutral-400 hover:text-white transition uppercase tracking-wider"
            >
              <ChevronLeft className="size-4" />
              Voltar para lista de {activeSubmenu}
            </button>

            {/* DADOS DO TÓPICO DEPENDENDO DA MÍDIA */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-10 items-start">
              {/* CAPA OU PLAYER — encolhe no modo Visual pra sobrar mais
                  espaço pro conteúdo customizado (ver mais abaixo). */}
              <div className={visualAberto ? "lg:col-span-3 space-y-3 sm:space-y-4" : "lg:col-span-5 space-y-3 sm:space-y-4"}>
                {activeSubmenu === "videos" ? (
                  /* CAPA DE VÍDEO — abre no mesmo player nativo do app usado
                     no catálogo (nunca um iframe cru do Drive/YouTube aqui;
                     o VideoPlayer já resolve Drive/Telegram via proxy do
                     Worker e YouTube/Vimeo via embed oficial). */
                  <button
                    type="button"
                    onClick={() => handleVideoPlay(selectedTopic)}
                    disabled={!selectedTopic.link}
                    className="w-full max-w-md sm:max-w-none mx-auto aspect-video bg-black rounded-2xl sm:rounded-3xl overflow-hidden border border-white/15 relative shadow-[0_25px_70px_-15px_rgba(0,0,0,0.9)] ring-1 ring-white/10 group flex items-center justify-center disabled:cursor-not-allowed"
                  >
                    {selectedTopic.cover ? (
                      <img
                        src={driveImg(selectedTopic.cover, 800) || undefined}
                        alt={selectedTopic.title}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition duration-500"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-neutral-800 to-neutral-950" />
                    )}
                    <div className="absolute inset-0 bg-black/30 group-hover:bg-black/40 transition-colors" />
                    {selectedTopic.link ? (
                      <span className="relative size-16 sm:size-20 rounded-full bg-red-600/70 group-hover:bg-red-500/85 backdrop-blur-sm text-white flex items-center justify-center shadow-2xl shadow-red-600/20 scale-95 group-hover:scale-100 transition-all">
                        <Play className="size-7 sm:size-9 ml-0.5 sm:ml-1 fill-white" />
                      </span>
                    ) : (
                      <div className="relative flex flex-col items-center text-center p-6">
                        <Tv className="size-10 text-neutral-400 mb-2" />
                        <p className="text-xs text-neutral-300 font-medium">
                          Player indisponível no momento.
                        </p>
                      </div>
                    )}
                  </button>
              ) : (
                /* CAPA DE MÚSICA / ÁLBUM — em destaque, estilo capa de disco.
                   Menor no modo Visual (só pra situar, sem tomar espaço). */
                <div
                  className={`relative aspect-square w-full mx-auto rounded-2xl sm:rounded-3xl overflow-hidden border border-white/15 shadow-[0_25px_70px_-15px_rgba(0,0,0,0.9)] ring-1 ring-white/10 bg-neutral-950 group ${
                    visualAberto ? "max-w-[120px] sm:max-w-[150px]" : "max-w-[280px] sm:max-w-[340px] md:max-w-[400px]"
                  }`}
                >
                  {selectedTopic.cover && !heroCoverFailed ? (
                    <img
                      src={driveImg(selectedTopic.cover, 800)}
                      alt={selectedTopic.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                      onError={() => setHeroCoverFailed(true)}
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center bg-neutral-900">
                      <Music className="size-16 text-neutral-700" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCoverExpanded(true);
                    }}
                    title="Ver capa em tela cheia"
                    className="absolute top-2 right-2 sm:top-3 sm:right-3 size-8 sm:size-9 rounded-full bg-black/50 backdrop-blur text-white grid place-items-center opacity-100 sm:opacity-0 group-hover:opacity-100 transition hover:bg-black/70 z-10"
                  >
                    <Maximize2 className="size-3.5 sm:size-4" />
                  </button>
                  {selectedTopic.link && (
                    <button
                      onClick={() => {
                        // Botão de play do CABEÇALHO do álbum — antes mandava
                        // a playlist vazia ([]), então "avançar/voltar" nunca
                        // tinha pra onde ir, mesmo com o álbum tendo várias
                        // faixas. Agora, se o álbum tem faixas próprias, toca
                        // a tracklist inteira a partir da primeira (igual
                        // clicar na primeira faixa da lista); só cai pro link
                        // único do tópico quando não há faixas cadastradas.
                        const tracksComAudio = (selectedTopic.tracks || []).filter((t) => t.audioUrl);
                        if (tracksComAudio.length > 0) {
                          const playlist = tracksComAudio.map((t, ti) => ({
                            id: t.id || String(ti),
                            titulo: t.title,
                            artista: t.artist || selectedTopic.artist,
                            capa_url: t.coverUrl || selectedTopic.cover || undefined,
                            url: t.audioUrl || undefined,
                          }));
                          onPlayTrack?.(playlist[0], playlist);
                          return;
                        }
                        onPlayTrack?.(
                          {
                            id: selectedTopic.id,
                            titulo: selectedTopic.title,
                            artista: selectedTopic.artist,
                            capa_url: selectedTopic.cover || undefined,
                            url: selectedTopic.link || undefined,
                            telegramTopicId: selectedTopic.telegramTopicId || selectedTopic.id,
                            letra: selectedTopic.lyrics || undefined,
                            letraSincronizada: selectedTopic.letraSincronizada || null,
                          },
                          [],
                        );
                      }}
                      className="absolute inset-0 m-auto size-16 sm:size-20 rounded-full bg-emerald-500/70 hover:bg-emerald-400/85 backdrop-blur-sm text-black flex items-center justify-center shadow-2xl shadow-emerald-500/20 opacity-70 sm:opacity-0 group-hover:opacity-100 transition scale-90 group-hover:scale-100"
                    >
                      <Play className="size-7 sm:size-9 ml-0.5 sm:ml-1 fill-black" />
                    </button>
                  )}
                </div>
              )}

              {/* CARD DE AVALIAÇÃO OFICIAL — só aparece com nota/likes real,
                  e escondido no modo Visual (coluna fica estreita demais). */}
              {!visualAberto && getItemScore(selectedTopic) && (
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

            {/* INFORMAÇÕES DO TÓPICO / LETRA / FAIXAS — texto encolhe no modo
                Visual, junto com a capa, pra sobrar mais espaço embaixo. */}
            <div className={visualAberto ? "lg:col-span-9 space-y-4 sm:space-y-6" : "lg:col-span-7 space-y-4 sm:space-y-6"}>
              <div>
                <span className="text-[10px] sm:text-xs font-black uppercase tracking-[0.2em] text-emerald-400/80">
                  {activeSubmenu === "musicas" && "Música"}
                  {activeSubmenu === "videos" && (selectedTopic.tipoVideo || "Vídeo")}
                  {activeSubmenu === "albuns" && "Álbum"}
                </span>
                <h1
                  className={
                    visualAberto
                      ? "text-lg sm:text-2xl font-black text-white tracking-tight leading-[1.05] mt-1"
                      : "text-2xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-[1.05] mt-1"
                  }
                >
                  {selectedTopic.title}
                </h1>
                <p className={visualAberto ? "text-sm font-bold text-emerald-400 mt-1" : "text-base sm:text-xl font-bold text-emerald-400 mt-2"}>
                  {selectedTopic.artist}
                </p>
                {selectedTopic.releaseDate && !visualAberto && (
                  <div className="inline-flex items-center gap-1.5 text-xs text-neutral-400 mt-3">
                    <Calendar className="size-3.5" />
                    <span>Lançamento: {selectedTopic.releaseDate}</span>
                  </div>
                )}
                {(activeSubmenu === "musicas" || activeSubmenu === "albuns") && (
                  <div className="mt-4">
                    <ExtraMaterialButtons
                      data={extraMaterial}
                      titulo={selectedTopic.title}
                      artista={selectedTopic.artist}
                      visualAtivo={visualAberto}
                      onToggleVisual={() => setVisualAberto((v) => !v)}
                    />
                  </div>
                )}
              </div>

              {!visualAberto && (
                <>

              {/* CASO ÁLBUM: EXIBIR LISTA DE FAIXAS DE VERDADE (com áudio
                  próprio por faixa, ordenadas — igual uma playlist) */}
              {activeSubmenu === "albuns" && (
                <div className="bg-neutral-800/40 border border-white/10 rounded-2xl p-4 sm:p-5 space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                    <ListMusic className="size-4" />
                    Faixas do Álbum
                  </h3>
                  <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                    {selectedTopic.tracks && selectedTopic.tracks.length > 0 ? (
                      selectedTopic.tracks.map((faixa, i) => {
                        const trackKey = faixa.id || String(i);
                        const isExpanded = expandedTrackId === trackKey;
                        const letra = faixa.lyrics?.trim();
                        return (
                          <div key={trackKey} className="bg-neutral-900/60 rounded-xl border border-white/5 overflow-hidden">
                            <div className="w-full flex items-center gap-1 p-2.5 sm:p-3 group">
                              <button
                                type="button"
                                disabled={!faixa.audioUrl}
                                onClick={() =>
                                  onPlayTrack?.(
                                    {
                                      id: trackKey,
                                      titulo: faixa.title,
                                      artista: faixa.artist || selectedTopic.artist,
                                      capa_url: faixa.coverUrl || selectedTopic.cover || undefined,
                                      url: faixa.audioUrl || undefined,
                                      telegramTopicId: faixa.telegramTopicId || trackKey,
                                      letra: faixa.lyrics || undefined,
                                      letraSincronizada: faixa.letraSincronizada || null,
                                    },
                                    selectedTopic.tracks!.map((t, ti) => ({
                                      id: t.id || String(ti),
                                      titulo: t.title,
                                      artista: t.artist || selectedTopic.artist,
                                      capa_url: t.coverUrl || selectedTopic.cover || undefined,
                                      url: t.audioUrl || undefined,
                                      telegramTopicId: t.telegramTopicId || t.id || String(ti),
                                      letra: t.lyrics || undefined,
                                      letraSincronizada: t.letraSincronizada || null,
                                    })),
                                  )
                                }
                                className="flex-1 min-w-0 flex items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <span className="w-5 shrink-0 text-center font-mono text-[11px] text-neutral-500 hidden sm:inline sm:group-hover:hidden">
                                  {faixa.trackOrder || i + 1}
                                </span>
                                <Play className="size-3.5 shrink-0 sm:hidden sm:group-hover:block text-emerald-400" />
                                <span className="flex-1 min-w-0 text-xs font-semibold text-neutral-200 break-words">
                                  {faixa.title}
                                </span>
                                {!faixa.audioUrl && (
                                  <span className="text-[10px] text-neutral-500 italic shrink-0">
                                    sem áudio
                                  </span>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => setExpandedTrackId(isExpanded ? null : trackKey)}
                                title="Ver letra"
                                className={`size-7 shrink-0 rounded-lg grid place-items-center transition ${isExpanded ? "bg-emerald-500/20 text-emerald-400" : "text-neutral-500 hover:text-neutral-300 hover:bg-white/5"}`}
                              >
                                <ChevronDown className={`size-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                              </button>
                            </div>
                            {isExpanded && (() => {
                              const isThisTrackPlaying =
                                !!playingTrack &&
                                (playingTrack.id === trackKey ||
                                  (faixa.telegramTopicId &&
                                    playingTrack.telegramTopicId === faixa.telegramTopicId));
                              const syncedLines = isThisTrackPlaying
                                ? parseLrc(playingTrack.letraSincronizada || faixa.letraSincronizada)
                                : [];
                              const activeIdx = findCurrentLrcLineIndex(syncedLines, playingTime);
                              return (
                                <div className="px-3 sm:px-4 pb-3 sm:pb-4 space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400/80">
                                      {isThisTrackPlaying && syncedLines.length > 0 ? "Letra (acompanhando)" : "Letra"}
                                    </span>
                                    {faixa.id && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveSubmenu("musicas");
                                          setPendingDeepLinkId(faixa.id);
                                        }}
                                        className="flex items-center gap-1 text-[10px] font-bold text-neutral-400 hover:text-emerald-400 transition"
                                      >
                                        Ver tópico <ExternalLink className="size-3" />
                                      </button>
                                    )}
                                  </div>
                                  {isThisTrackPlaying && syncedLines.length > 0 ? (
                                    <div className="max-h-60 overflow-y-auto bg-neutral-950/60 p-3 rounded-xl border border-emerald-500/20 space-y-1.5">
                                      <KaraokeLines
                                        lines={syncedLines}
                                        activeIndex={activeIdx}
                                        lineClassName={(li) =>
                                          li === activeIdx
                                            ? "text-emerald-400 font-black text-xs transition-colors"
                                            : li < activeIdx
                                              ? "text-neutral-600 text-[11px] transition-colors"
                                              : "text-neutral-400 text-[11px] transition-colors"
                                        }
                                      />
                                    </div>
                                  ) : (
                                    <div className="text-xs text-neutral-300 font-mono leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto bg-neutral-950/60 p-3 rounded-xl border border-white/5">
                                      {letra || "Letra oficial em processamento no acervo do Empire Hub."}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-xs text-neutral-500 italic">
                        Nenhuma faixa vinculada a este álbum ainda.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* CASO ÁLBUM: ENCARTE */}
              {activeSubmenu === "albuns" &&
                selectedTopic.encarte &&
                selectedTopic.encarte.length > 0 && (
                  <div className="bg-neutral-800/40 border border-white/10 rounded-2xl p-4 sm:p-5 space-y-3">
                    <h3 className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                      <FileText className="size-4" />
                      Encarte
                    </h3>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {selectedTopic.encarte.map((url, i) => (
                        <a
                          key={i}
                          href={driveImg(url, 1200) || url}
                          target="_blank"
                          rel="noreferrer"
                          className="aspect-square rounded-lg overflow-hidden bg-neutral-900 border border-white/5"
                        >
                          <img
                            src={driveImg(url, 300) || undefined}
                            alt={`Encarte ${i + 1}`}
                            className="w-full h-full object-cover hover:scale-105 transition"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

              {/* CASO MÚSICA: EXIBIR LETRA COMPLETA (ou karaoke, se essa é a
                  faixa tocando agora e o dono do artista sincronizou) */}
              {activeSubmenu === "musicas" && (() => {
                const isThisTrackPlaying =
                  !!playingTrack &&
                  (playingTrack.id === selectedTopic.id ||
                    playingTrack.telegramTopicId === selectedTopic.telegramTopicId);
                const syncedLines = isThisTrackPlaying
                  ? parseLrc(playingTrack.letraSincronizada || selectedTopic.letraSincronizada)
                  : [];

                if (isThisTrackPlaying && syncedLines.length > 0) {
                  const activeIdx = findCurrentLrcLineIndex(syncedLines, playingTime);
                  return (
                    <div className="bg-neutral-800/40 border border-emerald-500/20 rounded-2xl p-4 sm:p-5 space-y-2">
                      <h3 className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                        <FileText className="size-4" />
                        Letra Sincronizada
                      </h3>
                      <div className="max-h-60 sm:max-h-72 overflow-y-auto bg-neutral-950/60 p-3 sm:p-4 rounded-xl border border-white/5 space-y-2">
                        <KaraokeLines
                          lines={syncedLines}
                          activeIndex={activeIdx}
                          lineClassName={(i) =>
                            i === activeIdx
                              ? "text-emerald-400 font-black text-sm transition-colors"
                              : i < activeIdx
                                ? "text-neutral-600 text-xs transition-colors"
                                : "text-neutral-400 text-xs transition-colors"
                          }
                        />
                      </div>
                    </div>
                  );
                }

                return (
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
                );
              })()}
                </>
              )}
            </div>
          </div>

          {/* MODO VISUAL ATIVO — ocupa toda a largura abaixo da capa/título
              (que ficaram compactos acima), dando o máximo de espaço pra
              pessoa montar o layout dela (inclusive espaçamento em HTML). */}
          {visualAberto && extraMaterial && (
            <VisualBlocosView arte={extraMaterial.arte} />
          )}

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
                onClick={() => setIsCommentModalOpen((v) => !v)}
                className="w-full sm:w-auto px-4 sm:px-5 py-2 sm:py-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2"
              >
                <Sparkles className="size-4" />
                {isCommentModalOpen ? "Fechar" : "Avaliar & Comentar"}
              </button>
            </div>

            {/* Formulário encaixado na própria página (não é mais um popup
                que cobre o tópico) — dá pra continuar lendo o resto enquanto
                escreve o comentário. */}
            {isCommentModalOpen && (
              <CommentModal
                isOpen={isCommentModalOpen}
                onClose={() => setIsCommentModalOpen(false)}
                tipoMedia={getMediaTypeForModal()}
                tituloMedia={selectedTopic.title}
                topicId={resolvedTopicId || selectedTopic.id}
                onCommentSubmitted={() => {
                  if (selectedTopic) {
                    fetchTopicComments(selectedTopic);
                    const topicKey = resolvedTopicId || selectedTopic.telegramTopicId || selectedTopic.id;
                    if (topicKey) {
                      setCommentedTopicIds((prev) => new Set(prev).add(topicKey));
                    }
                  }
                }}
                variant="inline"
              />
            )}

            {/* LISTA DE COMENTÁRIOS — feed estilo tópico do Telegram: avatar +
                nome colorido por usuário, bolha de mensagem com "rabinho",
                hora dentro da bolha, reações como pills logo abaixo. */}
            {loadingComments ? (
              <div className="p-6 text-center text-xs text-neutral-400 bg-neutral-800/30 rounded-2xl border border-white/5">
                Carregando comentários...
              </div>
            ) : topicComments.length === 0 ? (
              <div className="p-6 text-center text-xs text-neutral-500 bg-neutral-800/30 rounded-2xl border border-white/5">
                Nenhum comentário registrado ainda. Seja o primeiro a avaliar!
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:gap-4">
                {topicComments.map((c) => {
                  const color = nameColorFor(c.jogador || c.id);
                  return (
                    <div key={c.id} className="flex items-start gap-2 sm:gap-2.5">
                      <div
                        className="size-8 sm:size-9 rounded-full grid place-items-center flex-shrink-0 text-[11px] sm:text-xs font-black text-white mt-0.5"
                        style={{ backgroundColor: color }}
                      >
                        {initialsFor(c.jogador)}
                      </div>

                      <div className="min-w-0 flex-1">
                        {editingCommentId === c.id ? (
                          <div className="rounded-2xl rounded-tl-sm bg-neutral-800/70 border border-emerald-500/30 px-3 py-2 sm:px-4 sm:py-2.5">
                            <RichTextToolbar
                              textareaRef={editTextareaRef}
                              value={editText}
                              onChange={setEditText}
                            />
                            <textarea
                              ref={editTextareaRef}
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              rows={2}
                              autoFocus
                              className="w-full bg-transparent text-xs sm:text-sm text-neutral-100 outline-none resize-none placeholder-neutral-500"
                            />
                            <div className="flex justify-end gap-1.5 mt-1.5">
                              <button
                                onClick={cancelEditComment}
                                disabled={savingEdit}
                                className="p-1.5 rounded-full bg-white/5 text-neutral-400 hover:bg-white/10"
                              >
                                <X className="size-3.5" />
                              </button>
                              <button
                                onClick={() => saveEditComment(c)}
                                disabled={savingEdit || !editText.trim()}
                                className="p-1.5 rounded-full bg-emerald-500 text-black disabled:opacity-50"
                              >
                                <Check className="size-3.5" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-2xl rounded-tl-sm bg-neutral-800/70 border border-white/5 px-3 py-2 sm:px-4 sm:py-2.5 inline-block max-w-full">
                            <div className="flex items-baseline gap-2 mb-0.5">
                              <span
                                className="text-[12px] sm:text-[13px] font-bold truncate"
                                style={{ color }}
                              >
                                {c.jogador}
                              </span>
                              {c.nota && (
                                <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 font-bold text-[9px] sm:text-[10px] rounded border border-emerald-500/20 flex-shrink-0">
                                  {activeSubmenu === "videos" ? `${c.nota} likes` : `nota ${c.nota}`}
                                </span>
                              )}
                            </div>
                            <p className="text-xs sm:text-sm text-neutral-100 leading-relaxed whitespace-pre-wrap break-words">
                              {renderRichText(c.comentario)}
                            </p>
                            <span className="block text-right text-[10px] text-neutral-500 mt-1 select-none">
                              {c.data}
                            </span>
                          </div>
                        )}

                        {editingCommentId !== c.id && (c.rowIndex != null || (c.jogadorId && c.jogadorId === myId)) && (
                          <div className="mt-1 pl-1 flex items-center gap-2">
                            {c.rowIndex != null && (
                              <ReactionBar
                                reactions={c.reactions}
                                reactedBy={c.reactedBy}
                                myId={myId}
                                disabled={!myId}
                                onToggle={(emoji) => handleToggleReaction(c, emoji)}
                              />
                            )}
                            {c.rowIndex != null && c.jogadorId && c.jogadorId === myId && (
                              <button
                                onClick={() => startEditComment(c)}
                                className="text-[10px] text-neutral-500 hover:text-neutral-300 inline-flex items-center gap-1"
                              >
                                <Pencil className="size-3" /> Editar
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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
                      <TopicThumbImg
                        src={driveImg(item.cover, 400)}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
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

                      {item.telegramTopicId && commentedTopicIds.has(item.telegramTopicId) && (
                        <div
                          className="absolute top-2 left-2 sm:top-3 sm:left-3 pointer-events-none size-5 sm:size-6 rounded-full bg-emerald-500 border border-emerald-300/50 shadow-lg grid place-items-center"
                          title="Você comentou este tópico"
                        >
                          <Check className="size-3 sm:size-3.5 text-black" strokeWidth={3} aria-hidden="true" />
                        </div>
                      )}
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

      {/* CAPA DO ÁLBUM EM TELA CHEIA */}
      {coverExpanded && selectedTopic && (
        <div
          onClick={() => setCoverExpanded(false)}
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
        >
          <button
            type="button"
            onClick={() => setCoverExpanded(false)}
            className="absolute top-4 right-4 sm:top-6 sm:right-6 size-10 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center transition"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
          <img
            src={driveRawImg(selectedTopic.cover) || driveImg(selectedTopic.cover, 1600) || "/placeholder.png"}
            alt={selectedTopic.title}
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-full rounded-2xl shadow-2xl object-contain"
          />
        </div>
      )}

    </div>
  );
};
