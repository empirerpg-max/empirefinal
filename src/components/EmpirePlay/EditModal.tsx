import React, { useState, useEffect } from "react";
import {
  X,
  Pencil,
  Music,
  Video,
  Film,
  Disc,
  User,
  Upload,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Image as ImageIcon,
  Save,
} from "lucide-react";

export type EditCategory = "musicas" | "videos" | "music-videos" | "albuns";

export interface ReleaseItem {
  id: string;
  rowIndex: number;
  tipo: EditCategory;
  titulo: string;
  artista: string;
  descricao?: string;
  capaUrl?: string;
}

interface EditModalProps {
  isOpen: boolean;
  onClose: () => void;
  associatedArtists?: string[];
  defaultArtist?: string;
}

const CATEGORIES = [
  { id: "musicas", label: "Músicas", icon: Music, desc: "Singles e Faixas Solas" },
  { id: "videos", label: "Vídeos", icon: Video, desc: "Vídeos do Catálogo" },
  { id: "music-videos", label: "Music Videos", icon: Film, desc: "Clipes e Visuais" },
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

              {/* DESCRIÇÃO (apenas para Vídeos e Music Videos) */}
              {(category === "videos" || category === "music-videos") && (
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

              {/* CAPA / THUMB (apenas para Músicas, Music Videos e Álbuns) */}
              {category !== "videos" && (
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                    <ImageIcon className="size-3.5 text-amber-400" />
                    Substituir Capa / Imagem
                  </label>

                  <div className="flex items-center gap-4 p-4 bg-neutral-800/40 border border-white/10 rounded-2xl">
                    <div className="size-20 rounded-2xl overflow-hidden bg-black border border-white/10 shrink-0 flex items-center justify-center">
                      {capaPreview ? (
                        <img src={capaPreview} alt="Thumb" className="w-full h-full object-cover" />
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
              )}

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
                              src={rel.capaUrl}
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
