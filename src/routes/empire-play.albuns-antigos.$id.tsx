import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Disc3, Play, FileText, X } from "lucide-react";
import { api, driveImg } from "@/lib/api";
import { useEmpirePlayer } from "@/components/EmpirePlay/PlayerContext";
import { type PlayableTrack } from "@/components/EmpirePlay/MusicPlayer";

export const Route = createFileRoute("/empire-play/albuns-antigos/$id")({
  component: AlbumAntigoDetail,
});

function AlbumAntigoDetail() {
  const { id } = Route.useParams();
  const { playSong, currentTrack } = useEmpirePlayer();
  const [album, setAlbum] = useState<Awaited<ReturnType<typeof api.getAlbumAntigo>> | null | undefined>(undefined);
  const [showLyrics, setShowLyrics] = useState<number | null>(null);

  useEffect(() => {
    api.getAlbumAntigo(id).then(setAlbum);
  }, [id]);

  if (album === undefined) return <div className="h-64 rounded-3xl bg-white/5 animate-pulse" />;
  if (album === null)
    return (
      <div>
        <Link to="/empire-play/albuns-antigos" className="text-neutral-400">
          Voltar
        </Link>
        <p className="text-white mt-2">Álbum não encontrado.</p>
      </div>
    );

  function toPlayable(f: NonNullable<typeof album>["faixas"][number]): PlayableTrack {
    return {
      titulo: f.titulo,
      artista: f.artistas || album!.artista,
      capa_url: album!.capa_url,
      drive_url: f.drive_url,
      duracao: f.duracao,
    };
  }

  return (
    <div className="-mx-3 sm:-mx-4 pb-8">
      <div
        className="px-4 pt-2 pb-6"
        style={{ background: "linear-gradient(180deg, rgba(16,185,129,0.16), transparent)" }}
      >
        <Link to="/empire-play/albuns-antigos" className="inline-flex items-center gap-1 text-white/80 mb-4">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="flex items-end gap-4">
          <div className="size-32 sm:size-40 rounded-2xl bg-neutral-800 overflow-hidden grid place-items-center shadow-2xl shrink-0">
            {album.capa_url ? (
              <img
                src={driveImg(album.capa_url, 500)}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : (
              <Disc3 className="size-14 text-neutral-500" />
            )}
          </div>
          <div className="flex-1 min-w-0 pb-2">
            <p className="text-[10px] uppercase font-black tracking-widest text-emerald-500">Álbum</p>
            <h1 className="text-2xl sm:text-3xl font-black leading-tight text-white">{album.titulo}</h1>
            <p className="text-xs text-neutral-400 mt-1">
              {album.artista} • {album.faixas.length} faixas
            </p>
            {album.descricao && <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{album.descricao}</p>}
          </div>
        </div>
      </div>

      <ul className="px-4">
        {album.faixas.map((f, i) => {
          const active = currentTrack?.drive_url && currentTrack.drive_url === f.drive_url;
          return (
            <li
              key={i}
              onClick={() => playSong(toPlayable(f), album.faixas.map(toPlayable))}
              className={`grid grid-cols-[2.5rem_1fr_auto_auto] items-center gap-3 px-2 py-2 rounded-xl cursor-pointer ${active ? "bg-emerald-500/10" : "hover:bg-white/5"}`}
            >
              <span className="text-neutral-500 text-center">{f.numero || i + 1}</span>
              <div className="min-w-0">
                <p className={`font-semibold truncate text-sm ${active ? "text-emerald-500" : "text-white"}`}>
                  {f.titulo}
                </p>
                <p className="text-xs text-neutral-500 truncate">{f.artistas || album.artista}</p>
              </div>
              {f.letra && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowLyrics(i);
                  }}
                  className="text-neutral-500 hover:text-white"
                  title="Ver letra"
                >
                  <FileText className="size-4" />
                </button>
              )}
              <div className={active ? "text-emerald-500" : "text-neutral-400"}>
                <Play className="size-4" fill="currentColor" />
              </div>
            </li>
          );
        })}
      </ul>

      {showLyrics !== null && album.faixas[showLyrics] && (
        <div
          onClick={() => setShowLyrics(null)}
          className="fixed inset-0 z-50 bg-black/90 grid place-items-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-neutral-900 border border-white/10 rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6"
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-[10px] uppercase font-black tracking-widest text-emerald-500">Letra</p>
                <h3 className="text-lg font-black text-white">{album.faixas[showLyrics].titulo}</h3>
                <p className="text-xs text-neutral-500">{album.faixas[showLyrics].artistas || album.artista}</p>
              </div>
              <button onClick={() => setShowLyrics(null)} className="text-neutral-400 shrink-0">
                <X className="size-5" />
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-sm font-sans text-neutral-200">
              {album.faixas[showLyrics].letra}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
