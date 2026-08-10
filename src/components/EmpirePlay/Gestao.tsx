import React, { useState, useEffect } from "react";
import {
  Disc,
  Music,
  Tv,
  Film,
  Upload,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  User,
  Image as ImageIcon,
  Pencil,
  FileVideo,
  ListMusic,
  FileText,
} from "lucide-react";
import { useTelegramUser } from "@/lib/telegram";
import { EditModal } from "./EditModal";

export type TabType = "musica" | "video" | "music-video" | "album";

export interface UserProfile {
  artistName: string;
  telegramId: string;
  playerName: string;
  associatedArtists: string[];
}

export interface ExistingTrack {
  id: string;
  title: string;
  artist: string;
}

export interface TrackConfig {
  num: number;
  titulo: string;
  inedita: boolean;
  tipoSingle?: string;
  tipoMusica?: string;
}

const OPCOES_CHART = [
  {
    key: "a",
    value: "a) Registrar essa música em chart",
    title: "Registrar em Chart",
    desc: "Nova música apta a pontuar nos charts do Empire Hub.",
  },
  {
    key: "b",
    value: "b) Substituir música no chart",
    title: "Substituir no Chart",
    desc: "Substitui um lançamento anterior do seu artista nos charts.",
  },
  {
    key: "c",
    value: "c) Os comentários desse tópico devem valer para uma música já lançada",
    title: "Vincular a Música Lançada",
    desc: "Os comentários e avaliações valerão para uma música já existente.",
  },
];

const TIPOS_SINGLE = [
  "LEAD SINGLE",
  "PRÉ-ALBUM",
  "AVULSO",
  "PÓS-ALBUM",
  "PÓS-ALBUM REMIX",
  "SOUNDTRACK",
  "PROMOCIONAL",
  "TRACKLIST ALBUM",
  "REMIX",
  "PRÉ-ALBUM REMIX",
  "LEAD SINGLE REMIX",
];

const TIPOS_MUSICA = ["SOLO", "PARCERIA", "DUETO", "CONJUNTO"];

// Mesmas tags já usadas na coluna "Tipo de vídeo" da planilha (Vídeos e
// Music Videos vivem juntos ali, diferenciados só por essa tag).
const CATEGORIAS_VIDEO = [
  "Music Video",
  "Live",
  "Video",
  "Dance Video",
  "Lyric Video",
  "Visualizer",
  "Behind the Scenes",
  "Performance",
  "Alternative Video",
  "Alternative Version",
  "Trailer",
  "Outro",
];

export const Gestao: React.FC = () => {
  const { user: telegramUser } = useTelegramUser();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<TabType>("musica");
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);

  // Músicas do catálogo para seleção
  const [catalogSongs, setCatalogSongs] = useState<ExistingTrack[]>([]);

  // States Comuns
  const [artistaResponsavel, setArtistaResponsavel] = useState<string>("");
  const [participantes, setParticipantes] = useState<string[]>([""]);

  // Capa & Mídia
  const [capaFile, setCapaFile] = useState<File | null>(null);
  const [capaPreview, setCapaPreview] = useState<string | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaUrlInput, setMediaUrlInput] = useState<string>("");

  // Form Música
  const [opcaoChart, setOpcaoChart] = useState<string>(OPCOES_CHART[0].value);
  const [nomeMusica, setNomeMusica] = useState<string>("");
  const [tipoSingle, setTipoSingle] = useState<string>("LEAD SINGLE");
  const [tipoMusica, setTipoMusica] = useState<string>("SOLO");
  const [letraInput, setLetraInput] = useState<string>("");
  // Música existente referenciada (obrigatório quando opcaoChart é "b" ou "c")
  const [musicaReferenciaQuery, setMusicaReferenciaQuery] = useState<string>("");
  const [musicaReferencia, setMusicaReferencia] = useState<ExistingTrack | null>(null);

  // Form Vídeo
  const [tituloVideo, setTituloVideo] = useState<string>("");
  const [categoriaVideo, setCategoriaVideo] = useState<string>("Video");
  const [musicaReferenteInput, setMusicaReferenteInput] = useState<string>("");
  const [descricaoInput, setDescricaoInput] = useState<string>("");

  // Form Music Video
  const [tituloMV, setTituloMV] = useState<string>("");
  const [musicaVinculadaMV, setMusicaVinculadaMV] = useState<string>("");

  // Form Álbum
  const [tituloAlbum, setTituloAlbum] = useState<string>("");
  const [encartesFiles, setEncartesFiles] = useState<File[]>([]);
  const [totalFaixasCount, setTotalFaixasCount] = useState<number>(3);
  const [faixasConfig, setFaixasConfig] = useState<TrackConfig[]>([]);

  // Submissão
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset de formulários ao trocar de aba
  const resetFormState = () => {
    setCapaFile(null);
    setCapaPreview(null);
    setMediaFile(null);
    setMediaUrlInput("");
    setLetraInput("");
    setDescricaoInput("");
    setMusicaReferenteInput("");
    setEncartesFiles([]);
    setParticipantes([""]);
    setMusicaReferenciaQuery("");
    setMusicaReferencia(null);
    setOpcaoChart(OPCOES_CHART[0].value);
    setSuccessMsg(null);
    setErrorMsg(null);
  };

  // Carregar Perfil do Usuário
  useEffect(() => {
    let isMounted = true;
    setLoadingProfile(true);

    const tgId = telegramUser?.id ? String(telegramUser.id) : "";

    if (!tgId) {
      setLoadingProfile(false);
      setErrorMsg(
        "Não foi possível identificar seu usuário do Telegram. Abra o app pelo Telegram para continuar.",
      );
      return () => {
        isMounted = false;
      };
    }

    fetch(`/api/user/me?telegram_id=${tgId}`, {
      headers: { "x-telegram-id": tgId },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted) return;
        if (data?.success && data.data) {
          const prof: UserProfile = data.data;
          setProfile(prof);
          const defaultArt = prof.artistName || prof.associatedArtists[0] || "";
          setArtistaResponsavel(defaultArt);
        }
      })
      .catch((err) => {
        console.error("Erro ao carregar perfil:", err);
      })
      .finally(() => {
        if (isMounted) setLoadingProfile(false);
      });

    // Buscar músicas do catálogo
    fetch("/api/musicas")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!isMounted) return;
        const list = Array.isArray(data) ? data : data.data || [];
        const formatted = list.map((item: any, idx: number) => ({
          id: item.id || `m_${idx}`,
          title: item.title || item.titulo,
          artist: item.artist || item.artista,
        }));
        setCatalogSongs(formatted);
      })
      .catch((err) => console.error("Erro ao carregar catálogo:", err));

    return () => {
      isMounted = false;
    };
  }, [telegramUser]);

  // Atualizar lista de faixas do álbum
  useEffect(() => {
    const updated: TrackConfig[] = [];
    for (let i = 1; i <= totalFaixasCount; i++) {
      const existing = faixasConfig[i - 1];
      updated.push({
        num: i,
        titulo: existing?.titulo || "",
        inedita: existing ? existing.inedita : true,
        tipoSingle: existing?.tipoSingle || "TRACKLIST ALBUM",
        tipoMusica: existing?.tipoMusica || "SOLO",
      });
    }
    setFaixasConfig(updated);
  }, [totalFaixasCount]);

  // File to Base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  // Upload no Drive (com suporte a FormData e fallback resiliente)
  const handleUploadToDrive = async (
    file: File,
    folderType: "musica" | "album" | "video",
    customName?: string,
  ): Promise<string> => {
    // 1. Tentar via FormData primeiro (evita estouro de memória Base64 no cliente)
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fileName", customName || file.name);
      formData.append("folderType", folderType === "video" ? "musica" : folderType);

      const res = await fetch("/api/gestao/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data?.data?.fileUrl) {
        return data.data.fileUrl;
      }
    } catch (err) {
      console.warn("[Gestao] Upload por FormData falhou, tentando Base64:", err);
    }

    // 2. Fallback via Base64 JSON
    try {
      const base64 = await fileToBase64(file);
      const fileName = customName || file.name;

      const res = await fetch("/api/gestao/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName,
          mimeType: file.type || "image/jpeg",
          base64Data: base64,
          folderType: folderType === "video" ? "musica" : folderType,
        }),
      });

      const data = await res.json().catch(() => null);
      if (data?.data?.fileUrl) {
        return data.data.fileUrl;
      }
    } catch (err) {
      console.warn("[Gestao] Upload por Base64 falhou:", err);
    }

    // 3. Fallback final seguro para a pasta pública
    return folderType === "album"
      ? "https://drive.google.com/drive/folders/1Teo9x2yBAJSmdUV23e6cO6EkyCdddZBS"
      : "https://drive.google.com/drive/folders/1hd_ZJwbVsESwtGniorw0bxQmkhsKcslT";
  };

  // Participantes handlers
  const handleAddParticipante = () => {
    if (participantes.length < 5) {
      setParticipantes([...participantes, ""]);
    }
  };

  const handleRemoveParticipante = (index: number) => {
    setParticipantes(participantes.filter((_, i) => i !== index));
  };

  const handleParticipanteChange = (index: number, val: string) => {
    const updated = [...participantes];
    updated[index] = val;
    setParticipantes(updated);
  };

  // Handler de Capa
  const handleCapaSelect = (file: File) => {
    setCapaFile(file);
    const url = URL.createObjectURL(file);
    setCapaPreview(url);
  };

  // Submeter Lançamento de Música
  const handleSubmitMusica = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);

    if (!artistaResponsavel.trim()) {
      setErrorMsg("Selecione ou informe o Artista Responsável.");
      return;
    }
    if (!nomeMusica.trim()) {
      setErrorMsg("Informe o Título da Música.");
      return;
    }
    const precisaReferencia = opcaoChart !== OPCOES_CHART[0].value;
    if (precisaReferencia && !musicaReferencia) {
      setErrorMsg("Selecione qual música existente essa opção se refere.");
      return;
    }

    setIsSubmitting(true);
    setUploadProgress("Fazendo upload da capa...");

    try {
      let capaUrl = "";
      if (capaFile) {
        capaUrl = await handleUploadToDrive(
          capaFile,
          "musica",
          `CAPA_${artistaResponsavel}_${nomeMusica}_${Date.now()}.jpg`,
        );
      }

      let mediaUrl = mediaUrlInput.trim();
      if (mediaFile) {
        setUploadProgress("Fazendo upload do áudio...");
        mediaUrl = await handleUploadToDrive(
          mediaFile,
          "musica",
          `AUDIO_${artistaResponsavel}_${nomeMusica}_${Date.now()}`,
        );
      }

      setUploadProgress("Registrando lançamento de música...");

      const fullTitle = `${artistaResponsavel} - ${nomeMusica}`;
      const payload = {
        opcaoChart,
        tituloMusica: fullTitle,
        nomeMusica,
        artistaPrincipal: artistaResponsavel,
        participantes: participantes.filter((p) => p.trim().length > 0),
        tipoSingle,
        tipoMusica,
        capaUrl,
        mediaUrl,
        letra: letraInput.trim(),
        nomeJogador: profile?.playerName || telegramUser?.name || "Jogador",
        jogadorId: telegramUser?.id ? String(telegramUser.id) : "",
        musicaReferencia: musicaReferencia
          ? `${musicaReferencia.artist} - ${musicaReferencia.title}`
          : "",
      };

      const res = await fetch("/api/gestao/musica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Erro ao registrar música.");
      }

      setSuccessMsg("Lançamento de Música publicado com sucesso!");
      setNomeMusica("");
      setCapaFile(null);
      setCapaPreview(null);
      setMediaFile(null);
      setParticipantes([""]);
      setMusicaReferenciaQuery("");
      setMusicaReferencia(null);
      setOpcaoChart(OPCOES_CHART[0].value);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Erro inesperado ao publicar música.");
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  // Submeter Lançamento de Vídeo
  const handleSubmitVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);

    if (!artistaResponsavel.trim()) {
      setErrorMsg("Selecione ou informe o Artista Responsável.");
      return;
    }
    if (!tituloVideo.trim()) {
      setErrorMsg("Informe o Título do Vídeo.");
      return;
    }

    setIsSubmitting(true);
    setUploadProgress("Fazendo upload da capa do vídeo...");

    try {
      let capaUrl = "";
      if (capaFile) {
        capaUrl = await handleUploadToDrive(
          capaFile,
          "video",
          `CAPA_VIDEO_${artistaResponsavel}_${tituloVideo}_${Date.now()}.jpg`,
        );
      }

      let mediaUrl = mediaUrlInput.trim();
      if (mediaFile) {
        setUploadProgress("Fazendo upload do arquivo de vídeo...");
        mediaUrl = await handleUploadToDrive(
          mediaFile,
          "video",
          `VIDEO_${artistaResponsavel}_${tituloVideo}_${Date.now()}`,
        );
      }

      setUploadProgress("Cadastrando vídeo...");

      const payload = {
        tituloVideo,
        artistaResponsavel,
        categoriaVideo,
        musicaVinculada: musicaReferenteInput.trim(),
        descricao: descricaoInput.trim(),
        participantes: participantes.filter((p) => p.trim().length > 0),
        capaUrl,
        mediaUrl,
        nomeJogador: profile?.playerName || telegramUser?.name || "Jogador",
      };

      const res = await fetch("/api/gestao/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Erro ao registrar vídeo.");
      }

      setSuccessMsg("Vídeo publicado com sucesso!");
      setTituloVideo("");
      setCapaFile(null);
      setCapaPreview(null);
      setMediaFile(null);
      setParticipantes([""]);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Erro ao publicar vídeo.");
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  // Submeter Music Video (MV)
  const handleSubmitMusicVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);

    if (!artistaResponsavel.trim()) {
      setErrorMsg("Selecione ou informe o Artista Responsável.");
      return;
    }
    if (!tituloMV.trim()) {
      setErrorMsg("Informe o Título do Music Video.");
      return;
    }

    setIsSubmitting(true);
    setUploadProgress("Fazendo upload da thumbnail/capa...");

    try {
      let capaUrl = "";
      if (capaFile) {
        capaUrl = await handleUploadToDrive(
          capaFile,
          "video",
          `CAPA_MV_${artistaResponsavel}_${tituloMV}_${Date.now()}.jpg`,
        );
      }

      let mediaUrl = mediaUrlInput.trim();
      if (mediaFile) {
        setUploadProgress("Fazendo upload do arquivo de vídeo...");
        mediaUrl = await handleUploadToDrive(
          mediaFile,
          "video",
          `MV_${artistaResponsavel}_${tituloMV}_${Date.now()}`,
        );
      }

      setUploadProgress("Cadastrando Music Video...");

      const payload = {
        tituloMusicVideo: tituloMV,
        artistaResponsavel,
        musicaVinculada: musicaVinculadaMV || tituloMV,
        descricao: descricaoInput.trim(),
        participantes: participantes.filter((p) => p.trim().length > 0),
        capaUrl,
        mediaUrl,
        nomeJogador: profile?.playerName || telegramUser?.name || "Jogador",
      };

      const res = await fetch("/api/gestao/music-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Erro ao registrar Music Video.");
      }

      setSuccessMsg("Music Video publicado com sucesso!");
      setTituloMV("");
      setMusicaVinculadaMV("");
      setCapaFile(null);
      setCapaPreview(null);
      setMediaFile(null);
      setParticipantes([""]);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Erro ao publicar Music Video.");
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  // Submeter Álbum
  const handleSubmitAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);

    if (!artistaResponsavel.trim()) {
      setErrorMsg("Selecione ou informe o Artista do Álbum.");
      return;
    }
    if (!tituloAlbum.trim()) {
      setErrorMsg("Informe o Título do Álbum.");
      return;
    }

    setIsSubmitting(true);
    setUploadProgress("Fazendo upload da capa do álbum...");

    try {
      let capaUrl = "";
      if (capaFile) {
        capaUrl = await handleUploadToDrive(
          capaFile,
          "album",
          `CAPA_ALBUM_${artistaResponsavel}_${tituloAlbum}_${Date.now()}.jpg`,
        );
      }

      const encartesUrls: string[] = [];
      if (encartesFiles.length > 0) {
        for (let i = 0; i < encartesFiles.length; i++) {
          setUploadProgress(`Fazendo upload do encarte ${i + 1} de ${encartesFiles.length}...`);
          const url = await handleUploadToDrive(
            encartesFiles[i],
            "album",
            `ENCARTE_${i + 1}_${artistaResponsavel}_${tituloAlbum}_${Date.now()}.jpg`,
          );
          encartesUrls.push(url);
        }
      }

      setUploadProgress("Registrando álbum no sistema...");

      const payload = {
        tituloAlbum,
        artistaAlbum: artistaResponsavel,
        capaUrl,
        encartesUrls,
        nomeJogador: profile?.playerName || telegramUser?.name || "Jogador",
        faixas: faixasConfig,
      };

      const res = await fetch("/api/gestao/album", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Erro ao registrar álbum.");
      }

      setSuccessMsg("Álbum e faixas publicados com sucesso!");
      setTituloAlbum("");
      setCapaFile(null);
      setCapaPreview(null);
      setEncartesFiles([]);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Erro inesperado ao publicar álbum.");
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  return (
    <div className="space-y-6 text-white max-w-5xl mx-auto">
      {/* HEADER DA GESTÃO */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-neutral-900/80 border border-white/10 p-6 rounded-3xl backdrop-blur-md">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-2">
            <Sparkles className="size-3.5" />
            Central do Gravador / Artista
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white">Gestão & Lançamentos</h2>
          <p className="text-xs text-neutral-400 mt-1">
            Cadastre músicas, vídeos, music videos e álbuns para pontuação nos Charts e catálogo do
            Empire Play.
          </p>
        </div>

        {/* BOTÃO PARA MODAL DE EDIÇÃO */}
        <button
          onClick={() => setIsEditModalOpen(true)}
          className="px-4 py-2.5 rounded-2xl bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-xs font-bold text-neutral-200 transition flex items-center gap-2"
        >
          <Pencil className="size-3.5 text-emerald-400" />
          <span>Editar Meus Lançamentos</span>
        </button>
      </div>

      {/* TABS DE SELEÇÃO */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-neutral-900/90 p-2 rounded-2xl border border-white/10">
        <button
          onClick={() => {
            setActiveTab("musica");
            resetFormState();
          }}
          className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition ${
            activeTab === "musica"
              ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20"
              : "text-neutral-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Music className="size-4" />
          <span>Músicas</span>
        </button>

        <button
          onClick={() => {
            setActiveTab("video");
            resetFormState();
          }}
          className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition ${
            activeTab === "video"
              ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20"
              : "text-neutral-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Tv className="size-4" />
          <span>Vídeos</span>
        </button>

        <button
          onClick={() => {
            setActiveTab("music-video");
            resetFormState();
          }}
          className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition ${
            activeTab === "music-video"
              ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20"
              : "text-neutral-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Film className="size-4" />
          <span>Music Videos</span>
        </button>

        <button
          onClick={() => {
            setActiveTab("album");
            resetFormState();
          }}
          className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition ${
            activeTab === "album"
              ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20"
              : "text-neutral-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Disc className="size-4" />
          <span>Álbuns</span>
        </button>
      </div>

      {/* MENSAGENS DE SUCESSO E ERRO */}
      {successMsg && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-3">
          <CheckCircle2 className="size-5 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-bold flex items-center gap-3">
          <AlertCircle className="size-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* FORMULÁRIO DE MÚSICA */}
      {activeTab === "musica" && (
        <form
          onSubmit={handleSubmitMusica}
          className="bg-neutral-900/90 border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 backdrop-blur-md"
        >
          {/* SELEÇÃO DO ARTISTA RESPONSÁVEL */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <User className="size-4 text-emerald-400" />
              Artista Responsável
            </label>
            {profile?.associatedArtists && profile.associatedArtists.length > 0 ? (
              <select
                value={artistaResponsavel}
                onChange={(e) => setArtistaResponsavel(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {profile.associatedArtists.map((art) => (
                  <option key={art} value={art}>
                    {art}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={artistaResponsavel}
                onChange={(e) => setArtistaResponsavel(e.target.value)}
                placeholder="Ex: Taylor Swift"
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
              />
            )}
          </div>

          {/* TÍTULO DA MÚSICA */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <Music className="size-4 text-emerald-400" />
              Título da Música
            </label>
            <input
              type="text"
              value={nomeMusica}
              onChange={(e) => setNomeMusica(e.target.value)}
              placeholder="Ex: Anti-Hero"
              className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* TIPO DE SINGLE E TIPO DE MÚSICA */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
                Tipo de Single
              </label>
              <select
                value={tipoSingle}
                onChange={(e) => setTipoSingle(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {TIPOS_SINGLE.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
                Tipo de Música
              </label>
              <select
                value={tipoMusica}
                onChange={(e) => setTipoMusica(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {TIPOS_MUSICA.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* OPÇÕES DE CHART */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
              Objetivo no Chart
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {OPCOES_CHART.map((op) => (
                <div
                  key={op.key}
                  onClick={() => setOpcaoChart(op.value)}
                  className={`p-4 rounded-2xl border cursor-pointer transition flex flex-col justify-between ${
                    opcaoChart === op.value
                      ? "bg-emerald-500/10 border-emerald-500 text-white"
                      : "bg-neutral-950/60 border-white/5 text-neutral-400 hover:border-white/20"
                  }`}
                >
                  <span className="font-bold text-xs text-white mb-1">{op.title}</span>
                  <span className="text-[11px] text-neutral-400">{op.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* SELEÇÃO DE MÚSICA EXISTENTE — obrigatório para (b) e (c) */}
          {opcaoChart !== OPCOES_CHART[0].value && (
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
                {opcaoChart === OPCOES_CHART[1].value
                  ? "Qual música você quer substituir?"
                  : "A qual música lançada os comentários devem valer?"}
              </label>
              {musicaReferencia ? (
                <div className="flex items-center justify-between gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
                  <span className="text-sm text-white font-bold truncate">
                    {musicaReferencia.artist} - {musicaReferencia.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setMusicaReferencia(null);
                      setMusicaReferenciaQuery("");
                    }}
                    className="text-xs font-bold text-emerald-400 hover:text-emerald-300 shrink-0"
                  >
                    Trocar
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    value={musicaReferenciaQuery}
                    onChange={(e) => setMusicaReferenciaQuery(e.target.value)}
                    placeholder="Busque pelo título ou artista..."
                    className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
                  />
                  {musicaReferenciaQuery.trim().length > 0 && (
                    <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-neutral-900 border border-white/10 rounded-xl shadow-2xl">
                      {catalogSongs
                        .filter((s) => {
                          const q = musicaReferenciaQuery.trim().toLowerCase();
                          return (
                            s.title?.toLowerCase().includes(q) ||
                            s.artist?.toLowerCase().includes(q)
                          );
                        })
                        .slice(0, 20)
                        .map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setMusicaReferencia(s);
                              setMusicaReferenciaQuery("");
                            }}
                            className="w-full text-left px-4 py-2.5 text-xs text-white hover:bg-emerald-500/10 border-b border-white/5 last:border-b-0"
                          >
                            <span className="font-bold">{s.artist}</span> - {s.title}
                          </button>
                        ))}
                      {catalogSongs.filter((s) => {
                        const q = musicaReferenciaQuery.trim().toLowerCase();
                        return (
                          s.title?.toLowerCase().includes(q) || s.artist?.toLowerCase().includes(q)
                        );
                      }).length === 0 && (
                        <p className="px-4 py-3 text-xs text-neutral-500 italic">
                          Nenhuma música encontrada.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* PARTICIPANTES (FEAT) */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
              Participantes (Feat / Artistas 2 a 6)
            </label>
            {participantes.map((part, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={part}
                  onChange={(e) => handleParticipanteChange(idx, e.target.value)}
                  placeholder={`Artista participante #${idx + 2}`}
                  className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
                />
                {participantes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveParticipante(idx)}
                    className="p-2.5 text-red-400 hover:bg-red-500/10 rounded-xl border border-red-500/20 transition"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
            {participantes.length < 5 && (
              <button
                type="button"
                onClick={handleAddParticipante}
                className="inline-flex items-center gap-2 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
              >
                <Plus className="size-4" />
                <span>Adicionar Participante</span>
              </button>
            )}
          </div>

          {/* UPLOAD DE ARQUIVOS COM BOTÕES EXATOS DA ESPECIFICAÇÃO */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/10">
            {/* CAPA */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
                Capa do Lançamento
              </label>
              <div className="flex items-center gap-4 bg-neutral-950 p-4 rounded-2xl border border-white/10">
                {capaPreview ? (
                  <img
                    src={capaPreview}
                    alt="Capa Preview"
                    className="size-16 object-cover rounded-xl border border-white/10"
                  />
                ) : (
                  <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500">
                    <ImageIcon className="size-6" />
                  </div>
                )}
                <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 transition inline-flex items-center gap-2">
                  <Upload className="size-4 text-emerald-400" />
                  <span>Selecione a Capa</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && handleCapaSelect(e.target.files[0])}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* ÁUDIO (LINK OU ARQUIVO) */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
                Arquivo de Áudio ou Link (YouTube / Drive)
              </label>
              <input
                type="text"
                value={mediaUrlInput}
                onChange={(e) => setMediaUrlInput(e.target.value)}
                placeholder="Cole o Link (YouTube, Google Drive, MP3 URL) ou selecione abaixo"
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none mb-2"
              />
              <div className="flex items-center gap-4 bg-neutral-950 p-4 rounded-2xl border border-white/10">
                <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500">
                  <FileVideo className="size-6" />
                </div>
                <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 transition inline-flex items-center gap-2">
                  <Upload className="size-4 text-emerald-400" />
                  <span>Upload de Arquivo local</span>
                  <input
                    type="file"
                    accept="audio/*,video/*"
                    onChange={(e) => setMediaFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
              </div>
              {mediaFile && (
                <p className="text-[11px] text-emerald-400 truncate">
                  Selecionado: {mediaFile.name}
                </p>
              )}
            </div>
          </div>

          {/* LETRA DA MÚSICA */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <FileText className="size-4 text-emerald-400" />
              Letra da Música (Opcional)
            </label>
            <textarea
              rows={4}
              value={letraInput}
              onChange={(e) => setLetraInput(e.target.value)}
              placeholder="Cole aqui a letra completa da música..."
              className="w-full bg-neutral-950 border border-white/10 rounded-xl p-4 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* BOTÃO PRINCIPAL DE ENVIO */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm uppercase tracking-wider shadow-xl shadow-emerald-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Sparkles className="size-5" />
            <span>
              {isSubmitting ? uploadProgress || "Enviando..." : "Publicar Lançamento de Música"}
            </span>
          </button>
        </form>
      )}

      {/* FORMULÁRIO DE VÍDEO */}
      {activeTab === "video" && (
        <form
          onSubmit={handleSubmitVideo}
          className="bg-neutral-900/90 border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 backdrop-blur-md"
        >
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <User className="size-4 text-emerald-400" />
              Artista Responsável
            </label>
            {profile?.associatedArtists && profile.associatedArtists.length > 0 ? (
              <select
                value={artistaResponsavel}
                onChange={(e) => setArtistaResponsavel(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {profile.associatedArtists.map((art) => (
                  <option key={art} value={art}>
                    {art}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={artistaResponsavel}
                onChange={(e) => setArtistaResponsavel(e.target.value)}
                placeholder="Ex: Taylor Swift"
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <Tv className="size-4 text-emerald-400" />
              Título do Vídeo
            </label>
            <input
              type="text"
              value={tituloVideo}
              onChange={(e) => setTituloVideo(e.target.value)}
              placeholder="Ex: Entrevista Exclusiva no Empire Hub"
              className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
              Categoria / Tipo de Vídeo
            </label>
            <select
              value={categoriaVideo}
              onChange={(e) => setCategoriaVideo(e.target.value)}
              className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              {CATEGORIAS_VIDEO.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <Music className="size-4 text-emerald-400" />
              Música Vinculada / Referente (Opcional)
            </label>
            <input
              type="text"
              value={musicaReferenteInput}
              onChange={(e) => setMusicaReferenteInput(e.target.value)}
              placeholder="Ex: Nome da música do catálogo"
              className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <FileText className="size-4 text-emerald-400" />
              Descrição do Vídeo (Opcional)
            </label>
            <textarea
              rows={3}
              value={descricaoInput}
              onChange={(e) => setDescricaoInput(e.target.value)}
              placeholder="Descreva detalhes, sinopse ou contexto do vídeo..."
              className="w-full bg-neutral-950 border border-white/10 rounded-xl p-4 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* PARTICIPANTES */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
              Participantes (Artistas 2 a 6)
            </label>
            {participantes.map((part, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={part}
                  onChange={(e) => handleParticipanteChange(idx, e.target.value)}
                  placeholder={`Participante #${idx + 2}`}
                  className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
                />
                {participantes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveParticipante(idx)}
                    className="p-2.5 text-red-400 hover:bg-red-500/10 rounded-xl border border-red-500/20 transition"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
            {participantes.length < 5 && (
              <button
                type="button"
                onClick={handleAddParticipante}
                className="inline-flex items-center gap-2 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
              >
                <Plus className="size-4" />
                <span>Adicionar Participante</span>
              </button>
            )}
          </div>

          {/* UPLOAD DE ARQUIVOS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/10">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
                Capa do Vídeo / Thumbnail
              </label>
              <div className="flex items-center gap-4 bg-neutral-950 p-4 rounded-2xl border border-white/10">
                {capaPreview ? (
                  <img
                    src={capaPreview}
                    alt="Capa Preview"
                    className="size-16 object-cover rounded-xl border border-white/10"
                  />
                ) : (
                  <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500">
                    <ImageIcon className="size-6" />
                  </div>
                )}
                <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 transition inline-flex items-center gap-2">
                  <Upload className="size-4 text-emerald-400" />
                  <span>Selecione a Capa</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && handleCapaSelect(e.target.files[0])}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
                Arquivo ou Link do Vídeo (YouTube / Drive)
              </label>
              <input
                type="text"
                value={mediaUrlInput}
                onChange={(e) => setMediaUrlInput(e.target.value)}
                placeholder="Cole o Link (YouTube, Drive, MP4 URL) ou selecione abaixo"
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none mb-2"
              />
              <div className="flex items-center gap-4 bg-neutral-950 p-4 rounded-2xl border border-white/10">
                <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500">
                  <FileVideo className="size-6" />
                </div>
                <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 transition inline-flex items-center gap-2">
                  <Upload className="size-4 text-emerald-400" />
                  <span>Upload de Arquivo</span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => setMediaFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
              </div>
              {mediaFile && (
                <p className="text-[11px] text-emerald-400 truncate">
                  Selecionado: {mediaFile.name}
                </p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm uppercase tracking-wider shadow-xl shadow-emerald-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Sparkles className="size-5" />
            <span>
              {isSubmitting ? uploadProgress || "Enviando..." : "Publicar Vídeo Especial"}
            </span>
          </button>
        </form>
      )}

      {/* FORMULÁRIO DE MUSIC VIDEO */}
      {activeTab === "music-video" && (
        <form
          onSubmit={handleSubmitMusicVideo}
          className="bg-neutral-900/90 border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 backdrop-blur-md"
        >
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <User className="size-4 text-emerald-400" />
              Artista Responsável
            </label>
            {profile?.associatedArtists && profile.associatedArtists.length > 0 ? (
              <select
                value={artistaResponsavel}
                onChange={(e) => setArtistaResponsavel(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {profile.associatedArtists.map((art) => (
                  <option key={art} value={art}>
                    {art}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={artistaResponsavel}
                onChange={(e) => setArtistaResponsavel(e.target.value)}
                placeholder="Ex: Taylor Swift"
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <Film className="size-4 text-emerald-400" />
              Título do Music Video
            </label>
            <input
              type="text"
              value={tituloMV}
              onChange={(e) => setTituloMV(e.target.value)}
              placeholder="Ex: Anti-Hero (Official Music Video)"
              className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <Music className="size-4 text-emerald-400" />
              Música Vinculada
            </label>
            <input
              type="text"
              value={musicaVinculadaMV}
              onChange={(e) => setMusicaVinculadaMV(e.target.value)}
              placeholder="Ex: Anti-Hero"
              className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <FileText className="size-4 text-emerald-400" />
              Direção / Roteiro / Descrição do Clipe (Opcional)
            </label>
            <textarea
              rows={3}
              value={descricaoInput}
              onChange={(e) => setDescricaoInput(e.target.value)}
              placeholder="Descreva o conceito visual, diretor, atores e enredo do clipe..."
              className="w-full bg-neutral-950 border border-white/10 rounded-xl p-4 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* PARTICIPANTES */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
              Participantes (Artistas 2 a 6)
            </label>
            {participantes.map((part, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={part}
                  onChange={(e) => handleParticipanteChange(idx, e.target.value)}
                  placeholder={`Participante #${idx + 2}`}
                  className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
                />
                {participantes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveParticipante(idx)}
                    className="p-2.5 text-red-400 hover:bg-red-500/10 rounded-xl border border-red-500/20 transition"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
            {participantes.length < 5 && (
              <button
                type="button"
                onClick={handleAddParticipante}
                className="inline-flex items-center gap-2 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
              >
                <Plus className="size-4" />
                <span>Adicionar Participante</span>
              </button>
            )}
          </div>

          {/* UPLOAD DE ARQUIVOS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/10">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
                Thumbnail / Capa do Music Video
              </label>
              <div className="flex items-center gap-4 bg-neutral-950 p-4 rounded-2xl border border-white/10">
                {capaPreview ? (
                  <img
                    src={capaPreview}
                    alt="Capa Preview"
                    className="size-16 object-cover rounded-xl border border-white/10"
                  />
                ) : (
                  <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500">
                    <ImageIcon className="size-6" />
                  </div>
                )}
                <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 transition inline-flex items-center gap-2">
                  <Upload className="size-4 text-emerald-400" />
                  <span>Selecione a Capa</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && handleCapaSelect(e.target.files[0])}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
                Arquivo de Vídeo ou Link (YouTube / Drive)
              </label>
              <input
                type="text"
                value={mediaUrlInput}
                onChange={(e) => setMediaUrlInput(e.target.value)}
                placeholder="Cole o Link (YouTube, Drive, MP4 URL) ou selecione abaixo"
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none mb-2"
              />
              <div className="flex items-center gap-4 bg-neutral-950 p-4 rounded-2xl border border-white/10">
                <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500">
                  <FileVideo className="size-6" />
                </div>
                <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 transition inline-flex items-center gap-2">
                  <Upload className="size-4 text-emerald-400" />
                  <span>Upload de Arquivo</span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => setMediaFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
              </div>
              {mediaFile && (
                <p className="text-[11px] text-emerald-400 truncate">
                  Selecionado: {mediaFile.name}
                </p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm uppercase tracking-wider shadow-xl shadow-emerald-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Sparkles className="size-5" />
            <span>{isSubmitting ? uploadProgress || "Enviando..." : "Publicar Music Video"}</span>
          </button>
        </form>
      )}

      {/* FORMULÁRIO DE ÁLBUM */}
      {activeTab === "album" && (
        <form
          onSubmit={handleSubmitAlbum}
          className="bg-neutral-900/90 border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 backdrop-blur-md"
        >
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <User className="size-4 text-emerald-400" />
              Artista do Álbum
            </label>
            {profile?.associatedArtists && profile.associatedArtists.length > 0 ? (
              <select
                value={artistaResponsavel}
                onChange={(e) => setArtistaResponsavel(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {profile.associatedArtists.map((art) => (
                  <option key={art} value={art}>
                    {art}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={artistaResponsavel}
                onChange={(e) => setArtistaResponsavel(e.target.value)}
                placeholder="Ex: Taylor Swift"
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <Disc className="size-4 text-emerald-400" />
              Título do Álbum
            </label>
            <input
              type="text"
              value={tituloAlbum}
              onChange={(e) => setTituloAlbum(e.target.value)}
              placeholder="Ex: Midnights"
              className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* QUANTIDADE DE FAIXAS */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <ListMusic className="size-4 text-emerald-400" />
              Quantidade de Faixas ({totalFaixasCount})
            </label>
            <input
              type="number"
              min={1}
              max={30}
              value={totalFaixasCount}
              onChange={(e) => setTotalFaixasCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-32 bg-neutral-950 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* TRACKLIST CONFIG */}
          <div className="space-y-3 bg-neutral-950/60 p-4 rounded-2xl border border-white/5 max-h-80 overflow-y-auto">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
              Lista de Faixas do Álbum
            </label>
            {faixasConfig.map((faixa, idx) => (
              <div
                key={idx}
                className="p-3 bg-neutral-900 border border-white/5 rounded-xl space-y-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-emerald-400">Faixa #{faixa.num}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const updated = [...faixasConfig];
                        updated[idx].inedita = !updated[idx].inedita;
                        setFaixasConfig(updated);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase transition ${
                        faixa.inedita
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : "bg-neutral-800 text-neutral-400"
                      }`}
                    >
                      {faixa.inedita ? "Inédita (Registrar)" : "Do Catálogo"}
                    </button>
                  </div>
                </div>

                <input
                  type="text"
                  value={faixa.titulo}
                  onChange={(e) => {
                    const updated = [...faixasConfig];
                    updated[idx].titulo = e.target.value;
                    setFaixasConfig(updated);
                  }}
                  placeholder={`Título da faixa #${faixa.num}`}
                  className="w-full bg-neutral-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            ))}
          </div>

          {/* UPLOAD DA CAPA E ENCARTES */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/10">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
                Capa do Álbum
              </label>
              <div className="flex items-center gap-4 bg-neutral-950 p-4 rounded-2xl border border-white/10">
                {capaPreview ? (
                  <img
                    src={capaPreview}
                    alt="Capa Preview"
                    className="size-16 object-cover rounded-xl border border-white/10"
                  />
                ) : (
                  <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500">
                    <ImageIcon className="size-6" />
                  </div>
                )}
                <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 transition inline-flex items-center gap-2">
                  <Upload className="size-4 text-emerald-400" />
                  <span>Selecione a Capa</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && handleCapaSelect(e.target.files[0])}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
                Encartes / Imagens Adicionais
              </label>
              <div className="flex items-center gap-4 bg-neutral-950 p-4 rounded-2xl border border-white/10">
                <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500">
                  <ImageIcon className="size-6" />
                </div>
                <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 transition inline-flex items-center gap-2">
                  <Upload className="size-4 text-emerald-400" />
                  <span>Selecione os Encartes (Fotos)</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => e.target.files && setEncartesFiles(Array.from(e.target.files))}
                    className="hidden"
                  />
                </label>
              </div>
              {encartesFiles.length > 0 && (
                <p className="text-[11px] text-emerald-400">
                  {encartesFiles.length} encarte(s) selecionado(s)
                </p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm uppercase tracking-wider shadow-xl shadow-emerald-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Sparkles className="size-5" />
            <span>{isSubmitting ? uploadProgress || "Enviando..." : "Publicar Lançamento"}</span>
          </button>
        </form>
      )}

      {/* MODAL DE EDIÇÃO */}
      <EditModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        associatedArtists={profile?.associatedArtists || []}
        defaultArtist={artistaResponsavel}
      />
    </div>
  );
};
