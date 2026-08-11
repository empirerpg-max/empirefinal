import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ListMusic, Plus } from "lucide-react";
import { api, driveImg, type PlaylistPayload } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";

export const Route = createFileRoute("/empire-play/playlists/")({
  component: PlaylistsPage,
  head: () => ({
    meta: [
      { title: "Playlists — Catálogo" },
      { name: "description", content: "Crie e ouça playlists com músicas dos álbuns lançados." },
    ],
  }),
});

function playlistCover(p: PlaylistPayload): string | undefined {
  // Prioridade: capa manual → capa da 1ª faixa
  if (p.capa_url) return driveImg(p.capa_url, 200);
  const firstCover = p.tracks?.[0]?.capa_url;
  if (firstCover) return driveImg(firstCover, 200);
  return undefined;
}

function PlaylistsPage() {
  const { user, ready } = useTelegramUser();
  const [list, setList] = useState<PlaylistPayload[] | null>(null);
  useEffect(() => {
    if (ready) api.listarPlaylists(user?.id).then(setList);
  }, [ready, user]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <ListMusic className="size-6 text-emerald-500" />
          <div>
            <p className="text-[10px] uppercase tracking-widest text-neutral-500 font-black">Suas curadorias</p>
            <h1 className="text-xl font-black text-white">Playlists</h1>
          </div>
        </div>
        <Link
          to="/empire-play/playlists/nova"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-full bg-emerald-500 text-black text-xs font-black uppercase tracking-wider active:scale-95 transition-transform"
        >
          <Plus className="size-4" /> Nova
        </Link>
      </div>

      {list === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded-2xl bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-3xl bg-neutral-900 border border-white/10 p-8 text-center mt-2">
          <ListMusic className="size-10 mx-auto text-neutral-600 mb-2" />
          <p className="text-sm text-neutral-400">Você ainda não criou playlists.</p>
          <Link
            to="/empire-play/playlists/nova"
            className="inline-flex mt-4 px-4 py-2 rounded-full bg-emerald-500 text-black text-xs font-black uppercase"
          >
            Criar primeira
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((p) => {
            const cover = playlistCover(p);
            return (
              <Link
                key={p.id}
                to="/empire-play/playlists/$id"
                params={{ id: p.id! }}
                className="flex items-center gap-3 p-2.5 rounded-2xl bg-neutral-900 border border-white/10 hover:bg-neutral-800 transition-colors"
              >
                <div className="size-14 rounded-xl bg-neutral-800 overflow-hidden grid place-items-center shrink-0">
                  {cover ? (
                    <img
                      src={cover}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <ListMusic className="size-6 text-neutral-500" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm text-white truncate">{p.titulo}</p>
                  <p className="text-xs text-neutral-500 truncate">{p.tracks?.length || 0} faixas</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
