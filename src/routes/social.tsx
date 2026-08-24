import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Instagram,
  Twitter,
  Video,
  Plus,
  Heart,
  MessageCircle,
  Share2,
  X,
  Image as ImageIcon,
  Send,
  MoreVertical,
  Newspaper,
  UserCircle,
  ChevronRight,
  ChevronLeft,
  Grid3x3,
  BadgeCheck,
  Play,
  Music2,
  Repeat2,
  Film,
  Tag,
  Rss,
  Users,
  Settings2,
  Loader2,
  Edit,
  Trash2,
  EyeOff,
  Eye,
  Shuffle,
} from "lucide-react";
import { api, resolveImg, isDirectImageUrl, driveVideo } from "@/lib/api";
import { useTelegramUser, haptic } from "@/lib/telegram";

// Alternativa ao upload: colar direto o link de uma imagem já hospedada em
// outro lugar (.png/.jpg/.jpeg/.webp). Só aplica se o link for válido —
// links do Drive continuam exigindo upload (precisam passar pelo proxy
// autenticado, ver resolveImg em @/lib/api).
function PasteImageLinkInput({
  onApply,
  className,
}: {
  onApply: (url: string) => void;
  className?: string;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  function commit() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(false);
      return;
    }
    if (isDirectImageUrl(trimmed)) {
      onApply(trimmed);
      setError(false);
    } else {
      setError(true);
    }
  }

  return (
    <div className="space-y-1">
      <input
        type="url"
        inputMode="url"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        placeholder="ou cole o link da imagem (.png/.jpg)"
        className={className}
      />
      {error && (
        <p className="text-[10px] font-bold text-red-400">
          O link precisa terminar em .png, .jpg ou .jpeg (e não pode ser um link do Drive).
        </p>
      )}
    </div>
  );
}

// Renderiza a mídia de um post — imagem (comportamento de sempre) ou vídeo
// (com controles nativos, tocando via /api/media/video — mesmo proxy
// autenticado com suporte a Range request pra dar seek). `resolveUrl` é a
// função `driveImg`/`resolveImg` já em uso no componente chamador, pra não
// duplicar a lógica de resolução de link.
function PostMedia({
  url,
  tipo,
  className,
  resolveUrl,
}: {
  url?: string;
  tipo?: string;
  className?: string;
  resolveUrl: (u?: string) => string | undefined;
}) {
  if (!url) return null;
  if (tipo === "video") {
    return (
      <video
        src={driveVideo(url)}
        controls
        playsInline
        preload="metadata"
        className={className}
      />
    );
  }
  return (
    <img
      loading="lazy"
      decoding="async"
      src={resolveUrl(url)}
      className={className}
      referrerPolicy="no-referrer"
    />
  );
}

function formatCount(n: number | undefined): string {
  const v = Number(n || 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(v >= 10_000 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(v);
}

export const Route = createFileRoute("/social")({
  validateSearch: (s: Record<string, unknown>): { postId?: string; artist?: string } => ({
    postId: s.postId ? String(s.postId) : undefined,
    artist: s.artist ? String(s.artist) : undefined,
  }),
  component: SocialPage,
});

type Post = {
  id: string;
  tipo: "Instagram" | "Twitter" | "TikTok";
  subtipo?: string;
  autor: string;
  handle: string;
  avatar?: string;
  texto: string;
  media_url?: string;
  media_tipo?: "imagem" | "video" | string;
  analytics: { likes: number; comments: number; shares: number };
  data: string;
  telegram_id?: string;
};

type SocialProfile = {
  artista: string;
  rede: string;
  handle: string;
  bio: string;
  avatar_url?: string;
  avatar?: string;
  foto?: string;
  seguidores?: number;
  seguindo?: number;
};

type News = {
  id: string;
  titulo: string;
  conteudo: string;
  imagem: string;
  autor: string;
  data: string;
};

function SocialPage() {
  const { postId, artist: artistParam } = Route.useSearch();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<"Instagram" | "Twitter" | "TikTok" | null>(null);
  const [igMode, setIgMode] = useState<"Feed" | "Story">("Feed");
  const [postText, setPostText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [mediaTipo, setMediaTipo] = useState<"imagem" | "video">("imagem");
  const [editingPost, setEditingPost] = useState<any | null>(null);
  // Blackout Mode — posta com um nome fictício em vez do nome real do
  // artista, pra criar suspense antes de um anúncio (ex: lançamento de era).
  // O post continua vinculado ao telegram_id de verdade (dono não muda),
  // só o nome exibido; por isso o dono sempre pode editar/reverter depois.
  const [blackoutMode, setBlackoutMode] = useState(false);
  const [blackoutUsername, setBlackoutUsername] = useState("");
  const [myArtists, setMyArtists] = useState<any[]>([]);
  const [selectedArtist, setSelectedArtist] = useState("");
  const [viewMode, setViewMode] = useState<"Feed" | "Settings" | "News" | "Industry">("Feed");
  const [profiles, setProfiles] = useState<SocialProfile[]>([]);
  const [allArtists, setAllArtists] = useState<any[]>([]);
  const [selectedIndustryArtist, setSelectedIndustryArtist] = useState<any | null>(null);
  const [industryViewTab, setIndustryViewTab] = useState<"Instagram" | "Twitter" | "TikTok" | null>(null);
  const [news, setNews] = useState<News[]>([]);
  const [isNewsModalOpen, setIsNewsModalOpen] = useState(false);

  // News form
  const [newsTitle, setNewsTitle] = useState("");
  const [newsContent, setNewsContent] = useState("");
  const [newsImage, setNewsImage] = useState("");
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [editingProfileInfo, setEditingProfileInfo] = useState<{ artista: string; rede: string } | null>(null);
  const [profileHandle, setProfileHandle] = useState("");
  const [profileAvatar, setProfileAvatar] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [activeArtist, setActiveArtist] = useState<any | null>(null);
  const [isCommentModalOpen, setIsCommentModalOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [editingCommentRow, setEditingCommentRow] = useState<number | null>(null);
  const [editCommentText, setEditCommentText] = useState("");
  const [savingCommentEdit, setSavingCommentEdit] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [profileFollowers, setProfileFollowers] = useState("0");
  const [profileFollowing, setProfileFollowing] = useState("0");
  const [selectedNews, setSelectedNews] = useState<News | null>(null);
  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set());
  const [likedPulse, setLikedPulse] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingNews, setUploadingNews] = useState(false);
  const { user, ready } = useTelegramUser();

  type SocialFolderType = "socialPosts" | "socialStories" | "socialAvatars" | "socialNews";

  async function uploadToDrive(file: File, folderType: SocialFolderType): Promise<string | null> {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fileName", file.name);
      formData.append("folderType", folderType);
      const res = await fetch("/api/gestao/upload", { method: "POST", body: formData });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data?.data?.fileUrl) return data.data.fileUrl as string;
      console.error("Erro no upload:", data?.error || res.status);
    } catch (err) {
      console.error("Erro no upload:", err);
    }
    alert("Não deu pra enviar a imagem. Tente de novo ou cole o link direto.");
    return null;
  }

  useEffect(() => {
    loadPosts();
    loadNews();
  }, []);

  useEffect(() => {
    if (ready) loadContext();
  }, [ready, user]);

  useEffect(() => {
    if (!postId || loading) return;
    const found = posts.find((p) => p.id === postId);
    if (found) {
      setSelectedPost(found);
      loadComments(found.id);
      setIsCommentModalOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, loading]);

  // Deep-link "/social?artist=Nome" (usado pelo mega perfil do artista) —
  // já abre direto na aba Perfis (Industry), no artista certo.
  useEffect(() => {
    if (!artistParam || allArtists.length === 0) return;
    const norm = artistParam.trim().toLowerCase();
    const found = allArtists.find((a) => (a.nome || "").trim().toLowerCase() === norm);
    if (found) {
      setViewMode("Industry");
      setSelectedIndustryArtist(found);
      setIndustryViewTab(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistParam, allArtists]);

  async function loadContext() {
    const tgId = user?.id || "";
    const arts = await api.meusArtistas(tgId);
    setMyArtists(arts);

    const allArts = await api.listarTodos();
    setAllArtists(allArts);

    if (arts.length > 0 && !activeArtist) {
      setActiveArtist(arts[0]);
      setSelectedArtist(arts[0].nome);
    }

    const profs = await (api as any).listarPerfisSocial();
    setProfiles(profs);
  }

  async function loadPosts() {
    setLoading(true);
    try {
      const data = await (api as any).listarPostsSocial();
      if (Array.isArray(data)) setPosts(data);
    } catch (err) {
      console.error("Erro ao carregar posts:", err);
    } finally {
      setLoading(false);
    }
  }

  async function loadNews() {
    try {
      const data = await (api as any).listarNewsSocial();
      if (Array.isArray(data)) setNews(data);
    } catch (err) {
      console.error("Erro ao carregar news:", err);
    }
  }

  async function loadComments(postId: string) {
    const data = await (api as any).listarComentariosSocial(postId);
    setComments(data);
  }

  function startEditComment(c: any) {
    haptic.selection();
    setEditingCommentRow(c.rowIndex);
    setEditCommentText(c.texto);
  }

  function cancelEditComment() {
    setEditingCommentRow(null);
    setEditCommentText("");
  }

  async function saveEditComment() {
    if (!editingCommentRow || !editCommentText.trim() || !selectedPost) return;
    setSavingCommentEdit(true);
    const tgId = user?.id || "";
    const res = await (api as any).editarComentarioSocial(editingCommentRow, editCommentText.trim(), tgId);
    setSavingCommentEdit(false);
    if (res?.ok) {
      haptic.success();
      setEditingCommentRow(null);
      setEditCommentText("");
      loadComments(selectedPost.id);
    }
  }

  async function handleLike(postId: string) {
    haptic.light();
    setLikedPulse(postId);
    window.setTimeout(() => setLikedPulse((cur) => (cur === postId ? null : cur)), 350);
    const tgId = user?.id || "";
    const res = await (api as any).curtirPostSocial(postId, tgId);
    if (res.ok) {
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, analytics: { ...p.analytics, likes: res.likes } } : p)),
      );
    }
  }

  async function handleAddComment() {
    if (!selectedPost || !newComment.trim() || !activeArtist || submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        postId: selectedPost.id,
        autor: activeArtist.nome,
        texto: newComment,
      };
      const tgId = user?.id || "";
      const res = await (api as any).comentarPostSocial(payload, tgId);
      if (res.ok) {
        haptic.success();
        setNewComment("");
        loadComments(selectedPost.id);
        setPosts((prev) =>
          prev.map((p) =>
            p.id === selectedPost.id ? { ...p, analytics: { ...p.analytics, comments: p.analytics.comments + 1 } } : p,
          ),
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveProfile() {
    if (!editingProfileInfo || submitting) return;
    setSubmitting(true);
    try {
      const safeSeguindo = parseInt(String(profileFollowing).replace(/\D/g, ""), 10) || 0;

      const p: any = {
        artista: editingProfileInfo.artista,
        rede: editingProfileInfo.rede,
        handle: profileHandle || "@",
        avatar_url: profileAvatar || "",
        avatar: profileAvatar || "",
        foto: profileAvatar || "",
        bio: profileBio || "",
        seguindo: safeSeguindo,
      };

      const tgId = user?.id || "";
      const res = await (api as any).salvarPerfilSocial(p, tgId);
      if (res.ok) {
        haptic.success();
        setIsProfileModalOpen(false);
        loadContext();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  function openEditPost(post: any) {
    haptic.selection();
    setEditingPost(post);
    setSelectedType(post.tipo);
    setIgMode(post.subtipo === "Story" ? "Story" : "Feed");
    setPostText(post.texto);
    setImageUrl(post.media_url || "");
    setMediaTipo(post.media_tipo === "video" ? "video" : "imagem");
    // Se o nome no post não bate com nenhum dos seus artistas, ele foi
    // publicado em Blackout Mode — reabre já no modo certo, com o nome
    // fictício pronto pra editar (ou voltar ao normal).
    const eraBlackout = !!post.autor && !myArtists.some((a) => a.nome === post.autor);
    setBlackoutMode(eraBlackout);
    setBlackoutUsername(eraBlackout ? post.autor : "");
    setIsModalOpen(true);
  }

  async function handleDeletePost(post: any) {
    haptic.selection();
    if (!confirm("Excluir este post? Não dá pra desfazer.")) return;
    const res = await api.deletarPostSocial(post.id, user?.id || "");
    if (res.ok) {
      haptic.success();
      loadPosts();
    } else {
      alert((res as any).error || res.erro || "Não deu pra excluir o post.");
    }
  }

  function closePostModal() {
    setIsModalOpen(false);
    setSelectedType(null);
    setPostText("");
    setImageUrl("");
    setMediaTipo("imagem");
    setEditingPost(null);
    setBlackoutMode(false);
    setBlackoutUsername("");
  }

  function gerarNomeBlackout() {
    const adjetivos = ["fã", "insider", "leak", "anônimo", "ghost", "fonte"];
    const adjetivo = adjetivos[Math.floor(Math.random() * adjetivos.length)];
    const numero = Math.floor(1000 + Math.random() * 9000);
    setBlackoutUsername(`${adjetivo}_${numero}`);
  }

  async function handlePost() {
    if (!selectedType || !postText.trim() || !activeArtist || submitting) return;
    if (blackoutMode && !blackoutUsername.trim()) return;

    setSubmitting(true);
    const tgId = user?.id || "";
    const autorFinal = blackoutMode ? blackoutUsername.trim() : activeArtist.nome;

    try {
      if (editingPost) {
        const res = await (api as any).editarPostSocial(
          editingPost.id,
          postText,
          imageUrl,
          tgId,
          autorFinal,
          mediaTipo,
        );
        if (res.ok) {
          haptic.success();
          closePostModal();
          loadPosts();
        }
        return;
      }

      const payload = {
        tipo: selectedType,
        subtipo: selectedType === "Instagram" ? igMode : undefined,
        autor: autorFinal,
        texto: postText,
        media_url: imageUrl,
        media_tipo: mediaTipo,
        analytics: { likes: 0, comments: 0, shares: 0 },
      };

      const res = await (api as any).salvarPostSocial(payload, tgId);
      if (res.ok) {
        haptic.success();
        closePostModal();
        loadPosts();
      }
    } catch (err) {
      console.error("Erro ao postar:", err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveNews() {
    if (!newsTitle.trim() || !newsContent.trim() || !activeArtist || submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        titulo: newsTitle,
        conteudo: newsContent,
        imagem: newsImage,
        autor: activeArtist.nome,
      };
      const tgId = user?.id || "";
      const res = await (api as any).salvarNewsSocial(payload, tgId);
      if (res.ok) {
        haptic.success();
        setIsNewsModalOpen(false);
        setNewsTitle("");
        setNewsContent("");
        setNewsImage("");
        loadNews();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  // Resolve link do Drive (via proxy autenticado, não depende de permissão
  // pública) ou link direto de imagem colado pelo usuário — ver resolveImg
  // em @/lib/api.
  const driveImg = resolveImg;

  const networkAccent = (tipo: string) => {
    if (tipo === "Twitter") return { icon: Twitter, color: "text-[#1d9bf0]", ring: "border-[#1d9bf0]/30" };
    if (tipo === "TikTok") return { icon: Video, color: "text-[#25F4EE]", ring: "border-[#25F4EE]/30" };
    return { icon: Instagram, color: "text-[#f472b6]", ring: "border-[#f472b6]/30" };
  };

  const card = "rounded-[1.75rem] bg-white/5 border border-white/10 transition-all";
  // text-base (16px) — abaixo disso o Safari/iOS dá zoom automático ao
  // focar o campo, e é esse zoom que "estica"/desalinha a tela até o
  // usuário beliscar pra voltar. Nunca usar texto menor que 16px em
  // input/textarea que o usuário vai tocar pra digitar.
  const inputCls =
    "w-full bg-white/5 border border-white/10 rounded-2xl p-3.5 text-base font-medium focus:outline-none focus:border-primary/50 transition-colors placeholder:text-muted-foreground/60";

  return (
    <div className="flex-1 bg-background min-h-dvh pb-32">
      {/* Header */}
      <div className="pt-6 px-4 sticky top-0 bg-background/90 backdrop-blur-md z-[60] border-b border-white/5">
        <div className="flex flex-col gap-4 mb-4 max-w-md mx-auto">
          <h1 className="text-2xl font-black uppercase tracking-tight flex items-center gap-2">
            Empire <span className="text-primary">Social</span>
          </h1>

          <div className="grid grid-cols-4 gap-1 bg-white/5 border border-white/10 rounded-2xl p-1 w-full">
            {(
              [
                { id: "Feed", label: "Feed", icon: Rss },
                { id: "Industry", label: "Perfis", icon: Users },
                { id: "News", label: "News", icon: Newspaper },
                { id: "Settings", label: "Config", icon: Settings2 },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = viewMode === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    haptic.selection();
                    setViewMode(tab.id);
                    if (tab.id === "Industry") setSelectedIndustryArtist(null);
                  }}
                  className={`relative py-2.5 min-h-11 font-black text-[10px] uppercase rounded-xl transition-all flex flex-col items-center justify-center gap-1 active:scale-95 ${
                    active
                      ? "text-primary-foreground shadow-[0_4px_18px_-4px_var(--primary)]"
                      : "text-muted-foreground border border-white/10 bg-white/[0.03] backdrop-blur-md hover:bg-white/[0.06] hover:text-foreground"
                  }`}
                >
                  {active && <span className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary via-primary to-fuchsia-500/80" aria-hidden="true" />}
                  <Icon className="relative z-10 size-3.5" />
                  <span className="relative z-10 truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {myArtists.length > 0 && (
          <div className="mb-4 max-w-md mx-auto">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2 px-1">
              Interagir como
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide px-1 items-center">
              {myArtists.map((art) => {
                const isActive = activeArtist?.nome === art.nome;
                const imgUrl = driveImg(art.foto);
                return (
                  <button
                    key={art.nome}
                    onClick={() => {
                      haptic.selection();
                      setActiveArtist(art);
                      setSelectedArtist(art.nome);
                    }}
                    title={art.nome}
                    className={`flex items-center gap-1.5 shrink-0 rounded-full border transition-all active:scale-95 ${
                      isActive
                        ? "border-primary bg-primary/10 pl-1 pr-3 py-1"
                        : "border-white/10 opacity-70 hover:opacity-100 p-1"
                    }`}
                  >
                    <div className="size-8 rounded-full overflow-hidden bg-secondary shrink-0">
                      {imgUrl ? (
                        <img
                          loading="lazy"
                          decoding="async"
                          src={imgUrl}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                          crossOrigin="anonymous"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.onerror = null;
                            target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(art.nome)}&background=111&color=fff&size=128&bold=true`;
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center font-black text-xs bg-primary/20 text-primary">
                          {art.nome[0]}
                        </div>
                      )}
                    </div>
                    {isActive && (
                      <span className="text-[11px] font-black uppercase tracking-tight text-primary max-w-[6rem] truncate">
                        {art.nome.split(" ")[0]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="px-4 max-w-md mx-auto mt-4">
        {viewMode === "Feed" ? (
          <>
            {loading ? (
              <div className="flex flex-col items-center justify-center p-20 gap-4">
                <Loader2 className="size-8 text-primary animate-spin" />
                <p className="font-black uppercase text-xs tracking-widest text-muted-foreground">Carregando feed...</p>
              </div>
            ) : posts.length === 0 ? (
              <div className="w-full p-8 rounded-[1.75rem] bg-card/50 border-2 border-dashed border-primary/20 flex flex-col items-center text-center min-h-40 gap-2 mt-6">
                <Rss className="size-8 text-primary/60" />
                <p className="text-sm font-black uppercase tracking-tight">Nenhum post ainda</p>
                <p className="text-[11px] font-medium text-muted-foreground leading-snug max-w-[16rem]">
                  Toque no botão + para lançar o primeiro hype de um dos seus artistas.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 pb-4">
                {posts.map((post) => {
                  const isMine = activeArtist && post.autor === activeArtist.nome;
                  const { icon: NetIcon, color: netColor } = networkAccent(post.tipo);
                  return (
                    <motion.div
                      key={post.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`${card} p-4 sm:p-5 ${isMine ? "border-primary/30 bg-primary/[0.04]" : ""}`}
                    >
                      <div
                        className="cursor-pointer"
                        onClick={() => {
                          setSelectedPost(post);
                          loadComments(post.id);
                          setIsCommentModalOpen(true);
                        }}
                      >
                        <div className="flex items-center justify-between mb-3.5 gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="size-10 rounded-full overflow-hidden flex-shrink-0 bg-secondary border border-white/10 flex items-center justify-center font-black">
                              {post.avatar ? (
                                <img
                                  loading="lazy"
                                  decoding="async"
                                  src={driveImg(post.avatar)}
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                  crossOrigin="anonymous"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.style.display = "none";
                                    if (target.parentElement) {
                                      target.parentElement.innerHTML = `<div class="w-full h-full flex items-center justify-center text-[10px] font-black uppercase">${post.autor[0]}</div>`;
                                    }
                                  }}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[10px] font-black uppercase">
                                  {post.autor[0]}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-black text-sm leading-none truncate">{post.autor}</p>
                              <p className="text-[10px] text-muted-foreground font-bold mt-1 truncate">{post.handle}</p>
                            </div>
                            {isMine && (
                              <span className="text-[9px] font-black uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded-md shrink-0">
                                Você
                              </span>
                            )}
                          </div>
                          <NetIcon className={`size-4.5 shrink-0 ${netColor}`} />
                        </div>

                        {post.tipo === "Instagram" && post.subtipo === "Story" ? (
                          <div className="relative aspect-[9/16] max-h-[26rem] bg-secondary rounded-[1.25rem] overflow-hidden mb-3.5 border border-white/10">
                            {post.media_url ? (
                              <PostMedia
                                url={post.media_url}
                                tipo={post.media_tipo}
                                resolveUrl={driveImg}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-muted-foreground font-black uppercase text-xs">
                                Story
                              </div>
                            )}
                            <div className="absolute top-3 left-3 flex gap-2">
                              <span className="px-2.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-black uppercase">
                                Story
                              </span>
                            </div>
                          </div>
                        ) : (
                          post.media_url && (
                            <div className="aspect-square bg-secondary rounded-[1.25rem] overflow-hidden mb-3.5 border border-white/10">
                              <PostMedia
                                url={post.media_url}
                                tipo={post.media_tipo}
                                resolveUrl={driveImg}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )
                        )}

                        <p className="font-medium text-sm leading-snug mb-3.5 text-pretty">{post.texto}</p>
                      </div>

                      <div className="flex items-center gap-5 pt-3 border-t border-white/5">
                        <button
                          onClick={() => handleLike(post.id)}
                          className="flex items-center gap-1.5 font-black text-xs min-h-9 active:scale-90 transition-transform"
                        >
                          <motion.span
                            animate={likedPulse === post.id ? { scale: [1, 1.4, 1] } : { scale: 1 }}
                            transition={{ duration: 0.35 }}
                          >
                            <Heart
                              className={`size-4 ${post.analytics.likes > 0 ? "fill-primary text-primary" : "text-muted-foreground"}`}
                            />
                          </motion.span>
                          <span className={post.analytics.likes > 0 ? "text-primary" : "text-muted-foreground"}>
                            {post.analytics.likes}
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            setSelectedPost(post);
                            loadComments(post.id);
                            setIsCommentModalOpen(true);
                          }}
                          className="flex items-center gap-1.5 font-black text-xs text-muted-foreground min-h-9 active:scale-90 transition-transform"
                        >
                          <MessageCircle className="size-4" /> {post.analytics.comments}
                        </button>
                        <button className="flex items-center gap-1.5 font-black text-xs text-muted-foreground min-h-9 active:scale-90 transition-transform">
                          <Share2 className="size-4" />
                        </button>
                        {post.telegram_id && String(post.telegram_id) === String(user?.id || "") && (
                          <div className="flex items-center gap-3 ml-auto">
                            {!myArtists.some((a) => a.nome === post.autor) && (
                              <span className="flex items-center gap-1 text-[9px] font-black uppercase text-muted-foreground">
                                <EyeOff className="size-3" /> Blackout
                              </span>
                            )}
                            <button
                              onClick={() => openEditPost(post)}
                              className="flex items-center gap-1.5 font-black text-xs text-muted-foreground min-h-9 active:scale-90 transition-transform"
                            >
                              <Edit className="size-4" /> Editar
                            </button>
                            {Date.now() - new Date(post.data).getTime() <= 24 * 60 * 60 * 1000 && (
                              <button
                                onClick={() => handleDeletePost(post)}
                                className="flex items-center gap-1.5 font-black text-xs text-muted-foreground min-h-9 active:scale-90 transition-transform hover:text-destructive"
                              >
                                <Trash2 className="size-4" /> Excluir
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </>
        ) : viewMode === "News" ? (
          <div className="grid gap-6 pb-20">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xl font-black uppercase tracking-tight">
                Empire <span className="text-primary">News</span>
              </h2>
              <button
                onClick={() => {
                  haptic.light();
                  setIsNewsModalOpen(true);
                }}
                className="size-10 shrink-0 rounded-full bg-primary text-primary-foreground grid place-items-center active:scale-90 transition-transform"
              >
                <Plus className="size-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-5">
              {news.map((item) => (
                <motion.div
                  key={item.id}
                  layoutId={item.id}
                  onClick={() => setSelectedNews(item)}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`${card} overflow-hidden cursor-pointer group active:scale-[0.98] flex flex-col`}
                >
                  <div className="aspect-[16/9] bg-secondary relative overflow-hidden">
                    {item.imagem ? (
                      <img
                        src={driveImg(item.imagem)}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Newspaper className="size-12 text-muted-foreground/20" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-transparent" />
                    <div className="absolute top-3 left-3">
                      <span className="bg-primary text-primary-foreground text-[10px] font-black uppercase px-2.5 py-1 rounded-full shadow-lg">
                        Exclusivo
                      </span>
                    </div>
                  </div>
                  <div className="p-4 sm:p-5">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase text-muted-foreground mb-2 tracking-widest">
                      <span className="text-primary">{item.autor}</span>
                      <span className="size-1 rounded-full bg-white/20" />
                      <span>{new Date(item.data).toLocaleDateString("pt-BR")}</span>
                    </div>
                    <h3 className="text-lg font-black uppercase leading-tight mb-2 line-clamp-2 group-hover:text-primary transition-colors">
                      {item.titulo}
                    </h3>
                    <p className="text-[13px] font-medium text-muted-foreground leading-snug line-clamp-3 mb-3">
                      {item.conteudo}
                    </p>
                    <div className="flex justify-between items-center pt-3 border-t border-white/5">
                      <span className="text-[10px] font-bold uppercase text-muted-foreground/60">Leitura 2 min</span>
                      <span className="text-xs font-black uppercase text-primary flex items-center gap-1 group-hover:gap-1.5 transition-all">
                        Ler matéria <ChevronRight className="size-3.5" />
                      </span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {news.length === 0 && (
              <div className="py-16 text-center flex flex-col items-center gap-3">
                <Newspaper className="size-10 text-muted-foreground/20" />
                <p className="font-black uppercase text-xs text-muted-foreground">Sem manchetes no momento</p>
              </div>
            )}
          </div>
        ) : viewMode === "Industry" ? (
          <div className="grid gap-6 pb-20">
            {!selectedIndustryArtist ? (
              <>
                <h2 className="text-xl font-black uppercase tracking-tight text-center">
                  <span className="text-primary">Perfis</span>
                </h2>
                <div className="grid gap-3">
                  {allArtists.map((art) => (
                    <motion.button
                      key={art.nome}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        haptic.selection();
                        setSelectedIndustryArtist(art);
                        setIndustryViewTab(null);
                      }}
                      className={`${card} flex items-center gap-4 p-4 group active:scale-[0.98]`}
                    >
                      <div className="size-12 rounded-full overflow-hidden flex-shrink-0 bg-secondary border border-white/10 flex items-center justify-center">
                        <UserCircle className="size-7 text-muted-foreground/40" />
                      </div>
                      <div className="flex flex-col items-start text-left min-w-0">
                        <span className="font-black text-sm uppercase truncate">{art.nome}</span>
                        <span className="text-[10px] font-bold uppercase text-muted-foreground truncate">
                          {art.gravadora || "Independent"}
                        </span>
                      </div>
                      <ChevronRight className="ml-auto size-5 text-primary opacity-0 group-hover:opacity-100 transition-all shrink-0" />
                    </motion.button>
                  ))}
                </div>
              </>
            ) : !industryViewTab ? (
              <div className="space-y-6">
                <div className="flex flex-col items-center text-center gap-2">
                  <button
                    onClick={() => setSelectedIndustryArtist(null)}
                    className="self-start text-[10px] font-black uppercase text-primary mb-2 flex items-center gap-1 min-h-9"
                  >
                    <ChevronLeft className="size-3.5" /> Voltar para Artistas
                  </button>
                  <h2 className="text-2xl font-black uppercase tracking-tight">{selectedIndustryArtist.nome}</h2>
                  <p className="text-xs font-medium text-muted-foreground px-4">{selectedIndustryArtist.descricao}</p>
                </div>

                <div className="grid gap-3 mt-4">
                  {["Instagram", "Twitter", "TikTok"].map((rede) => {
                    const perfil = profiles.find((p) => p.artista === selectedIndustryArtist.nome && p.rede === rede);
                    return (
                      <motion.button
                        key={rede}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => {
                          haptic.selection();
                          setIndustryViewTab(rede as any);
                        }}
                        className={`${card} p-4 flex items-center justify-between group`}
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div
                            className={`size-11 rounded-2xl flex items-center justify-center shrink-0 ${
                              rede === "Instagram" ? "bg-[#f472b6]/10" : rede === "Twitter" ? "bg-[#1d9bf0]/10" : "bg-[#25F4EE]/10"
                            }`}
                          >
                            {rede === "Instagram" && <Instagram className="size-5 text-[#f472b6]" />}
                            {rede === "Twitter" && <Twitter className="size-5 text-[#1d9bf0]" />}
                            {rede === "TikTok" && <Video className="size-5 text-[#25F4EE]" />}
                          </div>
                          <div className="text-left min-w-0">
                            <h4 className="font-black text-sm uppercase truncate">{rede}</h4>
                            <p className="text-[10px] font-bold text-muted-foreground truncate">
                              {perfil ? perfil.handle : "Sem perfil"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {perfil && (
                            <span className="text-[10px] font-black uppercase bg-white/10 px-2 py-0.5 rounded-md">
                              {perfil.seguidores?.toLocaleString() || 0} segs
                            </span>
                          )}
                          <ChevronRight className="size-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            ) : (
              (() => {
                const perfil = profiles.find(
                  (p) => p.artista === selectedIndustryArtist.nome && p.rede === industryViewTab,
                );
                const artistPosts = posts.filter(
                  (p) => p.autor === selectedIndustryArtist.nome && p.tipo === industryViewTab,
                );
                const handle = perfil?.handle || "@" + selectedIndustryArtist.nome.toLowerCase().replace(/\s+/g, "");
                const cleanHandle = handle.replace(/^@/, "");
                const bio = perfil?.bio || selectedIndustryArtist.descricao || "";
                const followers = perfil?.seguidores || 0;
                const following = perfil?.seguindo || 0;
                const totalLikes = artistPosts.reduce((s, p) => s + (p.analytics?.likes || 0), 0);

                const followKey = `${selectedIndustryArtist.nome}|${industryViewTab}`;
                const isFollowing = followingSet.has(followKey);
                const toggleFollow = () => {
                  haptic.selection();
                  setFollowingSet((prev) => {
                    const next = new Set(prev);
                    if (next.has(followKey)) next.delete(followKey);
                    else next.add(followKey);
                    return next;
                  });
                };

                const profileAvatarStr = perfil?.avatar_url || perfil?.avatar || perfil?.foto;
                const avatarSrc = profileAvatarStr ? driveImg(profileAvatarStr) : undefined;

                const avatarFallback = (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900 text-white font-black text-2xl">
                    {selectedIndustryArtist.nome[0]}
                  </div>
                );
                const renderAvatar = (className: string) => (
                  <div className={className}>
                    {avatarSrc ? (
                      <img
                        src={avatarSrc}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        crossOrigin="anonymous"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      avatarFallback
                    )}
                  </div>
                );

                const BackBar = ({ bg, fg, accent }: { bg: string; fg: string; accent: string }) => (
                  <div
                    className={`flex items-center justify-between px-4 py-3 min-h-[3.25rem] ${bg} ${fg} sticky top-0 z-30 border-b border-current/10`}
                  >
                    <button
                      onClick={() => setIndustryViewTab(null)}
                      className="flex items-center gap-1 text-sm font-bold min-h-9"
                    >
                      <ChevronLeft className="size-5" /> Voltar
                    </button>
                    <p className="font-bold text-sm flex items-center gap-1 min-w-0 truncate">
                      {cleanHandle}
                      <BadgeCheck className={`size-4 shrink-0 ${accent}`} fill="currentColor" />
                    </p>
                    <MoreVertical className="size-5 opacity-70 shrink-0" />
                  </div>
                );

                // ============ INSTAGRAM ============
                if (industryViewTab === "Instagram") {
                  return (
                    <div className="rounded-[1.75rem] overflow-hidden border border-white/10 bg-white text-black">
                      <BackBar bg="bg-white" fg="text-black" accent="text-[#1d9bf0]" />
                      <div className="px-5 pt-5">
                        <div className="flex items-start gap-6">
                          <div className="p-[3px] rounded-full bg-gradient-to-tr from-[#feda75] via-[#fa7e1e] via-[#d62976] via-[#962fbf] to-[#4f5bd5] shrink-0">
                            <div className="p-[2px] bg-white rounded-full">
                              {renderAvatar("size-20 rounded-full overflow-hidden bg-zinc-100")}
                            </div>
                          </div>
                          <div className="flex-1 grid grid-cols-3 gap-2 text-center pt-3">
                            <div>
                              <p className="font-black text-base">{artistPosts.length}</p>
                              <p className="text-[11px] text-black/60">posts</p>
                            </div>
                            <div>
                              <p className="font-black text-base">{formatCount(followers)}</p>
                              <p className="text-[11px] text-black/60">seguidores</p>
                            </div>
                            <div>
                              <p className="font-black text-base">{formatCount(following)}</p>
                              <p className="text-[11px] text-black/60">seguindo</p>
                            </div>
                          </div>
                        </div>
                        <div className="mt-4">
                          <p className="font-black text-sm flex items-center gap-1">
                            {selectedIndustryArtist.nome}{" "}
                            <BadgeCheck className="size-4 text-[#1d9bf0]" fill="currentColor" />
                          </p>
                          <p className="text-[11px] uppercase text-black/50 font-bold tracking-wide">Artista</p>
                          {bio && <p className="text-[13px] mt-1.5 leading-snug whitespace-pre-line">{bio}</p>}
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-4">
                          <button
                            onClick={toggleFollow}
                            className={
                              isFollowing
                                ? "py-2 min-h-9 rounded-lg text-[13px] font-bold text-black bg-zinc-100 border border-zinc-200 active:scale-95 transition-transform"
                                : "py-2 min-h-9 rounded-lg text-[13px] font-bold text-white bg-gradient-to-r from-[#fa7e1e] via-[#d62976] to-[#4f5bd5] active:scale-95 transition-transform"
                            }
                          >
                            {isFollowing ? "Seguindo" : "Seguir"}
                          </button>
                          <button className="py-2 min-h-9 rounded-lg text-[13px] font-bold bg-zinc-100 border border-zinc-200 active:scale-95 transition-transform">
                            Mensagem
                          </button>
                        </div>
                      </div>
                      {/* Tabs */}
                      <div className="grid grid-cols-3 mt-4 border-t border-zinc-200">
                        <button className="py-2.5 flex items-center justify-center border-t-2 border-black text-black">
                          <Grid3x3 className="size-5" />
                        </button>
                        <button className="py-2.5 flex items-center justify-center border-t-2 border-transparent text-black/40">
                          <Film className="size-5" />
                        </button>
                        <button className="py-2.5 flex items-center justify-center border-t-2 border-transparent text-black/40">
                          <Tag className="size-5" />
                        </button>
                      </div>
                      {/* Grid */}
                      {artistPosts.length > 0 ? (
                        <div className="grid grid-cols-3 gap-[2px] bg-zinc-200">
                          {artistPosts.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => {
                                setSelectedPost(p);
                                loadComments(p.id);
                                setIsCommentModalOpen(true);
                              }}
                              className="aspect-square bg-zinc-50 relative overflow-hidden group"
                            >
                              {p.media_url ? (
                                p.media_tipo === "video" ? (
                                  <video src={driveVideo(p.media_url)} muted preload="metadata" className="w-full h-full object-cover" />
                                ) : (
                                  <img
                                    src={driveImg(p.media_url)}
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                )
                              ) : (
                                <div className="w-full h-full bg-gradient-to-br from-pink-200 via-purple-200 to-orange-200 flex items-center justify-center p-2">
                                  <p className="text-[10px] text-black/70 font-bold line-clamp-3 text-left">
                                    {p.texto}
                                  </p>
                                </div>
                              )}
                              {p.media_tipo === "video" && (
                                <Play className="absolute inset-0 m-auto size-6 text-white drop-shadow fill-white/30" />
                              )}
                              {p.subtipo === "Story" && (
                                <Film className="absolute top-1.5 right-1.5 size-3.5 text-white drop-shadow" />
                              )}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="py-16 flex flex-col items-center gap-2 text-black/40">
                          <ImageIcon className="size-10" />
                          <p className="text-xs font-bold">Nenhuma publicação ainda</p>
                        </div>
                      )}
                    </div>
                  );
                }

                // ============ TWITTER / X ============
                if (industryViewTab === "Twitter") {
                  return (
                    <div className="rounded-[1.75rem] overflow-hidden border border-white/10 bg-black text-white">
                      <BackBar bg="bg-black/95 backdrop-blur" fg="text-white" accent="text-[#1d9bf0]" />
                      {/* Banner */}
                      <div className="h-24 sm:h-28 bg-gradient-to-br from-[#1d9bf0] via-[#0a7bbf] to-[#15202b] relative" />
                      <div className="px-4 pb-4 -mt-12">
                        <div className="flex items-end justify-between">
                          <div className="p-1 bg-black rounded-full">
                            {renderAvatar("size-20 sm:size-24 rounded-full overflow-hidden bg-zinc-800")}
                          </div>
                          <button
                            onClick={toggleFollow}
                            className={
                              isFollowing
                                ? "mt-12 px-4 py-1.5 min-h-9 rounded-full bg-transparent border border-zinc-600 text-white font-black text-sm active:scale-95 transition-transform"
                                : "mt-12 px-4 py-1.5 min-h-9 rounded-full bg-white text-black font-black text-sm active:scale-95 transition-transform"
                            }
                          >
                            {isFollowing ? "Seguindo" : "Seguir"}
                          </button>
                        </div>
                        <div className="mt-3 min-w-0">
                          <p className="font-black text-lg sm:text-xl flex items-center gap-1.5 truncate">
                            {selectedIndustryArtist.nome}{" "}
                            <BadgeCheck className="size-5 text-[#1d9bf0] shrink-0" fill="currentColor" />
                          </p>
                          <p className="text-sm text-zinc-500 truncate">{handle}</p>
                          {bio && <p className="text-[14px] mt-2 leading-snug whitespace-pre-line">{bio}</p>}
                          <div className="flex gap-4 mt-3 text-sm">
                            <span>
                              <strong className="text-white">{formatCount(following)}</strong>{" "}
                              <span className="text-zinc-500">Seguindo</span>
                            </span>
                            <span>
                              <strong className="text-white">{formatCount(followers)}</strong>{" "}
                              <span className="text-zinc-500">Seguidores</span>
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* Tabs */}
                      <div className="grid grid-cols-4 border-b border-zinc-800">
                        {["Posts", "Respostas", "Mídia", "Curtidas"].map((t, i) => (
                          <button
                            key={t}
                            className={`py-3.5 text-[12px] sm:text-[13px] font-bold relative truncate px-1 ${i === 0 ? "text-white" : "text-zinc-500"}`}
                          >
                            {t}
                            {i === 0 && (
                              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 rounded-full bg-[#1d9bf0]" />
                            )}
                          </button>
                        ))}
                      </div>
                      {/* Timeline */}
                      {artistPosts.length > 0 ? (
                        <div>
                          {artistPosts.map((p) => (
                            <article
                              key={p.id}
                              className="flex gap-3 px-4 py-3 border-b border-zinc-800 hover:bg-white/[0.03] cursor-pointer text-left"
                              onClick={() => {
                                setSelectedPost(p);
                                loadComments(p.id);
                                setIsCommentModalOpen(true);
                              }}
                            >
                              <div className="size-10 rounded-full overflow-hidden bg-zinc-800 shrink-0">
                                {avatarSrc ? (
                                  <img
                                    src={avatarSrc}
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : (
                                  avatarFallback
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1 text-[14px] min-w-0">
                                  <span className="font-black truncate">{selectedIndustryArtist.nome}</span>
                                  <BadgeCheck className="size-4 text-[#1d9bf0] shrink-0" fill="currentColor" />
                                  <span className="text-zinc-500 truncate">{handle}</span>
                                  <span className="text-zinc-500 shrink-0">·</span>
                                  <span className="text-zinc-500 shrink-0">
                                    {new Date(p.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                                  </span>
                                </div>
                                <p className="text-[14px] mt-0.5 leading-snug whitespace-pre-line">{p.texto}</p>
                                {p.media_url && (
                                  <div className="mt-2 rounded-2xl overflow-hidden border border-zinc-800 aspect-video bg-zinc-900">
                                    <PostMedia
                                      url={p.media_url}
                                      tipo={p.media_tipo}
                                      resolveUrl={driveImg}
                                      className="w-full h-full object-cover"
                                    />
                                  </div>
                                )}
                                <div className="flex justify-between mt-3 max-w-xs text-zinc-500 text-[12px]">
                                  <span className="flex items-center gap-1.5 hover:text-[#1d9bf0]">
                                    <MessageCircle className="size-4" /> {p.analytics.comments}
                                  </span>
                                  <span className="flex items-center gap-1.5 hover:text-[#00ba7c]">
                                    <Repeat2 className="size-4" /> 0
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleLike(p.id);
                                    }}
                                    className="flex items-center gap-1.5 hover:text-[#f91880] active:scale-90 transition-transform"
                                  >
                                    <Heart className="size-4" /> {p.analytics.likes}
                                  </button>
                                  <span className="flex items-center gap-1.5 hover:text-[#1d9bf0]">
                                    <Share2 className="size-4" />
                                  </span>
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="py-20 flex flex-col items-center gap-2 text-zinc-600">
                          <Twitter className="size-10" />
                          <p className="text-xs font-bold">Sem posts ainda</p>
                        </div>
                      )}
                    </div>
                  );
                }

                // ============ TIKTOK ============
                return (
                  <div className="rounded-[1.75rem] overflow-hidden border border-white/10 bg-black text-white">
                    <BackBar bg="bg-black" fg="text-white" accent="text-[#25F4EE]" />
                    <div className="px-5 pt-6 pb-5 flex flex-col items-center text-center">
                      {renderAvatar("size-24 rounded-full overflow-hidden border-2 border-zinc-800 bg-zinc-900")}
                      <p className="font-black text-lg mt-3 flex items-center gap-1">
                        {handle} <BadgeCheck className="size-4 text-[#25F4EE]" fill="currentColor" />
                      </p>
                      <p className="text-[13px] text-zinc-400">{selectedIndustryArtist.nome}</p>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={toggleFollow}
                          className={
                            isFollowing
                              ? "px-6 py-1.5 min-h-9 rounded-md bg-zinc-800 border border-zinc-600 font-bold text-sm active:scale-95 transition-transform"
                              : "px-6 py-1.5 min-h-9 rounded-md bg-[#FE2C55] font-bold text-sm active:scale-95 transition-transform"
                          }
                        >
                          {isFollowing ? "Seguindo" : "Seguir"}
                        </button>
                        <button className="px-3 py-1.5 min-h-9 rounded-md bg-zinc-800 font-bold text-sm active:scale-95 transition-transform">
                          Mensagem
                        </button>
                        <button className="px-3 py-1.5 min-h-9 rounded-md bg-zinc-800 font-bold text-sm active:scale-95 transition-transform">
                          <UserCircle className="size-4" />
                        </button>
                      </div>
                      <div className="flex gap-6 mt-5">
                        <div>
                          <p className="font-black text-base">{formatCount(following)}</p>
                          <p className="text-[11px] text-zinc-400">Seguindo</p>
                        </div>
                        <div>
                          <p className="font-black text-base">{formatCount(followers)}</p>
                          <p className="text-[11px] text-zinc-400">Seguidores</p>
                        </div>
                        <div>
                          <p className="font-black text-base">{formatCount(totalLikes)}</p>
                          <p className="text-[11px] text-zinc-400">Curtidas</p>
                        </div>
                      </div>
                      {bio && <p className="text-[13px] mt-4 leading-snug max-w-xs whitespace-pre-line">{bio}</p>}
                    </div>
                    {/* Tabs */}
                    <div className="grid grid-cols-2 border-b border-zinc-800">
                      <button className="py-3 flex items-center justify-center border-b-2 border-white text-white">
                        <Grid3x3 className="size-5" />
                      </button>
                      <button className="py-3 flex items-center justify-center border-b-2 border-transparent text-zinc-500">
                        <Heart className="size-5" />
                      </button>
                    </div>
                    {/* Grid 9:16 */}
                    {artistPosts.length > 0 ? (
                      <div className="grid grid-cols-3 gap-[2px] bg-zinc-900">
                        {artistPosts.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => {
                              setSelectedPost(p);
                              loadComments(p.id);
                              setIsCommentModalOpen(true);
                            }}
                            className="aspect-[9/16] bg-zinc-900 relative overflow-hidden"
                          >
                            {p.media_url ? (
                              p.media_tipo === "video" ? (
                                <video src={driveVideo(p.media_url)} muted preload="metadata" className="w-full h-full object-cover" />
                              ) : (
                                <img
                                  src={driveImg(p.media_url)}
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                  loading="lazy"
                                  decoding="async"
                                />
                              )
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-[#FE2C55]/40 via-black to-[#25F4EE]/30 flex items-center justify-center p-2">
                                <p className="text-[10px] text-white/80 font-bold line-clamp-4 text-left">{p.texto}</p>
                              </div>
                            )}
                            <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/80 to-transparent flex items-center gap-1 text-white text-[11px] font-bold">
                              <Play className="size-3 fill-current" />
                              {formatCount(p.analytics.likes)}
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="py-16 flex flex-col items-center gap-2 text-zinc-600">
                        <Music2 className="size-10" />
                        <p className="text-xs font-bold">Nenhum vídeo ainda</p>
                      </div>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        ) : (
          <div className="grid gap-6 pb-20">
            <h2 className="text-xl font-black uppercase tracking-tight text-center">
              Redes <span className="text-primary">Sociais</span>
            </h2>
            {myArtists.map((art) => (
              <div key={art.nome} className={`${card} p-4 sm:p-5`}>
                <h3 className="font-black text-base uppercase mb-4 truncate">{art.nome}</h3>

                <div className="grid gap-3">
                  {["Instagram", "Twitter", "TikTok"].map((rede) => {
                    const perfil = profiles.find((p) => p.artista === art.nome && p.rede === rede);
                    return (
                      <div key={rede} className="flex flex-col gap-2.5 p-3.5 bg-white/[0.03] border border-white/10 rounded-2xl">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {rede === "Instagram" && <Instagram className="size-4 shrink-0 text-[#f472b6]" />}
                            {rede === "Twitter" && <Twitter className="size-4 shrink-0 text-[#1d9bf0]" />}
                            {rede === "TikTok" && <Video className="size-4 shrink-0 text-[#25F4EE]" />}
                            <span className="text-[11px] font-black uppercase">{rede}</span>
                          </div>
                          <span className="text-[10px] font-black bg-white/5 px-2 py-0.5 rounded-md text-muted-foreground truncate max-w-[9rem]">
                            {perfil ? perfil.handle : "Sem perfil"}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            haptic.light();
                            setEditingProfileInfo({ artista: art.nome, rede });
                            setProfileHandle(perfil?.handle || "@");
                            setProfileAvatar(perfil?.avatar_url || perfil?.avatar || perfil?.foto || "");
                            setProfileBio(perfil?.bio || "");
                            setProfileFollowers(String(perfil?.seguidores || "0"));
                            setProfileFollowing(String(perfil?.seguindo || "0"));
                            setIsProfileModalOpen(true);
                          }}
                          className="w-full py-2.5 min-h-11 bg-primary/10 border border-primary/20 rounded-xl text-[11px] font-black text-primary uppercase active:scale-95 transition-transform"
                        >
                          Configurar {rede}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {myArtists.length === 0 && (
              <p className="text-center font-medium text-muted-foreground py-10 text-sm">
                Você não possui artistas para gerenciar.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Floating Plus Button */}
      <button
        onClick={() => {
          haptic.medium();
          setIsModalOpen(true);
        }}
        className="fixed bottom-24 right-6 size-14 bg-primary text-primary-foreground rounded-full shadow-2xl grid place-items-center active:scale-90 transition-transform z-50"
      >
        <Plus className="size-7 stroke-[2.5]" />
      </button>

      {/* Post Creation Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ y: 200 }}
              animate={{ y: 0 }}
              exit={{ y: 200 }}
              className="bg-card border-t sm:border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] p-5 sm:p-6 max-w-sm w-full shadow-2xl max-h-[90dvh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black uppercase">{editingPost ? "Editar post" : "Lançar Hype"}</h2>
                <button
                  onClick={closePostModal}
                  className="size-9 shrink-0 rounded-full bg-white/5 border border-white/10 grid place-items-center active:scale-90 transition-transform"
                >
                  <X className="size-4" />
                </button>
              </div>

              {!selectedType ? (
                <div className="grid gap-3">
                  <p className="text-[10px] font-black uppercase text-muted-foreground">
                    Selecione onde o hype vai rolar:
                  </p>
                  <button
                    onClick={() => {
                      haptic.selection();
                      setSelectedType("Instagram");
                    }}
                    className="flex items-center gap-4 p-4 min-h-14 rounded-2xl bg-white/5 border border-white/10 font-black uppercase text-sm active:scale-95 transition-transform"
                  >
                    <Instagram className="text-[#f472b6]" /> Instagram
                  </button>
                  <button
                    onClick={() => {
                      haptic.selection();
                      setSelectedType("Twitter");
                    }}
                    className="flex items-center gap-4 p-4 min-h-14 rounded-2xl bg-white/5 border border-white/10 font-black uppercase text-sm active:scale-95 transition-transform"
                  >
                    <Twitter className="text-[#1d9bf0]" /> Twitter (X)
                  </button>
                  <button
                    onClick={() => {
                      haptic.selection();
                      setSelectedType("TikTok");
                    }}
                    className="flex items-center gap-4 p-4 min-h-14 rounded-2xl bg-white/5 border border-white/10 font-black uppercase text-sm active:scale-95 transition-transform"
                  >
                    <Video className="text-[#25F4EE]" /> TikTok
                  </button>
                </div>
              ) : (
                <div className="grid gap-4">
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black uppercase text-muted-foreground">Modo de publicação:</p>
                    <div className="flex bg-white/5 border border-white/10 rounded-xl overflow-hidden p-1 gap-1">
                      <button
                        onClick={() => {
                          haptic.selection();
                          setBlackoutMode(false);
                        }}
                        className={`flex-1 py-2 min-h-9 rounded-lg font-black text-[11px] uppercase flex items-center justify-center gap-1.5 transition-all ${!blackoutMode ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                      >
                        <Eye className="size-3.5" /> Normal
                      </button>
                      <button
                        onClick={() => {
                          haptic.selection();
                          setBlackoutMode(true);
                        }}
                        className={`flex-1 py-2 min-h-9 rounded-lg font-black text-[11px] uppercase flex items-center justify-center gap-1.5 transition-all ${blackoutMode ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                      >
                        <EyeOff className="size-3.5" /> Blackout
                      </button>
                    </div>
                  </div>

                  {blackoutMode ? (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-black uppercase text-muted-foreground">
                        Nome fictício que vai aparecer no post:
                      </p>
                      <div className="flex gap-2">
                        <input
                          value={blackoutUsername}
                          onChange={(e) => setBlackoutUsername(e.target.value)}
                          placeholder="ex: fã_secreto482"
                          className={inputCls + " flex-1"}
                        />
                        <button
                          onClick={() => {
                            haptic.selection();
                            gerarNomeBlackout();
                          }}
                          className="size-11 shrink-0 rounded-xl bg-white/5 border border-white/10 grid place-items-center active:scale-90 transition-transform"
                          title="Gerar nome aleatório"
                        >
                          <Shuffle className="size-4" />
                        </button>
                      </div>
                      <p className="text-[10px] text-muted-foreground font-medium leading-snug">
                        Ninguém vai ver que é {activeArtist?.nome || "seu artista"} — bom pra criar suspense antes de
                        um anúncio. Só você (o responsável) consegue editar ou voltar ao Normal depois.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-black uppercase text-muted-foreground">Postar como:</p>
                      <div className={inputCls + " flex items-center gap-2 text-muted-foreground"}>
                        <div className="size-5 rounded-full bg-white/10 flex items-center justify-center font-black text-[11px] overflow-hidden shrink-0">
                          {activeArtist?.foto ? (
                            <img
                              src={driveImg(activeArtist.foto)}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            activeArtist?.nome[0]
                          )}
                        </div>
                        <span className="truncate">{activeArtist?.nome || "Magnata"}</span>
                      </div>
                    </div>
                  )}

                  {selectedType === "Instagram" && (
                    <div className="flex bg-white/5 border border-white/10 rounded-xl overflow-hidden p-1 gap-1">
                      <button
                        onClick={() => setIgMode("Feed")}
                        className={`flex-1 py-2 min-h-9 rounded-lg font-black text-[11px] uppercase transition-all ${igMode === "Feed" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                      >
                        Feed
                      </button>
                      <button
                        onClick={() => setIgMode("Story")}
                        className={`flex-1 py-2 min-h-9 rounded-lg font-black text-[11px] uppercase transition-all ${igMode === "Story" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                      >
                        Story
                      </button>
                    </div>
                  )}

                  <textarea
                    value={postText}
                    onChange={(e) => setPostText(e.target.value)}
                    placeholder="Escreva algo f*** aqui..."
                    className={inputCls + " h-24 resize-none"}
                  />

                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black uppercase text-muted-foreground">Mídia (imagem ou vídeo):</p>
                    {imageUrl && (
                      <div className="w-full aspect-video rounded-xl overflow-hidden bg-secondary border border-white/10">
                        {mediaTipo === "video" ? (
                          <video src={driveVideo(imageUrl)} controls playsInline className="w-full h-full object-cover" />
                        ) : (
                          <img src={driveImg(imageUrl)} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        )}
                      </div>
                    )}
                    <label
                      className={
                        inputCls +
                        " flex items-center justify-center gap-2 cursor-pointer text-center " +
                        (uploadingImage ? "opacity-60 pointer-events-none" : "")
                      }
                    >
                      {mediaTipo === "video" ? <Video className="size-4" /> : <ImageIcon className="size-4" />}
                      {uploadingImage ? "Enviando..." : imageUrl ? "Trocar mídia" : "Selecionar do dispositivo"}
                      <input
                        type="file"
                        accept="image/*,video/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const isVideo = file.type.startsWith("video/");
                          setUploadingImage(true);
                          const folderType: SocialFolderType =
                            selectedType === "Instagram" && igMode === "Story" ? "socialStories" : "socialPosts";
                          const url = await uploadToDrive(file, folderType);
                          if (url) {
                            setImageUrl(url);
                            setMediaTipo(isVideo ? "video" : "imagem");
                          }
                          setUploadingImage(false);
                        }}
                      />
                    </label>
                    {mediaTipo === "imagem" && <PasteImageLinkInput onApply={setImageUrl} className={inputCls} />}
                  </div>

                  <button
                    onClick={handlePost}
                    disabled={submitting || !postText.trim() || !activeArtist || (blackoutMode && !blackoutUsername.trim())}
                    className="mt-2 p-4 min-h-14 bg-primary text-primary-foreground rounded-2xl font-black uppercase tracking-wide flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50"
                  >
                    {submitting
                      ? editingPost
                        ? "Salvando..."
                        : "Lançando..."
                      : editingPost
                        ? "Salvar alterações"
                        : "Lançar Agora"}{" "}
                    <Send className="size-4" />
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* News Creation Modal */}
      <AnimatePresence>
        {isNewsModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ y: 200 }}
              animate={{ y: 0 }}
              exit={{ y: 200 }}
              className="bg-card border-t sm:border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] p-5 sm:p-6 max-w-sm w-full shadow-2xl max-h-[90dvh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black uppercase">Nova Matéria</h2>
                <button
                  onClick={() => setIsNewsModalOpen(false)}
                  className="size-9 shrink-0 rounded-full bg-white/5 border border-white/10 grid place-items-center active:scale-90 transition-transform"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="grid gap-4">
                <div className="space-y-1.5">
                  <p className="text-[10px] font-black uppercase text-muted-foreground">Título da matéria:</p>
                  <input
                    type="text"
                    value={newsTitle}
                    onChange={(e) => setNewsTitle(e.target.value)}
                    placeholder="Manchete impactante..."
                    className={inputCls + " text-base"}
                  />
                </div>

                <div className="space-y-1.5">
                  <p className="text-[10px] font-black uppercase text-muted-foreground">Conteúdo:</p>
                  <textarea
                    value={newsContent}
                    onChange={(e) => setNewsContent(e.target.value)}
                    placeholder="O que está acontecendo?"
                    className={inputCls + " h-32 resize-none"}
                  />
                </div>

                <div className="space-y-1.5">
                  <p className="text-[10px] font-black uppercase text-muted-foreground">Imagem de capa:</p>
                  {newsImage && (
                    <div className="w-full aspect-video rounded-xl overflow-hidden bg-secondary border border-white/10">
                      <img src={driveImg(newsImage)} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </div>
                  )}
                  <label
                    className={
                      inputCls +
                      " flex items-center justify-center gap-2 cursor-pointer text-center " +
                      (uploadingNews ? "opacity-60 pointer-events-none" : "")
                    }
                  >
                    <ImageIcon className="size-4" />
                    {uploadingNews ? "Enviando..." : newsImage ? "Trocar imagem" : "Selecionar do dispositivo"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploadingNews(true);
                        const url = await uploadToDrive(file, "socialNews");
                        if (url) setNewsImage(url);
                        setUploadingNews(false);
                      }}
                    />
                  </label>
                  <PasteImageLinkInput onApply={setNewsImage} className={inputCls} />
                </div>

                <div className="p-3 bg-white/[0.03] border border-white/10 rounded-xl flex items-center gap-2.5">
                  <div className="size-7 rounded-full bg-white/10 overflow-hidden shrink-0">
                    {activeArtist?.foto ? (
                      <img
                        src={driveImg(activeArtist.foto)}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <UserCircle className="size-full text-muted-foreground/40" />
                    )}
                  </div>
                  <p className="text-[10px] font-black uppercase text-muted-foreground truncate">
                    Publicar como <span className="text-foreground">{activeArtist?.nome}</span>
                  </p>
                </div>

                <button
                  onClick={handleSaveNews}
                  disabled={submitting || !newsTitle.trim() || !activeArtist}
                  className="mt-2 p-4 min-h-14 bg-primary text-primary-foreground rounded-2xl font-black uppercase tracking-wide flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50"
                >
                  {submitting ? "Publicando..." : "Publicar News"} <Send className="size-4" />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isProfileModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="bg-card border border-white/10 rounded-[1.75rem] p-5 sm:p-6 max-w-sm w-full shadow-2xl max-h-[90dvh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-6">
                <div className="flex flex-col min-w-0">
                  <h2 className="text-lg font-black uppercase leading-none truncate">{editingProfileInfo?.rede}</h2>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase mt-1 truncate">
                    {editingProfileInfo?.artista}
                  </p>
                </div>
                <button
                  onClick={() => setIsProfileModalOpen(false)}
                  className="size-9 shrink-0 rounded-full bg-white/5 border border-white/10 grid place-items-center active:scale-90 transition-transform"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="grid gap-4">
                <div className="space-y-1.5">
                  <p className="text-[10px] font-black uppercase text-muted-foreground">Handle (usuário):</p>
                  <input
                    type="text"
                    value={profileHandle}
                    onChange={(e) => setProfileHandle(e.target.value)}
                    placeholder="@nome"
                    className={inputCls}
                  />
                </div>

                <div className="space-y-1.5">
                  <p className="text-[10px] font-black uppercase text-muted-foreground">
                    Seguindo (qtd. de pessoas que segue):
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={profileFollowing}
                    onChange={(e) => setProfileFollowing(e.target.value.replace(/\D/g, ""))}
                    placeholder="0"
                    className={inputCls}
                  />
                </div>

                <div className="p-3 bg-white/[0.03] border border-dashed border-white/10 rounded-xl text-[10px] font-medium text-muted-foreground leading-snug">
                  <span className="font-black uppercase text-foreground/80">Seguidores:</span> calculados automaticamente
                  pela coluna <span className="font-black">G</span> da aba{" "}
                  <span className="font-black">SOCIAL_PERFIS</span>. Atual:{" "}
                  <span className="font-black text-foreground">{Number(profileFollowers).toLocaleString("pt-BR")}</span>.
                </div>

                <div className="space-y-1.5">
                  <p className="text-[10px] font-black uppercase text-muted-foreground">Foto de perfil:</p>
                  <div className="flex gap-2.5 items-center">
                    <div className="size-12 rounded-xl overflow-hidden flex-shrink-0 bg-secondary border border-white/10">
                      {profileAvatar ? (
                        <img
                          src={driveImg(profileAvatar)}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <UserCircle className="size-full text-muted-foreground/40" />
                      )}
                    </div>
                    <label
                      className={
                        inputCls +
                        " flex-1 flex items-center justify-center gap-2 cursor-pointer text-center " +
                        (uploadingAvatar ? "opacity-60 pointer-events-none" : "")
                      }
                    >
                      <ImageIcon className="size-4" />
                      {uploadingAvatar ? "Enviando..." : profileAvatar ? "Trocar foto" : "Selecionar do dispositivo"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setUploadingAvatar(true);
                          const url = await uploadToDrive(file, "socialAvatars");
                          if (url) setProfileAvatar(url);
                          setUploadingAvatar(false);
                        }}
                      />
                    </label>
                  </div>
                  <PasteImageLinkInput onApply={setProfileAvatar} className={inputCls} />
                </div>

                <div className="space-y-1.5">
                  <p className="text-[10px] font-black uppercase text-muted-foreground">Bio / descrição:</p>
                  <textarea
                    value={profileBio}
                    onChange={(e) => setProfileBio(e.target.value)}
                    placeholder="Fale um pouco sobre o artista..."
                    className={inputCls + " h-20 resize-none"}
                  />
                </div>

                <button
                  onClick={handleSaveProfile}
                  disabled={submitting}
                  className="mt-2 p-4 min-h-14 bg-primary text-primary-foreground rounded-2xl font-black uppercase tracking-wide flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50"
                >
                  {submitting ? "Salvando..." : "Salvar Perfil"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedNews && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-0 sm:p-4 bg-black/95 backdrop-blur-md">
            <motion.div
              layoutId={selectedNews.id}
              className="bg-card border border-white/10 sm:rounded-[1.75rem] max-w-lg w-full h-full sm:h-auto sm:max-h-[85dvh] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="relative h-56 sm:h-64 flex-shrink-0">
                {selectedNews.imagem ? (
                  <img
                    src={driveImg(selectedNews.imagem)}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-primary/10">
                    <Newspaper className="size-16 text-muted-foreground/20" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                <div className="absolute top-4 right-4">
                  <button
                    onClick={() => setSelectedNews(null)}
                    className="size-9 bg-black/50 backdrop-blur-md text-white rounded-full flex items-center justify-center border border-white/20 active:scale-90 transition-transform"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="absolute bottom-5 left-5 right-5">
                  <span className="bg-primary text-primary-foreground px-3 py-1 font-black text-[10px] uppercase rounded-lg shadow-lg inline-block">
                    Flash News
                  </span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 sm:p-6">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase text-muted-foreground mb-3 tracking-widest">
                  <span className="text-primary">Por {selectedNews.autor}</span>
                  <span className="size-1 rounded-full bg-white/20" />
                  <span>{new Date(selectedNews.data).toLocaleDateString("pt-BR")}</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-black uppercase leading-tight tracking-tight mb-6">
                  {selectedNews.titulo}
                </h2>
                <div className="text-sm font-medium text-muted-foreground leading-relaxed whitespace-pre-wrap border-l-2 border-primary/30 pl-4">
                  {selectedNews.conteudo}
                </div>
              </div>

              <div className="p-5 border-t border-white/5 flex justify-center shrink-0">
                <button
                  onClick={() => setSelectedNews(null)}
                  className="px-8 py-3 min-h-11 bg-primary text-primary-foreground rounded-full font-black uppercase text-sm tracking-wide active:scale-95 transition-transform"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCommentModalOpen && selectedPost && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="bg-card border-t sm:border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] p-5 sm:p-6 max-w-md w-full shadow-2xl max-h-[90dvh] flex flex-col"
            >
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-lg font-black uppercase">Comentários</h2>
                <button
                  onClick={() => setIsCommentModalOpen(false)}
                  className="size-9 shrink-0 rounded-full bg-white/5 border border-white/10 grid place-items-center active:scale-90 transition-transform"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto mb-4 space-y-4 pr-1">
                <div className="p-3 bg-white/[0.03] rounded-xl border border-white/10">
                  <p className="text-[10px] font-black uppercase text-muted-foreground mb-1 truncate">{selectedPost.autor}</p>
                  <p className="text-sm font-medium">{selectedPost.texto}</p>
                </div>

                <div className="space-y-4">
                  {comments.map((c, idx) => (
                    <div key={idx} className="flex gap-3">
                      <div className="size-8 rounded-full bg-white/10 border border-white/10 flex items-center justify-center font-black text-[10px] flex-shrink-0 overflow-hidden">
                        {c.avatar ? (
                          <img
                            src={driveImg(c.avatar)}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          c.autor[0]
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-black leading-none truncate">{c.autor}</p>
                        {editingCommentRow === c.rowIndex ? (
                          <div className="mt-1.5">
                            <textarea
                              value={editCommentText}
                              onChange={(e) => setEditCommentText(e.target.value)}
                              rows={2}
                              autoFocus
                              className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-base outline-none resize-none"
                            />
                            <div className="flex justify-end gap-1.5 mt-1">
                              <button
                                onClick={cancelEditComment}
                                disabled={savingCommentEdit}
                                className="px-2.5 py-1 rounded-full bg-white/5 text-muted-foreground text-[10px] font-bold"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={saveEditComment}
                                disabled={savingCommentEdit || !editCommentText.trim()}
                                className="px-2.5 py-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold disabled:opacity-50"
                              >
                                Salvar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs font-medium text-muted-foreground mt-1.5">{c.texto}</p>
                            {c.rowIndex && c.telegram_id && String(c.telegram_id) === String(user?.id || "") && (
                              <button
                                onClick={() => startEditComment(c)}
                                className="text-[10px] text-muted-foreground hover:text-foreground mt-1 inline-flex items-center gap-1"
                              >
                                <Edit className="size-2.5" /> Editar
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {comments.length === 0 && (
                    <p className="text-center font-medium text-muted-foreground py-10 text-sm">
                      Nenhum comentário por aqui ainda.
                    </p>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-white/5">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder={activeArtist ? `Comentar como ${activeArtist.nome}...` : "Selecione um artista..."}
                    className={inputCls + " flex-1"}
                    onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
                  />
                  <button
                    onClick={handleAddComment}
                    disabled={submitting || !newComment.trim() || !activeArtist}
                    className="size-11 shrink-0 bg-primary text-primary-foreground rounded-xl grid place-items-center active:scale-90 transition-transform disabled:opacity-50"
                  >
                    <Send className="size-4.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
