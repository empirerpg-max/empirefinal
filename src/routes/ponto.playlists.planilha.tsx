import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import {
  ChevronLeft,
  Loader2,
  Coins,
  RefreshCw,
  Send,
  AlertTriangle,
  AlertCircle,
  Music2,
} from "lucide-react";
import { useTelegramUser } from "@/lib/telegram";
import { api } from "@/lib/api";

export const Route = createFileRoute("/ponto/playlists/planilha")({
  component: PontoPlaylistsPlanilha,
});

const PLAYLISTS: Record<string, string[]> = {
  SPOTIFY: [
    "TOPO TODAY'S TOP HITS",
    "TODAY'S TOP HITS",
    "POP UP",
    "ROCK SOLID",
    "RAP CAVIAR",
    "MINT",
    "ARE & BE",
    "VIVA LATINO",
    "ALTERNATIVE PARTY",
    "JUST HITS",
    "NEW SONGS",
    "WORKOUT TIME",
    "RANDOM SONGS",
    "THIS IS... (ARTIST)",
  ],
  "APPLE MUSIC": [
    "TOPO TODAY'S HITS",
    "TODAY'S HITS",
    "A-LIST POP",
    "hyped<D>",
    "RAPLIFE",
    "danceXL",
    "R&B NOW",
    "!DalePlay!",
    "ALT CTRL",
    "JUST HITS",
    "JUST NEW",
    "GYM SONGS",
    "RANDOM SONGS",
    "JUST... (ARTIST)",
  ],
  YOUTUBE: ["Ad 5 segundos (Comercial/Vídeo)", "Ad 30 segundos (Comercial/Vídeo)", "Ad (Vídeo Completo)"],
};

type Musica = { linha: number; artista: string; musica: string };
type Selecoes = Record<string, string>;

function PontoPlaylistsPlanilha() {
  const { user, ready } = useTelegramUser();
  const tgId = user?.id ? String(user.id) : localStorage.getItem("empire_tg_id") || "";

  const [musicas, setMusicas] = useState<Musica[]>([]);
  const [artistasDisp, setArtistasDisp] = useState<string[]>([]);
  const [artistaSel, setArtistaSel] = useState<string>("");
  const [saldosMap, setSaldosMap] = useState<Record<string, number>>({});

  const [musicaSelecionada, setMusicaSelecionada] = useState<Musica | null>(null);
  const [pendente, setPendente] = useState<Record<string, Selecoes>>({});
  const [confirmado, setConfirmado] = useState<Record<string, Selecoes>>({});

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null);

  const carregarDados = useCallback(async () => {
    if (!tgId) return;
    setLoading(true);
    try {
      const [pts, sal]: [any, any] = await Promise.all([
        api.call({ acao: "ponto_listar_pontos", tgId }).catch(() => ({})),
        api.call({ acao: "ponto_saldo_ecoin_dados", tgId }).catch(() => ({})),
      ]);

      if (pts?.erro) setMsg({ key: "global", text: pts.erro, ok: false });

      const listaMusicas: Musica[] = (pts?.linhas || []).map((r: any) => ({
        linha: r.linha,
        artista: r.artista || "",
        musica: r.valores?.["MÚSICA"] || r.valores?.["NOME DA MÚSICA"] || r.valores?.["MUSICA"] || "Desconhecida",
      }));

      const unicos = Array.from(new Set(listaMusicas.map((m) => m.artista).filter((a) => a)));
      setArtistasDisp(unicos);
      setMusicas(listaMusicas);

      if (sal?.saldos) {
        setSaldosMap(sal.saldos);
      }
    } finally {
      setLoading(false);
    }
  }, [tgId]);

  const atualizarSaldoIndividual = useCallback(
    async (artistaNome: string) => {
      if (!tgId || !artistaNome) return;
      setRefreshing(true);
      try {
        const sal: any = await api.call({ acao: "ponto_saldo_ecoin_dados", tgId });
        if (sal?.saldos) {
          setSaldosMap(sal.saldos);
        }
      } finally {
        setRefreshing(false);
      }
    },
    [tgId],
  );

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  function toggleSelecao(musica: Musica, plataforma: string, playlist: string) {
    const mKey = String(musica.linha);
    setPendente((prev) => {
      const atual = prev[mKey] || {};
      if (atual[plataforma] === playlist) {
        const { [plataforma]: _, ...resto } = atual;
        return { ...prev, [mKey]: resto };
      }
      return { ...prev, [mKey]: { ...atual, [plataforma]: playlist } };
    });
    setMsg(null);
  }

  async function enviarMusica(musica: Musica) {
    const mKey = String(musica.linha);
    const selecoes = pendente[mKey] || {};
    if (Object.keys(selecoes).length === 0) return;

    setEnviando(mKey);
    setMsg(null);

    const erros: string[] = [];
    let sucessos = 0;

    // Garantia: nunca enviar artista vazio (fallback para o chip selecionado)
    const artistaFinal = (musica.artista || artistaSel || "").trim();

    for (const [plataforma, playlist] of Object.entries(selecoes)) {
      const d: any = await api.call({
        acao: "ponto_salvar_playlist_ecoin",
        tgId,
        artista: artistaFinal,
        musica: musica.musica,
        plataforma,
        playlist,
      });

      if (d?.ok) {
        sucessos++;
        setConfirmado((prev) => ({ ...prev, [mKey]: { ...(prev[mKey] || {}), [plataforma]: playlist } }));
      } else {
        erros.push(`${plataforma}: ${d?.erro || "Erro"}`);
      }
    }

    setEnviando(null);

    if (erros.length === 0) {
      setPendente((prev) => {
        const { [mKey]: _, ...resto } = prev;
        return resto;
      });
      setMsg({ key: mKey, text: `${sucessos} playlist(s) aplicada(s) com sucesso!`, ok: true });
      atualizarSaldoIndividual(musica.artista);
    } else {
      setMsg({ key: mKey, text: `${erros.join(" | ")}`, ok: false });
    }
  }

  if (!ready || loading)
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="animate-spin text-primary w-8 h-8" />
      </div>
    );

  const saldoAtual = Number(saldosMap[artistaSel] || 0);
  const saldoNegativo = saldoAtual < 0;
  const musicasFiltradas = musicas.filter((m) => m.artista === artistaSel);

  // === VIEW DE DETALHE DA MÚSICA (substitui a lista, sem ficar embaixo) ===
  if (musicaSelecionada) {
    const mKey = String(musicaSelecionada.linha);
    const pendenteMusica = pendente[mKey] || {};
    const confirmadoMusica = confirmado[mKey] || {};
    const isEnviando = enviando === mKey;
    const temPendente = Object.keys(pendenteMusica).length > 0;

    return (
      <main className="flex-1 mx-auto w-full max-w-md px-5 pt-6 pb-24 flex flex-col gap-4">
        <button
          onClick={() => {
            setMusicaSelecionada(null);
            setMsg(null);
          }}
          className="flex items-center gap-1 text-sm text-muted-foreground mb-2 hover:text-primary transition-colors w-fit"
        >
          <ChevronLeft className="w-4 h-4" /> Voltar para músicas
        </button>

        {/* Header da música */}
        <div className="rounded-2xl border border-white/10 bg-card p-4 flex items-start gap-3 shadow-lg">
          <div className="size-11 rounded-xl bg-primary/15 grid place-items-center shrink-0">
            <Music2 className="size-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-primary font-bold uppercase tracking-widest truncate mb-1">
              {musicaSelecionada.artista}
            </p>
            <h2 className="font-black text-lg leading-tight truncate">{musicaSelecionada.musica}</h2>
          </div>
        </div>

        {/* Saldo $ BANK ACCOUNT */}
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between shadow-lg transition-colors ${
            saldoNegativo ? "bg-red-950/40 border-red-500/50" : "bg-card border-white/10"
          }`}
        >
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 font-bold">$ BANK ACCOUNT</p>
            <div className="flex items-center gap-2">
              <Coins className={`w-5 h-5 ${saldoNegativo ? "text-red-400" : "text-yellow-400"}`} />
              <p className={`text-2xl font-black ${saldoNegativo ? "text-red-400" : "text-yellow-400"}`}>
                {saldoAtual.toLocaleString("pt-BR")}
              </p>
            </div>
            {saldoNegativo && (
              <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Orçamento estourado!
              </p>
            )}
          </div>
          <button
            onClick={() => atualizarSaldoIndividual(musicaSelecionada.artista)}
            disabled={refreshing}
            className="p-3 bg-white/5 rounded-xl hover:bg-white/10"
          >
            <RefreshCw className={`w-5 h-5 text-muted-foreground ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Plataformas */}
        <div className="flex flex-col gap-3 mt-1">
          {(["SPOTIFY", "APPLE MUSIC", "YOUTUBE"] as const).map((plat) => {
            const enviada = confirmadoMusica[plat];
            const selAtual = pendenteMusica[plat];

            return (
              <div key={plat} className="bg-card rounded-2xl border border-white/10 overflow-hidden">
                <div className="px-4 py-3 bg-white/5 border-b border-white/5 flex justify-between items-center">
                  <p className="text-xs font-black text-gray-200 tracking-wide">{plat}</p>
                  {enviada && (
                    <span className="text-[10px] bg-green-900/30 text-green-400 px-2 py-1 rounded-full font-bold">
                      ✓ {enviada}
                    </span>
                  )}
                </div>

                <div className="p-2 flex flex-col gap-1">
                  {PLAYLISTS[plat].map((pl) => {
                    const selecionada = selAtual === pl;
                    const jaEnviada = enviada === pl;
                    const isTopo = pl.toUpperCase().startsWith("TOPO ");
                    // TOPO já enviada para esta música → bloqueia nova seleção
                    const topoBloqueada = isTopo && jaEnviada;
                    return (
                      <button
                        key={pl}
                        disabled={isEnviando || topoBloqueada}
                        onClick={() => toggleSelecao(musicaSelecionada, plat, pl)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between gap-2 ${
                          jaEnviada
                            ? "bg-green-900/20 text-green-400 opacity-70"
                            : selecionada
                              ? "bg-primary/20 text-primary border border-primary/50"
                              : "hover:bg-white/5 text-gray-300 border border-transparent"
                        } ${topoBloqueada ? "cursor-not-allowed" : ""}`}
                        title={topoBloqueada ? "Playlist TOPO já utilizada por esta música" : undefined}
                      >
                        <span className="truncate">{pl}</span>
                        {isTopo && (
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                              jaEnviada
                                ? "bg-green-500/20 text-green-400"
                                : "bg-yellow-500/15 text-yellow-400"
                            }`}
                          >
                            TOPO
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Botão Enviar */}
          <button
            disabled={!temPendente || isEnviando}
            onClick={() => enviarMusica(musicaSelecionada)}
            className={`mt-1 w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold transition-all ${
              temPendente && !isEnviando
                ? "bg-primary text-primary-foreground hover:brightness-110 shadow-[0_0_15px_rgba(var(--primary),0.3)]"
                : "bg-white/5 text-muted-foreground cursor-not-allowed"
            }`}
          >
            {isEnviando ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Processando...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" /> Enviar Playlists Selecionadas
              </>
            )}
          </button>

          {msg?.key === mKey && (
            <p className={`text-center text-xs font-semibold ${msg.ok ? "text-green-400" : "text-red-400"}`}>
              {msg.text}
            </p>
          )}
        </div>
      </main>
    );
  }

  // === VIEW DE LISTA DE MÚSICAS ===
  return (
    <main className="flex-1 mx-auto w-full max-w-md px-4 pt-4 pb-24 flex flex-col gap-3">
      {/* Topo compacto sticky */}
      <div className="sticky top-0 z-10 -mx-4 px-4 pt-2 pb-3 bg-background/85 backdrop-blur-md border-b border-white/5 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Link to="/ponto/playlists" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors">
            <ChevronLeft className="w-4 h-4" /> Voltar
          </Link>
          <h2 className="text-sm font-black italic tracking-tighter">Playlists · Manual</h2>
          <button
            onClick={() => artistaSel && atualizarSaldoIndividual(artistaSel)}
            disabled={refreshing || !artistaSel}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40"
            aria-label="Atualizar saldo"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>

        {artistasDisp.length > 0 && (
          <div className="flex overflow-x-auto gap-1.5 scrollbar-hide -mx-1 px-1">
            {artistasDisp.map((a) => (
              <button
                key={a}
                onClick={() => setArtistaSel(a)}
                className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                  artistaSel === a
                    ? "bg-primary text-primary-foreground"
                    : "bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        )}

        {artistaSel && (
          <div
            className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl border ${
              saldoNegativo ? "bg-red-950/40 border-red-500/40" : "bg-card border-white/10"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Coins className={`w-4 h-4 shrink-0 ${saldoNegativo ? "text-red-400" : "text-yellow-400"}`} />
              <div className="min-w-0">
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold leading-none">
                  $ Bank
                </p>
                <p className={`text-base font-black leading-tight ${saldoNegativo ? "text-red-400" : "text-yellow-400"}`}>
                  {saldoAtual.toLocaleString("pt-BR")}
                </p>
              </div>
            </div>
            {saldoNegativo && (
              <span className="text-[9px] text-red-400 flex items-center gap-1 font-bold uppercase tracking-wider">
                <AlertTriangle className="w-3 h-3" /> Estourado
              </span>
            )}
          </div>
        )}
      </div>

      {msg?.key === "global" && (
        <div className="p-3 bg-red-950/40 border border-red-500/50 rounded-xl text-red-400 text-xs font-semibold">
          {msg.text}
        </div>
      )}

      {artistasDisp.length === 0 && !msg?.key ? (
        <div className="p-8 text-center bg-white/5 rounded-2xl border border-white/10 mt-4">
          <AlertCircle className="w-8 h-8 mx-auto text-muted-foreground mb-3 opacity-50" />
          <p className="text-sm text-muted-foreground">Nenhuma música/artista encontrado na aba PONTOS.</p>
        </div>
      ) : !artistaSel ? (
        <div className="p-6 text-center bg-white/5 rounded-2xl border border-white/10 mt-2">
          <p className="text-xs text-muted-foreground">Selecione um artista acima para ver as músicas.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 mt-1">
          {musicasFiltradas.length === 0 ? (
            <div className="p-4 bg-white/5 rounded-xl text-center text-sm text-muted-foreground">
              Não encontramos músicas para {artistaSel}.
            </div>
          ) : (
            musicasFiltradas.map((m) => (
              <button
                key={m.linha}
                onClick={() => {
                  setMusicaSelecionada(m);
                  setMsg(null);
                }}
                className="rounded-xl border border-white/10 bg-card hover:border-primary/40 hover:bg-white/5 transition-all text-left px-3 py-3 flex items-center gap-3 group"
              >
                <div className="size-9 rounded-lg bg-primary/10 grid place-items-center shrink-0 group-hover:bg-primary/20 transition-colors">
                  <Music2 className="size-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-sm leading-tight truncate">{m.musica}</h3>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider truncate mt-0.5">
                    {m.artista}
                  </p>
                </div>
                <ChevronLeft className="w-4 h-4 text-muted-foreground rotate-180 shrink-0 group-hover:text-primary transition-colors" />
              </button>
            ))
          )}
        </div>
      )}
    </main>
  );
}
