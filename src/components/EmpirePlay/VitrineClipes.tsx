import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Film, Play, Radio, RotateCw, Search, Volume2, X } from "lucide-react";
import { SmartImg } from "@/components/SmartImg";
import { DynamicCoverCard } from "./DynamicCoverCard";
import { toPlayableTrack, toPlayableVideo } from "./mappers";
import { useEmpirePlayer } from "./PlayerContext";
import { type PlayableTrack } from "./MusicPlayer";
import { VideoPlayer, type PlayableVideo } from "./VideoPlayer";
import { type FaixaPlaylist } from "@/lib/playlistsEmpirePlay";
import type { TelaProps } from "./TelaPlaylist";

// Títulos e nomes sempre completos: quebram linha em qualquer ponto se
// preciso, nunca "…" (CLAUDE.md + pedido do usuário).
const QUEBRA = "[overflow-wrap:anywhere]";

interface Cartao {
  faixa: FaixaPlaylist;
  /** Clipe pronto pro VideoPlayer (null = faixa sem clipe no catálogo). */
  video: PlayableVideo | null;
  /** Áudio da faixa, usado só quando não há clipe. */
  track: PlayableTrack | null;
  /** Miniatura 16:9: pôster do clipe; sem clipe, a capa do material. */
  thumb: string | null;
}

function montarCartao(f: FaixaPlaylist): Cartao {
  const video = f.clipe ? toPlayableVideo(f.clipe) : null;
  let track: PlayableTrack | null = null;
  if (!video && f.tocavel && f.musica) {
    const t = toPlayableTrack(f.musica);
    track = { ...t, capa_url: t.capa_url || f.capa_url || undefined };
  }
  const thumb = video
    ? video.poster_url || video.capa_url || f.capa_url || null
    : (f.musica?.coverUrl as string | null | undefined) || f.capa_url || null;
  return { faixa: f, video, track, thumb };
}

/**
 * Playlist do YouTube como vitrine de clipes (estilo página de playlist do
 * YouTube): painel com a capa do #1, título e "Ver primeiro clipe"; ao lado/abaixo,
 * a lista de clipes com miniatura 16:9. Tocar um clipe abre o VideoPlayer
 * com os outros clipes da playlist na ordem. Faixa sem clipe mostra a capa
 * do material com o selo "Sem clipe" e toca o áudio (se houver).
 *
 * O vídeo aberto vive em estado local (não na lista): a atualização ao vivo
 * de 30 s da TelaPlaylist troca a lista sem fechar o vídeo. O cartão ativo é
 * marcado pela `chave` da faixa (não pelo id do vídeo, que pode se repetir).
 */
export function VitrineClipes({ id, playlist, erro, onTentarDeNovo, onFechar }: TelaProps) {
  const { currentTrack, playSong } = useEmpirePlayer();
  const [busca, setBusca] = useState("");
  const [videoAberto, setVideoAberto] = useState<PlayableVideo | null>(null);
  const [chaveAberta, setChaveAberta] = useState<string | null>(null);

  useEffect(() => {
    setBusca("");
    setVideoAberto(null);
    setChaveAberta(null);
  }, [id]);

  const faixas = playlist?.faixas ?? [];
  const cartoes = useMemo(() => faixas.map(montarCartao), [faixas]);
  // Clipes na ordem da playlist (lateral "Nesta playlist" do player).
  const clipes = useMemo(
    () => cartoes.map((c) => c.video).filter((v): v is PlayableVideo => v !== null),
    [cartoes],
  );
  // Fila de áudio das faixas sem clipe que têm áudio no catálogo.
  const filaAudio = useMemo(
    () => cartoes.map((c) => c.track).filter((t): t is PlayableTrack => t !== null),
    [cartoes],
  );
  const semClipe = cartoes.length - clipes.length;

  const abrirClipe = (c: Cartao) => {
    if (!c.video) return;
    setVideoAberto(c.video);
    setChaveAberta(c.faixa.chave);
  };
  // Vídeo escolhido na lateral do player: acha o cartão pelo mesmo objeto
  // (vem de `clipes`); senão, o primeiro com o mesmo id.
  const selecionarVideo = (v: PlayableVideo) => {
    const c = cartoes.find((x) => x.video === v) ?? cartoes.find((x) => x.video?.id === v.id);
    setVideoAberto(v);
    setChaveAberta(c?.faixa.chave ?? null);
  };
  const fecharVideoLocal = () => {
    setVideoAberto(null);
    setChaveAberta(null);
  };
  // Voltar (gesto/botão do celular) fecha SÓ o vídeo e volta para a vitrine:
  // ao abrir um clipe, empurra uma entrada própria no histórico; o popstate
  // dela fecha o vídeo. Trocar de clipe na lateral não empurra outra entrada.
  const videoEstaAberto = videoAberto !== null;
  useEffect(() => {
    if (!videoEstaAberto) return;
    window.history.pushState({ empireSlidingPlaylist: true, empireClipeAberto: true }, "");
    const onPopState = () => {
      if (!window.history.state?.empireClipeAberto) fecharVideoLocal();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [videoEstaAberto]);
  // Fechar pelo X também passa pelo histórico, senão a entrada fica órfã.
  const fecharVideo = () => {
    if (window.history.state?.empireClipeAberto) window.history.back();
    else fecharVideoLocal();
  };

  const q = busca.toLowerCase().trim();
  const visiveis = q
    ? cartoes.filter(
        ({ faixa }) => faixa.titulo.toLowerCase().includes(q) || faixa.artista.toLowerCase().includes(q),
      )
    : cartoes;

  const titulo = playlist?.titulo ?? (erro ? "Playlist" : "Carregando playlist");
  const capaDestaque = cartoes.find((c) => c.thumb)?.thumb ?? playlist?.capa_url ?? null;

  return (
    <div className="fixed inset-0 z-[140] bg-neutral-950 overflow-y-auto overflow-x-hidden animate-in slide-in-from-right duration-300">
      <div className="mx-auto w-full max-w-[1400px] lg:flex lg:items-start lg:gap-6 lg:px-6 lg:py-6">
        {/* Painel da playlist (fixo à esquerda no desktop, como no YouTube) */}
        <section className="relative overflow-hidden bg-gradient-to-b from-red-900/60 to-neutral-950 lg:sticky lg:top-6 lg:w-[360px] lg:shrink-0 lg:rounded-2xl lg:border lg:border-white/10">
          <div className="relative px-4 pb-5 sm:px-6 lg:px-5 lg:pb-6" style={{ paddingTop: "max(1rem, calc(env(safe-area-inset-top) + 0.6rem))" }}>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onFechar}
                aria-label="Voltar"
                className="size-10 shrink-0 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm text-white grid place-items-center shadow-lg transition"
              >
                <ChevronLeft className="size-5 shrink-0" />
              </button>
              <button
                type="button"
                onClick={onFechar}
                aria-label="Fechar"
                className="size-10 shrink-0 rounded-full bg-black/40 hover:bg-black/70 text-white/80 hover:text-white grid place-items-center transition"
              >
                <X className="size-5 shrink-0" />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end lg:flex-col lg:items-stretch">
              <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-neutral-800 shadow-2xl sm:w-72 sm:shrink-0 lg:w-full">
                {capaDestaque ? (
                  <SmartImg
                    src={capaDestaque}
                    size={640}
                    wide
                    alt=""
                    className="absolute inset-0 size-full object-cover"
                    fallback={<DynamicCoverCard platform="youtube" className="absolute inset-0" />}
                  />
                ) : (
                  <DynamicCoverCard platform="youtube" className="absolute inset-0" />
                )}
              </div>

              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white/60">
                  <span>Playlist de clipes</span>
                  {playlist?.aoVivo && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[9px] text-white">
                      <Radio className="size-3 shrink-0" />
                      <span>Ao vivo</span>
                    </span>
                  )}
                </p>
                <h1 className={`mt-1 text-2xl sm:text-3xl font-black text-white leading-[1.05] tracking-tight ${QUEBRA}`}>
                  {titulo}
                </h1>
                {playlist?.subtitulo && (
                  <p className={`mt-1.5 text-xs text-white/70 ${QUEBRA}`}>{playlist.subtitulo}</p>
                )}
                {playlist && (
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11px] sm:text-xs text-white/60">
                    <Film className="size-3.5 shrink-0" />
                    <span>{clipes.length} clipes</span>
                    {semClipe > 0 && <span className="text-white/40">· {semClipe} sem clipe</span>}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const primeiro = cartoes.find((c) => c.video);
                  if (primeiro) abrirClipe(primeiro);
                }}
                disabled={clipes.length === 0}
                className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-black text-black hover:bg-white/90 disabled:opacity-30 disabled:pointer-events-none active:scale-95 transition"
              >
                <Play className="size-4 shrink-0 fill-black" />
                <span className="truncate">Ver primeiro clipe</span>
              </button>
              <div className="flex min-w-0 flex-1 basis-48 items-center gap-2 rounded-full bg-white/10 px-3 py-2.5">
                <Search className="size-4 shrink-0 text-white/50" />
                <input
                  type="text"
                  placeholder="Pesquisar nesta playlist..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="w-full min-w-0 bg-transparent text-xs text-white placeholder-white/40 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Clipes */}
        <section className="min-w-0 flex-1 px-2 py-3 sm:px-4 lg:px-0 lg:py-0">
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
              {faixas.length === 0 ? "Sem dados agora." : "Nenhum item encontrado nesta playlist."}
            </div>
          ) : (
            <ol className="flex flex-col gap-1">
              {visiveis.map((c) => (
                <li key={`${c.faixa.chave}:${c.faixa.pos}`}>
                  <CartaoClipe
                    cartao={c}
                    ativo={
                      c.video
                        ? !!videoAberto && chaveAberta === c.faixa.chave
                        : !!c.track && !!currentTrack && currentTrack.id === c.track.id
                    }
                    onTocar={() => {
                      if (c.video) abrirClipe(c);
                      else if (c.track) playSong(c.track, filaAudio);
                    }}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <VideoPlayer
        video={videoAberto}
        onClose={fecharVideo}
        relatedVideos={clipes}
        relatedTitulo="Nesta playlist"
        onSelectVideo={selecionarVideo}
      />
    </div>
  );
}

function CartaoClipe({ cartao, ativo, onTocar }: { cartao: Cartao; ativo: boolean; onTocar: () => void }) {
  const { faixa, video, track, thumb } = cartao;
  const tocavel = !!video || !!track;

  const conteudo = (
    <>
      {/* Posição */}
      <span
        className={`w-6 shrink-0 self-center text-center font-mono text-xs font-black ${
          ativo ? "text-red-400" : "text-neutral-500"
        }`}
      >
        {faixa.pos}
      </span>

      {/* Miniatura 16:9 */}
      <span className="relative block aspect-video w-36 shrink-0 overflow-hidden rounded-lg bg-neutral-900 sm:w-48 lg:w-56">
        {thumb ? (
          <SmartImg
            src={thumb}
            size={480}
            wide
            alt=""
            className={`absolute inset-0 size-full object-cover transition-transform ${
              video ? "group-hover:scale-105" : ""
            }`}
            fallback={
              <span className="absolute inset-0 grid place-items-center text-neutral-600">
                <Film className="size-6" />
              </span>
            }
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-neutral-600">
            <Film className="size-6" />
          </span>
        )}
        {video ? (
          <span className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/35">
            <span
              className={`grid size-10 place-items-center rounded-full bg-red-600/90 text-white shadow-lg transition-opacity ${
                ativo ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              <Play className="ml-0.5 size-4 shrink-0 fill-white" />
            </span>
          </span>
        ) : (
          <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
            <Film className="size-3 shrink-0" />
            <span>Sem clipe</span>
          </span>
        )}
      </span>

      {/* Título, artista e valor completos (quebram linha) */}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
        <span
          className={`text-sm font-extrabold leading-snug sm:text-[15px] ${QUEBRA} ${
            ativo ? "text-red-400" : tocavel ? "text-white" : "text-neutral-400"
          }`}
        >
          {faixa.titulo}
        </span>
        {faixa.artista && <span className={`text-xs text-neutral-400 ${QUEBRA}`}>{faixa.artista}</span>}
        <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-neutral-500">
          {faixa.valor && <span className="font-mono font-bold tabular-nums text-neutral-300">{faixa.valor}</span>}
          {faixa.posGlobal != null && <span>#{faixa.posGlobal} no Global 100</span>}
          {!video && track && (
            <span className="inline-flex items-center gap-1 font-bold">
              <Volume2 className="size-3 shrink-0" />
              <span>Tocar áudio</span>
            </span>
          )}
          {!tocavel && <span className="font-bold">Sem áudio no catálogo</span>}
        </span>
      </span>
    </>
  );

  const classe = `group flex w-full items-start gap-2 rounded-xl px-1.5 py-2 text-left transition-colors sm:gap-3 sm:px-2 ${
    ativo ? "bg-red-500/10" : ""
  }`;

  // Faixa sem clipe e sem áudio: não é botão (tocar não faz nada).
  if (!tocavel) return <div className={`${classe} opacity-60`}>{conteudo}</div>;

  return (
    <button
      type="button"
      onClick={onTocar}
      className={`${classe} cursor-pointer hover:bg-white/5`}
    >
      {conteudo}
    </button>
  );
}
