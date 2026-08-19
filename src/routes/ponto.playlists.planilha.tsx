import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronDown,
  Loader2,
  Coins,
  AlertTriangle,
  AlertCircle,
  Music2,
  Plus,
  Search,
  RotateCcw,
} from "lucide-react";
import { api, driveImg } from "@/lib/api";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { useDragScroll } from "@/lib/useDragScroll";

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

type LinhaInvestimento = {
  linha: number;
  musica: string;
  bankAccount: string;
  spotify: string;
  spotifyValor: string;
  apple: string;
  appleValor: string;
  youtube: string;
  youtubeValor: string;
  total: string;
};

type GrupoInvestimento = {
  artista: string;
  saldo: number;
  linhas: LinhaInvestimento[];
};

function fmtMoeda(n: number): string {
  return `R$ ${n.toLocaleString("pt-BR")}`;
}

function parseMoeda(v: string): number {
  return parseFloat(String(v || "").replace(/[^\d,-]/g, "").replace(",", ".")) || 0;
}

// $ BANK ACCOUNT (coluna D) já é o saldo AO VIVO — a própria planilha
// desconta o gasto de cada música do artista assim que uma playlist é
// escolhida. Nunca recalculamos isso no app, só refletimos o valor que a
// planilha devolve depois de cada escrita.

function PontoPlaylistsPlanilha() {
  const { user, ready } = useTelegramUser();
  const tgId = user?.id ? String(user.id) : (typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null) || "";
  const artistScroll = useDragScroll<HTMLDivElement>();

  const [grupos, setGrupos] = useState<GrupoInvestimento[]>([]);
  const [musicasPorArtista, setMusicasPorArtista] = useState<Record<string, string[]>>({});
  const [fotos, setFotos] = useState<Record<string, string>>({});
  const [artistaAtivo, setArtistaAtivo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [linhaAberta, setLinhaAberta] = useState<number | null>(null);
  const [escolhendoMusica, setEscolhendoMusica] = useState(false);
  const [iniciando, setIniciando] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null);
  const [buscaLista, setBuscaLista] = useState("");
  const [buscaMusica, setBuscaMusica] = useState("");

  const carregar = () => {
    if (!tgId) return;
    setLoading(true);
    Promise.all([api.listarInvestimentos(tgId), api.listarPontos(tgId), api.meusArtistas(tgId)])
      .then(([inv, pts, artistas]) => {
        setGrupos(inv.grupos);
        if (inv.grupos.length > 0) setArtistaAtivo((cur) => cur || inv.grupos[0].artista);
        else if (pts.grupos.length > 0) setArtistaAtivo((cur) => cur || pts.grupos[0].artista);

        const musicasMap: Record<string, string[]> = {};
        for (const g of pts.grupos) musicasMap[g.artista] = g.musicas.map((m) => m.musica).filter(Boolean);
        setMusicasPorArtista(musicasMap);

        const fotoMap: Record<string, string> = {};
        for (const a of artistas) fotoMap[a.nome] = a.foto;
        setFotos(fotoMap);
      })
      .catch(() => {
        setMsg({ key: "global", text: "Erro ao se conectar com a planilha ECOIN + INVESTIMENTO.", ok: false });
      })
      .finally(() => setLoading(false));
  };

  useEffect(carregar, [tgId]);

  const todosArtistas = useMemo(() => {
    const nomes = new Set<string>([...grupos.map((g) => g.artista), ...Object.keys(musicasPorArtista)]);
    return Array.from(nomes);
  }, [grupos, musicasPorArtista]);

  const grupoAtivo = useMemo(
    () => grupos.find((g) => g.artista === artistaAtivo) || null,
    [grupos, artistaAtivo],
  );

  const musicasDisponiveis = useMemo(() => {
    if (!artistaAtivo) return [];
    const todas = musicasPorArtista[artistaAtivo] || [];
    const jaUsadas = new Set((grupoAtivo?.linhas || []).map((l) => l.musica));
    return todas.filter((m) => !jaUsadas.has(m));
  }, [artistaAtivo, musicasPorArtista, grupoAtivo]);

  const musicasFiltradas = useMemo(() => {
    const termo = buscaMusica.trim().toLowerCase();
    if (!termo) return musicasDisponiveis;
    return musicasDisponiveis.filter((m) => m.toLowerCase().includes(termo));
  }, [musicasDisponiveis, buscaMusica]);

  const linhasFiltradas = useMemo(() => {
    const linhas = grupoAtivo?.linhas || [];
    const termo = buscaLista.trim().toLowerCase();
    if (!termo) return linhas;
    return linhas.filter((l) => l.musica.toLowerCase().includes(termo));
  }, [grupoAtivo, buscaLista]);

  async function iniciar(musica: string) {
    if (!artistaAtivo || iniciando) return;
    haptic.selection();
    setIniciando(true);
    setMsg(null);
    const r = await api.iniciarInvestimento({ telegramId: tgId, artista: artistaAtivo, musica });
    setIniciando(false);
    if ((r as any)?.ok) {
      haptic.success();
      setEscolhendoMusica(false);
      if ((r as any).linha) setLinhaAberta((r as any).linha);
      carregar();
    } else {
      haptic.error();
      setMsg({ key: "global", text: (r as any)?.error || "Erro ao iniciar investimento.", ok: false });
    }
  }

  async function investir(linha: LinhaInvestimento, plataforma: string, playlist: string) {
    const key = `${linha.linha}-${plataforma}`;
    setSaving(key);
    setMsg(null);
    const r = await api.investirPlaylist({ telegramId: tgId, linha: linha.linha, plataforma, playlist });
    setSaving(null);
    if ((r as any)?.ok && (r as any).investimento) {
      haptic.success();
      const atualizada: LinhaInvestimento = (r as any).investimento;
      setGrupos((prev) =>
        prev.map((g) =>
          g.artista !== artistaAtivo
            ? g
            : {
                ...g,
                linhas: g.linhas.map((l) => (l.linha === linha.linha ? atualizada : l)),
                // D já vem recalculado ao vivo pela planilha na própria resposta.
                saldo: parseMoeda(atualizada.bankAccount) || g.saldo,
              },
        ),
      );
      setMsg({ key, text: "Investido!", ok: true });
    } else {
      haptic.error();
      setMsg({ key, text: (r as any)?.error || "Erro ao investir", ok: false });
    }
  }

  async function limparInvestimentos(linha: LinhaInvestimento) {
    const key = `${linha.linha}-limpar`;
    setSaving(key);
    setMsg(null);
    const r = await api.limparInvestimento(tgId, linha.linha);
    setSaving(null);
    if ((r as any)?.ok && (r as any).investimento) {
      haptic.success();
      const atualizada: LinhaInvestimento = (r as any).investimento;
      setGrupos((prev) =>
        prev.map((g) =>
          g.artista !== artistaAtivo
            ? g
            : { ...g, linhas: g.linhas.map((l) => (l.linha === linha.linha ? atualizada : l)) },
        ),
      );
      setMsg({ key, text: "Limpo! Escolha de novo.", ok: true });
    } else {
      haptic.error();
      setMsg({ key, text: (r as any)?.error || "Erro ao limpar", ok: false });
    }
  }

  if (!ready || loading)
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="animate-spin text-emerald-500 w-8 h-8" />
      </div>
    );

  // === VIEW DE ESCOLHA DE MÚSICA (nova linha) ===
  if (escolhendoMusica) {
    return (
      <main className="flex-1 mx-auto w-full max-w-md px-5 pt-6 pb-24 flex flex-col gap-4">
        <button
          onClick={() => {
            setEscolhendoMusica(false);
            setBuscaMusica("");
          }}
          className="flex items-center gap-1 text-sm text-neutral-500 mb-2 hover:text-emerald-500 transition-colors w-fit"
        >
          <ChevronLeft className="w-4 h-4" /> Voltar
        </button>
        <h2 className="text-xl font-black italic tracking-tighter text-white">Escolha a música</h2>
        <p className="text-sm text-neutral-500 -mt-2">Investir em {artistaAtivo}</p>

        {musicasDisponiveis.length > 3 && (
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-neutral-600" />
            <input
              autoFocus
              value={buscaMusica}
              onChange={(e) => setBuscaMusica(e.target.value)}
              placeholder="Buscar música..."
              className="w-full h-10 bg-neutral-900 border border-white/10 rounded-xl pl-10 pr-4 text-sm font-bold text-white placeholder:text-neutral-600 outline-none focus:border-emerald-500/40 transition-colors"
            />
          </div>
        )}

        {musicasDisponiveis.length === 0 ? (
          <div className="p-6 text-center bg-neutral-900 rounded-2xl border border-white/10">
            <p className="text-sm text-neutral-500">
              Todas as músicas de {artistaAtivo} já têm investimento, ou nenhuma música foi encontrada na aba PONTOS.
            </p>
          </div>
        ) : musicasFiltradas.length === 0 ? (
          <div className="p-6 text-center bg-neutral-900 rounded-2xl border border-white/10">
            <p className="text-sm text-neutral-500">Nenhuma música encontrada para "{buscaMusica}".</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {musicasFiltradas.map((m) => (
              <button
                key={m}
                disabled={iniciando}
                onClick={() => iniciar(m)}
                className="rounded-2xl border border-white/10 bg-neutral-900 hover:border-emerald-500/40 hover:bg-neutral-800 transition-colors text-left px-4 py-3 flex items-center gap-3 disabled:opacity-50"
              >
                <Music2 className="size-4 text-emerald-500 shrink-0" />
                <span className="text-sm font-bold text-white truncate">{m}</span>
              </button>
            ))}
          </div>
        )}
        {msg?.key === "global" && (
          <p className={`text-center text-xs font-semibold ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>
            {msg.text}
          </p>
        )}
      </main>
    );
  }

  // === VIEW DE LISTA (por artista, com cards expansíveis) ===
  return (
    <main className="flex-1 mx-auto w-full max-w-md px-5 pt-6 pb-24 flex flex-col gap-4">
      <Link to="/ponto/playlists" className="flex items-center gap-1 text-sm text-neutral-500 hover:text-emerald-500 mb-2 w-fit transition-colors">
        <ChevronLeft className="w-4 h-4" /> Voltar
      </Link>

      <div className="mb-2">
        <h2 className="text-2xl font-black italic tracking-tighter text-white">Playlists · Manual</h2>
        <p className="text-sm text-neutral-500 mt-1">Toque numa música pra abrir e escolher as playlists.</p>
      </div>

      {msg?.key === "global" && (
        <div className="p-4 bg-red-950/40 border border-red-500/50 rounded-2xl text-red-400 text-sm font-semibold">
          {msg.text}
        </div>
      )}

      {todosArtistas.length === 0 && !msg ? (
        <div className="p-8 text-center bg-neutral-900 rounded-2xl border border-white/10">
          <AlertCircle className="w-8 h-8 mx-auto text-neutral-700 mb-3" />
          <p className="text-sm text-neutral-500">Nenhum artista encontrado.</p>
        </div>
      ) : (
        <>
          {todosArtistas.length > 1 && (
            <div className="relative -mx-5">
              <div
                ref={artistScroll.ref}
                {...artistScroll.dragProps}
                className="flex overflow-x-auto gap-3 scrollbar-hide px-5 pb-1 cursor-grab active:cursor-grabbing select-none"
                style={{ touchAction: "pan-x", WebkitOverflowScrolling: "touch" }}
              >
                {todosArtistas.map((a) => {
                  const ativo = artistaAtivo === a;
                  return (
                    <button
                      key={a}
                      onClick={() => {
                        haptic.selection();
                        setArtistaAtivo(a);
                        setLinhaAberta(null);
                        setBuscaLista("");
                      }}
                      className="flex flex-col items-center gap-1.5 shrink-0 w-16"
                    >
                      <div
                        className={`size-14 rounded-full overflow-hidden grid place-items-center border-2 transition-all ${
                          ativo ? "border-emerald-500 scale-105" : "border-white/10 opacity-60"
                        }`}
                      >
                        {fotos[a] ? (
                          <img src={driveImg(fotos[a])} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-emerald-500/15 grid place-items-center">
                            <Music2 className="size-5 text-emerald-500" />
                          </div>
                        )}
                      </div>
                      <p className={`text-[10px] font-bold truncate w-full text-center ${ativo ? "text-emerald-400" : "text-neutral-500"}`}>
                        {a}
                      </p>
                    </button>
                  );
                })}
              </div>
              <div className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-background to-transparent" />
              <div className="pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-background to-transparent" />
            </div>
          )}

          {artistaAtivo && (
            <div
              className={`p-4 rounded-2xl border flex items-center justify-between ${
                (grupoAtivo?.saldo ?? 0) < 0 ? "bg-red-950/40 border-red-500/40" : "bg-neutral-900 border-white/10"
              }`}
            >
              <div className="flex items-center gap-2">
                <Coins className={`w-4 h-4 shrink-0 ${(grupoAtivo?.saldo ?? 0) < 0 ? "text-red-400" : "text-amber-400"}`} />
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-neutral-500 font-bold leading-none">
                    $ Bank Account
                  </p>
                  <p className={`text-base font-black leading-tight ${(grupoAtivo?.saldo ?? 0) < 0 ? "text-red-400" : "text-amber-400"}`}>
                    {grupoAtivo ? fmtMoeda(grupoAtivo.saldo) : "—"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  haptic.selection();
                  setEscolhendoMusica(true);
                  setMsg(null);
                }}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-full bg-emerald-500 text-black text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform"
              >
                <Plus className="size-3.5" /> Nova
              </button>
            </div>
          )}

          {(grupoAtivo?.linhas.length || 0) > 3 && (
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-neutral-600" />
              <input
                value={buscaLista}
                onChange={(e) => setBuscaLista(e.target.value)}
                placeholder="Buscar música..."
                className="w-full h-10 bg-neutral-900 border border-white/10 rounded-xl pl-10 pr-4 text-sm font-bold text-white placeholder:text-neutral-600 outline-none focus:border-emerald-500/40 transition-colors"
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            {(grupoAtivo?.linhas || []).length === 0 ? (
              <div className="p-6 text-center bg-neutral-900 rounded-2xl border border-white/10">
                <p className="text-sm text-neutral-500">Nenhum investimento ainda de {artistaAtivo}.</p>
              </div>
            ) : linhasFiltradas.length === 0 ? (
              <div className="p-6 text-center bg-neutral-900 rounded-2xl border border-white/10">
                <p className="text-sm text-neutral-500">Nenhuma música encontrada para "{buscaLista}".</p>
              </div>
            ) : (
              linhasFiltradas.map((l) => {
                const aberta = linhaAberta === l.linha;
                const plataformasPreenchidas = [l.spotify, l.apple, l.youtube].filter(Boolean).length;

                return (
                  <div key={l.linha} className="rounded-2xl border border-white/10 bg-neutral-900 overflow-hidden">
                    <button
                      onClick={() => {
                        haptic.selection();
                        setLinhaAberta(aberta ? null : l.linha);
                        setMsg(null);
                      }}
                      className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-neutral-800 transition-colors"
                    >
                      <div className="size-9 rounded-xl bg-emerald-500/15 grid place-items-center shrink-0">
                        <Music2 className="size-4 text-emerald-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-sm leading-tight truncate text-white">{l.musica}</h3>
                        <p className="text-[10px] text-neutral-500 mt-0.5">
                          {plataformasPreenchidas}/3 plataformas · {l.total || fmtMoeda(0)} gasto
                        </p>
                      </div>
                      <ChevronDown
                        className={`size-4 text-neutral-500 shrink-0 transition-transform ${aberta ? "rotate-180" : ""}`}
                      />
                    </button>

                    {aberta && (
                      <div className="px-4 pb-4 pt-1 flex flex-col gap-2.5 border-t border-white/5">
                        {(
                          [
                            ["SPOTIFY", l.spotify, l.spotifyValor],
                            ["APPLE MUSIC", l.apple, l.appleValor],
                            ["YOUTUBE", l.youtube, l.youtubeValor],
                          ] as const
                        ).map(([plat, atual, valorAtual]) => {
                          const key = `${l.linha}-${plat}`;
                          const isSaving = saving === key;
                          return (
                            <div key={plat}>
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">{plat}</p>
                                {atual && (
                                  <span className="text-[10px] text-emerald-400 font-bold">{valorAtual || fmtMoeda(0)}</span>
                                )}
                              </div>
                              <div className="relative">
                                <select
                                  disabled={isSaving}
                                  value={atual || ""}
                                  onChange={(e) => e.target.value && investir(l, plat, e.target.value)}
                                  className={`w-full appearance-none px-3 py-2.5 rounded-xl text-xs font-bold border outline-none transition-colors ${
                                    atual
                                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/40"
                                      : "bg-black/30 text-neutral-300 border-white/10"
                                  } ${isSaving ? "opacity-50" : ""}`}
                                >
                                  <option value="" disabled>
                                    Escolher playlist...
                                  </option>
                                  {PLAYLISTS[plat].map((pl) => (
                                    <option key={pl} value={pl}>
                                      {pl}
                                    </option>
                                  ))}
                                </select>
                                {isSaving ? (
                                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-emerald-400 pointer-events-none" />
                                ) : (
                                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-3.5 text-neutral-500 pointer-events-none" />
                                )}
                              </div>
                              {msg?.key === key && (
                                <p className={`mt-1 text-[10px] font-semibold ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>
                                  {msg.text}
                                </p>
                              )}
                            </div>
                          );
                        })}
                        {(grupoAtivo?.saldo ?? 0) < 0 && (
                          <p className="text-[10px] text-red-400 flex items-center gap-1 mt-1">
                            <AlertTriangle className="w-3 h-3" /> Saldo estourado — pode continuar, mas fica no vermelho.
                          </p>
                        )}
                        {plataformasPreenchidas > 0 && (
                          <button
                            onClick={() => limparInvestimentos(l)}
                            disabled={saving === `${l.linha}-limpar`}
                            className="self-start flex items-center gap-1.5 text-xs font-bold text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 mt-1"
                          >
                            {saving === `${l.linha}-limpar` ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="w-3.5 h-3.5" />
                            )}
                            Limpar tudo e recomeçar
                          </button>
                        )}
                        {msg?.key === `${l.linha}-limpar` && (
                          <p className={`text-[10px] font-semibold ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>
                            {msg.text}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </main>
  );
}
