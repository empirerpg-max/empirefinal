import React, { useState, useEffect } from "react";
import { driveImg } from "@/lib/api";
import {
  X,
  Pencil,
  Music,
  Video,
  Disc,
  User,
  Upload,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Image as ImageIcon,
  Save,
  ListMusic,
  Plus,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

// "music-videos" foi consolidado dentro de "videos" — vivem na mesma aba
// da planilha ("Music Videos"), diferenciados por tag, não mais categoria.
export type EditCategory = "musicas" | "videos" | "albuns";

export interface ReleaseItem {
  id: string;
  rowIndex: number;
  tipo: EditCategory;
  titulo: string;
  artista: string;
  descricao?: string;
  capaUrl?: string;
  fields?: Record<string, string>;
}

interface AlbumFaixa {
  musicaRowIndex: number;
  titulo: string;
  ordem: number;
  audioUrl: string;
}

interface MusicaEmChart {
  label: string;
  artist: string;
  title: string;
}

const TIPOS_SINGLE_FAIXA = [
  "TRACKLIST ALBUM",
  "LEAD SINGLE",
  "PRÉ-ALBUM",
  "AVULSO",
  "PÓS-ALBUM",
  "PÓS-ALBUM REMIX",
  "SOUNDTRACK",
  "PROMOCIONAL",
  "REMIX",
  "PRÉ-ALBUM REMIX",
  "LEAD SINGLE REMIX",
];
const TIPOS_MUSICA_FAIXA = ["SOLO", "PARCERIA", "DUETO", "CONJUNTO"];

interface EditModalProps {
  isOpen: boolean;
  onClose: () => void;
  associatedArtists?: string[];
  defaultArtist?: string;
}

const CATEGORIES = [
  { id: "musicas", label: "Músicas", icon: Music, desc: "Singles e Faixas Solas" },
  { id: "videos", label: "Vídeos", icon: Video, desc: "Clipes, lives, vídeos gerais..." },
  { id: "albuns", label: "Álbuns", icon: Disc, desc: "Álbuns e EPs" },
] as const;

export const EditModal: React.FC<EditModalProps> = ({
  isOpen,
  onClose,
  associatedArtists = [],
  defaultArtist = "",
}) => {
  const [selectedArtist, setSelectedArtist] = useState<string>(
    defaultArtist || associatedArtists[0] || "",
  );
  const [category, setCategory] = useState<EditCategory>("musicas");

  const [releases, setReleases] = useState<ReleaseItem[]>([]);
  const [loadingReleases, setLoadingReleases] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Item selecionado para edição
  const [editingItem, setEditingItem] = useState<ReleaseItem | null>(null);

  // Formulário do item em edição
  const [editTitulo, setEditTitulo] = useState<string>("");
  const [editDescricao, setEditDescricao] = useState<string>("");
  const [capaFile, setCapaFile] = useState<File | null>(null);
  const [capaPreview, setCapaPreview] = useState<string | null>(null);

  const [saving, setSaving] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Faixas do álbum em edição (só categoria "albuns") — reordenar e
  // adicionar faixas novas.
  const [albumFaixas, setAlbumFaixas] = useState<AlbumFaixa[]>([]);
  const [loadingFaixas, setLoadingFaixas] = useState<boolean>(false);
  const [savingOrdem, setSavingOrdem] = useState<boolean>(false);
  const [musicasEmChart, setMusicasEmChart] = useState<MusicaEmChart[]>([]);

  // Formulário de "adicionar faixa nova"
  const [addingFaixa, setAddingFaixa] = useState<boolean>(false);
  const [novaFaixaInedita, setNovaFaixaInedita] = useState<boolean>(true);
  const [novaFaixaTitulo, setNovaFaixaTitulo] = useState<string>("");
  const [novaFaixaBusca, setNovaFaixaBusca] = useState<string>("");
  const [novaFaixaTipoSingle, setNovaFaixaTipoSingle] = useState<string>("TRACKLIST ALBUM");
  const [novaFaixaTipoMusica, setNovaFaixaTipoMusica] = useState<string>("SOLO");
  const [novaFaixaMediaUrl, setNovaFaixaMediaUrl] = useState<string>("");
  const [novaFaixaAudioFile, setNovaFaixaAudioFile] = useState<File | null>(null);
  const [uploadingFaixaAudio, setUploadingFaixaAudio] = useState<boolean>(false);

  // Atualizar artista quando props mudam
  useEffect(() => {
    if (defaultArtist || associatedArtists.length > 0) {
      setSelectedArtist(defaultArtist || associatedArtists[0]);
    }
  }, [defaultArtist, associatedArtists]);

  // Buscar lançamentos do artista e categoria
  useEffect(() => {
    if (!isOpen || !selectedArtist) return;

    let isMounted = true;
    setLoadingReleases(true);
    setFetchError(null);
    setEditingItem(null);

    const query = new URLSearchParams({
      artist: selectedArtist,
      tipo: category,
    });

    fetch(`/api/editar?${query.toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject("Erro HTTP " + res.status)))
      .then((data) => {
        if (!isMounted) return;
        if (data?.success) {
          setReleases(data.data || []);
        } else {
          setFetchError(data?.error || "Não foi possível buscar lançamentos.");
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setFetchError("Erro ao conectar ao servidor de lançamentos.");
      })
      .finally(() => {
        if (isMounted) setLoadingReleases(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, selectedArtist, category]);

  // Buscar músicas em chart (aba Pontos) — usado na busca de faixa existente
  // pra adicionar a um álbum.
  useEffect(() => {
    if (!isOpen || category !== "albuns") return;
    fetch("/api/gestao/musicas-em-chart")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success && Array.isArray(data.data)) setMusicasEmChart(data.data);
      })
      .catch(() => {});
  }, [isOpen, category]);

  const fetchAlbumFaixas = (topicId: string) => {
    setLoadingFaixas(true);
    fetch(`/api/gestao/album-faixas?topicId=${encodeURIComponent(topicId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success && data.data) {
          setAlbumFaixas(data.data.faixas || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingFaixas(false));
  };

  if (!isOpen) return null;

  // Abrir formulário de edição para um item específico
  const handleStartEdit = (item: ReleaseItem) => {
    setEditingItem(item);
    setEditTitulo(item.titulo);
    setEditDescricao(item.descricao || "");
    setCapaFile(null);
    setCapaPreview(item.capaUrl || null);
    setSuccessMsg(null);
    setErrorMsg(null);
    setAlbumFaixas([]);
    setAddingFaixa(false);
    setNovaFaixaTitulo("");
    setNovaFaixaBusca("");
    setNovaFaixaMediaUrl("");
    setNovaFaixaAudioFile(null);
    if (item.tipo === "albuns" && item.fields?.topicId) {
      fetchAlbumFaixas(item.fields.topicId);
    }
  };

  // Move uma faixa pra cima/baixo na lista, trocando a Ordem com a vizinha,
  // e já salva as duas mudanças na planilha.
  const handleMoveFaixa = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= albumFaixas.length) return;

    const updated = [...albumFaixas];
    [updated[index], updated[target]] = [updated[target], updated[index]];
    // Reatribui a Ordem em sequência (1, 2, 3...) conforme a nova posição.
    const reindexed = updated.map((f, i) => ({ ...f, ordem: i + 1 }));
    setAlbumFaixas(reindexed);
    setSavingOrdem(true);
    try {
      await fetch("/api/gestao/album-faixas/reordenar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ordens: reindexed.map((f) => ({ musicaRowIndex: f.musicaRowIndex, ordem: f.ordem })),
        }),
      });
    } catch (err) {
      console.error("Erro ao reordenar faixas:", err);
    } finally {
      setSavingOrdem(false);
    }
  };

  const handleAddFaixa = async () => {
    if (!editingItem?.fields?.topicId) return;
    if (novaFaixaInedita && !novaFaixaTitulo.trim()) {
      setErrorMsg("Informe o título da nova faixa.");
      return;
    }
    if (novaFaixaInedita && !novaFaixaMediaUrl.trim() && !novaFaixaAudioFile) {
      setErrorMsg("Envie o arquivo de áudio ou informe o link (Drive/YouTube) da nova faixa.");
      return;
    }
    if (!novaFaixaInedita && !novaFaixaTitulo.trim()) {
      setErrorMsg("Selecione a música existente pra adicionar.");
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      let mediaUrl = novaFaixaMediaUrl.trim();
      if (novaFaixaInedita && novaFaixaAudioFile) {
        setUploadingFaixaAudio(true);
        mediaUrl = await handleUploadAudioToDrive(
          novaFaixaAudioFile,
          `AUDIO_${selectedArtist || "faixa"}_${novaFaixaTitulo}_${Date.now()}`,
        );
        setUploadingFaixaAudio(false);
      }

      const res = await fetch("/api/gestao/album/substituir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          albumTopicId: editingItem.fields.topicId,
          novasFaixas: [
            {
              num: albumFaixas.length + 1,
              inedita: novaFaixaInedita,
              titulo: novaFaixaTitulo,
              tipoSingle: novaFaixaTipoSingle,
              tipoMusica: novaFaixaTipoMusica,
              mediaUrl,
              abrirTopico: false,
            },
          ],
          nomeJogador: selectedArtist || "Jogador",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Erro ao adicionar faixa.");
      }
      setSuccessMsg("Faixa adicionada com sucesso!");
      setAddingFaixa(false);
      setNovaFaixaTitulo("");
      setNovaFaixaBusca("");
      setNovaFaixaMediaUrl("");
      setNovaFaixaAudioFile(null);
      fetchAlbumFaixas(editingItem.fields.topicId);
      setTimeout(() => setSuccessMsg(null), 2000);
    } catch (err: any) {
      setErrorMsg(err.message || "Erro ao adicionar faixa.");
    } finally {
      setSaving(false);
      setUploadingFaixaAudio(false);
    }
  };

  // Upload direto pro Drive (mesmo padrão do Lançamento em Gestao.tsx) — pasta
  // "musicaAudio" pra áudio de faixa nova, evita depender só de link colado.
  const handleUploadAudioToDrive = async (file: File, customName?: string): Promise<string> => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fileName", customName || file.name);
      formData.append("folderType", "musicaAudio");

      const res = await fetch("/api/gestao/upload", { method: "POST", body: formData });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data?.data?.fileUrl) {
        return data.data.fileUrl;
      }
    } catch (err) {
      console.warn("[EditModal] Upload de áudio por FormData falhou, tentando Base64:", err);
    }

    try {
      const base64 = await fileToBase64(file);
      const res = await fetch("/api/gestao/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: customName || file.name,
          mimeType: file.type || "audio/mpeg",
          base64Data: base64,
          folderType: "musicaAudio",
        }),
      });
      const data = await res.json().catch(() => null);
      if (data?.data?.fileUrl) return data.data.fileUrl;
    } catch (err) {
      console.warn("[EditModal] Upload de áudio por Base64 falhou:", err);
    }

    throw new Error("Não foi possível fazer upload do áudio.");
  };

  // Converte imagem para base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  // Salvar edições
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editTitulo.trim()) {
      setErrorMsg("O título é obrigatório.");
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      let capaBase64 = undefined;
      let capaMimeType = undefined;

      if (capaFile) {
        capaBase64 = await fileToBase64(capaFile);
        capaMimeType = capaFile.type;
      }

      const payload = {
        tipo: category,
        rowIndex: editingItem.rowIndex,
        titulo: editTitulo.trim(),
        oldTitulo: editingItem.titulo,
        descricao: editDescricao.trim(),
        artista: selectedArtist,
        oldCapaUrl: editingItem.capaUrl,
        capaBase64,
        capaMimeType,
      };

      const res = await fetch("/api/editar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Erro ao salvar edições.");
      }

      setSuccessMsg("Lançamento atualizado com sucesso!");

      // Atualizar lista localmente
      setReleases((prev) =>
        prev.map((r) =>
          r.rowIndex === editingItem.rowIndex
            ? {
                ...r,
                titulo: editTitulo.trim(),
                descricao: editDescricao.trim(),
                capaUrl: json.capaUrl || r.capaUrl,
              }
            : r,
        ),
      );

      setTimeout(() => {
        setEditingItem(null);
        setSuccessMsg(null);
      }, 1200);
    } catch (err: any) {
      setErrorMsg(err.message || "Erro durante o salvamento.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="bg-neutral-900 border border-white/10 w-full max-w-3xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* HEADER DO MODAL */}
        <div className="flex items-center justify-between p-6 border-b border-white/10 bg-neutral-950/60">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-2xl bg-amber-500/20 text-amber-400 grid place-items-center">
              <Pencil className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white uppercase tracking-tight">
                Editar Lançamentos
              </h2>
              <p className="text-xs text-neutral-400">
                Selecione o artista e a categoria para alterar mídias existentes.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-2xl bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* CONTROLES: ARTISTA E CATEGORIA */}
        <div className="p-6 border-b border-white/10 bg-neutral-900/50 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Seletor de Artista */}
            <div>
              <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <User className="size-3.5 text-amber-400" />
                Artista Responsável
              </label>
              {associatedArtists.length > 1 ? (
                <select
                  value={selectedArtist}
                  onChange={(e) => setSelectedArtist(e.target.value)}
                  className="w-full px-4 py-2.5 bg-neutral-800 border border-white/10 rounded-2xl text-sm text-white focus:outline-none focus:border-amber-500"
                >
                  {associatedArtists.map((art) => (
                    <option key={art} value={art}>
                      {art}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={selectedArtist}
                  onChange={(e) => setSelectedArtist(e.target.value)}
                  placeholder="Nome do Artista"
                  className="w-full px-4 py-2.5 bg-neutral-800 border border-white/10 rounded-2xl text-sm text-white focus:outline-none focus:border-amber-500"
                />
              )}
            </div>

            {/* Seletor de Categoria */}
            <div>
              <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
                Categoria da Mídia
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-neutral-950 p-1 rounded-2xl border border-white/5">
                {CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const active = category === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setCategory(cat.id as EditCategory)}
                      className={`flex flex-col items-center justify-center p-2 rounded-xl text-[11px] font-bold transition ${
                        active
                          ? "bg-amber-500 text-black shadow-md"
                          : "text-neutral-400 hover:text-white hover:bg-neutral-800/50"
                      }`}
                    >
                      <Icon className="size-3.5 mb-1" />
                      <span className="truncate w-full text-center">{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* CORPO DO MODAL: LISTAGEM OU EDIÇÃO DA MÍDIA */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {editingItem ? (
            /* PAINEL DE EDIÇÃO DO ITEM */
            <form onSubmit={handleSaveEdit} className="space-y-6 animate-fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <span className="text-xs font-black text-amber-400 uppercase tracking-wider">
                  Editando: {editingItem.titulo}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="text-xs font-bold text-neutral-400 hover:text-white underline"
                >
                  Voltar para lista
                </button>
              </div>

              {/* TÍTULO */}
              <div>
                <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
                  Novo Título
                </label>
                <input
                  type="text"
                  value={editTitulo}
                  onChange={(e) => setEditTitulo(e.target.value)}
                  className="w-full px-4 py-3 bg-neutral-800 border border-white/10 rounded-2xl text-sm text-white focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              {/* FAIXAS DO ÁLBUM (reordenar + adicionar) — apenas Álbuns */}
              {category === "albuns" && (
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                    <ListMusic className="size-3.5 text-amber-400" />
                    Faixas do Álbum
                  </label>

                  {loadingFaixas ? (
                    <div className="flex items-center gap-2 text-xs text-neutral-400 py-4">
                      <Loader2 className="size-4 animate-spin" /> Carregando faixas...
                    </div>
                  ) : albumFaixas.length === 0 ? (
                    <p className="text-xs text-neutral-500 italic py-2">
                      Nenhuma faixa vinculada a este álbum ainda.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {albumFaixas.map((faixa, idx) => (
                        <div
                          key={faixa.musicaRowIndex}
                          className="flex items-center gap-2 p-2.5 bg-neutral-800/40 border border-white/10 rounded-xl"
                        >
                          <span className="w-5 text-center font-mono text-[11px] text-neutral-500">
                            {faixa.ordem}
                          </span>
                          <span className="flex-1 min-w-0 text-xs font-semibold text-neutral-200 truncate">
                            {faixa.titulo}
                          </span>
                          <button
                            type="button"
                            disabled={idx === 0 || savingOrdem}
                            onClick={() => handleMoveFaixa(idx, -1)}
                            className="size-7 rounded-lg bg-neutral-900 hover:bg-neutral-700 text-neutral-400 hover:text-white grid place-items-center transition disabled:opacity-30 disabled:pointer-events-none"
                            title="Mover pra cima"
                          >
                            <ArrowUp className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === albumFaixas.length - 1 || savingOrdem}
                            onClick={() => handleMoveFaixa(idx, 1)}
                            className="size-7 rounded-lg bg-neutral-900 hover:bg-neutral-700 text-neutral-400 hover:text-white grid place-items-center transition disabled:opacity-30 disabled:pointer-events-none"
                            title="Mover pra baixo"
                          >
                            <ArrowDown className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {addingFaixa ? (
                    <div className="p-3 bg-neutral-800/40 border border-white/10 rounded-2xl space-y-2.5">
                      <button
                        type="button"
                        onClick={() => setNovaFaixaInedita(!novaFaixaInedita)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase transition ${
                          novaFaixaInedita
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                            : "bg-neutral-900 text-neutral-400"
                        }`}
                      >
                        {novaFaixaInedita ? "Música Não Existente" : "Música Existente"}
                      </button>

                      {novaFaixaInedita ? (
                        <>
                          <input
                            type="text"
                            value={novaFaixaTitulo}
                            onChange={(e) => setNovaFaixaTitulo(e.target.value)}
                            placeholder="Título da faixa"
                            className="w-full bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-amber-500 focus:outline-none"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={novaFaixaTipoSingle}
                              onChange={(e) => setNovaFaixaTipoSingle(e.target.value)}
                              className="w-full bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                            >
                              {TIPOS_SINGLE_FAIXA.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                            <select
                              value={novaFaixaTipoMusica}
                              onChange={(e) => setNovaFaixaTipoMusica(e.target.value)}
                              className="w-full bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                            >
                              {TIPOS_MUSICA_FAIXA.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <input
                              type="file"
                              accept="audio/*"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) {
                                  setNovaFaixaAudioFile(f);
                                  setNovaFaixaMediaUrl("");
                                }
                              }}
                              className="hidden"
                              id="nova-faixa-audio-input"
                            />
                            <label
                              htmlFor="nova-faixa-audio-input"
                              className="w-full inline-flex items-center gap-2 bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white cursor-pointer hover:border-amber-500 transition"
                            >
                              <Upload className="size-3.5 text-amber-400 shrink-0" />
                              <span className="truncate">
                                {novaFaixaAudioFile ? novaFaixaAudioFile.name : "Fazer upload do áudio"}
                              </span>
                            </label>
                            <p className="text-[10px] text-neutral-500 text-center">ou</p>
                            <input
                              type="text"
                              value={novaFaixaMediaUrl}
                              onChange={(e) => {
                                setNovaFaixaMediaUrl(e.target.value);
                                if (e.target.value) setNovaFaixaAudioFile(null);
                              }}
                              placeholder="Link do Drive ou YouTube (áudio)"
                              className="w-full bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                        </>
                      ) : (
                        <div className="relative">
                          {novaFaixaTitulo ? (
                            <div className="flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                              <span className="text-xs text-white font-bold truncate">
                                {novaFaixaTitulo}
                              </span>
                              <button
                                type="button"
                                onClick={() => setNovaFaixaTitulo("")}
                                className="text-[11px] font-bold text-amber-400 hover:text-amber-300 shrink-0"
                              >
                                Trocar
                              </button>
                            </div>
                          ) : (
                            <>
                              <input
                                type="text"
                                value={novaFaixaBusca}
                                onChange={(e) => setNovaFaixaBusca(e.target.value)}
                                placeholder="Busque a música já lançada nos charts..."
                                className="w-full bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-amber-500 focus:outline-none"
                              />
                              {novaFaixaBusca.trim().length > 0 && (
                                <div className="mt-1 max-h-40 overflow-y-auto bg-neutral-900 border border-white/10 rounded-xl">
                                  {musicasEmChart
                                    .filter((m) =>
                                      m.label.toLowerCase().includes(novaFaixaBusca.trim().toLowerCase()),
                                    )
                                    .slice(0, 20)
                                    .map((m) => (
                                      <button
                                        key={m.label}
                                        type="button"
                                        onClick={() => {
                                          setNovaFaixaTitulo(m.label);
                                          setNovaFaixaBusca("");
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs text-white hover:bg-amber-500/10 border-b border-white/5 last:border-b-0"
                                      >
                                        {m.label}
                                      </button>
                                    ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setAddingFaixa(false)}
                          className="px-3 py-2 rounded-xl bg-neutral-900 text-neutral-400 text-[11px] font-bold uppercase"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={handleAddFaixa}
                          disabled={saving}
                          className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-[11px] font-black uppercase disabled:opacity-50"
                        >
                          {uploadingFaixaAudio
                            ? "Enviando áudio..."
                            : saving
                              ? "Adicionando..."
                              : "Adicionar Faixa"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAddingFaixa(true)}
                      className="inline-flex items-center gap-2 text-xs font-bold text-amber-400 hover:text-amber-300 transition"
                    >
                      <Plus className="size-4" />
                      Adicionar Faixa
                    </button>
                  )}
                </div>
              )}

              {/* DESCRIÇÃO (apenas para Vídeos) */}
              {category === "videos" && (
                <div>
                  <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
                    Nova Descrição
                  </label>
                  <textarea
                    rows={3}
                    value={editDescricao}
                    onChange={(e) => setEditDescricao(e.target.value)}
                    placeholder="Descrição oficial do vídeo/clipe..."
                    className="w-full px-4 py-3 bg-neutral-800 border border-white/10 rounded-2xl text-sm text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              )}

              {/* CAPA / THUMB — pra vídeos, essa é a "Thumb" (coluna T da
                  aba Music Videos) que vira a capa/fundo do vídeo no
                  catálogo; pra música/álbum, a capa do lançamento. */}
              <div className="space-y-3">
                  <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                    <ImageIcon className="size-3.5 text-amber-400" />
                    {category === "videos" ? "Substituir Thumb de Destaque" : "Substituir Capa / Imagem"}
                  </label>

                  <div className="flex items-center gap-4 p-4 bg-neutral-800/40 border border-white/10 rounded-2xl">
                    <div className="size-20 rounded-2xl overflow-hidden bg-black border border-white/10 shrink-0 flex items-center justify-center">
                      {capaPreview ? (
                        <img
                          src={capaPreview.startsWith("blob:") ? capaPreview : driveImg(capaPreview)}
                          alt="Thumb"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <ImageIcon className="size-8 text-neutral-600" />
                      )}
                    </div>

                    <div className="space-y-2">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            setCapaFile(f);
                            setCapaPreview(URL.createObjectURL(f));
                          }
                        }}
                        className="hidden"
                        id="edit-capa-input"
                      />
                      <label
                        htmlFor="edit-capa-input"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 cursor-pointer transition"
                      >
                        <Upload className="size-3.5 text-amber-400" />
                        {capaFile ? capaFile.name : "Escolher Nova Imagem"}
                      </label>
                      <p className="text-[11px] text-neutral-400">
                        A imagem antiga será removida do Drive e substituída pela nova.
                      </p>
                    </div>
                  </div>
              </div>

              {/* ALERTAS */}
              {successMsg && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-400 text-xs font-bold flex items-center gap-3">
                  <CheckCircle2 className="size-5 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              {errorMsg && (
                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-xs font-bold flex items-center gap-3">
                  <AlertCircle className="size-5 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* BOTÃO SALVAR */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-5 py-3 rounded-2xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-bold text-xs uppercase tracking-wider transition"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-black font-black text-xs uppercase tracking-wider transition flex items-center gap-2 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Save className="size-4" />
                      Salvar Alterações
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            /* LISTAGEM DOS LANÇAMENTOS DO ARTISTA */
            <div className="space-y-4">
              {loadingReleases ? (
                <div className="flex flex-col items-center justify-center py-12 text-neutral-400 gap-3">
                  <Loader2 className="size-8 text-amber-400 animate-spin" />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    Buscando lançamentos no catálogo...
                  </span>
                </div>
              ) : fetchError ? (
                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-xs font-bold flex items-center gap-3">
                  <AlertCircle className="size-5" />
                  <span>{fetchError}</span>
                </div>
              ) : releases.length === 0 ? (
                <div className="text-center py-12 text-neutral-500 space-y-2">
                  <Disc className="size-12 mx-auto stroke-1" />
                  <p className="text-sm font-bold">Nenhum lançamento encontrado</p>
                  <p className="text-xs">
                    Não encontramos mídias do artista "{selectedArtist}" na categoria selecinada.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
                    Lançamentos Encontrados ({releases.length}):
                  </p>

                  <div className="grid grid-cols-1 gap-2.5">
                    {releases.map((rel) => (
                      <div
                        key={rel.id}
                        className="flex items-center justify-between p-4 bg-neutral-800/40 hover:bg-neutral-800 border border-white/5 hover:border-amber-500/30 rounded-2xl transition group"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          {rel.capaUrl ? (
                            <img
                              src={driveImg(rel.capaUrl)}
                              alt={rel.titulo}
                              className="size-12 rounded-xl object-cover shrink-0 border border-white/10"
                            />
                          ) : (
                            <div className="size-12 rounded-xl bg-neutral-900 grid place-items-center text-neutral-500 shrink-0 border border-white/5">
                              <Music className="size-6" />
                            </div>
                          )}

                          <div className="min-w-0">
                            <h4 className="text-sm font-black text-white truncate group-hover:text-amber-400 transition">
                              {rel.titulo}
                            </h4>
                            <p className="text-xs text-neutral-400 truncate">
                              {rel.artista} • Linha {rel.rowIndex}
                            </p>
                          </div>
                        </div>

                        {/* BOTAO LÁPIS */}
                        <button
                          onClick={() => handleStartEdit(rel)}
                          className="size-10 rounded-xl bg-neutral-900 group-hover:bg-amber-500 group-hover:text-black text-amber-400 grid place-items-center transition shrink-0 shadow-md"
                          title="Editar esta mídia"
                        >
                          <Pencil className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
