import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Disc3, Trash2, Upload, Link2, Loader2, Plus, ImageIcon } from "lucide-react";
import { api, driveImg } from "@/lib/api";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { notify } from "@/lib/notify";

export const Route = createFileRoute("/empire-play/gestao/album-antigo")({
  component: AlbumAntigoPage,
});

type FaixaAntiga = {
  titulo: string;
  artistas: string;
  duracao: string;
  drive_url: string;
};

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
  const tgId = (typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null) || user?.id || "";

  const [artista, setArtista] = useState("");
  const [titulo, setTitulo] = useState("");
  const [genero, setGenero] = useState("");
  const [data, setData] = useState("");
  const [descricao, setDescricao] = useState("");
  const [capaUrl, setCapaUrl] = useState("");
  const [uploadingCapa, setUploadingCapa] = useState(false);

  const [faixas, setFaixas] = useState<FaixaAntiga[]>([]);
  const [trackTab, setTrackTab] = useState<"upload" | "link">("upload");
  const [trackTitulo, setTrackTitulo] = useState("");
  const [trackArtistas, setTrackArtistas] = useState("");
  const [trackLink, setTrackLink] = useState("");
  const [uploadingTrack, setUploadingTrack] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function addFaixa(drive_url: string) {
    setFaixas((prev) => [
      ...prev,
      { titulo: trackTitulo.trim(), artistas: trackArtistas.trim() || artista.trim(), duracao: "", drive_url },
    ]);
    setTrackTitulo("");
    setTrackArtistas("");
    setTrackLink("");
  }

  async function handleTrackFileUpload(file: File) {
    if (!trackTitulo.trim()) return;
    setUploadingTrack(true);
    const url = await uploadToDrive(file, "playlistTracks");
    setUploadingTrack(false);
    if (url) addFaixa(url);
  }

  function handleAddLinkTrack() {
    if (!trackTitulo.trim() || !trackLink.trim()) return;
    addFaixa(trackLink.trim());
  }

  function removeFaixa(i: number) {
    setFaixas((prev) => prev.filter((_, idx) => idx !== i));
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

  async function handleCapaUpload(file: File) {
    setUploadingCapa(true);
    const url = await uploadToDrive(file, "album");
    setUploadingCapa(false);
    if (url) setCapaUrl(url);
  }

  async function salvar() {
    if (!artista.trim() || !titulo.trim() || faixas.length === 0 || submitting) return;
    setSubmitting(true);
    const res = await api.criarAlbumAntigo({
      artista: artista.trim(),
      titulo: titulo.trim(),
      genero: genero.trim(),
      data: data || undefined,
      descricao: descricao.trim(),
      capa_url: capaUrl,
      telegram_id: tgId,
      faixas: faixas.map((f, i) => ({
        numero: i + 1,
        titulo: f.titulo,
        artistas: f.artistas,
        duracao: f.duracao,
        drive_url: f.drive_url,
      })),
    });
    setSubmitting(false);
    const { ok } = notify(res as Record<string, unknown>, { successFallback: "Álbum cadastrado!" });
    if (ok) navigate({ to: "/empire-play/gestao" });
  }

  const inputCls =
    "w-full bg-neutral-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-emerald-500/50";

  return (
    <div className="pb-24 max-w-lg mx-auto">
      <Link to="/empire-play/gestao" className="inline-flex items-center gap-1 text-neutral-400 mb-4">
        <ChevronLeft className="size-4" /> Voltar
      </Link>

      <header className="mb-6 flex items-center gap-3">
        <Disc3 className="size-7 text-emerald-500" />
        <div>
          <p className="text-[10px] uppercase tracking-widest text-neutral-500 font-black">Catálogo</p>
          <h1 className="text-xl font-black text-white">Cadastrar álbum antigo</h1>
        </div>
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
        <input value={artista} onChange={(e) => setArtista(e.target.value)} placeholder="Artista" className={inputCls} />
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
          Faixas ({faixas.length})
        </h2>
        {faixas.length > 0 && (
          <ul className="space-y-1 mb-3">
            {faixas.map((f, i) => (
              <li key={i} className="flex items-center gap-2 p-2 rounded-lg bg-neutral-900 border border-white/5">
                <span className="text-xs text-neutral-500 w-5 text-center shrink-0">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white truncate">{f.titulo}</p>
                  <p className="text-[10px] text-neutral-500 truncate">{f.artistas}</p>
                </div>
                <button type="button" onClick={() => moveFaixa(i, -1)} className="text-neutral-500 text-xs px-1">
                  ▲
                </button>
                <button type="button" onClick={() => moveFaixa(i, 1)} className="text-neutral-500 text-xs px-1">
                  ▼
                </button>
                <button type="button" onClick={() => removeFaixa(i)} className="text-red-400 px-1">
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-2 gap-1.5 p-1 bg-neutral-900 border border-white/10 rounded-xl mb-3">
          <button
            type="button"
            onClick={() => setTrackTab("upload")}
            className={`py-2 rounded-lg text-[11px] font-black uppercase tracking-wide inline-flex items-center justify-center gap-1 ${trackTab === "upload" ? "bg-emerald-500 text-black" : "text-neutral-400"}`}
          >
            <Upload className="size-3.5" /> Upload
          </button>
          <button
            type="button"
            onClick={() => setTrackTab("link")}
            className={`py-2 rounded-lg text-[11px] font-black uppercase tracking-wide inline-flex items-center justify-center gap-1 ${trackTab === "link" ? "bg-emerald-500 text-black" : "text-neutral-400"}`}
          >
            <Link2 className="size-3.5" /> Link
          </button>
        </div>

        <div className="space-y-2 bg-neutral-900/50 rounded-2xl border border-dashed border-white/10 p-4">
          <input
            value={trackTitulo}
            onChange={(e) => setTrackTitulo(e.target.value)}
            placeholder="Título da faixa"
            className={inputCls}
          />
          <input
            value={trackArtistas}
            onChange={(e) => setTrackArtistas(e.target.value)}
            placeholder={`Artista (padrão: ${artista || "o mesmo do álbum"})`}
            className={inputCls}
          />

          {trackTab === "upload" ? (
            <label
              className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors ${
                !trackTitulo.trim() || uploadingTrack
                  ? "bg-white/5 text-neutral-500 cursor-not-allowed"
                  : "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
              }`}
            >
              {uploadingTrack ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {uploadingTrack ? "Enviando…" : "Escolher arquivo de áudio"}
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                disabled={!trackTitulo.trim() || uploadingTrack}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleTrackFileUpload(file);
                  e.target.value = "";
                }}
              />
            </label>
          ) : (
            <>
              <input
                value={trackLink}
                onChange={(e) => setTrackLink(e.target.value)}
                placeholder="Link do YouTube ou Google Drive"
                className={inputCls}
              />
              <button
                type="button"
                onClick={handleAddLinkTrack}
                disabled={!trackTitulo.trim() || !trackLink.trim()}
                className="w-full py-3 rounded-xl bg-emerald-500/15 text-emerald-400 text-xs font-bold uppercase tracking-wide disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                <Plus className="size-4" /> Adicionar faixa
              </button>
            </>
          )}
        </div>
      </section>

      <button
        onClick={() => {
          haptic.selection();
          salvar();
        }}
        disabled={submitting || !artista.trim() || !titulo.trim() || faixas.length === 0}
        className="w-full py-3.5 rounded-full bg-emerald-500 text-black font-black uppercase tracking-wider text-sm disabled:opacity-40 inline-flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 className="size-4 animate-spin" />}
        Cadastrar álbum
      </button>
    </div>
  );
}
