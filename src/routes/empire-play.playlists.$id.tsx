import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Play, Pause, ListMusic, Edit, Trash2 } from "lucide-react";
import { api, driveImg, driveAudioSrc, isYoutubeUrl, youtubeEmbedSrc, type PlaylistPayload } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";
import { notify } from "@/lib/notify";

export const Route = createFileRoute("/empire-play/playlists/$id")({ component: PlaylistView });

function PlaylistView() {
  const { id } = Route.useParams();
  const { user } = useTelegramUser();
  const navigate = useNavigate();
  const [pl, setPl] = useState<PlaylistPayload | null | undefined>(undefined);
  const [playing, setPlaying] = useState<number | null>(null);

  useEffect(() => {
    api.getPlaylist(id).then(setPl);
  }, [id]);

  async function excluir() {
    if (!confirm("Excluir essa playlist?")) return;
    const r = (await api.excluirPlaylist(id, user?.id)) as string;
    const { ok } = notify(r, { successFallback: "Playlist excluída." });
    if (ok) navigate({ to: "/empire-play/playlists" });
  }

  if (pl === undefined)
    return (
      <div>
        <div className="h-64 rounded-3xl bg-white/5 animate-pulse" />
      </div>
    );
  if (pl === null)
    return (
      <div>
        <Link to="/empire-play/playlists" className="text-neutral-400">
          Voltar
        </Link>
        <p className="text-white mt-2">Playlist não encontrada.</p>
      </div>
    );

  const localId = typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null;
  const isOwner = (pl.telegram_id && String(pl.telegram_id) === String(localId)) || localId === "810141686";

  return (
    <div className="-mx-3 sm:-mx-4 pb-8">
      <div
        className="px-4 pt-2 pb-6"
        style={{ background: "linear-gradient(180deg, rgba(16,185,129,0.16), transparent)" }}
      >
        <Link to="/empire-play/playlists" className="inline-flex items-center gap-1 text-white/80 mb-4">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="flex items-end gap-4">
          <div className="size-32 sm:size-40 rounded-2xl bg-neutral-800 overflow-hidden grid place-items-center shadow-2xl shrink-0">
            {pl.capa_url ? (
              <img
                src={driveImg(pl.capa_url, 500)}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : (
              <ListMusic className="size-14 text-neutral-500" />
            )}
          </div>
          <div className="flex-1 min-w-0 pb-2">
            <p className="text-[10px] uppercase font-black tracking-widest text-emerald-500">Playlist</p>
            <h1 className="text-2xl sm:text-3xl font-black leading-tight text-white">{pl.titulo}</h1>
            <p className="text-xs text-neutral-400 mt-1">
              {pl.owner} • {pl.tracks.length} faixas
            </p>
            {pl.descricao && (
              <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{pl.descricao}</p>
            )}
          </div>
        </div>
        {isOwner && (
          <div className="flex gap-2 mt-4">
            <Link
              to="/empire-play/playlists/$id/editar"
              params={{ id }}
              className="px-3 py-2 rounded-full bg-white/5 border border-white/10 text-xs font-bold text-white inline-flex items-center gap-1"
            >
              <Edit className="size-3.5" /> Editar
            </Link>
            <button
              onClick={excluir}
              className="px-3 py-2 rounded-full bg-white/5 border border-white/10 text-xs font-bold inline-flex items-center gap-1 text-red-400"
            >
              <Trash2 className="size-3.5" /> Excluir
            </button>
          </div>
        )}
      </div>
      <ul className="px-4">
        {pl.tracks.map((t, i) => {
          const active = playing === i;
          return (
            <li
              key={i}
              className={`grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 px-2 py-2 rounded-xl ${active ? "bg-emerald-500/10" : "hover:bg-white/5"}`}
            >
              <button
                onClick={() => setPlaying(active ? null : i)}
                className="size-10 grid place-items-center"
              >
                {t.capa_url ? (
                  <img
                    src={driveImg(t.capa_url, 80)}
                    alt=""
                    className="size-10 rounded-lg object-cover"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="text-neutral-500">{i + 1}</span>
                )}
              </button>
              <div className="min-w-0">
                <p className={`font-semibold truncate text-sm ${active ? "text-emerald-500" : "text-white"}`}>
                  {t.titulo}
                </p>
                <p className="text-xs text-neutral-500 truncate">{t.artistas}</p>
              </div>
              <button onClick={() => setPlaying(active ? null : i)} className="text-neutral-400">
                {active ? (
                  <Pause className="size-4" fill="currentColor" />
                ) : (
                  <Play className="size-4" fill="currentColor" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {playing !== null && pl.tracks[playing]?.drive_url && (
        <div className="fixed bottom-20 inset-x-0 z-30 bg-neutral-900 border-t border-white/10">
          <div className="mx-auto max-w-2xl px-4 py-2 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-white truncate">{pl.tracks[playing].titulo}</p>
              <p className="text-[10px] text-neutral-500 truncate">{pl.tracks[playing].artistas}</p>
            </div>
            <button onClick={() => setPlaying(null)} className="text-xs text-neutral-400">
              Fechar
            </button>
          </div>
          <iframe
            src={
              isYoutubeUrl(pl.tracks[playing].drive_url)
                ? youtubeEmbedSrc(pl.tracks[playing].drive_url)
                : driveAudioSrc(pl.tracks[playing].drive_url)
            }
            className={`w-full border-0 ${isYoutubeUrl(pl.tracks[playing].drive_url) ? "h-48" : "h-16"}`}
            allow="autoplay"
            title="player"
          />
        </div>
      )}
    </div>
  );
}
