import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Disc3, Play, Search, Music, Clock, ChevronRight, FileText, MessageSquare } from "lucide-react";
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

interface AlbumListProps {
  onPlayTrack?: (track: PlayableTrack, playlist: PlayableTrack[]) => void;
}

export function AlbumList({ onPlayTrack }: AlbumListProps) {
  const [albuns, setAlbuns] = useState<DetailedAlbum[] | null>(null);
  const [musicas, setMusicas] = useState<MappedTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedAlbum, setSelectedAlbum] = useState<DetailedAlbum | null>(null);

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
              <div
                key={alb.id || alb.titulo}
                onClick={() =>
                  setSelectedAlbum({
                    ...alb,
                    faixas: albumTracks,
                  })
                }
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

                  {/* Play Hover Overlay */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity grid place-items-center">
                    <span className="size-12 rounded-full bg-emerald-500 text-black grid place-items-center shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-transform">
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
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL DETALHADO DO ÁLBUM */}
      {selectedAlbum && (
        <div className="fixed inset-0 z-[110] bg-neutral-950/90 backdrop-blur-2xl flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-2xl bg-neutral-900 border border-white/15 rounded-3xl p-6 shadow-2xl relative max-h-[85vh] flex flex-col overflow-hidden">
            {/* Header com Capa e Metadados */}
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 border-b border-white/10 pb-6 mb-4">
              <div className="size-32 sm:size-40 rounded-2xl overflow-hidden bg-neutral-950 flex-shrink-0 border border-white/10 shadow-2xl">
                {selectedAlbum.capa_url ? (
                  <img
                    src={driveImg(selectedAlbum.capa_url, 400)}
                    alt={selectedAlbum.titulo}
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="size-full grid place-items-center text-neutral-600">
                    <Disc3 className="size-16" />
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 text-center sm:text-left">
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  Álbum Oficial
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-white truncate mt-2">
                  {selectedAlbum.titulo}
                </h2>
                <p className="text-sm font-bold text-neutral-300 mt-0.5">{selectedAlbum.artista}</p>

                {selectedAlbum.data_lancamento && (
                  <p className="text-xs font-mono text-neutral-400 mt-2">
                    Lançamento: {selectedAlbum.data_lancamento}
                  </p>
                )}

                <div className="flex items-center gap-2 mt-4 justify-center sm:justify-start">
                  {selectedAlbum.faixas && selectedAlbum.faixas.length > 0 && (
                    <button
                      onClick={() => {
                        if (selectedAlbum.faixas && selectedAlbum.faixas.length > 0) {
                          onPlayTrack?.(selectedAlbum.faixas[0], selectedAlbum.faixas);
                        }
                      }}
                      className="px-5 py-2.5 rounded-full bg-emerald-500 text-black font-black text-xs uppercase tracking-wider flex items-center gap-2 active:scale-95 transition-all shadow-lg shadow-emerald-500/20"
                    >
                      <Play className="size-4" /> Tocar Álbum
                    </button>
                  )}
                  {selectedAlbum.id && (
                    <Link
                      to="/empire-play/forum"
                      search={{ tab: "albuns", id: selectedAlbum.id }}
                      onClick={() => setSelectedAlbum(null)}
                      className="px-4 py-2.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 hover:text-white font-black text-xs uppercase tracking-wider flex items-center gap-2 active:scale-95 transition-all"
                    >
                      <MessageSquare className="size-4" /> Fórum
                    </Link>
                  )}
                </div>
              </div>

              <button
                onClick={() => setSelectedAlbum(null)}
                className="absolute top-4 right-4 size-9 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 grid place-items-center text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Lista de Faixas Mapeadas */}
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              <h4 className="text-xs font-black uppercase tracking-widest text-neutral-400 mb-3 px-2">
                Faixas ({selectedAlbum.faixas?.length || 0})
              </h4>

              {!selectedAlbum.faixas || selectedAlbum.faixas.length === 0 ? (
                <div className="text-center py-8 text-neutral-500 italic text-xs">
                  Nenhuma faixa vinculada a este álbum na planilha.
                </div>
              ) : (
                selectedAlbum.faixas.map((track, idx) => (
                  <div
                    key={track.id || idx}
                    onClick={() => onPlayTrack?.(track, selectedAlbum.faixas || [])}
                    className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-transparent hover:border-white/10 cursor-pointer transition-all group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-6 text-center font-mono text-xs text-neutral-500 group-hover:text-emerald-400">
                        {track.ordem || idx + 1}
                      </span>
                      <div className="size-10 rounded-lg overflow-hidden bg-neutral-950 shrink-0 border border-white/10">
                        {track.capa_url ? (
                          <img
                            src={driveImg(track.capa_url, 100)}
                            alt={track.titulo}
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="size-full grid place-items-center text-neutral-600">
                            <Music className="size-4" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white truncate group-hover:text-emerald-400 transition-colors">
                          {track.titulo}
                        </p>
                        <p className="text-xs text-neutral-400 truncate">{track.artista}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {track.letra && (
                        <FileText className="size-4 text-neutral-500" aria-label="Possui Letra" />
                      )}
                      {track.id && (
                        <Link
                          to="/empire-play/forum"
                          search={{ tab: "musicas", id: track.id }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAlbum(null);
                          }}
                          title="Ver no Fórum"
                          className="size-8 rounded-full bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white grid place-items-center transition-all"
                        >
                          <MessageSquare className="size-3.5" />
                        </Link>
                      )}
                      <span className="size-8 rounded-full bg-white/5 group-hover:bg-emerald-500 group-hover:text-black text-neutral-400 grid place-items-center transition-all">
                        <Play className="size-3.5 ml-0.5" />
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
