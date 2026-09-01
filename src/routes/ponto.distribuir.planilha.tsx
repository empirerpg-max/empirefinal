import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Music2,
  TrendingUp,
  Wallet,
  Search,
  RotateCcw,
} from "lucide-react";
import { api, driveImg } from "@/lib/api";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { useDragScroll } from "@/lib/useDragScroll";

export const Route = createFileRoute("/ponto/distribuir/planilha")({
  component: PontoPlanilha,
});

const OPCOES_PONTOS: Record<string, string[]> = {
  "BILLBOARD HOT 100": ["1,00%", "2,00%", "3,00%", "4,00%", "5,00%", "6,00%", "7,00%", "8,00%", "9,00%", "10,00%"],
  SPOTIFY: ["30,00%", "40,00%", "50,00%", "60,00%", "70,00%"],
  "APPLE MUSIC": ["30,00%", "40,00%", "50,00%", "60,00%", "70,00%"],
  YOUTUBE: ["10,00%", "15,00%", "20,00%", "25,00%", "30,00%", "35,00%", "40,00%", "45,00%", "50,00%", "55,00%", "60,00%", "65,00%", "70,00%"],
  "DIGITAL SALES": ["10,00%", "15,00%", "20,00%", "25,00%", "30,00%", "35,00%", "40,00%", "45,00%", "50,00%", "55,00%", "60,00%", "65,00%", "70,00%"],
  "BILLBOARD 200": ["10,00%", "15,00%", "20,00%", "25,00%", "30,00%", "35,00%", "40,00%", "45,00%", "50,00%", "55,00%", "60,00%", "65,00%", "70,00%"],
};

function parsePercent(v: string): number {
  return parseFloat(String(v || "").replace("%", "").replace(",", ".")) || 0;
}

type PontoMusica = {
  linha: number;
  artista: string;
  musica: string;
  weeks: string;
  pontosDisponiveis: string;
  pontosUtilizados: string;
  categorias: Record<string, string>;
  dataLancamento: string;
};

type PontoGrupo = { artista: string; musicas: PontoMusica[] };

function PontoPlanilha() {
  const { user, ready } = useTelegramUser();
  const tgId = user?.id ? String(user.id) : (typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null) || "";
  const artistScroll = useDragScroll<HTMLDivElement>();

  const [grupos, setGrupos] = useState<PontoGrupo[]>([]);
  const [fotos, setFotos] = useState<Record<string, string>>({});
  const [artistaAtivo, setArtistaAtivo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [musicaSelecionada, setMusicaSelecionada] = useState<PontoMusica | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    if (!tgId) return;
    setLoading(true);
    api
      .listarPontos(tgId)
      .then((d) => {
        setGrupos(d.grupos);
        if (d.grupos.length > 0) setArtistaAtivo((cur) => cur || d.grupos[0].artista);
      })
      .catch(() => {
        setMsg({ key: "global", text: "Erro ao se conectar com a planilha PONTOS.", ok: false });
      })
      .finally(() => setLoading(false));
    api
      .meusArtistas(tgId)
      .then((artistas) => {
        const map: Record<string, string> = {};
        for (const a of artistas) map[a.nome] = a.foto;
        setFotos(map);
      })
      .catch(() => {});
  }, [tgId]);

  const grupoAtivo = useMemo(
    () => grupos.find((g) => g.artista === artistaAtivo) || null,
    [grupos, artistaAtivo],
  );

  const musicasFiltradas = useMemo(() => {
    const musicas = grupoAtivo?.musicas || [];
    const termo = busca.trim().toLowerCase();
    if (!termo) return musicas;
    return musicas.filter((m) => m.musica.toLowerCase().includes(termo));
  }, [grupoAtivo, busca]);

  async function refetchGrupos(): Promise<PontoGrupo[]> {
    const d = await api.listarPontos(tgId);
    setGrupos(d.grupos);
    return d.grupos;
  }

  // A aba PONTOS é reescrita periodicamente pelo processo de charts (a
  // música que estava na linha X pode virar outra de uma hora pra outra) —
  // se a pessoa deixa a tela aberta por um tempo, o número de linha que o
  // navegador guardou fica desatualizado e o backend recusa achando que a
  // música "não é mais dela". Localiza a linha atual da mesma música
  // (por artista+título) nos grupos recém-buscados, pra tentar de novo sem
  // a pessoa precisar recarregar a página na mão.
  function encontrarLinhaAtual(grupos: PontoGrupo[], row: PontoMusica): PontoMusica | null {
    for (const g of grupos) {
      const achada = g.musicas.find((m) => m.artista === row.artista && m.musica === row.musica);
      if (achada) return achada;
    }
    return null;
  }

  async function limparTudo(row: PontoMusica) {
    const key = `${row.linha}-limpar`;
    setSaving(key);
    setMsg(null);
    let r: any = await api.limparPontoCelula(tgId, row.linha);
    let linhaUsada = row.linha;
    if (!r?.ok && /não pertence a um artista seu/i.test(r?.error || "")) {
      const gruposAtualizados = await refetchGrupos();
      const atual = encontrarLinhaAtual(gruposAtualizados, row);
      if (atual && atual.linha !== row.linha) {
        linhaUsada = atual.linha;
        r = await api.limparPontoCelula(tgId, atual.linha);
      }
    }
    setSaving(null);
    if (r?.ok) {
      haptic.success();
      setGrupos((prev) =>
        prev.map((g) => ({
          ...g,
          musicas: g.musicas.map((m) => (m.linha === linhaUsada ? { ...m, categorias: {} } : m)),
        })),
      );
      setMusicaSelecionada((prev) => (prev && prev.linha === row.linha ? { ...prev, linha: linhaUsada, categorias: {} } : prev));
      setMsg({ key, text: "Limpo! Escolha de novo.", ok: true });
    } else {
      haptic.error();
      setMsg({ key, text: r?.error || "Erro ao limpar", ok: false });
    }
  }

  async function salvarPonto(row: PontoMusica, coluna: string, valor: string) {
    const key = `${row.linha}-${coluna}`;
    setSaving(key);
    setMsg(null);
    let r: any = await api.salvarPontoCelula(tgId, row.linha, coluna, valor);
    let linhaUsada = row.linha;
    if (!r?.ok && /não pertence a um artista seu/i.test(r?.error || "")) {
      const gruposAtualizados = await refetchGrupos();
      const atual = encontrarLinhaAtual(gruposAtualizados, row);
      if (atual && atual.linha !== row.linha) {
        linhaUsada = atual.linha;
        r = await api.salvarPontoCelula(tgId, atual.linha, coluna, valor);
      }
    }
    setSaving(null);
    if (r?.ok) {
      haptic.success();
      setGrupos((prev) =>
        prev.map((g) => ({
          ...g,
          musicas: g.musicas.map((m) =>
            m.linha === linhaUsada ? { ...m, categorias: { ...m.categorias, [coluna]: valor } } : m,
          ),
        })),
      );
      setMusicaSelecionada((prev) =>
        prev && prev.linha === row.linha
          ? { ...prev, linha: linhaUsada, categorias: { ...prev.categorias, [coluna]: valor } }
          : prev,
      );
      setMsg({ key, text: "Salvo com sucesso!", ok: true });
    } else {
      haptic.error();
      setMsg({ key, text: r?.error || "Erro ao salvar", ok: false });
    }
  }

  if (!ready || loading)
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="animate-spin text-emerald-500 w-8 h-8" />
      </div>
    );

  // === VIEW DE DETALHE DA MÚSICA ===
  if (musicaSelecionada) {
    const somaPreenchida = Object.values(musicaSelecionada.categorias || {}).reduce(
      (acc, v) => acc + parsePercent(v),
      0,
    );

    return (
      <main className="flex-1 mx-auto w-full max-w-md px-5 pt-6 pb-24 flex flex-col gap-4">
        <button
          onClick={() => {
            setMusicaSelecionada(null);
            setMsg(null);
          }}
          className="flex items-center gap-1 text-sm text-neutral-500 mb-2 hover:text-emerald-500 transition-colors w-fit"
        >
          <ChevronLeft className="w-4 h-4" /> Voltar para músicas
        </button>

        <div className="rounded-2xl border border-white/10 bg-neutral-900 p-4 flex items-start gap-3">
          <div className="size-11 rounded-xl bg-emerald-500/15 grid place-items-center shrink-0 overflow-hidden">
            {fotos[musicaSelecionada.artista] ? (
              <img
                src={driveImg(fotos[musicaSelecionada.artista])}
                alt=""
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            ) : (
              <Music2 className="size-5 text-emerald-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-emerald-500 font-black uppercase tracking-widest truncate mb-1">
              {musicaSelecionada.artista}
            </p>
            <h2 className="font-black text-lg leading-tight truncate text-white">{musicaSelecionada.musica}</h2>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-neutral-900 border border-white/10 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Wallet className="w-3.5 h-3.5 text-emerald-400" />
              <p className="text-[10px] text-neutral-500 uppercase tracking-wider font-bold">Disponível</p>
            </div>
            <p className="text-base font-black text-emerald-400">{musicaSelecionada.pontosDisponiveis || "0%"}</p>
          </div>
          <div className="rounded-2xl bg-neutral-900 border border-white/10 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
              <p className="text-[10px] text-neutral-500 uppercase tracking-wider font-bold">Utilizado</p>
            </div>
            <p className="text-base font-black text-amber-400">{musicaSelecionada.pontosUtilizados || "0%"}</p>
          </div>
          <div className="rounded-2xl bg-neutral-900 border border-white/10 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <CheckCircle2 className={`w-3.5 h-3.5 ${somaPreenchida >= 100 ? "text-emerald-400" : "text-neutral-500"}`} />
              <p className="text-[10px] text-neutral-500 uppercase tracking-wider font-bold">Soma</p>
            </div>
            <p className={`text-base font-black ${somaPreenchida >= 100 ? "text-emerald-400" : "text-white"}`}>
              {somaPreenchida.toFixed(0)}%
            </p>
          </div>
        </div>

        {somaPreenchida > 0 && (
          <button
            onClick={() => limparTudo(musicaSelecionada)}
            disabled={saving === `${musicaSelecionada.linha}-limpar`}
            className="self-start flex items-center gap-1.5 text-xs font-bold text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
          >
            {saving === `${musicaSelecionada.linha}-limpar` ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5" />
            )}
            Limpar tudo e recomeçar
          </button>
        )}
        {msg?.key === `${musicaSelecionada.linha}-limpar` && (
          <p className={`text-[10px] font-semibold -mt-2 ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>
            {msg.text}
          </p>
        )}

        <div className="flex flex-col gap-3 mt-2">
          {Object.entries(OPCOES_PONTOS).map(([coluna, opcoes]) => {
            const colKey = `${musicaSelecionada.linha}-${coluna}`;
            const salvoVal = musicaSelecionada.categorias?.[coluna] || "";
            const isSaving = saving === colKey;
            const somaOutras = somaPreenchida - parsePercent(salvoVal);

            return (
              <div key={coluna} className="rounded-2xl bg-neutral-900 border border-white/10 overflow-hidden">
                <div className="px-4 py-3 bg-white/5 border-b border-white/5 flex items-center justify-between">
                  <p className="text-xs font-black text-neutral-200 tracking-wide">{coluna}</p>
                  {salvoVal && (
                    <span className="text-[10px] bg-emerald-500/15 text-emerald-400 px-2 py-1 rounded-full flex items-center gap-1 font-bold">
                      <CheckCircle2 className="w-3 h-3" /> {salvoVal}
                    </span>
                  )}
                </div>
                <div className="p-3 grid grid-cols-3 gap-1.5">
                  {opcoes.map((op) => {
                    const sel = salvoVal === op;
                    const excede = !sel && somaOutras + parsePercent(op) > 100.001;
                    return (
                      <button
                        key={op}
                        disabled={isSaving || excede}
                        onClick={() => salvarPonto(musicaSelecionada, coluna, op)}
                        className={`px-2 py-2 rounded-lg text-xs font-bold border transition-all active:scale-95 ${
                          sel
                            ? "border-emerald-500 bg-emerald-500/15 text-emerald-400"
                            : excede
                              ? "border-white/5 bg-black/20 text-neutral-700 cursor-not-allowed"
                              : "border-white/10 bg-black/30 hover:border-emerald-500/50 text-neutral-300"
                        } ${isSaving ? "opacity-50 cursor-wait" : ""}`}
                      >
                        {op}
                      </button>
                    );
                  })}
                </div>
                {isSaving && (
                  <div className="px-4 pb-3 flex items-center gap-2 text-xs text-emerald-400">
                    <Loader2 className="w-3 h-3 animate-spin" /> Salvando...
                  </div>
                )}
                {msg?.key === colKey && (
                  <p className={`px-4 pb-3 text-xs font-semibold ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>
                    {msg.text}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </main>
    );
  }

  // === VIEW DE LISTA DE MÚSICAS (por artista) ===
  return (
    <main className="flex-1 mx-auto w-full max-w-md px-5 pt-6 pb-24 flex flex-col gap-4">
      <Link to="/ponto/distribuir" className="flex items-center gap-1 text-sm text-neutral-500 hover:text-emerald-500 mb-2 w-fit transition-colors">
        <ChevronLeft className="w-4 h-4" /> Voltar
      </Link>

      <div className="mb-2">
        <h2 className="text-2xl font-black italic tracking-tighter text-white">Pontos · Manual</h2>
        <p className="text-sm text-neutral-500 mt-1">Escolha o artista e toque numa música pra distribuir.</p>
      </div>

      {msg?.key === "global" && (
        <div className="p-4 bg-red-950/40 border border-red-500/50 rounded-2xl text-red-400 text-sm font-semibold">
          {msg.text}
        </div>
      )}

      {grupos.length === 0 && !msg ? (
        <div className="p-8 text-center bg-neutral-900 rounded-2xl border border-white/10">
          <AlertCircle className="w-8 h-8 mx-auto text-neutral-700 mb-3" />
          <p className="text-sm text-neutral-500">
            Nenhuma música encontrada na aba PONTOS para os seus artistas.
          </p>
        </div>
      ) : (
        <>
          {grupos.length > 1 && (
            <div className="relative -mx-5">
              <div
                ref={artistScroll.ref}
                {...artistScroll.dragProps}
                className="flex overflow-x-auto gap-3 scrollbar-hide px-5 pb-1 cursor-grab active:cursor-grabbing select-none"
                style={{ touchAction: "pan-x", WebkitOverflowScrolling: "touch" }}
              >
              {grupos.map((g) => {
                const ativo = artistaAtivo === g.artista;
                return (
                  <button
                    key={g.artista}
                    onClick={() => {
                      haptic.selection();
                      setArtistaAtivo(g.artista);
                      setBusca("");
                    }}
                    className="flex flex-col items-center gap-1.5 shrink-0 w-16"
                  >
                    <div
                      className={`size-14 rounded-full overflow-hidden grid place-items-center border-2 transition-all ${
                        ativo ? "border-emerald-500 scale-105" : "border-white/10 opacity-60"
                      }`}
                    >
                      {fotos[g.artista] ? (
                        <img
                          src={driveImg(fotos[g.artista])}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-emerald-500/15 grid place-items-center">
                          <Music2 className="size-5 text-emerald-500" />
                        </div>
                      )}
                    </div>
                    <p
                      className={`text-[10px] font-bold truncate w-full text-center ${
                        ativo ? "text-emerald-400" : "text-neutral-500"
                      }`}
                    >
                      {g.artista}
                    </p>
                  </button>
                );
              })}
              </div>
              <div className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-background to-transparent" />
              <div className="pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-background to-transparent" />
            </div>
          )}

          {(grupoAtivo?.musicas.length || 0) > 3 && (
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-neutral-600" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar música..."
                className="w-full h-10 bg-neutral-900 border border-white/10 rounded-xl pl-10 pr-4 text-sm font-bold text-white placeholder:text-neutral-600 outline-none focus:border-emerald-500/40 transition-colors"
              />
            </div>
          )}

          <div className="flex flex-col gap-3">
            {(grupoAtivo?.musicas || []).length === 0 ? (
              <div className="p-6 text-center bg-neutral-900 rounded-2xl border border-white/10">
                <p className="text-sm text-neutral-500">Nenhuma música de {artistaAtivo} na aba PONTOS.</p>
              </div>
            ) : musicasFiltradas.length === 0 ? (
              <div className="p-6 text-center bg-neutral-900 rounded-2xl border border-white/10">
                <p className="text-sm text-neutral-500">Nenhuma música encontrada para "{busca}".</p>
              </div>
            ) : (
              musicasFiltradas.map((row) => {
                const disponivelNum = parseFloat(String(row.pontosDisponiveis).replace("%", "").replace(",", ".")) || 0;
                const utilizadoNum = parseFloat(String(row.pontosUtilizados).replace("%", "").replace(",", ".")) || 0;

                return (
                  <button
                    key={row.linha}
                    onClick={() => {
                      haptic.selection();
                      setMusicaSelecionada(row);
                      setMsg(null);
                    }}
                    className="rounded-2xl border border-white/10 bg-neutral-900 overflow-hidden transition-colors hover:border-emerald-500/40 hover:bg-neutral-800 text-left"
                  >
                    <div className="px-4 py-4">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1 pr-4 min-w-0">
                          <p className="text-[10px] text-emerald-500 font-black uppercase tracking-widest mb-1 truncate">
                            {row.artista}
                          </p>
                          <h3 className="font-bold text-base leading-tight truncate text-white">{row.musica}</h3>
                        </div>
                        <div className="size-9 rounded-xl bg-emerald-500/15 grid place-items-center shrink-0 overflow-hidden">
                          {fotos[row.artista] ? (
                            <img
                              src={driveImg(fotos[row.artista])}
                              alt=""
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Music2 className="size-4 text-emerald-500" />
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-white/5 border border-white/5 px-3 py-2">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <Wallet className="w-3 h-3 text-emerald-400" />
                            <p className="text-[9px] text-neutral-500 uppercase tracking-wider font-bold">
                              Disponível
                            </p>
                          </div>
                          <p className="text-sm font-black text-emerald-400">{row.pontosDisponiveis || "0%"}</p>
                        </div>
                        <div className="rounded-xl bg-white/5 border border-white/5 px-3 py-2">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <TrendingUp className="w-3 h-3 text-amber-400" />
                            <p className="text-[9px] text-neutral-500 uppercase tracking-wider font-bold">
                              Utilizado
                            </p>
                          </div>
                          <p className="text-sm font-black text-amber-400">{row.pontosUtilizados || "0%"}</p>
                        </div>
                      </div>

                      {(disponivelNum > 0 || utilizadoNum > 0) && (
                        <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-amber-400 to-emerald-500 transition-all"
                            style={{
                              width: `${Math.min(100, (utilizadoNum / Math.max(1, utilizadoNum + disponivelNum)) * 100)}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </main>
  );
}
