import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  Disc3,
  Trash2,
  Upload,
  Loader2,
  ImageIcon,
  FileText,
  ChevronDown,
  ChevronUp,
  Search,
} from "lucide-react";
import { api, driveImg, type Artist } from "@/lib/api";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { notify } from "@/lib/notify";

export const Route = createFileRoute("/empire-play/gestao/album-antigo")({
  component: AlbumAntigoPage,
  validateSearch: (search: Record<string, unknown>): { id?: string } => {
    const id = search.id as string | undefined;
    return id ? { id } : {};
  },
});

type FaixaAntiga = {
  titulo: string;
  artistas: string;
  duracao: string;
  drive_url: string;
  letra: string;
};

function faixaVazia(artistaPadrao: string): FaixaAntiga {
  return { titulo: "", artistas: artistaPadrao, duracao: "", drive_url: "", letra: "" };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}

async function uploadToDrive(file: File, folderType: "playlistTracks" | "album"): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("fileName", file.name);
    formData.append("folderType", folderType);
    const res = await fetch("/api/gestao/upload", { method: "POST", body: formData });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success && data?.data?.fileUrl) return data.data.fileUrl;
  } catch (err) {
    console.warn("[AlbumAntigo] Upload por FormData falhou, tentando Base64:", err);
  }
  try {
    const base64 = await fileToBase64(file);
    const res = await fetch("/api/gestao/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || (folderType === "album" ? "image/jpeg" : "audio/mpeg"),
        base64Data: base64,
        folderType,
      }),
    });
    const data = await res.json().catch(() => null);
    if (data?.data?.fileUrl) return data.data.fileUrl;
  } catch (err) {
    console.warn("[AlbumAntigo] Upload por Base64 falhou:", err);
  }
  return null;
}

function AlbumAntigoPage() {
  const { user } = useTelegramUser();
  const navigate = useNavigate();
  const { id: editId } = Route.useSearch();
  const tgId = (typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null) || user?.id || "";
  const [loadingEdit, setLoadingEdit] = useState(!!editId);
  const [deleting, setDeleting] = useState(false);

  const [artista, setArtista] = useState("");
  const [artistas, setArtistas] = useState<Artist[] | null>(null);
  const [artistaQuery, setArtistaQuery] = useState("");
  const [artistaAberto, setArtistaAberto] = useState(false);

  useEffect(() => {
    api.listarTodos().then(setArtistas).catch(() => setArtistas([]));
  }, []);

  const artistasFiltrados = useMemo(() => {
    if (!artistas) return [];
    const q = artistaQuery.trim().toLowerCase();
    const lista = q ? artistas.filter((a) => a.nome.toLowerCase().includes(q)) : artistas;
    return lista.slice(0, 30);
  }, [artistas, artistaQuery]);
  const [titulo, setTitulo] = useState("");
  const [genero, setGenero] = useState("");
  const [data, setData] = useState("");
  const [descricao, setDescricao] = useState("");
  const [capaUrl, setCapaUrl] = useState("");
  const [uploadingCapa, setUploadingCapa] = useState(false);

  const [faixas, setFaixas] = useState<FaixaAntiga[]>([]);
  const [qtdFaixas, setQtdFaixas] = useState("");
  const [uploadingTrack, setUploadingTrack] = useState<number | null>(null);
  const [letraAberta, setLetraAberta] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!editId) return;
    let alive = true;
    api.getAlbumAntigo(editId).then((album) => {
      if (!alive || !album) {
        if (alive) setLoadingEdit(false);
        return;
      }
      setArtista(album.artista);
      setTitulo(album.titulo);
      setGenero(album.genero || "");
      setData(album.data || "");
      setDescricao(album.descricao || "");
      setCapaUrl(album.capa_url || "");
      setFaixas(
        album.faixas.map((f) => ({
          titulo: f.titulo,
          artistas: f.artistas,
          duracao: f.duracao || "",
          drive_url: f.drive_url,
          letra: f.letra || "",
        })),
      );
      setLoadingEdit(false);
    });
    return () => {
      alive = false;
    };
  }, [editId]);

  async function excluirAlbum() {
    if (!editId || deleting) return;
    if (!confirm("Excluir este álbum legado? Não dá pra desfazer.")) return;
    setDeleting(true);
    const res = await api.deletarAlbumAntigo(editId, tgId);
    setDeleting(false);
    const { ok } = notify(res as Record<string, unknown>, { successFallback: "Álbum excluído." });
    if (ok) navigate({ to: "/empire-play/gestao" });
  }

  function aplicarQuantidade() {
    const n = Math.max(0, Math.min(200, parseInt(qtdFaixas, 10) || 0));
    if (n === 0) return;
    haptic.selection();
    setFaixas((prev) => {
      if (n === prev.length) return prev;
      if (n < prev.length) return prev.slice(0, n);
      return [...prev, ...Array.from({ length: n - prev.length }, () => faixaVazia(artista.trim()))];
    });
  }

  function updateFaixa(i: number, patch: Partial<FaixaAntiga>) {
    setFaixas((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  function addFaixaVazia() {
    haptic.selection();
    setFaixas((prev) => [...prev, faixaVazia(artista.trim())]);
  }

  function removeFaixa(i: number) {
    setFaixas((prev) => prev.filter((_, idx) => idx !== i));
    setLetraAberta((cur) => (cur === i ? null : cur));
  }

  function moveFaixa(i: number, dir: -1 | 1) {
    setFaixas((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function handleTrackFileUpload(i: number, file: File) {
    setUploadingTrack(i);
    const url = await uploadToDrive(file, "playlistTracks");
    setUploadingTrack(null);
    if (url) updateFaixa(i, { drive_url: url });
  }

  async function handleCapaUpload(file: File) {
    setUploadingCapa(true);
    const url = await uploadToDrive(file, "album");
    setUploadingCapa(false);
    if (url) setCapaUrl(url);
  }

  async function salvar() {
    const faixasValidas = faixas.filter((f) => f.titulo.trim() && f.drive_url.trim());
    if (!artista.trim() || !titulo.trim() || faixasValidas.length === 0 || submitting) return;
    setSubmitting(true);
    const faixasPayload = faixasValidas.map((f, i) => ({
      numero: i + 1,
      titulo: f.titulo.trim(),
      artistas: f.artistas.trim() || artista.trim(),
      duracao: f.duracao.trim(),
      drive_url: f.drive_url.trim(),
      letra: f.letra.trim() || undefined,
    }));
    const res = editId
      ? await api.editarAlbumAntigo({
          id: editId,
          tgId,
          artista: artista.trim(),
          titulo: titulo.trim(),
          genero: genero.trim(),
          data: data || undefined,
          descricao: descricao.trim(),
          capa_url: capaUrl,
          faixas: faixasPayload,
        })
      : await api.criarAlbumAntigo({
          artista: artista.trim(),
          titulo: titulo.trim(),
          genero: genero.trim(),
          data: data || undefined,
          descricao: descricao.trim(),
          capa_url: capaUrl,
          telegram_id: tgId,
          faixas: faixasPayload,
        });
    setSubmitting(false);
    const { ok } = notify(res as Record<string, unknown>, {
      successFallback: editId ? "Álbum atualizado!" : "Álbum cadastrado!",
    });
    if (ok) navigate({ to: "/empire-play/gestao" });
  }

  const inputCls =
    "w-full bg-neutral-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-emerald-500/50";
  const faixasProntas = faixas.filter((f) => f.titulo.trim() && f.drive_url.trim()).length;

  if (loadingEdit) {
    return (
      <div className="pb-24 max-w-lg mx-auto flex items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="pb-24 max-w-lg mx-auto">
      <Link to="/empire-play/gestao" className="inline-flex items-center gap-1 text-neutral-400 mb-4">
        <ChevronLeft className="size-4" /> Voltar
      </Link>

      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Disc3 className="size-7 text-emerald-500" />
          <div>
            <p className="text-[10px] uppercase tracking-widest text-neutral-500 font-black">Catálogo</p>
            <h1 className="text-xl font-black text-white">{editId ? "Editar álbum legado" : "Cadastrar álbum antigo"}</h1>
          </div>
        </div>
        {editId && (
          <button
            type="button"
            onClick={excluirAlbum}
            disabled={deleting}
            className="p-2.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50 shrink-0"
            title="Excluir álbum"
          >
            {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </button>
        )}
      </header>

      <div className="space-y-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="size-20 rounded-xl bg-neutral-900 border border-white/10 overflow-hidden grid place-items-center shrink-0">
            {capaUrl ? (
              <img src={driveImg(capaUrl, 200)} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <ImageIcon className="size-6 text-neutral-600" />
            )}
          </div>
          <label
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-white/15 text-xs font-bold uppercase text-neutral-400 cursor-pointer ${uploadingCapa ? "opacity-60 pointer-events-none" : "hover:border-white/30"}`}
          >
            {uploadingCapa ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {uploadingCapa ? "Enviando..." : capaUrl ? "Trocar capa" : "Enviar capa"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploadingCapa}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleCapaUpload(file);
              }}
            />
          </label>
        </div>
        <div className="relative">
          {artista ? (
            <div className={inputCls + " flex items-center justify-between"}>
              <span className="text-white font-bold">{artista}</span>
              <button
                type="button"
                onClick={() => {
                  setArtista("");
                  setArtistaQuery("");
                }}
                className="text-neutral-500 hover:text-white text-[11px] font-black uppercase"
              >
                Trocar
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-neutral-500" />
                <input
                  value={artistaQuery}
                  onChange={(e) => setArtistaQuery(e.target.value)}
                  onFocus={() => setArtistaAberto(true)}
                  onBlur={() => setTimeout(() => setArtistaAberto(false), 150)}
                  placeholder="Buscar artista existente..."
                  className={inputCls + " pl-9"}
                />
              </div>
              {artistaAberto && (
                <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-xl bg-neutral-900 border border-white/10 shadow-2xl">
                  {artistas === null ? (
                    <div className="p-3 text-xs text-neutral-500">Carregando artistas...</div>
                  ) : artistasFiltrados.length === 0 ? (
                    <div className="p-3 text-xs text-neutral-500">Nenhum artista encontrado.</div>
                  ) : (
                    artistasFiltrados.map((a) => (
                      <button
                        key={a.nome}
                        type="button"
                        onMouseDown={() => {
                          setArtista(a.nome);
                          setArtistaQuery("");
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 text-left"
                      >
                        <div className="size-6 rounded-full bg-neutral-800 overflow-hidden shrink-0">
                          {a.foto && (
                            <img src={driveImg(a.foto, 50)} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          )}
                        </div>
                        <span className="text-sm text-white truncate">{a.nome}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título do álbum" className={inputCls} />
        <div className="grid grid-cols-2 gap-2">
          <input value={genero} onChange={(e) => setGenero(e.target.value)} placeholder="Gênero" className={inputCls} />
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={inputCls} />
        </div>
        <textarea
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Descrição (opcional)"
          rows={2}
          className={inputCls + " resize-none"}
        />
      </div>

      <section className="mb-6">
        <h2 className="text-xs uppercase tracking-widest font-black text-neutral-500 mb-2">
          Faixas ({faixasProntas}/{faixas.length})
        </h2>

        <div className="flex gap-2 mb-3">
          <input
            type="number"
            min={1}
            max={200}
            value={qtdFaixas}
            onChange={(e) => setQtdFaixas(e.target.value)}
            placeholder="Quantidade de faixas do álbum"
            className={inputCls}
          />
          <button
            type="button"
            onClick={aplicarQuantidade}
            className="px-4 rounded-xl bg-emerald-500/15 text-emerald-400 text-xs font-black uppercase shrink-0"
          >
            Gerar
          </button>
        </div>

        {faixas.length > 0 && (
          <ul className="space-y-2 mb-3">
            {faixas.map((f, i) => (
              <li key={i} className="rounded-2xl bg-neutral-900 border border-white/5 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500 w-5 text-center shrink-0">{i + 1}</span>
                  <input
                    value={f.titulo}
                    onChange={(e) => updateFaixa(i, { titulo: e.target.value })}
                    placeholder="Título da faixa"
                    className={inputCls}
                  />
                  <button type="button" onClick={() => moveFaixa(i, -1)} className="text-neutral-500 text-xs px-1 shrink-0">
                    ▲
                  </button>
                  <button type="button" onClick={() => moveFaixa(i, 1)} className="text-neutral-500 text-xs px-1 shrink-0">
                    ▼
                  </button>
                  <button type="button" onClick={() => removeFaixa(i)} className="text-red-400 px-1 shrink-0">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                <div className="pl-7 space-y-2">
                  <input
                    value={f.artistas}
                    onChange={(e) => updateFaixa(i, { artistas: e.target.value })}
                    placeholder={`Artista (padrão: ${artista || "o mesmo do álbum"})`}
                    className={inputCls}
                  />

                  <div className="flex gap-2">
                    <input
                      value={f.drive_url}
                      onChange={(e) => updateFaixa(i, { drive_url: e.target.value })}
                      placeholder="Link do YouTube ou Google Drive"
                      className={inputCls}
                    />
                    <label
                      className={`px-3 rounded-xl border border-dashed border-white/15 text-neutral-400 flex items-center justify-center cursor-pointer shrink-0 ${uploadingTrack === i ? "opacity-60 pointer-events-none" : "hover:border-white/30"}`}
                      title="Enviar arquivo de áudio"
                    >
                      {uploadingTrack === i ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Upload className="size-4" />
                      )}
                      <input
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        disabled={uploadingTrack === i}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleTrackFileUpload(i, file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={() => setLetraAberta((cur) => (cur === i ? null : i))}
                    className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-neutral-400 hover:text-white"
                  >
                    <FileText className="size-3.5" />
                    Letra {f.letra.trim() ? "(preenchida)" : "(opcional)"}
                    {letraAberta === i ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  </button>
                  {letraAberta === i && (
                    <textarea
                      value={f.letra}
                      onChange={(e) => updateFaixa(i, { letra: e.target.value })}
                      placeholder="Cole a letra da faixa aqui, pra dar pra acompanhar tocando."
                      rows={5}
                      className={inputCls + " resize-none font-mono text-xs"}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={addFaixaVazia}
          className="w-full py-2.5 rounded-xl border border-dashed border-white/15 text-xs font-bold uppercase text-neutral-400 hover:border-white/30 hover:text-white transition-colors"
        >
          + Adicionar faixa
        </button>
      </section>

      <button
        onClick={() => {
          haptic.selection();
          salvar();
        }}
        disabled={submitting || !artista.trim() || !titulo.trim() || faixasProntas === 0}
        className="w-full py-3.5 rounded-full bg-emerald-500 text-black font-black uppercase tracking-wider text-sm disabled:opacity-40 inline-flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 className="size-4 animate-spin" />}
        {editId ? "Salvar alterações" : "Cadastrar álbum"}
      </button>
    </div>
  );
}
