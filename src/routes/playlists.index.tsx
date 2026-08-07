import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ListMusic, Plus } from "lucide-react";
import { api, driveImg, type PlaylistPayload } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";

export const Route = createFileRoute("/playlists/")({
  component: PlaylistsPage,
  head: () => ({
    meta: [
      { title: "Playlists • Empire Hub" },
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
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6">
      <header className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ListMusic className="size-7 text-primary" />
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold">
              Suas curadorias
            </p>
            <h1 className="text-2xl font-extrabold">Playlists</h1>
          </div>
        </div>
        <Link
          to="/playlists/nova"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-full bg-primary text-primary-foreground text-xs font-extrabold uppercase tracking-wider"
        >
          <Plus className="size-4" /> Nova
        </Link>
      </header>

      {list === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-card animate-pulse" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl bg-card p-8 text-center mt-2">
          <ListMusic className="size-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Você ainda não criou playlists.</p>
          <Link
            to="/playlists/nova"
            className="inline-flex mt-4 px-4 py-2 rounded-full bg-primary text-primary-foreground text-xs font-bold uppercase"
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
                to="/playlists/$id"
                params={{ id: p.id! }}
                className="flex items-center gap-3 p-2 rounded-xl bg-card hover:bg-secondary transition-colors"
              >
                <div className="size-14 rounded-lg bg-secondary overflow-hidden grid place-items-center shrink-0">
                  {cover ? (
                    <img
                      src={cover}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <ListMusic className="size-6 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm truncate">{p.titulo}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {p.tracks?.length || 0} faixas
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
