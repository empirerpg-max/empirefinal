import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Disc3, Play, Search } from "lucide-react";
import { driveImg, type AlbumPayload } from "@/lib/api";
import { type PlayableTrack } from "./MusicPlayer";
import { ScoreBadge } from "./ScoreBadge";

export interface MappedTrack extends PlayableTrack {
  ordem?: number | string;
  id_arquivo?: string;
  duracao?: string;
}

export interface DetailedAlbum extends Omit<AlbumPayload, "faixas"> {
  faixas?: MappedTrack[];
  data_lancamento?: string;
  telegramTopicId?: string;
  metacriticAvg?: number | string | null;
}

export function AlbumList() {
  const [albuns, setAlbuns] = useState<DetailedAlbum[] | null>(null);
  const [musicas, setMusicas] = useState<MappedTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const res = await fetch("/api/empire-play/albuns")
          .then((r) => r.json())
          .catch(() => null);

        if (res && res.success && Array.isArray(res.data)) {
          const mapped = res.data.map((item: any) => ({
            id: item.id || item.title || item.titulo,
            titulo: item.title || item.titulo || item.nome_do_album || "Álbum sem título",
            artista: item.artist || item.artista || item.act_principal || "Artista não informado",
            capa_url:
              item.coverUrl || item.cover || item.capa_url || item.capa_do_album || item.capa,
            data_lancamento: item.releaseDate || item.data_lancamento || "",
            telegramTopicId: item.telegramTopicId,
            metacriticAvg: item.metacriticAvg ?? item.metacritic ?? item.nota,
            faixas: (item.tracks || []).map((t: any, idx: number) => ({
              id: t.id || `${item.title}-${idx}`,
              titulo: t.title || t.titulo || t.nome_da_musica || "Faixa sem título",
              artista: t.artist || t.artista || item.artist || "Artista não informado",
              capa_url: t.coverUrl || t.cover || t.capa_url || item.coverUrl || item.capa_url,
              audio_url: t.audioUrl || t.link || t.audio_url || t.drive_url || t.id_do_arquivo,
              drive_url: t.audioUrl || t.link || t.drive_url || t.id_do_arquivo,
              letra: t.lyrics || t.letra,
              album: t.album || item.title || item.titulo,
              ordem: t.trackOrder || t.ordem || idx + 1,
            })),
          }));
          setAlbuns(mapped);
        } else {
          // Fallback para APIs legadas
          const [resAlbuns, resMusicas] = await Promise.all([
            fetch("/api/albuns")
              .then((r) => r.json())
              .catch(() => null),
            fetch("/api/musicas")
              .then((r) => r.json())
              .catch(() => null),
          ]);
          if (resAlbuns && resAlbuns.success) setAlbuns(resAlbuns.data || []);
          if (resMusicas && resMusicas.success) setMusicas(resMusicas.data || []);
        }
      } catch (err) {
        console.warn("[AlbumList] Erro ao buscar álbuns/músicas:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Mapeia faixas de um álbum respeitando ALBUM, Ordem, ID do arquivo e Letra
  const getTracksForAlbum = (albumTitle?: string, albumArtist?: string): MappedTrack[] => {
    const titleNorm = (albumTitle || "").toLowerCase().trim();
    const artistNorm = (albumArtist || "").toLowerCase().trim();

    return musicas
      .filter((m) => {
        const mAlbum = (m.album || "").toLowerCase().trim();
        const mArtist = (m.artista || "").toLowerCase().trim();
        return (
          (titleNorm !== "" && mAlbum === titleNorm) ||
          (titleNorm !== "" && mAlbum.includes(titleNorm) && mArtist.includes(artistNorm))
        );
      })
      .sort((a, b) => {
        const ordA = parseInt(String(a.ordem || "999"), 10);
        const ordB = parseInt(String(b.ordem || "999"), 10);
        return ordA - ordB;
      });
  };

  const filtered = (albuns || []).filter((a) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const t = (a?.titulo || "").toLowerCase();
    const art = (a?.artista || "").toLowerCase();
    return t.includes(s) || art.includes(s);
  });

  return (
    <div className="space-y-6">
      <Link
        to="/empire-play/albuns-antigos"
        className="flex items-center justify-between p-3.5 rounded-2xl bg-white/5 border border-white/10 text-neutral-300 hover:bg-white/10 hover:text-white transition-colors"
      >
        <span className="text-xs font-bold">Álbuns legados (lançamentos antes de 06/12/2021)</span>
        <span className="text-[11px] font-black uppercase text-emerald-400 shrink-0">Ver →</span>
      </Link>

      {/* Busca */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-neutral-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar álbuns ou artistas..."
          className="w-full bg-neutral-900 border border-white/10 rounded-2xl pl-11 pr-4 py-3.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all"
        />
      </div>

      {/* Grid de Álbuns */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-2xl bg-neutral-900/60 animate-pulse border border-white/5"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-neutral-500 italic text-sm">
          Nenhum álbum encontrado no catálogo.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {filtered.map((alb) => {
            const preMapped = (alb as DetailedAlbum).faixas;
            const albumTracks =
              preMapped && preMapped.length > 0
                ? preMapped
                : getTracksForAlbum(alb.titulo, alb.artista);
            const cover = alb.capa_url ? driveImg(alb.capa_url, 400) : undefined;

            return (
              <Link
                key={alb.id || alb.titulo}
                to="/empire-play/forum"
                search={{ tab: "albuns", id: alb.id }}
                className="group cursor-pointer rounded-2xl bg-neutral-900/50 border border-white/10 p-3 hover:bg-neutral-800/80 hover:border-emerald-500/30 transition-all duration-300"
              >
                <div className="relative aspect-square rounded-xl overflow-hidden bg-neutral-950 mb-3 shadow-lg">
                  {cover ? (
                    <img
                      src={cover}
                      alt={alb.titulo}
                      className="size-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />
                  ) : (
                    <div className="size-full grid place-items-center bg-neutral-900 text-neutral-600">
                      <Disc3 className="size-12" />
                    </div>
                  )}

                  {/* Play — visível por padrão (essencial no touch); o escurecido
                      de fundo só reforça no hover do desktop. */}
                  <div className="absolute inset-0 bg-black/0 sm:group-hover:bg-black/40 transition-colors grid place-items-center">
                    <span className="size-12 rounded-full bg-emerald-500/90 sm:bg-emerald-500/70 sm:group-hover:bg-emerald-400/90 backdrop-blur-sm text-black grid place-items-center shadow-lg transition-colors">
                      <Play className="size-6 ml-0.5" />
                    </span>
                  </div>

                  {albumTracks.length > 0 && (
                    <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/80 text-[10px] font-mono text-emerald-400 border border-white/10">
                      {albumTracks.length} faixas
                    </span>
                  )}

                  <div className="absolute top-2 right-2 pointer-events-none">
                    <ScoreBadge score={alb.metacriticAvg} variant="metacritic" />
                  </div>
                </div>

                <h3 className="font-bold text-sm text-white truncate group-hover:text-emerald-400 transition-colors">
                  {alb.titulo}
                </h3>
                <p className="text-xs text-neutral-400 truncate mt-0.5 font-medium">
                  {alb.artista}
                </p>
                {alb.data_lancamento && (
                  <p className="text-[10px] font-mono text-neutral-500 mt-1">
                    {alb.data_lancamento}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
