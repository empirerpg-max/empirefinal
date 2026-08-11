import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, type PlaylistPayload } from "@/lib/api";
import { PlaylistEditor } from "@/components/PlaylistEditor";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/empire-play/playlists/$id/editar")({
  component: EditPlaylistPage,
});

function EditPlaylistPage() {
  const { id } = Route.useParams();
  const [playlist, setPlaylist] = useState<PlaylistPayload | null | undefined>(undefined);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    api.getPlaylist(id).then((pl) => {
      if (!pl) {
        setPlaylist(null);
        return;
      }
      const localId = typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null;
      if (pl.telegram_id && localId && localId !== "810141686" && String(pl.telegram_id) !== String(localId)) {
        setUnauthorized(true);
      } else {
        setPlaylist(pl);
      }
    });
  }, [id]);

  if (unauthorized) {
    return (
      <div className="flex items-center justify-center p-6 text-center flex-col gap-4">
        <h1 className="text-xl font-bold text-white">Acesso Negado</h1>
        <p className="text-neutral-400 text-sm">Você não tem permissão para editar esta playlist.</p>
        <Link to="/empire-play/playlists/$id" params={{ id }} className="text-emerald-500 font-bold">
          Voltar
        </Link>
      </div>
    );
  }

  if (playlist === undefined) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (playlist === null) {
    return (
      <div className="flex items-center justify-center p-6 text-center">
        <p className="text-neutral-400">Playlist não encontrada.</p>
      </div>
    );
  }

  return <PlaylistEditor existing={playlist} />;
}
