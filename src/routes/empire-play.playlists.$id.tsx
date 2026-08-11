import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Play, ListMusic, Edit, Trash2 } from "lucide-react";
import { api, driveImg, type PlaylistPayload, type PlaylistTrack } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";
import { notify } from "@/lib/notify";
import { useEmpirePlayer } from "@/components/EmpirePlay/PlayerContext";
import { type PlayableTrack } from "@/components/EmpirePlay/MusicPlayer";

function toPlayableTrack(t: PlaylistTrack): PlayableTrack {
  return {
    titulo: t.titulo,
    artista: t.artistas,
    capa_url: t.capa_url,
    drive_url: t.drive_url,
    duracao: t.duracao,
  };
}

export const Route = createFileRoute("/empire-play/playlists/$id")({ component: PlaylistView });

function PlaylistView() {
  const { id } = Route.useParams();
  const { user } = useTelegramUser();
  const navigate = useNavigate();
  const { playSong, currentTrack } = useEmpirePlayer();
  const [pl, setPl] = useState<PlaylistPayload | null | undefined>(undefined);

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
          const active = currentTrack?.drive_url && currentTrack.drive_url === t.drive_url;
          return (
            <li
              key={i}
              onClick={() => playSong(toPlayableTrack(t), pl.tracks.map(toPlayableTrack))}
              className={`grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 px-2 py-2 rounded-xl cursor-pointer ${active ? "bg-emerald-500/10" : "hover:bg-white/5"}`}
            >
              <div className="size-10 grid place-items-center">
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
              </div>
              <div className="min-w-0">
                <p className={`font-semibold truncate text-sm ${active ? "text-emerald-500" : "text-white"}`}>
                  {t.titulo}
                </p>
                <p className="text-xs text-neutral-500 truncate">{t.artistas}</p>
              </div>
              <div className={active ? "text-emerald-500" : "text-neutral-400"}>
                <Play className="size-4" fill="currentColor" />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
