import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ListMusic, Loader2, Plus, Trash2, Search, GripVertical, Upload, Link2 } from "lucide-react";
import {
  api,
  driveImg,
  type AlbumPayload,
  type PlaylistPayload,
  type PlaylistTrack,
} from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";
import { notify } from "@/lib/notify";

type AddTab = "catalogo" | "upload" | "link";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}

async function uploadTrackToDrive(file: File): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("fileName", file.name);
    formData.append("folderType", "playlistTracks");
    const res = await fetch("/api/gestao/upload", { method: "POST", body: formData });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success && data?.data?.fileUrl) return data.data.fileUrl;
  } catch (err) {
    console.warn("[PlaylistEditor] Upload por FormData falhou, tentando Base64:", err);
  }
  try {
    const base64 = await fileToBase64(file);
    const res = await fetch("/api/gestao/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || "audio/mpeg",
        base64Data: base64,
        folderType: "playlistTracks",
      }),
    });
    const data = await res.json().catch(() => null);
    if (data?.data?.fileUrl) return data.data.fileUrl;
  } catch (err) {
    console.warn("[PlaylistEditor] Upload por Base64 falhou:", err);
  }
  return null;
}

export function PlaylistEditor({ existing }: { existing?: PlaylistPayload }) {
  const { user } = useTelegramUser();
  const navigate = useNavigate();
  const [titulo, setTitulo] = useState(existing?.titulo || "");
  const [descricao, setDescricao] = useState(existing?.descricao || "");
  const [capa, setCapa] = useState(existing?.capa_url || "");
  const [owner, setOwner] = useState(existing?.owner || "");
  const [tracks, setTracks] = useState<PlaylistTrack[]>(existing?.tracks || []);
  const [catalog, setCatalog] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [addTab, setAddTab] = useState<AddTab>("catalogo");
  const [uploading, setUploading] = useState(false);
  const [manualTitulo, setManualTitulo] = useState("");
  const [manualArtista, setManualArtista] = useState("");
  const [manualLink, setManualLink] = useState("");

  useEffect(() => {
    api.listarFaixasCatalogo().then(data => {
      setCatalog(data);
    }).catch(err => {
      console.error("Erro ao carregar catálogo:", err);
      setCatalog([]);
    });
  }, []);

  function add(t: any) {
    if (tracks.some((x) => x.album_id === t.album_id && x.faixa_numero === t.numero)) return;
    setTracks((prev) => [...prev, {
      album_id: t.album_id,
      faixa_numero: t.numero,
      titulo: t.titulo,
      artistas: t.artistas,
      drive_url: t.drive_url,
      capa_url: t.capa_url || ""
    }]);
  }
  function addManual(track: { titulo: string; artistas: string; drive_url: string; capa_url?: string }) {
    setTracks((prev) => [
      ...prev,
      { album_id: "", faixa_numero: 0, titulo: track.titulo, artistas: track.artistas, drive_url: track.drive_url, capa_url: track.capa_url || "" },
    ]);
  }

  async function handleFileUpload(file: File) {
    if (!manualTitulo.trim() || !manualArtista.trim()) return;
    setUploading(true);
    const url = await uploadTrackToDrive(file);
    setUploading(false);
    if (!url) return;
    addManual({ titulo: manualTitulo.trim(), artistas: manualArtista.trim(), drive_url: url });
    setManualTitulo("");
    setManualArtista("");
  }

  function handleAddLink() {
    if (!manualTitulo.trim() || !manualArtista.trim() || !manualLink.trim()) return;
    addManual({ titulo: manualTitulo.trim(), artistas: manualArtista.trim(), drive_url: manualLink.trim() });
    setManualTitulo("");
    setManualArtista("");
    setManualLink("");
  }

  function rm(i: number) {
    setTracks((prev) => prev.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    setTracks((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const term = q.toLowerCase();
    return catalog
      .filter((t) => 
        String(t.titulo).toLowerCase().includes(term) || 
        String(t.artistas).toLowerCase().includes(term)
      )
      .slice(0, 100);
  }, [catalog, q]);

  async function salvar() {
    if (!titulo || tracks.length === 0) return;
    setSubmitting(true);
    const localTgId = typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null;
    const payload: PlaylistPayload = {
      id: existing?.id,
      titulo,
      descricao,
      capa_url: capa,
      owner: owner || user?.name || "Player",
      telegram_id: localTgId || user?.id,
      tracks,
      data: existing?.data || new Date().toISOString().slice(0, 10),
    };
    const r = await api.salvarPlaylist(payload, localTgId || user?.id);
    setSubmitting(false);
    const { ok } = notify(r as Record<string, unknown>, {
      successFallback: existing ? "Playlist atualizada!" : "Playlist criada!",
    });
    if (ok) {
      const id = ((r as Record<string, unknown>)?.id as string | undefined) || existing?.id;
      if (id) navigate({ to: "/empire-play/playlists/$id", params: { id } });
      else navigate({ to: "/empire-play/playlists" });
    }
  }

  return (
    <div className="pb-32">
      <Link to="/empire-play/playlists" className="inline-flex items-center gap-1 text-neutral-400 mb-4">
        <ChevronLeft className="size-4" /> Voltar
      </Link>
      <header className="mb-5 flex items-center gap-3">
        <ListMusic className="size-7 text-primary" />
        <h1 className="text-2xl font-extrabold">
          {existing ? "Editar playlist" : "Nova playlist"}
        </h1>
      </header>

      <div className="space-y-3 mb-6">
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Título da playlist"
          className="w-full bg-card border border-border rounded-xl px-3 py-3 text-sm"
        />
        <textarea
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Descrição (opcional)"
          rows={2}
          className="w-full bg-card border border-border rounded-xl px-3 py-3 text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={capa}
            onChange={(e) => setCapa(e.target.value)}
            placeholder="Capa (link Drive)"
            className="w-full bg-card border border-border rounded-xl px-3 py-3 text-sm"
          />
          <input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="Curador (você ou artista)"
            className="w-full bg-card border border-border rounded-xl px-3 py-3 text-sm"
          />
        </div>
      </div>

      <section className="mb-6">
        <h2 className="text-xs uppercase tracking-widest font-bold text-muted-foreground mb-2">
          Faixas ({tracks.length})
        </h2>
        {tracks.length === 0 && (
          <p className="text-xs text-muted-foreground py-4">Adicione faixas dos álbuns abaixo.</p>
        )}
        <ul className="space-y-1">
          {tracks.map((t, i) => (
            <li key={i} className="flex items-center gap-2 p-2 rounded-lg bg-card">
              <GripVertical className="size-4 text-muted-foreground" />
              <button
                type="button"
                onClick={() => move(i, -1)}
                className="text-xs text-muted-foreground"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                className="text-xs text-muted-foreground"
              >
                ▼
              </button>
              {t.capa_url && (
                <img
                  src={driveImg(t.capa_url, 80)}
                  alt=""
                  className="size-8 rounded object-cover"
                  loading="lazy" decoding="async" referrerPolicy="no-referrer"/>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold truncate">{t.titulo}</p>
                <p className="text-[10px] text-muted-foreground truncate">{t.artistas}</p>
              </div>
              <button type="button" onClick={() => rm(i)} className="text-destructive">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-xs uppercase tracking-widest font-bold text-muted-foreground mb-2">
          Adicionar faixas
        </h2>

        <div className="grid grid-cols-3 gap-1.5 p-1 bg-card border border-border rounded-xl mb-3">
          <button
            type="button"
            onClick={() => setAddTab("catalogo")}
            className={`py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide inline-flex items-center justify-center gap-1 ${addTab === "catalogo" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            <ListMusic className="size-3.5" /> Catálogo
          </button>
          <button
            type="button"
            onClick={() => setAddTab("upload")}
            className={`py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide inline-flex items-center justify-center gap-1 ${addTab === "upload" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            <Upload className="size-3.5" /> Upload
          </button>
          <button
            type="button"
            onClick={() => setAddTab("link")}
            className={`py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide inline-flex items-center justify-center gap-1 ${addTab === "link" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            <Link2 className="size-3.5" /> Link
          </button>
        </div>

        {addTab === "catalogo" && (
          <>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar faixa ou artista"
                className="w-full bg-card border border-border rounded-xl pl-9 pr-3 py-2.5 text-sm"
              />
            </div>
            {catalog === null ? (
              <div className="h-24 rounded-xl bg-card animate-pulse" />
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center bg-card/50 rounded-2xl border border-dashed border-border">
                <ListMusic className="size-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm font-medium text-muted-foreground">O catálogo está vazio</p>
                <p className="text-[10px] text-muted-foreground mt-1 max-w-[200px] mx-auto uppercase tracking-tighter">
                  Lance um álbum ou use a busca acima para encontrar faixas.
                </p>
              </div>
            ) : (
              <ul className="space-y-1 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
                {filtered.map((t, i) => (
                  <li
                    key={`${t.album_id}-${t.numero}-${i}`}
                    className="flex items-center gap-2 p-2 rounded-lg bg-card hover:bg-secondary"
                  >
                    {t.drive_url && (
                      <div className="size-8 rounded bg-primary/10 grid place-items-center">
                        <ListMusic className="size-4 text-primary" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate">{t.titulo}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{t.artistas}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => add(t)}
                      className="size-8 rounded-full bg-primary/15 text-primary grid place-items-center"
                    >
                      <Plus className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {addTab === "upload" && (
          <div className="space-y-2 bg-card/50 rounded-2xl border border-dashed border-border p-4">
            <input
              value={manualTitulo}
              onChange={(e) => setManualTitulo(e.target.value)}
              placeholder="Título da faixa"
              className="w-full bg-card border border-border rounded-xl px-3 py-2.5 text-sm"
            />
            <input
              value={manualArtista}
              onChange={(e) => setManualArtista(e.target.value)}
              placeholder="Artista"
              className="w-full bg-card border border-border rounded-xl px-3 py-2.5 text-sm"
            />
            <label
              className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors ${
                !manualTitulo.trim() || !manualArtista.trim() || uploading
                  ? "bg-white/5 text-muted-foreground cursor-not-allowed"
                  : "bg-primary/15 text-primary hover:bg-primary/25"
              }`}
            >
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {uploading ? "Enviando…" : "Escolher arquivo de áudio"}
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                disabled={!manualTitulo.trim() || !manualArtista.trim() || uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                  e.target.value = "";
                }}
              />
            </label>
            <p className="text-[10px] text-muted-foreground text-center">
              Preencha título e artista antes de escolher o arquivo.
            </p>
          </div>
        )}

        {addTab === "link" && (
          <div className="space-y-2 bg-card/50 rounded-2xl border border-dashed border-border p-4">
            <input
              value={manualTitulo}
              onChange={(e) => setManualTitulo(e.target.value)}
              placeholder="Título da faixa"
              className="w-full bg-card border border-border rounded-xl px-3 py-2.5 text-sm"
            />
            <input
              value={manualArtista}
              onChange={(e) => setManualArtista(e.target.value)}
              placeholder="Artista"
              className="w-full bg-card border border-border rounded-xl px-3 py-2.5 text-sm"
            />
            <input
              value={manualLink}
              onChange={(e) => setManualLink(e.target.value)}
              placeholder="Link do YouTube ou Google Drive"
              className="w-full bg-card border border-border rounded-xl px-3 py-2.5 text-sm"
            />
            <button
              type="button"
              onClick={handleAddLink}
              disabled={!manualTitulo.trim() || !manualArtista.trim() || !manualLink.trim()}
              className="w-full py-3 rounded-xl bg-primary/15 text-primary text-xs font-bold uppercase tracking-wide disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              <Plus className="size-4" /> Adicionar faixa
            </button>
          </div>
        )}
      </section>

      <button
        onClick={salvar}
        disabled={submitting || !titulo || tracks.length === 0}
        className="w-full py-3.5 rounded-full bg-primary text-primary-foreground font-extrabold uppercase tracking-wider text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 className="size-4 animate-spin" />}{" "}
        {existing ? "Salvar alterações" : "Criar playlist"}
      </button>
    </div>
  );
}
