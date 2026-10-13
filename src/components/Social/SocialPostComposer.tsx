// Formulário/composer REAL de criação de post do Social — extraído de
// src/routes/social.tsx (modal "Lançar Hype" + seletores de material/áudio)
// pra ser reutilizado por outras telas que também precisam publicar no
// Social pelo mesmo caminho real (mesmo backend, mesmo payload), em vez de
// duplicar um mini-formulário simplificado.
//
// Hoje usado por:
// - src/routes/social.tsx (uso original, "Lançar Hype")
// - src/components/EmpirePlay/GestaoPreSave.tsx (MissaoModal) — o pre-save
//   usa esse MESMO composer pra cumprir as missões de post social do dia;
//   no final das contas o post cai no mesmo Social de sempre. O pre-save só
//   dispara a confirmação da missão (completar-missao) DEPOIS que o post é
//   criado de verdade por aqui (onPosted).
//
// Qualquer ajuste no formulário real de post (novo campo, nova rede, nova
// trava de Stories etc.) deve ser feito aqui — nunca duplicado de volta num
// mini-form à parte.
import { useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import {
  Instagram,
  Twitter,
  Video,
  Plus,
  X,
  Image as ImageIcon,
  Send,
  Music2,
  Loader2,
  EyeOff,
  Eye,
  Shuffle,
  Disc,
  Music,
  Search,
  ChevronLeft,
} from "lucide-react";
import { api, resolveImg, driveVideo } from "@/lib/api";
import { useImageCrop } from "@/hooks/use-image-crop";
import { SmartImg } from "@/components/SmartImg";
import { haptic } from "@/lib/telegram";
import { RichTextToolbar } from "@/components/EmpirePlay/RichTextToolbar";

const MAX_IG_PHOTOS = 10;

export type SocialPostType = "Instagram" | "Twitter" | "TikTok";

// Mesma forma usada em social.tsx (PostAudio/PostMaterial) — mantidas aqui
// pra esse componente não depender de tipos privados da rota.
export type PostAudio = {
  titulo: string;
  artista: string;
  url: string;
  topicId: string;
  startSec: number;
  durationSec: number;
};

export type PostMaterial = {
  tipo: "musica" | "album";
  titulo: string;
  artista: string;
  capaUrl?: string;
  topicId: string;
};

export type SocialFolderType = "socialPosts" | "socialStories" | "socialAvatars" | "socialNews";

async function uploadToDrive(file: File, folderType: SocialFolderType): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("fileName", file.name);
    formData.append("folderType", folderType);
    const res = await fetch("/api/gestao/upload", { method: "POST", body: formData });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success && data?.data?.fileUrl) return data.data.fileUrl as string;
    toast.error(data?.error || "Falha ao enviar arquivo.");
    return null;
  } catch {
    toast.error("Falha ao enviar arquivo.");
    return null;
  }
}

// Proporção padrão de story (retangular em pé, igual Instagram/TikTok).
const STORY_ASPECT = 9 / 16;

// Recorta a imagem escolhida pro centro, na proporção de story — a pessoa
// escolhe qualquer foto e o app ajusta o enquadramento sozinho pro formato
// vertical padrão, em vez de subir a imagem crua (que podia sair cortada
// ou esticada errado dependendo da proporção original).
function cropImageToStoryRatio(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const srcRatio = img.width / img.height;
      let sx = 0,
        sy = 0,
        sw = img.width,
        sh = img.height;
      if (srcRatio > STORY_ASPECT) {
        sw = img.height * STORY_ASPECT;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / STORY_ASPECT;
        sy = (img.height - sh) / 2;
      }
      const targetH = Math.min(1920, sh);
      const canvas = document.createElement("canvas");
      canvas.height = targetH;
      canvas.width = targetH * STORY_ASPECT;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas indisponível."));
        return;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(new File([blob], file.name, { type: "image/jpeg" })) : reject(new Error("Falha ao recortar a imagem."))),
        "image/jpeg",
        0.9,
      );
    };
    img.onerror = () => reject(new Error("Não deu pra ler essa imagem."));
    img.src = URL.createObjectURL(file);
  });
}

// Vídeo de post/story sobe pro Drive via multipart/form-data — sem upload em
// partes/streaming, tem um teto real de tamanho (corpo de requisição do
// Cloudflare Worker). Essas checagens travam ANTES de tentar o upload, com
// mensagem explicando o que fazer.
const MAX_VIDEO_DURATION_SEC = 180;
const MAX_VIDEO_SIZE_MB = 95;

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(video.src);
      Number.isFinite(duration) ? resolve(duration) : reject(new Error("Duração inválida."));
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error("Não deu pra ler esse vídeo."));
    };
    video.src = URL.createObjectURL(file);
  });
}

// Validação antes do upload — devolve uma mensagem de erro (pra mostrar
// num toast) ou null se o vídeo está dentro do limite.
async function validarVideoAntesDeEnviar(file: File): Promise<string | null> {
  const tamanhoMB = file.size / (1024 * 1024);
  if (tamanhoMB > MAX_VIDEO_SIZE_MB) {
    return `Esse vídeo tem ${tamanhoMB.toFixed(0)}MB — o máximo é ${MAX_VIDEO_SIZE_MB}MB. Grave em qualidade menor ou corte um trecho mais curto.`;
  }
  try {
    const duracao = await getVideoDuration(file);
    if (duracao > MAX_VIDEO_DURATION_SEC) {
      return `Esse vídeo tem ${Math.round(duracao)}s — o máximo é ${MAX_VIDEO_DURATION_SEC}s. Corte um trecho mais curto antes de enviar.`;
    }
  } catch {
    // Não deu pra ler a duração (formato incomum) — deixa passar, o
    // tamanho em MB já é uma rede de segurança razoável sozinha.
  }
  return null;
}

function normalizeComparisonLocal(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const inputCls =
  "w-full bg-white/5 border border-white/10 rounded-2xl p-3.5 text-base font-medium focus:outline-none focus:border-primary/50 transition-colors placeholder:text-muted-foreground/60";

export interface SocialPostComposerActiveArtist {
  nome: string;
  foto?: string;
}

export interface SocialPostComposerProps {
  telegramId: string;
  // Quando informado, trava o "postar como" nesse artista (sem seletor de
  // artista nem modo Blackout) — usado pelo pre-save, onde a missão já é
  // do artista daquela campanha.
  fixedArtist?: SocialPostComposerActiveArtist;
  // Quando `fixedArtist` não é informado, o composer usa o artista ativo
  // (ex: página Social, onde a pessoa já escolheu "postar como" antes de
  // abrir o composer).
  activeArtist?: SocialPostComposerActiveArtist;
  // Restringe os tipos de post oferecidos no primeiro passo (ex: missão
  // "Desafio de Som"/"Making Of" do pre-save sempre é TikTok — não faz
  // sentido oferecer Instagram/Twitter nesse caso).
  allowedTypes?: SocialPostType[];
  initialType?: SocialPostType | null;
  initialIgMode?: "Feed" | "Story";
  // Nome fictício já usado quando o post sendo editado foi publicado em
  // Blackout Mode (ver openEditPost em social.tsx) — abre o composer já no
  // modo certo em vez de voltar pro Normal sem a pessoa pedir.
  initialBlackoutAutor?: string;
  profiles: { artista: string; rede: string; handle?: string; avatar_url?: string; avatar?: string; foto?: string }[];
  // Post existente (edição) — só suportado no uso original do Social.
  editingPost?: {
    id: string;
    texto: string;
    media_url?: string;
    media_tipo?: string;
  } | null;
  onClose: () => void;
  // Disparado depois que o post é criado/editado com sucesso pelo caminho
  // real (`salvarPostSocial`/`editarPostSocial`) — quem chama decide o que
  // fazer a seguir (recarregar feed, marcar missão como completa etc.).
  onPosted: (result: { id: string; payload: Record<string, unknown> }) => void;
}

export function SocialPostComposer({
  telegramId,
  fixedArtist,
  activeArtist: activeArtistProp,
  allowedTypes,
  initialType = null,
  initialIgMode = "Feed",
  initialBlackoutAutor,
  profiles,
  editingPost = null,
  onClose,
  onPosted,
}: SocialPostComposerProps) {
  const driveImg = resolveImg;
  const activeArtist = fixedArtist || activeArtistProp || null;

  const [selectedType, setSelectedType] = useState<SocialPostType | null>(initialType);
  const [igMode, setIgMode] = useState<"Feed" | "Story">(initialIgMode);
  const [postText, setPostText] = useState(editingPost?.texto || "");
  const [imageUrl, setImageUrl] = useState(editingPost?.media_url || "");
  const [mediaTipo, setMediaTipo] = useState<"imagem" | "video">(
    (editingPost?.media_tipo as "imagem" | "video") || "imagem",
  );
  const [uploadingImage, setUploadingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [attachedMaterial, setAttachedMaterial] = useState<PostMaterial | null>(null);
  const [isMaterialPickerOpen, setIsMaterialPickerOpen] = useState(false);
  const [materialPickerTipo, setMaterialPickerTipo] = useState<"musica" | "album">("musica");
  const [materialOptions, setMaterialOptions] = useState<any[]>([]);
  const [loadingMaterialOptions, setLoadingMaterialOptions] = useState(false);
  const [materialSearchQuery, setMaterialSearchQuery] = useState("");
  const [albumTrackPicker, setAlbumTrackPicker] = useState<any | null>(null);

  const [extraImageUrls, setExtraImageUrls] = useState<string[]>([]);
  const [uploadingExtraImage, setUploadingExtraImage] = useState(false);
  const [attachedAudio, setAttachedAudio] = useState<PostAudio | null>(null);
  const [isAudioPickerOpen, setIsAudioPickerOpen] = useState(false);
  const MAX_AUDIO_SEC = selectedType === "TikTok" ? 15 : 10;

  const [storyMusicMode, setStoryMusicMode] = useState(false);
  const [storyComSom, setStoryComSom] = useState(true);

  // Blackout mode (postar sob pseudônimo) só faz sentido quando há um
  // artista "próprio" podendo ser escondido — sem sentido pra missão de
  // pre-save, que já tem o artista fixo da campanha.
  const [blackoutMode, setBlackoutMode] = useState(!!initialBlackoutAutor);
  const [blackoutUsername, setBlackoutUsername] = useState(initialBlackoutAutor || "");

  const postTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const { cropModal: postMediaCropModal, cropImage: cropPostMedia } = useImageCrop({
    targetW: 1080,
    targetH: 1080,
    shape: "square",
    title: "Editar imagem do post",
  });
  const { cropModal: extraPhotoCropModal, cropImage: cropExtraPhoto } = useImageCrop({
    targetW: 1080,
    targetH: 1080,
    shape: "square",
    title: "Editar foto",
  });

  function close() {
    onClose();
  }

  async function loadMaterialOptions(tipo: "musica" | "album", query: string = "") {
    setLoadingMaterialOptions(true);
    try {
      if (tipo === "musica") {
        const res = await fetch(`/api/empire-play/musicas${query ? `?q=${encodeURIComponent(query)}` : ""}`);
        const json = await res.json().catch(() => null);
        const items = (json?.success ? json.data || [] : []).map((it: any) => ({
          id: it.id,
          titulo: it.title,
          artista: it.artist,
          capaUrl: it.coverUrl,
          audioUrl: it.audioUrl,
          topicId: it.telegramTopicId,
        }));
        setMaterialOptions(items);
      } else {
        const res = await fetch("/api/empire-play/albuns");
        const json = await res.json().catch(() => null);
        let items = (json?.success ? json.data || [] : []) as any[];
        const q = normalizeComparisonLocal(query);
        if (q) {
          items = items.filter((a) => normalizeComparisonLocal(`${a.title} ${a.artist}`).includes(q));
        }
        setMaterialOptions(
          items.map((it) => ({
            id: it.id,
            titulo: it.title,
            artista: it.artist,
            capaUrl: it.coverUrl,
            topicId: it.id?.replace(/^album_/, ""),
            tracks: (it.tracks || []).map((t: any) => ({
              id: t.id,
              titulo: t.title,
              artista: t.artist,
              capaUrl: t.coverUrl || it.coverUrl,
              audioUrl: t.audioUrl,
              topicId: t.telegramTopicId,
            })),
          })),
        );
      }
    } catch {
      setMaterialOptions([]);
    } finally {
      setLoadingMaterialOptions(false);
    }
  }

  function openMaterialPicker() {
    haptic.selection();
    setIsMaterialPickerOpen(true);
    setMaterialPickerTipo("musica");
    setMaterialSearchQuery("");
    setAlbumTrackPicker(null);
    loadMaterialOptions("musica", "");
  }

  function pickMaterial(item: any, tipo: "musica" | "album") {
    if (tipo === "album" && storyMusicMode) {
      if (!item.tracks?.length) {
        toast.error("Esse álbum não tem faixas com áudio cadastrado.");
        return;
      }
      haptic.selection();
      setAlbumTrackPicker(item);
      return;
    }

    if (!item.topicId) {
      toast.error("Essa faixa não tem um tópico vinculado no catálogo — não dá pra compartilhar.");
      return;
    }
    haptic.selection();
    setAttachedMaterial({
      tipo,
      titulo: item.titulo,
      artista: item.artista || "",
      capaUrl: item.capaUrl || undefined,
      topicId: String(item.topicId),
    });
    if (storyMusicMode && tipo === "musica" && item.audioUrl) {
      setAttachedAudio({
        titulo: item.titulo,
        artista: item.artista || "",
        url: item.audioUrl,
        topicId: String(item.topicId),
        startSec: 0,
        durationSec: MAX_AUDIO_SEC,
      });
    }
    setIsMaterialPickerOpen(false);
    setAlbumTrackPicker(null);
  }

  function pickAlbumTrack(track: any) {
    if (!albumTrackPicker || !track.audioUrl) return;
    haptic.selection();
    setAttachedMaterial({
      tipo: "album",
      titulo: albumTrackPicker.titulo,
      artista: albumTrackPicker.artista || "",
      capaUrl: albumTrackPicker.capaUrl || undefined,
      topicId: String(albumTrackPicker.topicId),
    });
    setAttachedAudio({
      titulo: `${albumTrackPicker.titulo} — ${track.titulo}`,
      artista: track.artista || "",
      url: track.audioUrl,
      topicId: String(track.topicId || albumTrackPicker.topicId),
      startSec: 0,
      durationSec: MAX_AUDIO_SEC,
    });
    setIsMaterialPickerOpen(false);
    setAlbumTrackPicker(null);
  }

  function openAudioPicker() {
    haptic.selection();
    setIsAudioPickerOpen(true);
    setMaterialSearchQuery("");
    loadMaterialOptions("musica", "");
  }

  function pickAudio(item: any) {
    if (!item.audioUrl) {
      toast.error("Essa música não tem áudio cadastrado.");
      return;
    }
    haptic.selection();
    setAttachedAudio({
      titulo: item.titulo,
      artista: item.artista || "",
      url: item.audioUrl,
      topicId: String(item.topicId || ""),
      startSec: 0,
      durationSec: MAX_AUDIO_SEC,
    });
    setIsAudioPickerOpen(false);
  }

  function gerarNomeBlackout() {
    const adjetivos = ["fã", "insider", "leak", "anônimo", "ghost", "fonte"];
    const adjetivo = adjetivos[Math.floor(Math.random() * adjetivos.length)];
    const numero = Math.floor(1000 + Math.random() * 9000);
    setBlackoutUsername(`${adjetivo}_${numero}`);
  }

  async function handlePost() {
    const isStoryDraft = selectedType === "Instagram" && igMode === "Story";
    const isStoryMusicDraft = isStoryDraft && storyMusicMode;
    const isTwitterMaterial = selectedType === "Twitter" && !!attachedMaterial;
    const hasContent = isStoryMusicDraft
      ? !!attachedMaterial
      : isStoryDraft
        ? !!(postText.trim() || imageUrl)
        : isTwitterMaterial
          ? true
          : !!postText.trim();
    if (!selectedType || !hasContent || !activeArtist || submitting) return;
    if (blackoutMode && !blackoutUsername.trim()) return;

    setSubmitting(true);
    const autorFinal = blackoutMode ? blackoutUsername.trim() : activeArtist.nome;

    try {
      if (editingPost) {
        const res = await (api as any).editarPostSocial(
          editingPost.id,
          postText,
          imageUrl,
          telegramId,
          autorFinal,
          mediaTipo,
        );
        if (res.ok) {
          haptic.success();
          onPosted({ id: editingPost.id, payload: { texto: postText, media_url: imageUrl, media_tipo: mediaTipo } });
        } else {
          toast.error(res.error || "Não deu pra salvar as alterações.");
        }
        return;
      }

      const payload: Record<string, unknown> = {
        tipo: selectedType,
        subtipo: selectedType === "Instagram" ? igMode : undefined,
        autor: autorFinal,
        texto: postText,
        media_url: isStoryMusicDraft ? attachedMaterial?.capaUrl || "" : imageUrl,
        media_tipo: mediaTipo,
        analytics: { likes: 0, comments: 0, shares: 0 },
        ...(selectedType === "Twitter" && attachedMaterial ? { material: attachedMaterial } : {}),
        ...(isStoryMusicDraft && attachedMaterial ? { material: attachedMaterial } : {}),
        ...(selectedType === "Instagram" && igMode === "Feed" && extraImageUrls.length
          ? { extra_media: extraImageUrls }
          : {}),
        ...((selectedType === "Instagram" && igMode === "Feed") || selectedType === "TikTok"
          ? attachedAudio
            ? { audio: attachedAudio }
            : {}
          : {}),
        ...(isStoryMusicDraft && storyComSom && attachedAudio ? { audio: attachedAudio } : {}),
      };

      const res = await (api as any).salvarPostSocial(payload, telegramId);
      if (res.ok) {
        haptic.success();
        onPosted({ id: res.id || `temp_${Date.now()}`, payload });
      } else {
        toast.error(res.error || "Não deu pra publicar. Tenta de novo.");
      }
    } catch (err) {
      console.error("Erro ao postar:", err);
      toast.error("Não deu pra publicar. Tenta de novo.");
    } finally {
      setSubmitting(false);
    }
  }

  const tipoOptions: { tipo: SocialPostType; label: string; icon: React.ReactElement }[] = (
    [
      { tipo: "Instagram", label: "Instagram", icon: <Instagram className="text-[#f472b6]" /> },
      { tipo: "Twitter", label: "Twitter (X)", icon: <Twitter className="text-[#1d9bf0]" /> },
      { tipo: "TikTok", label: "TikTok", icon: <Video className="text-[#25F4EE]" /> },
    ] as { tipo: SocialPostType; label: string; icon: React.ReactElement }[]
  ).filter((o) => !allowedTypes || allowedTypes.includes(o.tipo));

  return (
    <>
      <AnimatePresence>
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/70 backdrop-blur-sm" onClick={close}>
          <motion.div
            initial={{ y: 200 }}
            animate={{ y: 0 }}
            exit={{ y: 200 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card border-t sm:border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] p-5 sm:p-6 max-w-sm w-full shadow-2xl max-h-[90dvh] overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black uppercase">{editingPost ? "Editar post" : "Lançar Hype"}</h2>
              <button
                onClick={close}
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
                {tipoOptions.map((o) => (
                  <button
                    key={o.tipo}
                    onClick={() => {
                      haptic.selection();
                      setSelectedType(o.tipo);
                    }}
                    className="flex items-center gap-4 p-4 min-h-14 rounded-2xl bg-white/5 border border-white/10 font-black uppercase text-sm active:scale-95 transition-transform"
                  >
                    {o.icon} {o.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid gap-4">
                {!fixedArtist && (
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
                )}

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
                        <SmartImg
                          src={activeArtist?.foto}
                          alt=""
                          className="w-full h-full object-cover"
                          fallback={<>{activeArtist?.nome?.[0]}</>}
                        />
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

                {selectedType === "Instagram" && igMode === "Story" && (
                  <div className="flex bg-white/5 border border-white/10 rounded-xl overflow-hidden p-1 gap-1">
                    <button
                      onClick={() => {
                        setStoryMusicMode(false);
                        setAttachedMaterial(null);
                        setAttachedAudio(null);
                      }}
                      className={`flex-1 py-2 min-h-9 rounded-lg font-black text-[11px] uppercase transition-all ${!storyMusicMode ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                    >
                      Foto/Vídeo
                    </button>
                    <button
                      onClick={() => {
                        setStoryMusicMode(true);
                        setImageUrl("");
                      }}
                      className={`flex-1 py-2 min-h-9 rounded-lg font-black text-[11px] uppercase transition-all ${storyMusicMode ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                    >
                      <Music2 className="size-3.5 inline mr-1" /> Música
                    </button>
                  </div>
                )}

                {selectedType === "Instagram" && igMode === "Story" && storyMusicMode && (
                  <div className="space-y-2">
                    {attachedMaterial ? (
                      <div className="rounded-2xl border border-white/15 bg-white/[0.03] p-3 space-y-3">
                        <div className="flex items-center gap-2.5">
                          <div className="size-11 shrink-0 rounded-lg overflow-hidden bg-secondary">
                            {attachedMaterial.capaUrl && (
                              <SmartImg src={attachedMaterial.capaUrl} alt="" className="w-full h-full object-cover" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-black text-xs truncate">{attachedMaterial.titulo}</p>
                            {attachedMaterial.tipo === "album" && attachedAudio && (
                              <p className="text-[10px] text-muted-foreground font-bold truncate">
                                Faixa: {attachedAudio.titulo.split(" — ").slice(1).join(" — ")}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setAttachedMaterial(null);
                              setAttachedAudio(null);
                            }}
                            className="text-muted-foreground hover:text-white"
                          >
                            <X className="size-4" />
                          </button>
                        </div>

                        <div className="flex bg-white/5 border border-white/10 rounded-xl overflow-hidden p-1 gap-1">
                          <button
                            onClick={() => setStoryComSom(true)}
                            className={`flex-1 py-1.5 min-h-8 rounded-lg font-black text-[10px] uppercase transition-all ${storyComSom ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                          >
                            Com som
                          </button>
                          <button
                            onClick={() => setStoryComSom(false)}
                            className={`flex-1 py-1.5 min-h-8 rounded-lg font-black text-[10px] uppercase transition-all ${!storyComSom ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                          >
                            Sem som
                          </button>
                        </div>

                        {storyComSom && attachedAudio && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground font-bold uppercase">
                              <span>Início: {attachedAudio.startSec}s</span>
                              <span>Duração: {attachedAudio.durationSec}s</span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={300}
                              step={1}
                              value={attachedAudio.startSec}
                              onChange={(e) =>
                                setAttachedAudio((prev) => (prev ? { ...prev, startSec: Number(e.target.value) } : prev))
                              }
                              className="w-full"
                            />
                            <input
                              type="range"
                              min={1}
                              max={MAX_AUDIO_SEC}
                              step={1}
                              value={attachedAudio.durationSec}
                              onChange={(e) =>
                                setAttachedAudio((prev) => (prev ? { ...prev, durationSec: Number(e.target.value) } : prev))
                              }
                              className="w-full"
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={openMaterialPicker}
                        className={inputCls + " flex items-center justify-center gap-2 text-center"}
                      >
                        <Music2 className="size-4" /> Escolher música ou álbum
                      </button>
                    )}
                  </div>
                )}

                <RichTextToolbar textareaRef={postTextareaRef} value={postText} onChange={setPostText} />
                <textarea
                  ref={postTextareaRef}
                  value={postText}
                  onChange={(e) => setPostText(e.target.value)}
                  placeholder={
                    selectedType === "Instagram" && igMode === "Story"
                      ? "Legenda (opcional)..."
                      : selectedType === "Twitter" && attachedMaterial
                        ? "Comentário (opcional)..."
                        : "Escreva algo f*** aqui... (use #hashtag, **negrito**, *itálico*)"
                  }
                  className={inputCls + " h-24 resize-none"}
                />

                {selectedType === "Twitter" && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black uppercase text-muted-foreground">
                      Compartilhar música/álbum:
                    </p>
                    {attachedMaterial ? (
                      <div className="flex items-stretch rounded-2xl border border-white/15 bg-white/[0.03] overflow-hidden">
                        <div className="size-14 shrink-0 bg-secondary flex items-center justify-center overflow-hidden">
                          {attachedMaterial.capaUrl ? (
                            <SmartImg
                              src={attachedMaterial.capaUrl}
                              alt=""
                              className="w-full h-full object-cover"
                              fallback={
                                attachedMaterial.tipo === "album" ? (
                                  <Disc className="size-5 text-muted-foreground" />
                                ) : (
                                  <Music className="size-5 text-muted-foreground" />
                                )
                              }
                            />
                          ) : attachedMaterial.tipo === "album" ? (
                            <Disc className="size-5 text-muted-foreground" />
                          ) : (
                            <Music className="size-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-center px-3 py-1.5">
                          <span className="font-black text-xs truncate">{attachedMaterial.titulo}</span>
                          <span className="text-[10px] text-muted-foreground font-bold truncate">
                            {attachedMaterial.tipo === "album" ? "Álbum" : "Música"} de{" "}
                            {attachedMaterial.artista || activeArtist?.nome}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAttachedMaterial(null)}
                          className="w-11 shrink-0 grid place-items-center text-muted-foreground hover:text-white"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={openMaterialPicker}
                        className={inputCls + " flex items-center justify-center gap-2 text-center"}
                      >
                        <Music2 className="size-4" /> Anexar música ou álbum
                      </button>
                    )}
                  </div>
                )}

                {!(selectedType === "Instagram" && igMode === "Story" && storyMusicMode) && (
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
                        accept={selectedType === "TikTok" ? "video/*" : "image/*,video/*"}
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file) return;
                          const isVideo = file.type.startsWith("video/");
                          if (isVideo) {
                            const erro = await validarVideoAntesDeEnviar(file);
                            if (erro) {
                              toast.error(erro);
                              return;
                            }
                          }
                          const isStory = selectedType === "Instagram" && igMode === "Story";
                          const folderType: SocialFolderType = isStory ? "socialStories" : "socialPosts";
                          let fileToUpload: File = file;
                          if (!isVideo) {
                            if (isStory) {
                              fileToUpload = await cropImageToStoryRatio(file).catch(() => file);
                            } else {
                              const cropped = await cropPostMedia(file);
                              if (!cropped) return;
                              fileToUpload = cropped;
                            }
                          }
                          setUploadingImage(true);
                          const url = await uploadToDrive(fileToUpload, folderType);
                          if (url) {
                            setImageUrl(url);
                            setMediaTipo(isVideo ? "video" : "imagem");
                          }
                          setUploadingImage(false);
                        }}
                      />
                    </label>
                  </div>
                )}

                {selectedType === "Instagram" && igMode === "Feed" && mediaTipo === "imagem" && imageUrl && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black uppercase text-muted-foreground">
                      Mais fotos ({extraImageUrls.length + 1}/{MAX_IG_PHOTOS}):
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {extraImageUrls.map((url, idx) => (
                        <div key={idx} className="relative aspect-square rounded-xl overflow-hidden bg-secondary border border-white/10">
                          <img src={driveImg(url)} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          <button
                            type="button"
                            onClick={() => setExtraImageUrls((prev) => prev.filter((_, i) => i !== idx))}
                            className="absolute top-1 right-1 size-5 rounded-full bg-black/70 grid place-items-center"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                      {extraImageUrls.length + 1 < MAX_IG_PHOTOS && (
                        <label
                          className={
                            "aspect-square rounded-xl border border-dashed border-white/20 flex items-center justify-center cursor-pointer text-muted-foreground " +
                            (uploadingExtraImage ? "opacity-60 pointer-events-none" : "")
                          }
                        >
                          {uploadingExtraImage ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-5" />}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              e.target.value = "";
                              if (!file) return;
                              const cropped = await cropExtraPhoto(file);
                              if (!cropped) return;
                              setUploadingExtraImage(true);
                              const url = await uploadToDrive(cropped, "socialPosts");
                              if (url) setExtraImageUrls((prev) => [...prev, url]);
                              setUploadingExtraImage(false);
                            }}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                )}

                {((selectedType === "Instagram" && igMode === "Feed") || selectedType === "TikTok") && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black uppercase text-muted-foreground">
                      {selectedType === "TikTok"
                        ? `Música por cima do vídeo (opcional, até ${MAX_AUDIO_SEC}s):`
                        : `Música na publicação (opcional, até ${MAX_AUDIO_SEC}s):`}
                    </p>
                    {attachedAudio ? (
                      <div className="rounded-2xl border border-white/15 bg-white/[0.03] p-3 space-y-2.5">
                        <div className="flex items-center gap-2.5">
                          <Music2 className="size-4 text-primary shrink-0" />
                          <span className="font-black text-xs truncate flex-1">{attachedAudio.titulo}</span>
                          <button type="button" onClick={() => setAttachedAudio(null)} className="text-muted-foreground hover:text-white">
                            <X className="size-4" />
                          </button>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground font-bold uppercase">
                            <span>Início: {attachedAudio.startSec}s</span>
                            <span>Duração: {attachedAudio.durationSec}s</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={300}
                            step={1}
                            value={attachedAudio.startSec}
                            onChange={(e) =>
                              setAttachedAudio((prev) => (prev ? { ...prev, startSec: Number(e.target.value) } : prev))
                            }
                            className="w-full"
                          />
                          <input
                            type="range"
                            min={1}
                            max={MAX_AUDIO_SEC}
                            step={1}
                            value={attachedAudio.durationSec}
                            onChange={(e) =>
                              setAttachedAudio((prev) => (prev ? { ...prev, durationSec: Number(e.target.value) } : prev))
                            }
                            className="w-full"
                          />
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={openAudioPicker}
                        className={inputCls + " flex items-center justify-center gap-2 text-center"}
                      >
                        <Music2 className="size-4" /> Escolher música
                      </button>
                    )}
                  </div>
                )}

                <button
                  onClick={handlePost}
                  disabled={
                    submitting ||
                    !(selectedType === "Instagram" && igMode === "Story" && storyMusicMode
                      ? attachedMaterial
                      : selectedType === "Instagram" && igMode === "Story"
                        ? postText.trim() || imageUrl
                        : selectedType === "Twitter" && attachedMaterial
                          ? true
                          : postText.trim()) ||
                    !activeArtist ||
                    (blackoutMode && !blackoutUsername.trim())
                  }
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
      </AnimatePresence>

      {/* Seletor de música/álbum do catálogo (compartilhar no Twitter / Story de música) */}
      <AnimatePresence>
        {isMaterialPickerOpen && (
          <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ y: 200 }}
              animate={{ y: 0 }}
              exit={{ y: 200 }}
              className="bg-card border-t sm:border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] p-5 sm:p-6 max-w-sm w-full shadow-2xl max-h-[85dvh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-black uppercase">
                  {albumTrackPicker ? "Escolher faixa" : "Anexar material"}
                </h2>
                <button
                  onClick={() => setIsMaterialPickerOpen(false)}
                  className="size-9 shrink-0 rounded-full bg-white/5 border border-white/10 grid place-items-center active:scale-90 transition-transform"
                >
                  <X className="size-4" />
                </button>
              </div>

              {albumTrackPicker ? (
                <div className="grid gap-2">
                  <button
                    onClick={() => setAlbumTrackPicker(null)}
                    className="flex items-center gap-1.5 text-[11px] font-black uppercase text-muted-foreground mb-1"
                  >
                    <ChevronLeft className="size-3.5" /> {albumTrackPicker.titulo}
                  </button>
                  {albumTrackPicker.tracks
                    .filter((t: any) => t.audioUrl)
                    .map((t: any) => (
                      <button
                        key={t.id}
                        onClick={() => pickAlbumTrack(t)}
                        className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/5 border border-white/10 text-left active:scale-[0.98] transition-transform"
                      >
                        <div className="size-11 shrink-0 rounded-lg overflow-hidden bg-secondary flex items-center justify-center">
                          {t.capaUrl ? (
                            <SmartImg src={t.capaUrl} alt="" className="w-full h-full object-cover" fallback={<Music className="size-4 text-muted-foreground" />} />
                          ) : (
                            <Music className="size-4 text-muted-foreground" />
                          )}
                        </div>
                        <span className="font-bold text-sm truncate">{t.titulo}</span>
                      </button>
                    ))}
                </div>
              ) : (
                <>
                  <div className="flex bg-white/5 border border-white/10 rounded-xl overflow-hidden p-1 gap-1 mb-3">
                    <button
                      onClick={() => {
                        setMaterialPickerTipo("musica");
                        loadMaterialOptions("musica", materialSearchQuery);
                      }}
                      className={`flex-1 py-2 min-h-9 rounded-lg font-black text-[11px] uppercase transition-all ${materialPickerTipo === "musica" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                    >
                      Músicas
                    </button>
                    <button
                      onClick={() => {
                        setMaterialPickerTipo("album");
                        loadMaterialOptions("album", materialSearchQuery);
                      }}
                      className={`flex-1 py-2 min-h-9 rounded-lg font-black text-[11px] uppercase transition-all ${materialPickerTipo === "album" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                    >
                      Álbuns
                    </button>
                  </div>

                  <div className="relative mb-4">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={materialSearchQuery}
                      onChange={(e) => {
                        const q = e.target.value;
                        setMaterialSearchQuery(q);
                        loadMaterialOptions(materialPickerTipo, q);
                      }}
                      placeholder="Buscar por artista ou título..."
                      className={inputCls + " pl-10"}
                    />
                  </div>

                  {loadingMaterialOptions ? (
                    <div className="py-10 flex items-center justify-center">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : materialOptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground font-medium text-center py-10">
                      Nenhum {materialPickerTipo === "album" ? "álbum" : "música"} encontrado.
                    </p>
                  ) : (
                    <div className="grid gap-2">
                      {materialOptions.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => pickMaterial(item, materialPickerTipo)}
                          className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/5 border border-white/10 text-left active:scale-[0.98] transition-transform"
                        >
                          <div className="size-11 shrink-0 rounded-lg overflow-hidden bg-secondary flex items-center justify-center">
                            {item.capaUrl ? (
                              <SmartImg
                                src={item.capaUrl}
                                alt=""
                                className="w-full h-full object-cover"
                                fallback={
                                  materialPickerTipo === "album" ? (
                                    <Disc className="size-4 text-muted-foreground" />
                                  ) : (
                                    <Music className="size-4 text-muted-foreground" />
                                  )
                                }
                              />
                            ) : materialPickerTipo === "album" ? (
                              <Disc className="size-4 text-muted-foreground" />
                            ) : (
                              <Music className="size-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-sm truncate">{item.titulo}</p>
                            <p className="text-[10px] text-muted-foreground font-bold truncate">{item.artista}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Seletor de música pra tocar por cima da publicação do Instagram/TikTok */}
      <AnimatePresence>
        {isAudioPickerOpen && (
          <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ y: 200 }}
              animate={{ y: 0 }}
              exit={{ y: 200 }}
              className="bg-card border-t sm:border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] p-5 sm:p-6 max-w-sm w-full shadow-2xl max-h-[85dvh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-black uppercase">Escolher música</h2>
                <button
                  onClick={() => setIsAudioPickerOpen(false)}
                  className="size-9 shrink-0 rounded-full bg-white/5 border border-white/10 grid place-items-center active:scale-90 transition-transform"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="relative mb-4">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type="text"
                  value={materialSearchQuery}
                  onChange={(e) => {
                    const q = e.target.value;
                    setMaterialSearchQuery(q);
                    loadMaterialOptions("musica", q);
                  }}
                  placeholder="Buscar por artista ou título..."
                  className={inputCls + " pl-10"}
                />
              </div>

              {loadingMaterialOptions ? (
                <div className="py-10 flex items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : materialOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground font-medium text-center py-10">
                  Nenhuma música encontrada.
                </p>
              ) : (
                <div className="grid gap-2">
                  {materialOptions.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => pickAudio(item)}
                      className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/5 border border-white/10 text-left active:scale-[0.98] transition-transform"
                    >
                      <div className="size-11 shrink-0 rounded-lg overflow-hidden bg-secondary flex items-center justify-center">
                        {item.capaUrl ? (
                          <SmartImg src={item.capaUrl} alt="" className="w-full h-full object-cover" fallback={<Music className="size-4 text-muted-foreground" />} />
                        ) : (
                          <Music className="size-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-sm truncate">{item.titulo}</p>
                        <p className="text-[10px] text-muted-foreground font-bold truncate">{item.artista}</p>
                      </div>
                      {!item.audioUrl && (
                        <span className="text-[9px] font-black uppercase text-muted-foreground shrink-0">Sem áudio</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {postMediaCropModal}
      {extraPhotoCropModal}
    </>
  );
}
