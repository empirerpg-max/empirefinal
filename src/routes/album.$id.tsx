import { createFileRoute, Link } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  Play,
  Pause,
  Share2,
  Music,
  Image as ImageIcon,
  Disc3,
  Edit,
  MoreVertical,
} from "lucide-react";
import { api, driveImg, driveRawImg, driveAudioSrc, type AlbumPayload, type PlaylistTrack } from "@/lib/api";
import { AddToPlaylistSheet } from "@/components/AddToPlaylistSheet";

export const Route = createFileRoute("/album/$id")({
  component: AlbumPage,
  head: ({ params }) => ({
    meta: [
      { title: `Álbum • Empire Hub` },
      { property: "og:title", content: `Álbum #${params.id} • Empire Hub` },
      { property: "og:description", content: "Ouça e compartilhe este álbum no Empire RPG." },
    ],
  }),
});

function AlbumPage() {
  const { id } = Route.useParams();
  const [album, setAlbum] = useState<AlbumPayload | null | undefined>(undefined);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [showEncarte, setShowEncarte] = useState<string | null>(null);
  const [showLyrics, setShowLyrics] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [menuTrack, setMenuTrack] = useState<PlaylistTrack | null>(null);

  useEffect(() => {
    api.getAlbum(id).then((a) => setAlbum(a));
  }, [id]);

  const shareUrl = useMemo(() => (typeof window !== "undefined" ? window.location.href : ""), []);

  async function share() {
    const url = shareUrl;
    const title = album ? `${album.titulo} — ${album.artista}` : "Empire Hub";
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        console.error("Share failed:", err);
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Clipboard failed:", err);
    }
  }

  if (album === undefined) {
    return (
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6">
        <div className="h-64 rounded-2xl bg-card animate-pulse" />
      </main>
    );
  }
  if (album === null) {
    return (
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6">
        <BackButton />
        <p className="text-sm text-muted-foreground">Álbum não encontrado.</p>
      </main>
    );
  }

  const localTgId = typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null;
  const isOwner = album && localTgId && (String(album.telegram_id) === String(localTgId) || localTgId === "810141686");

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl pb-32">
      <div
        className="relative px-4 pt-4 pb-8"
        style={{
          background: `linear-gradient(180deg, oklch(0.32 0.16 145 / 0.7), oklch(0.12 0 0) 80%)`,
        }}
      >
        <Link to="/" className="inline-flex items-center gap-1 text-foreground/80 mb-4">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="flex flex-col items-center text-center sm:flex-row sm:text-left sm:items-end gap-4">
          <button
            type="button"
            onClick={() => album.capa_url && setShowEncarte(album.capa_url)}
            className="shrink-0"
            title="Ver capa em tela cheia"
          >
            <img
              src={driveImg(album.capa_url, 800)}
              alt={album.titulo}
              className="size-48 sm:size-56 rounded-lg object-cover shadow-2xl bg-secondary"
              loading="eager"
              decoding="async"
            />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase font-bold tracking-widest">Álbum</p>
            <h1 className="text-3xl sm:text-5xl font-black leading-tight mt-1">{album.titulo}</h1>
            {album.descricao && (
              <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap break-words">{album.descricao}</p>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              <span className="font-bold text-foreground">{album.artista}</span>
              {" • "}
              {album.genero}
              {" • "}
              {fmtDate(album.data)}
              {" • "}
              {album.faixas.length} faixa{album.faixas.length !== 1 && "s"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={() => setPlayingIdx(playingIdx === 0 ? null : 0)}
            className="size-14 rounded-full bg-primary text-primary-foreground grid place-items-center hover:scale-105 transition-transform"
            style={{ boxShadow: "var(--shadow-glow)" }}
          >
            {playingIdx !== null ? (
              <Pause className="size-7" fill="currentColor" />
            ) : (
              <Play className="size-7" fill="currentColor" />
            )}
          </button>
          <button
            onClick={share}
            className="px-4 py-2 rounded-full bg-card border border-border inline-flex items-center gap-2 text-sm font-bold"
          >
            <Share2 className="size-4" /> {copied ? "Link copiado!" : "Compartilhar"}
          </button>
          {isOwner && (
            <Link
              to="/album/$id/editar"
              params={{ id }}
              className="px-4 py-2 rounded-full bg-card border border-border inline-flex items-center gap-2 text-sm font-bold"
            >
              <Edit className="size-4" /> Editar
            </Link>
          )}
        </div>
      </div>

      <section className="px-4">
        <ul>
          {album.faixas.map((f, i) => {
            const active = playingIdx === i;
            return (
              <li
                key={i}
                className={`group grid grid-cols-[2rem_1fr_auto_2.5rem_2.5rem] items-center gap-3 px-2 py-2 rounded-lg ${active ? "bg-primary/10" : "hover:bg-card"}`}
              >
                <button
                  onClick={() => setPlayingIdx(active ? null : i)}
                  className="size-8 grid place-items-center text-muted-foreground hover:text-foreground"
                  aria-label={active ? "Pausar" : "Tocar"}
                >
                  {active ? (
                    <Pause className="size-4" fill="currentColor" />
                  ) : (
                    <>
                      <span className="hidden sm:inline sm:group-hover:hidden text-sm">{f.numero}</span>
                      <Play className="size-4 sm:hidden sm:group-hover:block" fill="currentColor" />
                    </>
                  )}
                </button>
                <div className="min-w-0">
                  <button
                    onClick={() => f.letra && setShowLyrics(i)}
                    className={`font-semibold break-words text-sm text-left w-full leading-tight ${active ? "text-primary" : ""} ${f.letra ? "hover:underline" : ""}`}
                    title={f.letra ? "Ver letra" : ""}
                  >
                    {f.titulo}
                    {f.letra ? " ♪" : ""}
                  </button>
                  <p className="text-xs text-muted-foreground break-words">{f.artistas}</p>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {f.duracao || "—"}
                </span>
                <a
                  href={f.drive_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted-foreground hover:text-primary justify-self-end"
                  title="Abrir no Drive"
                >
                  <Music className="size-4" />
                </a>
                <button
                  onClick={() =>
                    setMenuTrack({
                      album_id: album.id || "",
                      faixa_numero: f.numero,
                      titulo: f.titulo,
                      artistas: f.artistas,
                      drive_url: f.drive_url,
                      capa_url: album.capa_url || "",
                      letra: f.letra || "",
                    })
                  }
                  className="text-muted-foreground hover:text-foreground justify-self-end"
                  title="Mais opções"
                >
                  <MoreVertical className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {playingIdx !== null && album.faixas[playingIdx]?.drive_url && (
        <div className="fixed bottom-20 inset-x-0 z-30 bg-card border-t border-border">
          <div className="mx-auto max-w-2xl px-4 py-2 flex items-center gap-3">
            <img
              src={driveImg(album.capa_url, 80)}
              alt=""
              className="size-10 rounded object-cover"
             loading="lazy" decoding="async"/>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold truncate">{album.faixas[playingIdx].titulo}</p>
              <p className="text-[10px] text-muted-foreground truncate">
                {album.faixas[playingIdx].artistas}
              </p>
            </div>
            <button onClick={() => setPlayingIdx(null)} className="text-xs text-muted-foreground">
              Fechar
            </button>
          </div>
          <iframe
            src={driveAudioSrc(album.faixas[playingIdx].drive_url)}
            className="w-full h-16 border-0"
            allow="autoplay"
            title="player"
          />
        </div>
      )}

      {(album.encarte?.length > 0 || album.contracapa_url) && (
        <section className="px-4 mt-8">
          <h2 className="text-lg font-extrabold mb-3 inline-flex items-center gap-2">
            <ImageIcon className="size-4" /> Encarte
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {album.contracapa_url && (
              <button
                onClick={() => setShowEncarte(album.contracapa_url!)}
                className="aspect-square rounded-lg overflow-hidden bg-card"
              >
                <img
                  src={driveImg(album.contracapa_url, 300)}
                  alt="contracapa"
                  className="w-full h-full object-cover"
                  loading="lazy"
                 decoding="async"/>
              </button>
            )}
            {album.encarte?.map((u, i) => (
              <button
                key={i}
                onClick={() => setShowEncarte(u)}
                className="aspect-square rounded-lg overflow-hidden bg-card"
              >
                <img
                  src={driveImg(u, 300)}
                  alt={`encarte ${i + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                 decoding="async"/>
              </button>
            ))}
          </div>
        </section>
      )}

      {showEncarte && (
        <div
          onClick={() => setShowEncarte(null)}
          className="fixed inset-0 z-50 bg-black/90 grid place-items-center p-4"
        >
          <img
            src={driveRawImg(showEncarte) || driveImg(showEncarte, 1600)}
            alt=""
            className="max-w-full max-h-full rounded-lg"
           loading="lazy" decoding="async"/>
        </div>
      )}

      {showLyrics !== null && album.faixas[showLyrics]?.letra && (
        <div
          onClick={() => setShowLyrics(null)}
          className="fixed inset-0 z-50 bg-black/90 grid place-items-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6"
          >
            <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">
              Letra
            </p>
            <h3 className="text-xl font-extrabold mb-4">{album.faixas[showLyrics].titulo}</h3>
            <pre className="whitespace-pre-wrap text-sm font-sans text-foreground/90">
              {album.faixas[showLyrics].letra}
            </pre>
            <button
              onClick={() => setShowLyrics(null)}
              className="mt-4 w-full py-2 rounded-full bg-primary text-primary-foreground text-sm font-bold"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      <footer className="text-center text-[10px] text-muted-foreground/60 py-8 inline-flex items-center justify-center gap-1 w-full">
        <Disc3 className="size-3" /> Empire Hub • Music Industry Game
      </footer>

      <AddToPlaylistSheet track={menuTrack} onClose={() => setMenuTrack(null)} />
    </main>
  );
}

function fmtDate(d: string) {
  if (!d) return "";
  // Tira qualquer parte de hora se vier ISO (ex: 2026-05-14T...)
  const cleanDate = d.split("T")[0];
  const parts = cleanDate.split("-");
  if (parts.length !== 3) return d;
  const [y, m, day] = parts;
  return `${day}/${m}/${y}`;
}
