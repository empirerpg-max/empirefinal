import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ListMusic, Loader2, Plus, Trash2, Search, GripVertical } from "lucide-react";
import {
  api,
  driveImg,
  type AlbumPayload,
  type PlaylistPayload,
  type PlaylistTrack,
} from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";
import { notify } from "@/lib/notify";

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

  useEffect(() => {
    api.listarFaixasCatalogo().then(data => {
      setCatalog(data);
    }).catch(err => {
      console.error("Erro ao carregar catálogo:", err);
      setCatalog([]);
    });
  }, []);

  async function handleSearch() {
    if (!q.trim()) return;
    try {
      const results = await api.searchSongs(q);
      // Mesclar resultados da busca no catálogo local se não existirem
      setCatalog(prev => {
        const existingIds = new Set((prev || []).map(t => `${t.album_id}-${t.numero}`));
        const newOnes = results.filter(r => !existingIds.has(`${r.album_id}-${r.numero}`));
        return [...(prev || []), ...newOnes];
      });
    } catch (e) {
      console.error("Erro na busca remota:", e);
    }
  }

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
      if (id) navigate({ to: "/playlists/$id", params: { id } });
      else navigate({ to: "/playlists" });
    }
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-32">
      <Link to="/playlists" className="inline-flex items-center gap-1 text-muted-foreground mb-4">
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
                 loading="lazy" decoding="async"/>
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
          Catálogo
        </h2>
        <div className="relative mb-2 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Buscar faixa ou artista"
              className="w-full bg-card border border-border rounded-xl pl-9 pr-3 py-2.5 text-sm"
            />
          </div>
          <button 
            onClick={handleSearch}
            className="px-4 py-2.5 bg-secondary text-foreground rounded-xl text-xs font-bold active:scale-95 transition-transform"
          >
            Buscar
          </button>
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
      </section>

      <button
        onClick={salvar}
        disabled={submitting || !titulo || tracks.length === 0}
        className="w-full py-3.5 rounded-full bg-primary text-primary-foreground font-extrabold uppercase tracking-wider text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 className="size-4 animate-spin" />}{" "}
        {existing ? "Salvar alterações" : "Criar playlist"}
      </button>
    </main>
  );
}
