import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Flame, Sparkles, Music, Film, Play, Search, ChevronLeft, X, MoreVertical, RotateCw } from "lucide-react";
import { type PlaylistTrack } from "@/lib/api";
import { SmartImg } from "@/components/SmartImg";
import { AddToPlaylistSheet } from "@/components/AddToPlaylistSheet";
import { DynamicCoverCard, type CoverPlatform } from "@/components/EmpirePlay/DynamicCoverCard";
import { ScoreBadge } from "@/components/EmpirePlay/ScoreBadge";
import { toPlayableTrack, toPlayableVideo, toPlaylistTrack as toPlaylistTrackBase } from "@/components/EmpirePlay/mappers";
import { useEmpirePlayer } from "@/components/EmpirePlay/PlayerContext";
import { PlaylistsInicio } from "@/components/EmpirePlay/PlaylistsInicio";
import { getPlaylist, type Playlist } from "@/lib/playlistsEmpirePlay";

export const Route = createFileRoute("/empire-play/")({
  component: EmpirePlayInicio,
});

function EmpirePlayInicio() {
  const { currentTrack, currentVideo, playSong, playVideo } = useEmpirePlayer();

  // Tela Deslizante de Playlist (Estilo Spotify): abre por id de playlist
  // ("ao-vivo:spotify", "pais:apple:BRASIL", "semana:hot"...). A Início
  // mostra só o destaque e as prateleiras; a lista só abre depois do clique.
  const [activeSlidingPlaylist, setActiveSlidingPlaylist] = useState<string | null>(null);
  const [playlistAberta, setPlaylistAberta] = useState<Playlist | null>(null);
  const [erroPlaylist, setErroPlaylist] = useState(false);
  const [tentativaPlaylist, setTentativaPlaylist] = useState(0);
  const [slidingSearchQuery, setSlidingSearchQuery] = useState("");
  const [menuTrack, setMenuTrack] = useState<PlaylistTrack | null>(null);

  // Mapeamento canônico vive em mappers.ts (compartilhado com
  // empire-play.musicas.tsx, que antes tinha uma versão levemente
  // diferente/desatualizada) — só resolve aqui o fallback de capa pra foto
  // do artista/poster, que é específico dos itens desta tela.
  const toPlaylistTrack = (item: any, idx: number): PlaylistTrack =>
    toPlaylistTrackBase({ ...item, capa_url: item.capa_url || item.poster_url || item.artista_foto_url }, idx);

  // O botão de voltar do Telegram/gesto do Android navega pelo HISTÓRICO do
  // navegador, não sabe nada do estado local dessa tela — sem empurrar uma
  // entrada de histórico quando a tela deslizante abre, voltar não fecha
  // ela (o gesto "vaza" pra rota de trás, deixando a tela presa). Empurra
  // uma entrada marcada ao abrir; ao voltar (gesto, botão do Telegram ou
  // botão físico do Android), o popstate fecha a tela em vez de navegar.
  useEffect(() => {
    if (!activeSlidingPlaylist) return;
    window.history.pushState({ empireSlidingPlaylist: true }, "");
    const onPopState = () => setActiveSlidingPlaylist(null);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [activeSlidingPlaylist]);

  // Fechar pelo X/seta também passa pelo histórico — se não fizer isso, a
  // entrada empurrada acima fica "órfã" e o próximo voltar do usuário não
  // faz nada (o SPA nunca navegou de verdade, só o estado local mudou).
  const closeSlidingPlaylist = () => {
    if (window.history.state?.empireSlidingPlaylist) {
      window.history.back();
    } else {
      setActiveSlidingPlaylist(null);
    }
  };

  const abrirPlaylist = (id: string) => {
    setSlidingSearchQuery("");
    setPlaylistAberta(null);
    setErroPlaylist(false);
    setActiveSlidingPlaylist(id);
  };

  // Carrega a playlist aberta pelo id. (Adaptador provisório: a Task 5
  // generaliza esta tela — atualização ao vivo pela chave, faixas sem áudio.)
  useEffect(() => {
    if (!activeSlidingPlaylist) {
      setPlaylistAberta(null);
      return;
    }
    let vivo = true;
    setErroPlaylist(false);
    getPlaylist(activeSlidingPlaylist)
      .then((p) => {
        if (vivo) setPlaylistAberta(p);
      })
      .catch((err) => {
        console.warn("[EmpirePlayInicio] Erro ao abrir playlist:", err);
        if (vivo) setErroPlaylist(true);
      });
    return () => {
      vivo = false;
    };
  }, [activeSlidingPlaylist, tentativaPlaylist]);

  const isYoutube = playlistAberta?.plataforma === "youtube";

  // Itens tocáveis da playlist aberta: no YouTube, os clipes; nas outras, as
  // músicas do catálogo (por enquanto só as que existem no catálogo).
  const getSlidingPlaylistItems = (): any[] => {
    if (!activeSlidingPlaylist || !playlistAberta) return [];
    let list: any[] = playlistAberta.faixas
      .map((f) => {
        const bruto = isYoutube ? f.clipe : f.musica;
        if (!bruto) return null;
        const item: any = isYoutube ? toPlayableVideo(bruto) : toPlayableTrack(bruto);
        return { ...item, pos: f.pos, capa_url: item.capa_url || f.capa_url || undefined };
      })
      .filter((x): x is any => x !== null);

    if (slidingSearchQuery.trim()) {
      const q = slidingSearchQuery.toLowerCase().trim();
      list = list.filter((item) => (item.titulo || "").toLowerCase().includes(q));
    }

    return list.slice(0, 100);
  };

  return (
    <div className="space-y-6">
      <PlaylistsInicio onAbrir={abrirPlaylist} pausado={!!activeSlidingPlaylist} />

      {/* TELA DESLIZANTE DE PLAYLIST (ESTILO SPOTIFY) */}
      {activeSlidingPlaylist &&
        typeof document !== "undefined" &&
        createPortal(
        <div className="fixed inset-0 z-[140] bg-neutral-950 flex flex-col transition-all duration-300 ease-out animate-in slide-in-from-right overflow-hidden">
          {(() => {
            const list = getSlidingPlaylistItems();
            const plataforma = playlistAberta?.plataforma ?? null;
            const coverPlatform: CoverPlatform =
              plataforma ?? (activeSlidingPlaylist === "semana:hot" ? "hot" : "spotify");
            const gradient =
              plataforma === "spotify"
                ? "from-emerald-800/60"
                : plataforma === "apple"
                  ? "from-rose-800/60"
                  : plataforma === "youtube"
                    ? "from-red-900/60"
                    : "from-purple-800/60";
            const title = playlistAberta?.titulo ?? (erroPlaylist ? "Playlist" : "Carregando playlist");
            const PlatformIcon =
              plataforma === "spotify"
                ? Flame
                : plataforma === "apple"
                  ? Music
                  : plataforma === "youtube"
                    ? Film
                    : Sparkles;
            return (
              <>
                {/* Hero — capa grande + título, estilo playlist do Spotify */}
                <div className={`relative shrink-0 overflow-hidden bg-gradient-to-b ${gradient} to-neutral-950`}>
                  <button
                    onClick={closeSlidingPlaylist}
                    style={{ top: "max(1rem, calc(env(safe-area-inset-top) + 0.6rem))" }}
                    className="absolute left-4 z-10 size-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm text-white grid place-items-center shadow-lg transition"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                  <div className="flex items-end gap-4 sm:gap-5 px-5 sm:px-8 pt-16 pb-5">
                    <div className="relative size-28 sm:size-40 rounded-xl shadow-2xl overflow-hidden shrink-0 bg-neutral-800">
                      {playlistAberta?.capa_url ? (
                        <SmartImg
                          src={playlistAberta.capa_url}
                          size={400}
                          alt=""
                          className="absolute inset-0 size-full object-cover"
                          fallback={<DynamicCoverCard platform={coverPlatform} className="absolute inset-0" />}
                        />
                      ) : (
                        <DynamicCoverCard platform={coverPlatform} className="absolute inset-0" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 pb-1">
                      <p className="text-[10px] font-black uppercase tracking-widest text-white/60">Playlist</p>
                      <h1 className="text-2xl sm:text-4xl font-black text-white leading-[1.05] tracking-tight break-words">
                        {title}
                      </h1>
                      <p className="text-[11px] sm:text-xs text-white/60 mt-2 flex items-center gap-1.5">
                        <PlatformIcon className="size-3.5" /> {list.length} músicas
                      </p>
                    </div>
                  </div>
                </div>

                {/* Barra de ações */}
                <div className="flex items-center gap-3 px-5 sm:px-8 py-4 bg-neutral-950 border-b border-white/5 shrink-0">
                  <button
                    onClick={() => {
                      if (list.length > 0) playSong(list[0], list);
                    }}
                    disabled={isYoutube || list.length === 0}
                    className="size-12 sm:size-14 rounded-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-30 disabled:pointer-events-none text-black grid place-items-center shadow-lg shadow-emerald-500/20 active:scale-95 transition"
                  >
                    <Play className="size-5 sm:size-6 fill-black ml-0.5" />
                  </button>
                  <div className="flex items-center gap-2 flex-1 min-w-0 bg-white/5 rounded-xl px-3 py-2.5">
                    <Search className="size-4 text-neutral-500 shrink-0" />
                    <input
                      type="text"
                      placeholder="Pesquisar nesta lista por título..."
                      value={slidingSearchQuery}
                      onChange={(e) => setSlidingSearchQuery(e.target.value)}
                      className="w-full bg-transparent text-xs text-white placeholder-neutral-500 focus:outline-none min-w-0"
                    />
                  </div>
                  <button
                    onClick={closeSlidingPlaylist}
                    className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition shrink-0"
                  >
                    <X className="size-5" />
                  </button>
                </div>
              </>
            );
          })()}

          {/* Conteúdo de Faixas ou Vídeos */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-3">
            {!playlistAberta && erroPlaylist ? (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <p className="text-neutral-400 font-bold text-xs">Não foi possível carregar a playlist.</p>
                <button
                  type="button"
                  onClick={() => {
                    setErroPlaylist(false);
                    setTentativaPlaylist((n) => n + 1);
                  }}
                  className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black text-white hover:bg-white/10 active:scale-95 transition"
                >
                  <RotateCw className="size-3.5 shrink-0" />
                  <span className="truncate">Tentar de novo</span>
                </button>
              </div>
            ) : !playlistAberta ? (
              <div className="text-center py-20 text-neutral-500 font-bold text-xs">Carregando playlist...</div>
            ) : getSlidingPlaylistItems().length === 0 ? (
              <div className="text-center py-20 text-neutral-500 font-bold text-xs">
                Nenhum item encontrado nesta lista.
              </div>
            ) : (
              getSlidingPlaylistItems().map((item, idx) => {
                const isPlayingThis = currentTrack?.id === item.id || currentVideo?.id === item.id;

                // Linha: posição, capa, título e artista.
                return (
                  <div
                    key={item.id || idx}
                    onClick={() => {
                      if (isYoutube) {
                        playVideo(item);
                      } else {
                        playSong(item, getSlidingPlaylistItems());
                      }
                    }}
                    className={`flex items-center gap-4 px-3 sm:px-4 py-3 rounded-xl transition-all cursor-pointer ${
                      isPlayingThis ? "bg-emerald-500/10 text-emerald-400" : "hover:bg-white/5 text-white"
                    }`}
                  >
                    {/* Posição Rank */}
                    <span className="font-mono font-black text-xs text-neutral-500 min-w-[28px] text-center">
                      {item.pos ?? idx + 1}
                    </span>

                    {/* Capa (com fallback pra foto do artista, quando a faixa não tem capa própria) */}
                    <div className="size-11 rounded-xl bg-neutral-950 border border-white/10 overflow-hidden shrink-0 relative">
                      {item.capa_url || item.poster_url || item.artista_foto_url ? (
                        <SmartImg
                          src={item.capa_url || item.poster_url || item.artista_foto_url}
                          size={150}
                          alt={item.titulo}
                          className="size-full object-cover"
                          fallback={
                            <div className="size-full grid place-items-center text-neutral-600">
                              <Music className="size-5" />
                            </div>
                          }
                        />
                      ) : (
                        <div className="size-full grid place-items-center text-neutral-600">
                          <Music className="size-5" />
                        </div>
                      )}
                    </div>

                    {/* Título (com feats) + selo de likes (só YouTube — a
                        nota do Metacritic saiu daqui, mora só em Acervo
                        > Metacritic agora) */}
                    <div className="flex-1 min-w-0 flex items-center gap-2.5">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-extrabold text-sm text-white break-words leading-tight">
                          {item.titulo}
                        </h4>
                        {item.artista && (
                          <p className="text-[11px] text-neutral-400 break-words mt-0.5">
                            {item.artista}
                          </p>
                        )}
                      </div>
                      {isYoutube && (
                        <ScoreBadge
                          score={item.metacriticAvg}
                          variant="likes"
                          className="shrink-0 !text-[10px] !px-2 !py-1"
                        />
                      )}
                    </div>

                    {/* Salvar / adicionar à playlist (só faixas de áudio) */}
                    {!isYoutube && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuTrack(toPlaylistTrack(item, idx));
                        }}
                        className="p-2.5 text-neutral-400 hover:text-white transition-all shrink-0"
                        title="Salvar / adicionar à playlist"
                      >
                        <MoreVertical className="size-4" />
                      </button>
                    )}

                    {/* Botão de Ação */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isYoutube) {
                          playVideo(item);
                        } else {
                          playSong(item, getSlidingPlaylistItems());
                        }
                      }}
                      className="p-2.5 rounded-xl bg-white/5 hover:bg-emerald-500 hover:text-black text-white transition-all shrink-0"
                    >
                      <Play className="size-4 fill-current" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>,
          document.body,
        )}

      <AddToPlaylistSheet track={menuTrack} onClose={() => setMenuTrack(null)} />
    </div>
  );
}
