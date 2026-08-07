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
  BarChart3,
  X,
  Image as ImageIcon,
  Send,
  MoreVertical,
  Newspaper,
  ImageOff,
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
} from "lucide-react";

function formatCount(n: number | undefined): string {
  const v = Number(n || 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(v >= 10_000 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(v);
}
import { api } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";

export const Route = createFileRoute("/social")({
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
  analytics: { likes: number; comments: number; shares: number };
  data: string;
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
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<"Instagram" | "Twitter" | "TikTok" | null>(null);
  const [igMode, setIgMode] = useState<"Feed" | "Story">("Feed");
  const [postText, setPostText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
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
  const [newComment, setNewComment] = useState("");
  const [profileFollowers, setProfileFollowers] = useState("0");
  const [profileFollowing, setProfileFollowing] = useState("0");
  const [columns, setColumns] = useState(1);
  const [selectedNews, setSelectedNews] = useState<News | null>(null);
  const { user, ready } = useTelegramUser();

  useEffect(() => {
    loadPosts();
    loadNews();
  }, []);

  useEffect(() => {
    if (ready) loadContext();
  }, [ready, user]);

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

  async function handleLike(postId: string) {
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
      // 💡 Convertendo explicitamente para número puro
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

      console.log("Enviando dados para o Google Script:", p); // Debug para você ver o que está indo

      const tgId = user?.id || "";
      const res = await (api as any).salvarPerfilSocial(p, tgId);
      if (res.ok) {
        setIsProfileModalOpen(false);
        loadContext();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePost() {
    if (!selectedType || !postText.trim() || !activeArtist || submitting) return;

    setSubmitting(true);
    const tgId = user?.id || "";

    try {
      const payload = {
        tipo: selectedType,
        subtipo: selectedType === "Instagram" ? igMode : undefined,
        autor: activeArtist.nome,
        texto: postText,
        media_url: imageUrl,
        analytics: { likes: 0, comments: 0, shares: 0 },
      };

      const res = await (api as any).salvarPostSocial(payload, tgId);
      if (res.ok) {
        setIsModalOpen(false);
        setSelectedType(null);
        setPostText("");
        setImageUrl("");
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

  const driveImg = (url: string | null | undefined) => {
    if (!url) return undefined;
    if (url.includes("lh3.googleusercontent.com")) return url;
    const m = String(url).match(/[-\w]{25,}/);
    if (!m) return url;
    return `https://lh3.googleusercontent.com/d/$${m[0]}=w600`;
  };

  const getPostStyles = (tipo: string) => {
    if (tipo === "Twitter")
      return "bg-white text-black border-[#3D8BFF] shadow-[6px_6px_0px_#B9E2FF] active:shadow-[2px_2px_0px_#B9E2FF]";
    if (tipo === "Instagram")
      return "bg-white text-black border-[#FF4757] shadow-[6px_6px_0px_#FFE0E0] active:shadow-[2px_2px_0px_#FFE0E0]";
    if (tipo === "TikTok")
      return "bg-white text-black border-black shadow-[6px_6px_0px_#000] active:shadow-[2px_2px_0px_#000]";
    return "bg-white text-black border-black shadow-[7px_7px_0px_#000] active:shadow-[2px_2px_0px_#000]";
  };

  const neoCard =
    "border-[3.5px] rounded-[24px] p-4 sm:p-5 mb-5 transition-all active:translate-x-[1px] active:translate-y-[1px]";
  const neoBadge =
    "px-2.5 py-0.5 rounded-full border-2 border-black text-[11px] font-black uppercase tracking-tight text-white text-center";
  const neoInput =
    "w-full border-[3px] border-black rounded-[16px] p-3.5 font-bold text-sm focus:outline-none focus:ring-4 focus:ring-[#3D8BFF]/20 text-black bg-white placeholder:text-black/30 transition-all";

  return (
    <div className="flex-1 bg-[#F4F4F5] min-h-screen pb-32">
      {/* Header */}
      <div className="pt-4 px-4 sticky top-0 bg-[#F4F4F5]/90 backdrop-blur-md z-[60] border-b-2 border-black/5">
        <div className="flex flex-col gap-4 mb-4">
          <h1 className="text-3xl font-black italic uppercase tracking-tighter text-black flex items-center gap-2">
            Empire <span className="text-[#3D8BFF]">Social</span>
          </h1>

          <div className="grid grid-cols-4 bg-white border-[3px] border-black rounded-2xl p-1 shadow-[4px_4px_0px_#000] w-full overflow-hidden">
            <button
              onClick={() => setViewMode("Feed")}
              className={`py-3 font-black text-[11px] uppercase rounded-xl transition-all flex items-center justify-center gap-1 ${viewMode === "Feed" ? "bg-black text-white shadow-inner" : "bg-white text-black hover:bg-zinc-50"}`}
            >
              Feed
            </button>
            <button
              onClick={() => {
                setViewMode("Industry");
                setSelectedIndustryArtist(null);
              }}
              className={`py-3 font-black text-[11px] uppercase rounded-xl transition-all flex items-center justify-center gap-1 ${viewMode === "Industry" ? "bg-black text-white shadow-inner" : "bg-white text-black hover:bg-zinc-50"}`}
            >
              Perfis
            </button>
            <button
              onClick={() => setViewMode("News")}
              className={`py-3 font-black text-[11px] uppercase rounded-xl transition-all flex items-center justify-center gap-1 ${viewMode === "News" ? "bg-black text-white shadow-inner" : "bg-white text-black hover:bg-zinc-50"}`}
            >
              News
            </button>
            <button
              onClick={() => setViewMode("Settings")}
              className={`py-3 font-black text-[11px] uppercase rounded-xl transition-all flex items-center justify-center gap-1 ${viewMode === "Settings" ? "bg-black text-white shadow-inner" : "bg-white text-black hover:bg-zinc-50"}`}
            >
              Configurações
            </button>
          </div>
        </div>

        {myArtists.length > 0 && (
          <div className="mb-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-black/40 mb-3 px-1 italic">
              Interagir como:
            </p>
            <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar px-1 items-center">
              {myArtists.map((art) => {
                const isActive = activeArtist?.nome === art.nome;
                const imgUrl = driveImg(art.foto);
                return (
                  <button
                    key={art.nome}
                    onClick={() => {
                      setActiveArtist(art);
                      setSelectedArtist(art.nome);
                    }}
                    className={`flex flex-col items-center gap-2 transition-all shrink-0 group relative`}
                  >
                    <div
                      className={`size-14 rounded-full border-[3px] overflow-hidden transition-all relative p-0.5 ${
                        isActive
                          ? "border-[#3D8BFF] shadow-[0_0_15px_rgba(61,139,255,0.4)] scale-110 z-10 bg-white"
                          : "border-black bg-white grayscale hover:grayscale-0"
                      }`}
                    >
                      <div className="w-full h-full rounded-full overflow-hidden bg-zinc-100 border-[1px] border-transparent">
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
                              target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(art.nome)}&background=3D8BFF&color=fff&size=128&bold=true`;
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center font-black text-lg bg-[#3D8BFF] text-white italic">
                            {art.nome[0]}
                          </div>
                        )}
                      </div>
                    </div>
                    {isActive && (
                      <motion.div
                        layoutId="activeIndicator"
                        className="absolute bottom-6 right-0 size-4 bg-[#D0FF43] border-2 border-black rounded-full flex items-center justify-center z-20"
                      >
                        <div className="size-1 bg-black rounded-full animate-pulse" />
                      </motion.div>
                    )}
                    <span
                      className={`text-[11px] font-black uppercase italic tracking-tighter transition-all ${isActive ? "text-[#3D8BFF] scale-105" : "text-black/60"}`}
                    >
                      {art.nome.split(" ")[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="px-4 max-w-xl mx-auto mt-4">
        {viewMode === "Feed" ? (
          <>
            {loading ? (
              <div className="flex flex-col items-center justify-center p-20 gap-4">
                <div className="w-12 h-12 border-4 border-black border-t-transparent rounded-full animate-spin"></div>
                <p className="font-black italic uppercase text-black">Carregando Hype...</p>
              </div>
            ) : (
              posts.map((post) => (
                <motion.div
                  key={post.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`${neoCard} ${getPostStyles(post.tipo)}`}
                >
                  <div
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedPost(post);
                      loadComments(post.id);
                      setIsCommentModalOpen(true);
                    }}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full border-2 border-black overflow-hidden flex-shrink-0 bg-[#FFD166] flex items-center justify-center font-black text-black">
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
                                  target.parentElement.innerHTML = `<div class="w-full h-full flex items-center justify-center bg-zinc-200 text-black text-[10px] font-black uppercase">${post.autor[0]}</div>`;
                                }
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-zinc-200 text-black text-[10px] font-black uppercase">
                              {post.autor[0]}
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="font-black text-sm text-black leading-none">{post.autor}</p>
                          <p className="text-[10px] text-black font-black opacity-80 uppercase">{post.handle}</p>
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        {post.tipo === "Instagram" && <Instagram className="size-5 text-black" />}
                        {post.tipo === "Twitter" && <Twitter className="size-5 text-black" />}
                        {post.tipo === "TikTok" && <Video className="size-5 text-black" />}
                      </div>
                    </div>

                    {post.tipo === "Instagram" && post.subtipo === "Story" ? (
                      <div className="relative aspect-[9/16] bg-black border-2 border-black rounded-[15px] overflow-hidden mb-4 shadow-[4px_4px_0px_#000]">
                        {post.media_url ? (
                          <img
                            loading="lazy"
                            decoding="async"
                            src={driveImg(post.media_url)}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = "https://placehold.co/600x1067?text=Story";
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white font-black italic">
                            STORY
                          </div>
                        )}
                        <div className="absolute top-4 left-4 flex gap-2">
                          <span className={neoBadge + " bg-[#D0FF43] text-black font-black"}>Story</span>
                        </div>
                      </div>
                    ) : (
                      post.media_url && (
                        <div className="aspect-square bg-muted border-2 border-black rounded-[15px] overflow-hidden mb-4 shadow-[4px_4px_0px_#000]">
                          <img
                            loading="lazy"
                            decoding="async"
                            src={driveImg(post.media_url)}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = "https://placehold.co/600x600?text=Post";
                            }}
                          />
                        </div>
                      )
                    )}

                    <p className="font-bold text-sm leading-snug mb-4 text-black text-pretty">{post.texto}</p>
                  </div>

                  <div className="flex items-center gap-4 pt-3 border-t-2 border-current/10">
                    <button
                      onClick={() => handleLike(post.id)}
                      className="flex items-center gap-1 font-black text-xs hover:opacity-70 transition-colors text-black"
                    >
                      <Heart
                        className={`size-4 ${post.analytics.likes > 0 ? "fill-[#3D8BFF] text-[#3D8BFF]" : "text-black"}`}
                      />{" "}
                      {post.analytics.likes}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedPost(post);
                        loadComments(post.id);
                        setIsCommentModalOpen(true);
                      }}
                      className="flex items-center gap-1 font-black text-xs hover:opacity-70 transition-colors text-black"
                    >
                      <MessageCircle className="size-4 text-black" /> {post.analytics.comments}
                    </button>
                    <button className="flex items-center gap-1 font-black text-xs ml-auto text-black">
                      <Share2 className="size-4 text-black" />
                    </button>
                  </div>
                </motion.div>
              ))
            )}
          </>
        ) : viewMode === "News" ? (
          <div className="grid gap-6 pb-20">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-black italic uppercase text-black tracking-tighter">
                Empire <span className="text-[#3D8BFF]">NEWS</span>
              </h2>
              <button
                onClick={() => setIsNewsModalOpen(true)}
                className="p-2 bg-black text-[#D0FF43] rounded-full border-2 border-black shadow-[3px_3px_0px_#D0FF43]"
              >
                <Plus className="size-5 text-[#D0FF43]" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-8">
              {news.map((item) => (
                <motion.div
                  key={item.id}
                  layoutId={item.id}
                  onClick={() => setSelectedNews(item)}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white text-black border-[3.5px] border-black rounded-[35px] overflow-hidden shadow-[8px_8px_0px_#000] cursor-pointer group active:translate-x-1 active:translate-y-1 active:shadow-none transition-all flex flex-col"
                >
                  <div className="aspect-[16/9] bg-zinc-100 relative border-b-[3.5px] border-black overflow-hidden">
                    {item.imagem ? (
                      <img
                        src={driveImg(item.imagem)}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-[#D0FF43]/10">
                        <Newspaper className="size-12 text-black/5" />
                      </div>
                    )}
                    <div className="absolute top-4 left-4">
                      <span className="bg-black text-[#D0FF43] text-[11px] font-black uppercase px-3 py-1 rounded-full border-2 border-white/20 shadow-lg">
                        EXCLUSIVO
                      </span>
                    </div>
                  </div>
                  <div className="p-5 sm:p-6 bg-white shrink-0">
                    <div className="flex items-center gap-3 text-[10px] font-black uppercase text-black/70 mb-3 italic tracking-widest">
                      <span className="text-[#3D8BFF] tracking-tighter">{item.autor}</span>
                      <span className="size-1 rounded-full bg-black/30" />
                      <span className="opacity-80">{new Date(item.data).toLocaleDateString("pt-BR")}</span>
                    </div>
                    <h3 className="text-xl font-black uppercase italic leading-[1.1] mb-3 line-clamp-2 group-hover:text-[#3D8BFF] transition-colors tracking-tight text-black">
                      {item.titulo}
                    </h3>
                    <p className="text-[13.5px] font-bold text-[#1A1A1B] leading-snug line-clamp-3 mb-5">
                      {item.conteudo}
                    </p>
                    <div className="flex justify-between items-center pt-3 border-t-2 border-dashed border-black/20">
                      <span className="text-[10px] font-black uppercase opacity-50 italic">Leitura 2 min</span>
                      <span className="text-xs font-black uppercase italic text-[#3D8BFF] flex items-center gap-1 group-hover:gap-2 transition-all">
                        Ver Matéria Completa <ChevronRight className="size-3 stroke-[3]" />
                      </span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {news.length === 0 && (
              <div className="py-20 text-center flex flex-col items-center gap-4">
                <Newspaper className="size-12 opacity-10" />
                <p className="font-black uppercase italic opacity-20">Sem manchetes no momento</p>
              </div>
            )}
          </div>
        ) : viewMode === "Industry" ? (
          <div className="grid gap-6 pb-20">
            {!selectedIndustryArtist ? (
              <>
                <h2 className="text-2xl font-black italic uppercase text-black tracking-tighter text-center">
                  Império <span className="text-[#3D8BFF]">Perfis</span>
                </h2>
                <div className="grid gap-4">
                  {allArtists.map((art) => (
                    <motion.button
                      key={art.nome}
                      whileHover={{ x: 5 }}
                      onClick={() => {
                        setSelectedIndustryArtist(art);
                        setIndustryViewTab(null);
                      }}
                      className="flex items-center gap-4 p-4 bg-white border-[3px] border-black rounded-[20px] shadow-[4px_4px_0px_#000] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all group"
                    >
                      <div className="size-14 rounded-full border-2 border-black overflow-hidden flex-shrink-0 bg-stone-100 flex items-center justify-center">
                        <UserCircle className="size-8 text-black/20" />
                      </div>
                      <div className="flex flex-col items-start text-left">
                        <span className="font-black text-lg uppercase italic text-black">{art.nome}</span>
                        <span className="text-[10px] font-bold uppercase opacity-40">
                          {art.gravadora || "Independent"}
                        </span>
                      </div>
                      <ChevronRight className="ml-auto size-6 text-[#3D8BFF] opacity-0 group-hover:opacity-100 transition-all" />
                    </motion.button>
                  ))}
                </div>
              </>
            ) : !industryViewTab ? (
              <div className="space-y-6">
                {/* Selection of Networks Screen */}
                <div className="flex flex-col items-center text-center gap-2">
                  <button
                    onClick={() => setSelectedIndustryArtist(null)}
                    className="self-start text-[10px] font-black uppercase italic text-[#3D8BFF] mb-2 flex items-center gap-1"
                  >
                    <ChevronRight className="size-3 rotate-180" /> Voltar para Artistas
                  </button>
                  <h2 className="text-3xl font-black uppercase italic tracking-tighter text-black">
                    {selectedIndustryArtist.nome}
                  </h2>
                  <p className="text-xs font-black uppercase opacity-60 text-black px-4">
                    {selectedIndustryArtist.descricao}
                  </p>
                </div>

                <div className="grid gap-4 mt-6">
                  {["Instagram", "Twitter", "TikTok"].map((rede) => {
                    const perfil = profiles.find((p) => p.artista === selectedIndustryArtist.nome && p.rede === rede);
                    return (
                      <motion.button
                        key={rede}
                        whileHover={{ scale: 1.02 }}
                        onClick={() => setIndustryViewTab(rede as any)}
                        className="p-5 bg-white border-[3px] border-black rounded-[25px] shadow-[6px_6px_0px_#000] flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className={`size-12 rounded-2xl flex items-center justify-center border-2 border-black ${
                              rede === "Instagram"
                                ? "bg-[#FF4757]/10"
                                : rede === "Twitter"
                                  ? "bg-[#3D8BFF]/10"
                                  : "bg-black/10"
                            }`}
                          >
                            {rede === "Instagram" && <Instagram className="size-6 text-[#FF4757]" />}
                            {rede === "Twitter" && <Twitter className="size-6 text-[#3D8BFF]" />}
                            {rede === "TikTok" && <Video className="size-6 text-black" />}
                          </div>
                          <div className="text-left">
                            <h4 className="font-black text-sm uppercase italic text-black">{rede}</h4>
                            <p className="text-[10px] font-bold uppercase opacity-50">
                              {perfil ? perfil.handle : "Sem Perfil"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {perfil && (
                            <span className="text-[11px] font-black uppercase bg-black text-white px-2 py-0.5 rounded-md italic">
                              {perfil.seguidores?.toLocaleString() || 0} SEGS
                            </span>
                          )}
                          <ChevronRight className="size-5 text-black group-hover:translate-x-1 transition-transform" />
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

                const profileAvatarStr = perfil?.avatar_url || perfil?.avatar || perfil?.foto;
                const avatarSrc = profileAvatarStr ? driveImg(profileAvatarStr) : undefined;

                const avatarFallback = (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900 text-white font-black text-2xl italic">
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
                    className={`flex items-center justify-between px-4 py-3 ${bg} ${fg} sticky top-[152px] z-30 border-b border-current/10`}
                  >
                    <button
                      onClick={() => setIndustryViewTab(null)}
                      className="flex items-center gap-1 text-sm font-bold"
                    >
                      <ChevronLeft className="size-5" /> Voltar
                    </button>
                    <p className="font-bold text-sm flex items-center gap-1">
                      {cleanHandle}
                      <BadgeCheck className={`size-4 ${accent}`} fill="currentColor" />
                    </p>
                    <MoreVertical className="size-5 opacity-70" />
                  </div>
                );

                // ============ INSTAGRAM ============
                if (industryViewTab === "Instagram") {
                  return (
                    <div className="-mx-4 bg-white text-black rounded-[24px] overflow-hidden border-[3px] border-black shadow-[6px_6px_0px_#000]">
                      <BackBar bg="bg-white" fg="text-black" accent="text-[#3D8BFF]" />
                      <div className="px-5 pt-5">
                        <div className="flex items-start gap-6">
                          <div className="p-[3px] rounded-full bg-gradient-to-tr from-[#feda75] via-[#fa7e1e] via-[#d62976] via-[#962fbf] to-[#4f5bd5]">
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
                            <BadgeCheck className="size-4 text-[#3D8BFF]" fill="currentColor" />
                          </p>
                          <p className="text-[11px] uppercase text-black/50 font-bold tracking-wide">Artista</p>
                          {bio && <p className="text-[13px] mt-1.5 leading-snug whitespace-pre-line">{bio}</p>}
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-4">
                          <button className="py-1.5 rounded-lg text-[13px] font-bold text-white bg-gradient-to-r from-[#fa7e1e] via-[#d62976] to-[#4f5bd5]">
                            Seguir
                          </button>
                          <button className="py-1.5 rounded-lg text-[13px] font-bold bg-zinc-100 border border-zinc-200">
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
                                <img
                                  src={driveImg(p.media_url)}
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                  loading="lazy"
                                  decoding="async"
                                />
                              ) : (
                                <div className="w-full h-full bg-gradient-to-br from-pink-200 via-purple-200 to-orange-200 flex items-center justify-center p-2">
                                  <p className="text-[10px] text-black/70 font-bold line-clamp-3 text-left">
                                    {p.texto}
                                  </p>
                                </div>
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
                    <div className="-mx-4 bg-black text-white rounded-[24px] overflow-hidden border-[3px] border-black shadow-[6px_6px_0px_#1d9bf0]">
                      <BackBar bg="bg-black/95 backdrop-blur" fg="text-white" accent="text-[#1d9bf0]" />
                      {/* Banner */}
                      <div className="h-28 bg-gradient-to-br from-[#1d9bf0] via-[#0a7bbf] to-[#15202b] relative" />
                      <div className="px-4 pb-4 -mt-12">
                        <div className="flex items-end justify-between">
                          <div className="p-1 bg-black rounded-full">
                            {renderAvatar("size-24 rounded-full overflow-hidden bg-zinc-800")}
                          </div>
                          <button className="mt-12 px-4 py-1.5 rounded-full bg-white text-black font-black text-sm">
                            Seguir
                          </button>
                        </div>
                        <div className="mt-3">
                          <p className="font-black text-xl flex items-center gap-1.5">
                            {selectedIndustryArtist.nome}{" "}
                            <BadgeCheck className="size-5 text-[#1d9bf0]" fill="currentColor" />
                          </p>
                          <p className="text-sm text-zinc-500">{handle}</p>
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
                            className={`py-3.5 text-[13px] font-bold relative ${i === 0 ? "text-white" : "text-zinc-500"}`}
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
                                <div className="flex items-center gap-1 text-[14px]">
                                  <span className="font-black truncate">{selectedIndustryArtist.nome}</span>
                                  <BadgeCheck className="size-4 text-[#1d9bf0] shrink-0" fill="currentColor" />
                                  <span className="text-zinc-500 truncate">{handle}</span>
                                  <span className="text-zinc-500">·</span>
                                  <span className="text-zinc-500">
                                    {new Date(p.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                                  </span>
                                </div>
                                <p className="text-[14px] mt-0.5 leading-snug whitespace-pre-line">{p.texto}</p>
                                {p.media_url && (
                                  <div className="mt-2 rounded-2xl overflow-hidden border border-zinc-800 aspect-video bg-zinc-900">
                                    <img
                                      src={driveImg(p.media_url)}
                                      className="w-full h-full object-cover"
                                      referrerPolicy="no-referrer"
                                      loading="lazy"
                                      decoding="async"
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
                                    className="flex items-center gap-1.5 hover:text-[#f91880]"
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
                  <div className="-mx-4 bg-black text-white rounded-[24px] overflow-hidden border-[3px] border-black shadow-[6px_6px_0px_#FE2C55]">
                    <BackBar bg="bg-black" fg="text-white" accent="text-[#25F4EE]" />
                    <div className="px-5 pt-6 pb-5 flex flex-col items-center text-center">
                      {renderAvatar("size-24 rounded-full overflow-hidden border-2 border-zinc-800 bg-zinc-900")}
                      <p className="font-black text-lg mt-3 flex items-center gap-1">
                        {handle} <BadgeCheck className="size-4 text-[#25F4EE]" fill="currentColor" />
                      </p>
                      <p className="text-[13px] text-zinc-400">{selectedIndustryArtist.nome}</p>
                      <div className="flex gap-2 mt-3">
                        <button className="px-6 py-1.5 rounded-md bg-[#FE2C55] font-bold text-sm">Seguir</button>
                        <button className="px-3 py-1.5 rounded-md bg-zinc-800 font-bold text-sm">Mensagem</button>
                        <button className="px-3 py-1.5 rounded-md bg-zinc-800 font-bold text-sm">
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
                              <img
                                src={driveImg(p.media_url)}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-[#FE2C55]/40 via-black to-[#25F4EE]/30 flex items-center justify-center p-2">
                                <p className="text-[10px] text-white/80 font-bold line-clamp-4 text-left">{p.texto}</p>
                              </div>
                            )}
                            <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/80 to-transparent flex items-center gap-1 text-white text-[11px] font-bold">
                              <Play className="size-3 fill-current" />
                              {formatCount(p.analytics.likes * 17 + 234)}
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
          <div className="grid gap-6 text-black pb-20">
            <h2 className="text-2xl font-black tracking-tighter uppercase italic text-center text-black">
              Redes <span className="text-[#3D8BFF]">Sociais</span>
            </h2>
            {myArtists.map((art) => (
              <div key={art.nome} className={neoCard}>
                <div className="flex items-center gap-3 mb-4 text-black">
                  <h3 className="font-black text-lg uppercase italic text-black">{art.nome}</h3>
                </div>

                <div className="grid gap-3">
                  {["Instagram", "Twitter", "TikTok"].map((rede) => {
                    const perfil = profiles.find((p) => p.artista === art.nome && p.rede === rede);
                    return (
                      <div
                        key={rede}
                        className="flex flex-col gap-2 p-4 bg-white border-[3px] border-black rounded-xl text-black shadow-[4px_4px_0px_#000]"
                      >
                        <div className="flex items-center justify-between text-black mb-1">
                          <div className="flex items-center gap-2">
                            {rede === "Instagram" && <Instagram className="size-4 text-black" />}
                            {rede === "Twitter" && <Twitter className="size-4 text-black" />}
                            {rede === "TikTok" && <Video className="size-4 text-black" />}
                            <span className="text-[11px] font-black uppercase italic">{rede}</span>
                          </div>
                          <span className="text-[10px] font-black bg-black/5 px-2 py-0.5 rounded-md opacity-60 uppercase">
                            {perfil ? perfil.handle : "Sem Perfil"}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setEditingProfileInfo({ artista: art.nome, rede });
                            setProfileHandle(perfil?.handle || "@");
                            setProfileAvatar(perfil?.avatar_url || perfil?.avatar || perfil?.foto || "");
                            setProfileBio(perfil?.bio || "");
                            setProfileFollowers(String(perfil?.seguidores || "0"));
                            setProfileFollowing(String(perfil?.seguindo || "0"));
                            setIsProfileModalOpen(true);
                          }}
                          className="w-full py-2.5 bg-[#D0FF43] border-[2.5px] border-black rounded-xl text-[10px] font-black text-black uppercase shadow-[3px_3px_0px_#000] active:translate-y-[1px] active:shadow-none transition-all"
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
              <p className="text-center font-bold text-black opacity-50 py-10">
                Você não possui artistas para gerenciar.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Floating Plus Button */}
      <button
        onClick={() => setIsModalOpen(true)}
        className="fixed bottom-24 right-6 w-16 h-16 bg-[#D0FF43] border-[3px] border-black rounded-full shadow-[4px_4px_0px_#000] flex items-center justify-center transition-all hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[6px_6px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0px_0px_0px_#000] z-50 text-black"
      >
        <Plus className="size-8 stroke-[3] text-black" />
      </button>

      {/* Post Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
          <motion.div
            initial={{ y: 200 }}
            animate={{ y: 0 }}
            exit={{ y: 200 }}
            className="bg-white border-[4px] border-black rounded-[30px] p-6 max-w-sm w-full shadow-[10px_10px_0px_#000] max-h-[90vh] overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black italic uppercase text-black">LANÇAR HYPE</h2>
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setSelectedType(null);
                  setPostText("");
                  setImageUrl("");
                }}
                className="p-2 border-2 border-black rounded-full hover:bg-red-500 text-black transition-colors"
              >
                <X className="size-4 stroke-[3]" />
              </button>
            </div>

            {!selectedType ? (
              <div className="grid gap-4">
                <p className="text-[10px] font-black uppercase text-black opacity-60 italic">
                  Selecione onde o hype vai rolar:
                </p>
                <button
                  onClick={() => setSelectedType("Instagram")}
                  className="flex items-center gap-4 p-4 border-[3px] border-black rounded-[15px] bg-[#FFD166] font-black uppercase text-sm shadow-[4px_4px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0px_0px_0px_#000] text-black"
                >
                  <Instagram className="text-black" /> Instagram
                </button>
                <button
                  onClick={() => setSelectedType("Twitter")}
                  className="flex items-center gap-4 p-4 border-[3px] border-black rounded-[15px] bg-[#3D8BFF] text-black font-black uppercase text-sm shadow-[4px_4px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0px_0px_0px_#000]"
                >
                  <Twitter className="text-black" /> Twitter (X)
                </button>
                <button
                  onClick={() => setSelectedType("TikTok")}
                  className="flex items-center gap-4 p-4 border-[3px] border-black rounded-[15px] bg-[#D0FF43] font-black uppercase text-sm shadow-[4px_4px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0px_0px_0px_#000] text-black"
                >
                  <Video className="text-black" /> TikTok
                </button>
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-black uppercase text-black opacity-60 italic">Postar como:</p>
                  <div className={neoInput + " flex items-center gap-2 opacity-50 italic bg-zinc-50"}>
                    <div className="size-5 rounded-full bg-black/10 flex items-center justify-center font-black text-[11px] overflow-hidden">
                      {activeArtist?.foto ? (
                        <img
                          src={activeArtist.foto}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        activeArtist?.nome[0]
                      )}
                    </div>
                    {activeArtist?.nome || "Magnata"}
                  </div>
                </div>

                {selectedType === "Instagram" && (
                  <div className="flex border-2 border-black rounded-lg overflow-hidden bg-white">
                    <button
                      onClick={() => setIgMode("Feed")}
                      className={`flex-1 py-1.5 font-black text-[10px] uppercase ${igMode === "Feed" ? "bg-black text-white" : "bg-white text-black"}`}
                    >
                      Feed
                    </button>
                    <button
                      onClick={() => setIgMode("Story")}
                      className={`flex-1 py-1.5 font-black text-[10px] uppercase ${igMode === "Story" ? "bg-black text-white" : "bg-white text-black"}`}
                    >
                      Story
                    </button>
                  </div>
                )}

                <textarea
                  value={postText}
                  onChange={(e) => setPostText(e.target.value)}
                  placeholder="Escreva algo f*** aqui..."
                  className={neoInput + " h-24 italic"}
                />

                <div className="space-y-1">
                  <p className="text-[10px] font-black uppercase text-black opacity-60 italic">
                    URL da Mídia (IMG ou GIF):
                  </p>
                  <input
                    type="text"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://..."
                    className={neoInput}
                  />
                </div>

                <button
                  onClick={handlePost}
                  disabled={submitting || !postText.trim() || !activeArtist}
                  className="mt-2 p-4 bg-black text-white rounded-[20px] font-black uppercase italic tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50 shadow-[4px_4px_0px_#D0FF43]"
                >
                  {submitting ? "LANÇANDO..." : "LANÇAR AGORA"} <Send className="size-4" />
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* News Creation Modal */}
      {isNewsModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
          <motion.div
            initial={{ y: 200 }}
            animate={{ y: 0 }}
            exit={{ y: 200 }}
            className="bg-white border-[4px] border-black rounded-[30px] p-6 max-w-sm w-full shadow-[10px_10px_0px_#000] max-h-[90vh] overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black italic uppercase text-black">NOVA MATÉRIA</h2>
              <button
                onClick={() => setIsNewsModalOpen(false)}
                className="p-2 border-2 border-black rounded-full hover:bg-red-500 text-black transition-colors"
              >
                <X className="size-4 stroke-[3]" />
              </button>
            </div>

            <div className="grid gap-4">
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase text-black opacity-60 italic">Título da Matéria:</p>
                <input
                  type="text"
                  value={newsTitle}
                  onChange={(e) => setNewsTitle(e.target.value)}
                  placeholder="Manchete impactante..."
                  className={neoInput + " text-lg italic"}
                />
              </div>

              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase text-black opacity-60 italic">Conteúdo:</p>
                <textarea
                  value={newsContent}
                  onChange={(e) => setNewsContent(e.target.value)}
                  placeholder="O que está acontecendo?"
                  className={neoInput + " h-32 italic"}
                />
              </div>

              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase text-black opacity-60 italic">Imagem de Capa (URL):</p>
                <input
                  type="text"
                  value={newsImage}
                  onChange={(e) => setNewsImage(e.target.value)}
                  placeholder="https://..."
                  className={neoInput}
                />
              </div>

              <div className="p-3 bg-zinc-50 border-2 border-black border-dashed rounded-xl flex items-center gap-2">
                <div className="size-6 rounded-full bg-black/10 overflow-hidden">
                  {activeArtist?.foto ? (
                    <img
                      src={activeArtist.foto}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <UserCircle className="size-full opacity-20" />
                  )}
                </div>
                <p className="text-[10px] font-black uppercase opacity-60 italic">
                  Publicar como <span className="text-black">{activeArtist?.nome}</span>
                </p>
              </div>

              <button
                onClick={handleSaveNews}
                disabled={submitting || !newsTitle.trim() || !activeArtist}
                className="mt-4 p-4 bg-black text-[#D0FF43] rounded-[20px] font-black uppercase italic tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50 shadow-[4px_4px_0px_#D0FF43]"
              >
                {submitting ? "PUBLICANDO..." : "PUBLICAR NEWS"} <Send className="size-4" />
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <AnimatePresence>
        {/* 💡 MODAL DE CONFIGURAÇÃO DE PERFIL - Ajustado para items-center para evitar que o teclado esconda o input */}
        {isProfileModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="bg-white border-[4px] border-black rounded-[30px] p-6 max-w-sm w-full shadow-[10px_10px_0px_#000] max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-6">
                <div className="flex flex-col">
                  <h2 className="text-xl font-black italic uppercase text-black leading-none">
                    {editingProfileInfo?.rede}
                  </h2>
                  <p className="text-[10px] font-bold text-black opacity-60 uppercase italic">
                    {editingProfileInfo?.artista}
                  </p>
                </div>
                <button
                  onClick={() => setIsProfileModalOpen(false)}
                  className="p-2 border-2 border-black rounded-full hover:bg-red-500 text-black transition-colors"
                >
                  <X className="size-4 stroke-[3]" />
                </button>
              </div>

              <div className="grid gap-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-black uppercase text-black opacity-60 italic">Handle (Usuário):</p>
                  <input
                    type="text"
                    value={profileHandle}
                    onChange={(e) => setProfileHandle(e.target.value)}
                    placeholder="@nome"
                    className={neoInput}
                  />
                </div>

                <div className="space-y-1">
                  <p className="text-[10px] font-black uppercase text-black opacity-60 italic">
                    Seguindo (qtd. de pessoas que segue):
                  </p>
                  {/* 💡 Correção: type="text" com inputMode previne bugs do React/Navegador mobile */}
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={profileFollowing}
                    onChange={(e) => setProfileFollowing(e.target.value.replace(/\D/g, ""))}
                    placeholder="0"
                    className={neoInput}
                  />
                </div>

                <div className="p-3 bg-zinc-50 border-2 border-dashed border-black/20 rounded-xl text-[10px] font-bold text-black/60 italic leading-snug">
                  <span className="font-black uppercase text-black/80">Seguidores:</span> calculados automaticamente
                  pela coluna <span className="font-black">G</span> da aba{" "}
                  <span className="font-black">SOCIAL_PERFIS</span>. Atual:{" "}
                  <span className="font-black text-black">{Number(profileFollowers).toLocaleString("pt-BR")}</span>.
                </div>

                <div className="space-y-1">
                  <p className="text-[10px] font-black uppercase text-black opacity-60 italic">Foto de Perfil (URL):</p>
                  <div className="flex gap-2">
                    {profileAvatar && (
                      <div className="size-12 rounded-xl border-2 border-black overflow-hidden flex-shrink-0 bg-zinc-100">
                        <img
                          src={driveImg(profileAvatar)}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    )}
                    <input
                      type="text"
                      value={profileAvatar}
                      onChange={(e) => setProfileAvatar(e.target.value)}
                      placeholder="https://..."
                      className={neoInput}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-[10px] font-black uppercase text-black opacity-60 italic">Bio / Descrição:</p>
                  <textarea
                    value={profileBio}
                    onChange={(e) => setProfileBio(e.target.value)}
                    placeholder="Fale um pouco sobre o artista..."
                    className={neoInput + " h-20 italic"}
                  />
                </div>

                <button
                  onClick={handleSaveProfile}
                  disabled={submitting}
                  className="mt-2 p-4 bg-[#D0FF43] text-black rounded-[20px] font-black uppercase italic tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50 border-2 border-black shadow-[4px_4px_0px_#000]"
                >
                  {submitting ? "SALVANDO..." : "SALVAR PERFIL"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedNews && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md">
            <motion.div
              layoutId={selectedNews.id}
              className="bg-white text-black border-[4px] border-black rounded-[35px] max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col shadow-[20px_20px_0px_rgba(0,0,0,0.5)]"
            >
              <div className="relative h-64 flex-shrink-0">
                {selectedNews.imagem ? (
                  <img
                    src={selectedNews.imagem}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-[#3D8BFF]/20">
                    <Newspaper className="size-20 text-black/10" />
                  </div>
                )}
                <div className="absolute top-4 right-4">
                  <button
                    onClick={() => setSelectedNews(null)}
                    className="size-10 bg-black/50 backdrop-blur-md text-white rounded-full flex items-center justify-center border border-white/20 hover:bg-black transition-colors"
                  >
                    <X className="size-5" />
                  </button>
                </div>
                <div className="absolute bottom-6 left-6 right-6">
                  <span className="bg-[#D0FF43] text-black px-3 py-1 font-black italic text-[10px] uppercase rounded-lg border-2 border-black shadow-[3px_3px_0px_#000] mb-2 inline-block">
                    Flash News
                  </span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 pt-8 bg-zinc-50">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase text-black/40 mb-4 italic tracking-widest">
                  <span className="text-black/60">Por {selectedNews.autor}</span>
                  <span className="size-1 rounded-full bg-black/20" />
                  <span className="text-black/60">{new Date(selectedNews.data).toLocaleDateString("pt-BR")}</span>
                </div>
                <h2 className="text-3xl font-black uppercase italic leading-[0.9] text-black tracking-tight mb-8 drop-shadow-sm">
                  {selectedNews.titulo}
                </h2>
                <div className="prose prose-sm font-bold text-zinc-800 leading-relaxed whitespace-pre-wrap text-[13px] border-l-4 border-[#3D8BFF]/20 pl-4">
                  {selectedNews.conteudo}
                </div>
              </div>

              <div className="p-6 bg-zinc-50 border-t-2 border-black/5 flex justify-center">
                <button
                  onClick={() => setSelectedNews(null)}
                  className="px-8 py-3 bg-black text-white rounded-full font-black uppercase italic text-sm tracking-widest active:scale-95 transition-transform"
                >
                  Fechar Gazette
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCommentModalOpen && selectedPost && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="bg-white border-[4px] border-black rounded-[30px] p-6 max-w-md w-full shadow-[10px_10px_0px_#000] max-h-[90vh] flex flex-col"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black italic uppercase text-black">COMENS</h2>
                <button
                  onClick={() => setIsCommentModalOpen(false)}
                  className="p-2 border-2 border-black rounded-full hover:bg-red-500 text-black transition-colors"
                >
                  <X className="size-4 stroke-[3]" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto mb-4 space-y-4 pr-1">
                <div className="p-3 bg-[#F4F4F5] rounded-xl border-2 border-black/10">
                  <p className="text-[10px] font-black uppercase opacity-50 mb-1">{selectedPost.autor}</p>
                  <p className="text-sm font-bold text-black">{selectedPost.texto}</p>
                </div>

                <div className="space-y-4">
                  {comments.map((c, idx) => (
                    <div key={idx} className="flex gap-3">
                      <div className="size-8 rounded-full bg-[#FFD166] border-2 border-black flex items-center justify-center font-black text-[10px] flex-shrink-0 overflow-hidden">
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
                      <div className="flex-1">
                        <p className="text-[10px] font-black text-black leading-none">{c.autor}</p>
                        <p className="text-xs font-bold text-black opacity-80 mt-1">{c.texto}</p>
                      </div>
                    </div>
                  ))}
                  {comments.length === 0 && (
                    <p className="text-center font-bold text-black opacity-40 py-10">
                      Nenhum comentário por aqui ainda.
                    </p>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t-4 border-black">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder={activeArtist ? `Comentar como ${activeArtist.nome}...` : "Selecione um artista..."}
                    className={neoInput + " flex-1"}
                    onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
                  />
                  <button
                    onClick={handleAddComment}
                    disabled={submitting || !newComment.trim() || !activeArtist}
                    className="p-3 bg-black text-white rounded-xl border-2 border-black active:scale-90 transition-transform shadow-[2px_2px_0px_#D0FF43]"
                  >
                    <Send className="size-5" />
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
