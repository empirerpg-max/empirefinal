import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Play, Pause, ListMusic, Edit, Trash2 } from "lucide-react";
import { api, driveImg, driveAudioSrc, type PlaylistPayload } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";
import { notify } from "@/lib/notify";

export const Route = createFileRoute("/playlists/$id")({ component: PlaylistView });

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
    if (ok) navigate({ to: "/playlists" });
  }

  if (pl === undefined)
    return (
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6">
        <div className="h-64 rounded-2xl bg-card animate-pulse" />
      </main>
    );
  if (pl === null)
    return (
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6">
        <Link to="/playlists" className="text-muted-foreground">
          Voltar
        </Link>
        <p>Playlist não encontrada.</p>
      </main>
    );

  const localId = typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null;
  const isOwner = (pl.telegram_id && String(pl.telegram_id) === String(localId)) || localId === "810141686";

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl pb-32">
      <div
        className="px-4 pt-4 pb-6"
        style={{ background: "linear-gradient(180deg, oklch(0.32 0.16 145 / 0.55), transparent)" }}
      >
        <Link to="/playlists" className="inline-flex items-center gap-1 text-foreground/80 mb-4">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="flex items-end gap-4">
          <div className="size-40 rounded-xl bg-secondary overflow-hidden grid place-items-center shadow-2xl">
            {pl.capa_url ? (
              <img src={driveImg(pl.capa_url, 500)} alt="" className="w-full h-full object-cover"  loading="lazy" decoding="async"/>
            ) : (
              <ListMusic className="size-14 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0 pb-2">
            <p className="text-[10px] uppercase font-bold tracking-widest">Playlist</p>
            <h1 className="text-3xl font-black leading-tight">{pl.titulo}</h1>
            <p className="text-xs text-muted-foreground mt-1">
              {pl.owner} • {pl.tracks.length} faixas
            </p>
            {pl.descricao && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{pl.descricao}</p>
            )}
          </div>
        </div>
        {isOwner && (
          <div className="flex gap-2 mt-4">
            <Link
              to="/playlists/$id/editar"
              params={{ id }}
              className="px-3 py-2 rounded-full bg-card border border-border text-xs font-bold inline-flex items-center gap-1"
            >
              <Edit className="size-3.5" /> Editar
            </Link>
            <button
              onClick={excluir}
              className="px-3 py-2 rounded-full bg-card border border-border text-xs font-bold inline-flex items-center gap-1 text-destructive"
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
              className={`grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 px-2 py-2 rounded-lg ${active ? "bg-primary/10" : "hover:bg-card"}`}
            >
              <button
                onClick={() => setPlaying(active ? null : i)}
                className="size-10 grid place-items-center"
              >
                {t.capa_url ? (
                  <img
                    src={driveImg(t.capa_url, 80)}
                    alt=""
                    className="size-10 rounded object-cover"
                   loading="lazy" decoding="async"/>
                ) : (
                  <span>{i + 1}</span>
                )}
              </button>
              <div className="min-w-0">
                <p className={`font-semibold truncate text-sm ${active ? "text-primary" : ""}`}>
                  {t.titulo}
                </p>
                <p className="text-xs text-muted-foreground truncate">{t.artistas}</p>
              </div>
              <button
                onClick={() => setPlaying(active ? null : i)}
                className="text-muted-foreground"
              >
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
        <div className="fixed bottom-20 inset-x-0 z-30 bg-card border-t border-border">
          <div className="mx-auto max-w-2xl px-4 py-2 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold truncate">{pl.tracks[playing].titulo}</p>
              <p className="text-[10px] text-muted-foreground truncate">
                {pl.tracks[playing].artistas}
              </p>
            </div>
            <button onClick={() => setPlaying(null)} className="text-xs text-muted-foreground">
              Fechar
            </button>
          </div>
          <iframe
            src={driveAudioSrc(pl.tracks[playing].drive_url)}
            className="w-full h-16 border-0"
            allow="autoplay"
            title="player"
          />
        </div>
      )}
    </main>
  );
}
