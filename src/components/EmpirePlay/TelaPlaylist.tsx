import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flame, Sparkles, Music, Film, Play, Search, ChevronLeft, X, MoreVertical, RotateCw, Radio } from "lucide-react";
import { type PlaylistTrack } from "@/lib/api";
import { SmartImg } from "@/components/SmartImg";
import { AddToPlaylistSheet } from "@/components/AddToPlaylistSheet";
import { DynamicCoverCard, type CoverPlatform } from "./DynamicCoverCard";
import { toPlayableTrack, toPlaylistTrack } from "./mappers";
import { useEmpirePlayer } from "./PlayerContext";
import { type PlayableTrack } from "./MusicPlayer";
import { getPlaylist, plataformaDoId, type FaixaPlaylist, type Playlist } from "@/lib/playlistsEmpirePlay";

/** Intervalo de atualização das playlists ao vivo (mesmo cache do servidor). */
const ATUALIZAR_MS = 30_000;

// Títulos e nomes sempre completos: quebram linha em qualquer ponto se
// preciso, nunca "…" (CLAUDE.md + pedido do usuário).
const QUEBRA = "[overflow-wrap:anywhere]";

/**
 * Reconcilia a lista nova com a atual pela `chave` estável: faixa que não
 * mudou mantém o MESMO objeto (React não re-renderiza capa/linha à toa).
 * A fila que está tocando não é tocada aqui — ela vive no PlayerContext e
 * só muda quando o usuário toca algo.
 */
function reconciliar(atual: Playlist | null, nova: Playlist): Playlist {
  if (!atual || atual.id !== nova.id) return nova;
  const antigas = new Map(atual.faixas.map((f) => [f.chave, f]));
  const faixas = nova.faixas.map((f) => {
    const velha = antigas.get(f.chave);
    return velha && JSON.stringify(velha) === JSON.stringify(f) ? velha : f;
  });
  return { ...nova, faixas };
}

/** Faixa do catálogo pronta pro player (capa do chart como reserva). */
function faixaTocavel(f: FaixaPlaylist): PlayableTrack | null {
  if (!f.tocavel || !f.musica) return null;
  const t = toPlayableTrack(f.musica);
  return { ...t, capa_url: t.capa_url || f.capa_url || undefined };
}

interface Props {
  /** Id da playlist aberta ("ao-vivo:spotify", "pais:apple:BRASIL", "semana:hot"...). */
  id: string;
  onFechar: () => void;
}

/**
 * Tela cheia de uma playlist do Empire Play. Carrega por id, recarrega a
 * cada 30 s se for ao vivo (só com a aba visível) e escolhe o layout pela
 * plataforma: YouTube → vitrine de clipes; demais → lista de áudio.
 */
export function TelaPlaylist({ id, onFechar }: Props) {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const seqRef = useRef(0);

  const carregar = useCallback(
    (inicial: boolean) => {
      const seq = ++seqRef.current;
      if (inicial) setErro(false);
      getPlaylist(id)
        .then((p) => {
          if (seq !== seqRef.current) return;
          setPlaylist((atual) => reconciliar(atual, p));
          setErro(false);
        })
        .catch((err) => {
          if (seq !== seqRef.current) return;
          console.warn("[TelaPlaylist] Erro ao carregar playlist:", err);
          // Falha numa atualização ao vivo mantém a lista que já está na tela.
          if (inicial) setErro(true);
        });
    },
    [id],
  );

  // Abertura (ou "Tentar de novo"): começa do zero.
  useEffect(() => {
    setPlaylist(null);
    carregar(true);
    return () => {
      seqRef.current++;
    };
  }, [carregar, tentativa]);

  // Ao vivo: recarrega a cada 30 s enquanto a tela está aberta e visível;
  // ao voltar pra aba depois de 30 s parada, atualiza na hora.
  const aoVivo = !!playlist?.aoVivo;
  useEffect(() => {
    if (!aoVivo) return;
    let ultima = Date.now();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - ultima < ATUALIZAR_MS - 500) return;
      ultima = Date.now();
      carregar(false);
    };
    const timer = window.setInterval(tick, ATUALIZAR_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [aoVivo, carregar]);

  const props: TelaProps = {
    id,
    playlist,
    erro,
    onTentarDeNovo: () => setTentativa((n) => n + 1),
    onFechar,
  };

  // ── Gancho da Task 6 ──────────────────────────────────────────────────
  // Playlists do YouTube abrem na vitrine de clipes. Por enquanto o
  // placeholder só mostra a lista de áudio; a Task 6 troca esta linha por
  // <VitrineClipes {...props} />.
  if (playlist?.plataforma === "youtube") return <VitrineClipesPlaceholder {...props} />;

  return <ListaAudioPlaylist {...props} />;
}

export interface TelaProps {
  id: string;
  playlist: Playlist | null;
  erro: boolean;
  onTentarDeNovo: () => void;
  onFechar: () => void;
}

/** TEMPORÁRIO (Task 6 substitui pela VitrineClipes): mesma lista de áudio. */
function VitrineClipesPlaceholder(props: TelaProps) {
  return <ListaAudioPlaylist {...props} />;
}

function ListaAudioPlaylist({ id, playlist, erro, onTentarDeNovo, onFechar }: TelaProps) {
  const { currentTrack, playSong } = useEmpirePlayer();
  const [busca, setBusca] = useState("");
  const [menuTrack, setMenuTrack] = useState<PlaylistTrack | null>(null);

  useEffect(() => setBusca(""), [id]);

  const faixas = playlist?.faixas ?? [];

  // Faixa tocável de cada chave (memo por objeto: a reconciliação mantém o
  // mesmo objeto quando a faixa não mudou).
  const linhas = useMemo(
    () => faixas.map((f) => ({ faixa: f, track: faixaTocavel(f) })),
    [faixas],
  );
  // Fila = só as tocáveis, na ordem da playlist (pula "Sem áudio no catálogo").
  const fila = useMemo(
    () => linhas.map((l) => l.track).filter((t): t is PlayableTrack => t !== null),
    [linhas],
  );
  const semAudio = faixas.length - fila.length;

  const q = busca.toLowerCase().trim();
  const visiveis = q
    ? linhas.filter(
        ({ faixa }) =>
          faixa.titulo.toLowerCase().includes(q) || faixa.artista.toLowerCase().includes(q),
      )
    : linhas;

  const plataforma = playlist?.plataforma ?? plataformaDoId(id);
  const coverPlatform: CoverPlatform = plataforma ?? (id === "semana:hot" ? "hot" : "spotify");
  const gradient =
    plataforma === "spotify"
      ? "from-emerald-800/60"
      : plataforma === "apple"
        ? "from-rose-800/60"
        : plataforma === "youtube"
          ? "from-red-900/60"
          : "from-purple-800/60";
  const PlatformIcon =
    plataforma === "spotify" ? Flame : plataforma === "apple" ? Music : plataforma === "youtube" ? Film : Sparkles;
  const titulo = playlist?.titulo ?? (erro ? "Playlist" : "Carregando playlist");

  return (
    <div className="fixed inset-0 z-[140] bg-neutral-950 flex flex-col transition-all duration-300 ease-out animate-in slide-in-from-right overflow-hidden">
      {/* Hero — capa grande + título completo */}
      <div className={`relative shrink-0 overflow-hidden bg-gradient-to-b ${gradient} to-neutral-950`}>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Voltar"
          style={{ top: "max(1rem, calc(env(safe-area-inset-top) + 0.6rem))" }}
          className="absolute left-4 z-10 size-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm text-white grid place-items-center shadow-lg transition"
        >
          <ChevronLeft className="size-5 shrink-0" />
        </button>
        <div className="flex items-end gap-4 sm:gap-5 px-5 sm:px-8 pt-16 pb-5">
          <div className="relative size-28 sm:size-40 rounded-xl shadow-2xl overflow-hidden shrink-0 bg-neutral-800">
            {playlist?.capa_url ? (
              <SmartImg
                src={playlist.capa_url}
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
            <p className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white/60">
              <span>Playlist</span>
              {playlist?.aoVivo && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[9px] text-white">
                  <Radio className="size-3 shrink-0" />
                  <span>Ao vivo</span>
                </span>
              )}
            </p>
            <h1 className={`text-2xl sm:text-4xl font-black text-white leading-[1.05] tracking-tight ${QUEBRA}`}>
              {titulo}
            </h1>
            {playlist?.subtitulo && (
              <p className={`text-xs text-white/70 mt-1.5 ${QUEBRA}`}>{playlist.subtitulo}</p>
            )}
            {playlist && (
              <p className="text-[11px] sm:text-xs text-white/60 mt-1.5 flex flex-wrap items-center gap-x-1.5">
                <PlatformIcon className="size-3.5 shrink-0" />
                <span>{faixas.length} músicas</span>
                {semAudio > 0 && <span className="text-white/40">· {semAudio} sem áudio</span>}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Barra de ações */}
      <div className="flex items-center gap-3 px-5 sm:px-8 py-4 bg-neutral-950 border-b border-white/5 shrink-0">
        <button
          type="button"
          aria-label="Tocar playlist"
          onClick={() => {
            if (fila.length > 0) playSong(fila[0], fila);
          }}
          disabled={fila.length === 0}
          className="size-12 sm:size-14 shrink-0 rounded-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-30 disabled:pointer-events-none text-black grid place-items-center shadow-lg shadow-emerald-500/20 active:scale-95 transition"
        >
          <Play className="size-5 sm:size-6 fill-black ml-0.5 shrink-0" />
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0 bg-white/5 rounded-xl px-3 py-2.5">
          <Search className="size-4 text-neutral-500 shrink-0" />
          <input
            type="text"
            placeholder="Pesquisar nesta lista..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full bg-transparent text-xs text-white placeholder-neutral-500 focus:outline-none min-w-0"
          />
        </div>
        <button
          type="button"
          aria-label="Fechar"
          onClick={onFechar}
          className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition shrink-0"
        >
          <X className="size-5 shrink-0" />
        </button>
      </div>

      {/* Faixas */}
      <div className="flex-1 overflow-y-auto px-2 sm:px-6 py-3">
        {!playlist && erro ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <p className="text-neutral-400 font-bold text-xs">Não foi possível carregar a playlist.</p>
            <button
              type="button"
              onClick={onTentarDeNovo}
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black text-white hover:bg-white/10 active:scale-95 transition"
            >
              <RotateCw className="size-3.5 shrink-0" />
              <span className="truncate">Tentar de novo</span>
            </button>
          </div>
        ) : !playlist ? (
          <div className="text-center py-20 text-neutral-500 font-bold text-xs">Carregando playlist...</div>
        ) : visiveis.length === 0 ? (
          <div className="text-center py-20 text-neutral-500 font-bold text-xs">
            {faixas.length === 0 ? "Sem dados agora." : "Nenhum item encontrado nesta lista."}
          </div>
        ) : (
          visiveis.map(({ faixa, track }) => {
            const tocando = !!track && !!currentTrack && currentTrack.id === track.id;
            const tocar = () => {
              if (track) playSong(track, fila);
            };
            return (
              <div
                key={faixa.chave}
                role={track ? "button" : undefined}
                tabIndex={track ? 0 : undefined}
                aria-disabled={track ? undefined : true}
                onClick={tocar}
                onKeyDown={(e) => {
                  if (track && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    tocar();
                  }
                }}
                className={`flex items-center gap-3 px-2 sm:px-4 py-3 rounded-xl transition-all ${
                  !track
                    ? "opacity-45 grayscale cursor-default"
                    : tocando
                      ? "bg-emerald-500/10 cursor-pointer"
                      : "hover:bg-white/5 cursor-pointer"
                }`}
              >
                {/* Posição */}
                <span
                  className={`font-mono font-black text-xs min-w-[26px] text-center shrink-0 ${
                    tocando ? "text-emerald-400" : "text-neutral-500"
                  }`}
                >
                  {faixa.pos}
                </span>

                {/* Capa */}
                <div className="size-11 rounded-xl bg-neutral-900 border border-white/10 overflow-hidden shrink-0 relative">
                  {track?.capa_url || faixa.capa_url ? (
                    <SmartImg
                      src={(track?.capa_url || faixa.capa_url) as string}
                      size={150}
                      alt=""
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

                {/* Título e artista completos (quebram linha) */}
                <div className="flex-1 min-w-0">
                  <h4
                    className={`font-extrabold text-sm leading-tight ${QUEBRA} ${
                      tocando ? "text-emerald-400" : track ? "text-white" : "text-neutral-400"
                    }`}
                  >
                    {faixa.titulo}
                  </h4>
                  {faixa.artista && (
                    <p className={`text-[11px] text-neutral-400 mt-0.5 ${QUEBRA}`}>{faixa.artista}</p>
                  )}
                  {(!track || faixa.posGlobal != null) && (
                    <p className="text-[10px] text-neutral-500 mt-0.5 flex flex-wrap gap-x-2">
                      {!track && <span className="font-bold">Sem áudio no catálogo</span>}
                      {faixa.posGlobal != null && <span>#{faixa.posGlobal} no Global 100</span>}
                    </p>
                  )}
                </div>

                {/* Valor do chart */}
                {faixa.valor && (
                  <span className="shrink-0 text-right font-mono text-[11px] font-bold text-neutral-300 tabular-nums">
                    {faixa.valor}
                  </span>
                )}

                {/* Salvar / adicionar à playlist (só faixas com áudio) */}
                {track ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuTrack(toPlaylistTrack(track, faixa.pos - 1));
                    }}
                    className="p-2 -mr-1 text-neutral-400 hover:text-white transition-all shrink-0"
                    title="Salvar / adicionar à playlist"
                    aria-label="Salvar / adicionar à playlist"
                  >
                    <MoreVertical className="size-4 shrink-0" />
                  </button>
                ) : (
                  <span className="w-8 -mr-1 shrink-0" aria-hidden />
                )}
              </div>
            );
          })
        )}
      </div>

      <AddToPlaylistSheet track={menuTrack} onClose={() => setMenuTrack(null)} />
    </div>
  );
}
