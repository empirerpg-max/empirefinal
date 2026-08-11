import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Heart, ListMusic, Plus, X, Check, Loader2 } from "lucide-react";
import { api, driveImg, type PlaylistPayload, type PlaylistTrack } from "@/lib/api";
import { useTelegramUser, haptic } from "@/lib/telegram";

export function AddToPlaylistSheet({
  track,
  onClose,
}: {
  track: PlaylistTrack | null;
  onClose: () => void;
}) {
  const { user } = useTelegramUser();
  const tgId = (typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null) || user?.id || "";
  const [myPlaylists, setMyPlaylists] = useState<PlaylistPayload[] | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  useEffect(() => {
    if (!track || !tgId) return;
    api.listarPlaylists().then((all) => {
      setMyPlaylists(all.filter((p) => String(p.telegram_id) === String(tgId)));
    });
    api.listarSalvos(tgId).then((salvos) => {
      setIsSaved(salvos.some((s) => s.drive_url === track.drive_url));
    });
  }, [track, tgId]);

  if (!track) return null;

  async function toggleSalvo() {
    if (!tgId || !track) return;
    haptic.selection();
    if (isSaved) {
      setIsSaved(false);
      await api.removerSalvo(tgId, track.drive_url);
    } else {
      setIsSaved(true);
      await api.salvarFaixa(tgId, track);
    }
  }

  async function addToPlaylist(pl: PlaylistPayload) {
    if (!track || busyId) return;
    setBusyId(pl.id!);
    const already = pl.tracks.some((t) => t.drive_url === track.drive_url);
    if (!already) {
      const payload: PlaylistPayload = { ...pl, tracks: [...pl.tracks, track] };
      await api.salvarPlaylist(payload, tgId);
    }
    setBusyId(null);
    setAddedId(pl.id!);
    haptic.success();
    setTimeout(() => setAddedId(null), 1200);
  }

  async function createWithTrack() {
    if (!newTitle.trim() || !track || creating) return;
    setCreating(true);
    const payload: PlaylistPayload = {
      titulo: newTitle.trim(),
      owner: user?.name || "Player",
      telegram_id: tgId,
      tracks: [track],
      data: new Date().toISOString().slice(0, 10),
    };
    const res = await api.salvarPlaylist(payload, tgId);
    setCreating(false);
    if ((res as any)?.ok) {
      haptic.success();
      setNewTitle("");
      const all = await api.listarPlaylists();
      setMyPlaylists(all.filter((p) => String(p.telegram_id) === String(tgId)));
    }
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
        <motion.div
          initial={{ y: 200 }}
          animate={{ y: 0 }}
          exit={{ y: 200 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-neutral-900 border-t sm:border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] p-5 sm:p-6 max-w-sm w-full shadow-2xl max-h-[85vh] overflow-y-auto"
        >
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-base font-black uppercase text-white truncate pr-2">{track.titulo}</h2>
            <button
              onClick={onClose}
              className="size-8 shrink-0 rounded-full bg-white/5 border border-white/10 grid place-items-center active:scale-90 transition-transform"
            >
              <X className="size-4" />
            </button>
          </div>

          <button
            onClick={toggleSalvo}
            className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/10 mb-4 active:scale-[0.98] transition-transform"
          >
            <Heart className={`size-5 ${isSaved ? "fill-emerald-500 text-emerald-500" : "text-neutral-400"}`} />
            <span className="text-sm font-bold text-white">
              {isSaved ? "Salvo em Suas Curtidas" : "Salvar em Suas Curtidas"}
            </span>
          </button>

          <p className="text-[10px] uppercase tracking-widest text-neutral-500 font-black mb-2">
            Adicionar à playlist
          </p>

          <div className="space-y-1.5 mb-4 max-h-60 overflow-y-auto">
            {myPlaylists === null ? (
              <div className="h-12 rounded-xl bg-white/5 animate-pulse" />
            ) : myPlaylists.length === 0 ? (
              <p className="text-xs text-neutral-500 py-2">Você ainda não tem playlists.</p>
            ) : (
              myPlaylists.map((pl) => {
                const already = pl.tracks.some((t) => t.drive_url === track.drive_url);
                return (
                  <button
                    key={pl.id}
                    onClick={() => addToPlaylist(pl)}
                    disabled={busyId === pl.id}
                    className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors"
                  >
                    <div className="size-10 rounded-lg bg-neutral-800 overflow-hidden grid place-items-center shrink-0">
                      {pl.capa_url ? (
                        <img src={driveImg(pl.capa_url, 100)} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <ListMusic className="size-4 text-neutral-500" />
                      )}
                    </div>
                    <span className="text-sm font-bold text-white truncate flex-1 text-left">{pl.titulo}</span>
                    {busyId === pl.id ? (
                      <Loader2 className="size-4 animate-spin text-neutral-400" />
                    ) : addedId === pl.id || already ? (
                      <Check className="size-4 text-emerald-500" />
                    ) : (
                      <Plus className="size-4 text-neutral-400" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div className="flex gap-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Nova playlist com essa faixa"
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none"
            />
            <button
              onClick={createWithTrack}
              disabled={!newTitle.trim() || creating}
              className="px-4 rounded-xl bg-emerald-500 text-black font-black text-xs uppercase disabled:opacity-40"
            >
              {creating ? <Loader2 className="size-4 animate-spin" /> : "Criar"}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
